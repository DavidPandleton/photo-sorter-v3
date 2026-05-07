import os
import sys
import shutil
import logging
import json
import datetime
import hashlib
import time
from pathlib import Path

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QLabel, QVBoxLayout, QHBoxLayout,
    QWidget, QFileDialog, QFrame, QPushButton, QMessageBox,
    QStackedWidget, QProgressBar, QScrollArea
)
from PyQt6.QtGui import QColor, QKeyEvent, QGuiApplication
from PyQt6.QtCore import Qt, QTimer, QThreadPool, QEvent


from .utils import safe_move, compute_file_metadata, MemoryBoundedCache, RAW_SUPPORTED, RAW_EXTENSIONS, NUMPY_SUPPORTED, GAMEPAD_SUPPORTED, IS_MAC, MOD_MASK
from .workers import GamepadThread, WorkerSignals, ImageLoadTask, ThumbnailTask
from .ui import ThumbnailItem, FilmstripWidget, ZoomController, PhotoViewer


logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

QGuiApplication.setHighDpiScaleFactorRoundingPolicy(
    Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
)

class PhotoSorter(QMainWindow):
    """
    The main application window. 
    Manages the application state, image library, and the export pipeline.
    """

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Photo Sorter V1")
        self.resize(1400, 900)

        self.image_paths: list[str] = []
        self.current_index = -1
        self.results: dict[str, str] = {}
        self.rotations: dict[str, int] = {}
        self.cache = MemoryBoundedCache(max_mb=1000)  # 1GB memory budget
        self.active_tasks: dict[str, ImageLoadTask] = {}
        self.thread_pool = QThreadPool()
        self.thread_pool.setMaxThreadCount(6)  # Increased for smoother preloading
        
        # Dedicated pool and cache for the filmstrip to ensure main viewer priority
        self.thumb_pool = QThreadPool()
        self.thumb_pool.setMaxThreadCount(4)
        self.thumb_cache = MemoryBoundedCache(max_mb=200)
        self.active_thumbs = {}
        self.blur_scores: dict[str, float] = {}
        
        # Gamepad Support (Optional)
        self.gamepad_thread = None
        self.gamepad_mode = False  # True if last input was gamepad
        self.left_stick = [0, 0]
        self.right_stick = [0, 0]
        
        self.settings = {
            "filmstrip_window": 15,
            "filmstrip_visible": True
        }
        self.load_settings()

        if GAMEPAD_SUPPORTED:
            self.gamepad_thread = GamepadThread()
            self.gamepad_thread.button_pressed.connect(self.handle_gamepad_input)
            self.gamepad_thread.joystick_moved.connect(self.handle_joystick_input)
            self.gamepad_thread.connection_changed.connect(self.on_gamepad_connection_changed)
            self.gamepad_thread.start()

            self.stick_timer = QTimer(self)
            self.stick_timer.setInterval(16)
            self.stick_timer.timeout.connect(self.process_joysticks)
            self.stick_timer.start()
        else:
            logging.info("Gamepad support disabled: 'inputs' library not found.")

        self.root_folder = ""
        self.is_processing = False
        self.side_layout: QVBoxLayout | None = None

        self.stack = QStackedWidget()
        self.setCentralWidget(self.stack)

        self.setup_styles()
        self.setup_menu_bar()
        self.build_menu_ui()
        self.build_main_ui()

        self.menu_focus_index = 0
        self.stack.setCurrentIndex(0)

    def setup_menu_bar(self):
        menubar = self.menuBar()
        if IS_MAC:
            menubar.setNativeMenuBar(True)

        file_menu = menubar.addMenu("File")

        act_open = file_menu.addAction("Open Folder")
        act_open.triggered.connect(self.select_folder)
        act_open.setShortcut("Ctrl+O")  # Qt maps Ctrl to Cmd on Mac for shortcuts

        act_restore = file_menu.addAction("Restore Checkpoint")
        act_restore.triggered.connect(self.restore_checkpoint)

        file_menu.addSeparator()

        act_exit = file_menu.addAction("Exit")
        act_exit.triggered.connect(self.close)
        act_exit.setShortcut("Ctrl+Q")

        settings_menu = menubar.addMenu("Settings")
        act_film_size = settings_menu.addAction("Filmstrip Window Size")
        act_film_size.triggered.connect(self.change_filmstrip_size)

    def setup_styles(self):
        self.setStyleSheet("""
            QMainWindow { background-color: #0c0c0c; }
            QWidget { color: #f0f0f0; font-family: 'Segoe UI Variable Text', 'Segoe UI', 'Roboto', 'Inter', sans-serif; }
            #SidePanel { background-color: #121212; border-right: 1px solid #252525; }
            #TopBar { background-color: #121212; border-bottom: 1px solid #252525; min-height: 65px; }
            #Title { font-size: 18px; font-weight: 800; color: #42a5f5; letter-spacing: 1px; padding-left: 20px; }
            
            QPushButton { 
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #2d2d2d, stop:1 #252525); 
                border: 1px solid #3d3d3d; 
                padding: 10px 20px; 
                border-radius: 6px; 
                font-weight: 600; 
                min-height: 38px;
            }
            QPushButton:hover { background-color: #353535; border-color: #454545; }
            QPushButton:focus { border: 2px solid #42a5f5; background-color: #3a3a3a; }
            QPushButton#ActionBtn { 
                background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #42a5f5, stop:1 #1e88e5); 
                color: white; 
                border: none;
                padding: 10px 25px;
            }
            QPushButton#ActionBtn:hover { background-color: #64b5f6; }

            #HotkeyLabel { 
                font-size: 13px; 
                padding: 12px; 
                border-radius: 8px; 
                background-color: #1a1a1a; 
                border: 1px solid #252525;
                color: #aaa;
            }
            
            #StatCard { 
                background-color: #1a1a1a; 
                padding: 18px; 
                border-radius: 10px; 
                margin-bottom: 12px; 
                border: 1px solid #252525; 
            }
            #StatValue { font-size: 28px; font-weight: bold; color: #fff; padding: 0px 5px; }
            #StatTitle { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; }
            
            #MenuTitle { font-size: 56px; font-weight: 900; color: #42a5f5; margin-bottom: 40px; letter-spacing: -1px; }
            
            QProgressBar {
                background-color: #1a1a1a;
                border: none;
                height: 4px;
                max-height: 4px;
                border-radius: 0px;
            }
            QProgressBar::chunk {
                background-color: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #42a5f5, stop:1 #64b5f6);
            }
        """)

    def build_menu_ui(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.setSpacing(20)

        title = QLabel("PHOTO SORTER V1")
        title.setObjectName("MenuTitle")
        layout.addWidget(title, alignment=Qt.AlignmentFlag.AlignCenter)

        btn_start = QPushButton("Start Sorting")
        btn_start.setFixedSize(300, 60)
        btn_start.clicked.connect(self.select_folder)
        layout.addWidget(btn_start, alignment=Qt.AlignmentFlag.AlignCenter)

        btn_restore = QPushButton("Restore Checkpoint")
        btn_restore.setFixedSize(300, 60)
        btn_restore.clicked.connect(self.restore_from_menu)
        layout.addWidget(btn_restore, alignment=Qt.AlignmentFlag.AlignCenter)

        btn_exit = QPushButton("Exit")
        btn_exit.setFixedSize(300, 60)
        btn_exit.clicked.connect(self.close)
        layout.addWidget(btn_exit, alignment=Qt.AlignmentFlag.AlignCenter)

        self.menu_buttons = [btn_start, btn_restore, btn_exit]
        # Set initial focus for gamepad navigation
        btn_start.setFocus()

        self.stack.addWidget(page)

    def build_main_ui(self):
        page = QWidget()
        main_layout = QVBoxLayout(page)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        self.top_bar = QWidget()
        self.top_bar.setObjectName("TopBar")
        top_layout = QHBoxLayout(self.top_bar)
        title = QLabel("PHOTO SORTER V1")
        title.setObjectName("Title")
        top_layout.addWidget(title)
        top_layout.addStretch()

        btn_back = QPushButton("Back to Menu")
        btn_back.clicked.connect(self.confirm_return_to_menu)
        top_layout.addWidget(btn_back)

        btn_restore = QPushButton("Restore Checkpoint")
        btn_restore.clicked.connect(self.restore_checkpoint)
        top_layout.addWidget(btn_restore)

        btn_export = QPushButton("Finish Export")
        btn_export.setObjectName("ActionBtn")
        btn_export.clicked.connect(self.finish_sorting)
        top_layout.addWidget(btn_export)

        self.progress_bar = QProgressBar()
        self.progress_bar.setTextVisible(False)
        main_layout.addWidget(self.progress_bar)

        main_layout.addWidget(self.top_bar)

        content = QWidget()
        content_layout = QHBoxLayout(content)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        self.side_scroll = QScrollArea()
        self.side_scroll.setObjectName("SidePanel")
        self.side_scroll.setWidgetResizable(True)
        self.side_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.side_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.side_scroll.setFixedWidth(300)
        self.side_scroll.setStyleSheet("QScrollArea { border: none; border-right: 1px solid #252525; } QScrollBar:vertical { width: 4px; background: transparent; } QScrollBar::handle:vertical { background: #444; border-radius: 2px; }")

        self.side_panel = QFrame()
        self.side_panel.setStyleSheet("background-color: #121212;")
        self.side_layout = QVBoxLayout(self.side_panel)
        self.side_layout.setContentsMargins(20, 20, 20, 20)

        self.create_hotkey_panel()
        self.side_layout.addSpacing(20)
        self.create_stats_panel()
        self.side_layout.addStretch()
        self.create_info_panel()

        self.side_scroll.setWidget(self.side_panel)
        
        # Add Side Panel first so it appears on the LEFT
        content_layout.addWidget(self.side_scroll)
        
        # Add PhotoViewer second so it appears on the RIGHT
        self.viewer = PhotoViewer()
        content_layout.addWidget(self.viewer, 1)
        main_layout.addWidget(content)
        
        # Filmstrip Navigator at the bottom
        self.filmstrip = FilmstripWidget()
        self.filmstrip.image_selected.connect(self.jump_to_image_by_path)
        main_layout.addWidget(self.filmstrip)

        self.stack.addWidget(page)
        self.adjust_layout_to_screen()

    def create_hotkey_panel(self) -> None:
        """Builds the controls legend in the side panel."""
        self.hotkey_container = QWidget()
        self.hotkey_vbox = QVBoxLayout(self.hotkey_container)
        self.hotkey_vbox.setContentsMargins(15, 15, 15, 15)
        self.hotkey_vbox.setSpacing(10)
        self.hotkey_container.setStyleSheet("background-color: #1a1a1a; border-radius: 10px; border: 1px solid #252525;")

        title = QLabel("CONTROLS")
        title.setStyleSheet("color: #666; font-weight: bold; font-size: 10px; letter-spacing: 1px; border: none;")
        self.hotkey_vbox.addWidget(title)

        self.hotkey_label = QLabel()
        self.hotkey_label.setWordWrap(True)
        self.hotkey_label.setStyleSheet("font-size: 13px; color: #ccc; border: none; line-height: 1.5;")
        self.hotkey_vbox.addWidget(self.hotkey_label)
        
        self.side_layout.addWidget(self.hotkey_container)
        self.update_hotkey_hud()

    def toggle_hotkey_hud(self) -> None:
        """Toggles the visibility of the hotkey panel."""
        is_visible = self.hotkey_container.isVisible()
        self.hotkey_container.setVisible(not is_visible)

    def update_hotkey_hud(self) -> None:
        """Switches HUD between keyboard and gamepad based on last input."""
        if self.gamepad_mode:
            hk = [
                "<span style='color:#ef5350'>[B / ○]</span> BAD",
                "<span style='color:#ffca28'>[X / □]</span> OK",
                "<span style='color:#66bb6a'>[A / ✕]</span> GOOD",
                "<b>[LB/RB]</b> Prev / Next",
                "<b>[L-Stick]</b> Pan | <b>[R-Stick]</b> Zoom",
                "<b>[LT/RT]</b> Rot | <b>[Start]</b> Export",
                "<b>[R-Thumb]</b> Toggle HUD",
            ]
        else:
            hk = [
                "<span style='color:#ef5350'>[1]</span> BAD",
                "<span style='color:#ffca28'>[2]</span> OK",
                "<span style='color:#66bb6a'>[3]</span> GOOD",
                "<b>[P/N]</b> Prev / Next | <b>[H]</b> HUD",
                "<b>[CTRL +/-]</b> Zoom",
                "<b>[F]</b> Fullscreen | <b>[ESC]</b> Exit",
            ]
        
        html = "<br><br>".join(hk)
        self.hotkey_label.setText(html)

    def create_stats_panel(self) -> None:
        """Builds the category counters in the side panel."""
        self.stat_widgets = {}
        # Refined colors and symbols for a professional look
        symbols = {"BAD": "●", "OK": "●", "GOOD": "●"}
        colors = {"BAD": "#ef5350", "OK": "#ffca28", "GOOD": "#66bb6a"}
        
        for cat in ["BAD", "OK", "GOOD"]:
            card = QFrame()
            card.setObjectName("StatCard")
            layout = QVBoxLayout(card)
            layout.setSpacing(4)
            
            title_label = QLabel(f"<span style='color:{colors[cat]}'>{symbols[cat]}</span> {cat}")
            title_label.setObjectName("StatTitle")
            
            value_label = QLabel("0")
            value_label.setObjectName("StatValue")
            
            layout.addWidget(title_label)
            layout.addWidget(value_label)
            if self.side_layout:
                self.side_layout.addWidget(card)
            self.stat_widgets[cat] = value_label

    def create_info_panel(self):
        self.info_progress = QLabel("0 / 0")
        self.info_progress.setStyleSheet("font-size: 18px; font-weight: bold;")
        self.info_filename = QLabel("-")
        self.info_filename.setWordWrap(True)
        self.info_filename.setStyleSheet("color: #aaa;")
        self.info_type = QLabel("-")
        self.info_type.setStyleSheet("color: #42a5f5; font-weight: bold;")
        self.side_layout.addWidget(self.info_progress)
        self.side_layout.addWidget(self.info_filename)
        self.side_layout.addWidget(self.info_type)

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Folder")
        if folder:
            self.load_images(folder)

    def restore_from_menu(self):
        folder = QFileDialog.getExistingDirectory(
            self, "Select folder that contains the checkpoint"
        )
        if folder:
            self.root_folder = os.path.abspath(folder)
            self.restore_checkpoint()

    def load_images(self, folder):
        self.root_folder = os.path.abspath(folder)
        exts = {".jpg", ".jpeg", ".png", ".webp"} | set(RAW_EXTENSIONS)
        self.image_paths = []
        managed = {"BAD", "OK", "GOOD"}
        for r, _, fs in os.walk(self.root_folder):
            rel_path = Path(r).relative_to(self.root_folder)
            if any(part.upper() in managed for part in rel_path.parts):
                continue
            for f in fs:
                if Path(f).suffix.lower() in exts:
                    self.image_paths.append(os.path.abspath(os.path.join(r, f)))

        if not self.image_paths:
            QMessageBox.warning(
                self, "No Images", "Folder is empty or formats not supported."
            )
            return

        cp_path = os.path.join(self.root_folder, ".photosorter_checkpoint.json")
        overwrite = True
        if os.path.exists(cp_path):
            ans = QMessageBox.question(
                self,
                "Checkpoint Exists",
                "A previous checkpoint was found. Do you want to replace it?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if ans == QMessageBox.StandardButton.No:
                overwrite = False

        if overwrite:
            self.create_checkpoint()

        self.current_index = 0
        self.results = {}
        self.filmstrip.rebuild(self.image_paths)
        self.update_stats()
        self.stack.setCurrentIndex(1)
        self.display_current()

    def load_settings(self):
        """Loads app-level configuration from settings.json."""
        try:
            if os.path.exists("settings.json"):
                with open("settings.json", "r") as f:
                    self.settings.update(json.load(f))
        except:
            pass

    def save_settings(self):
        """Saves app-level configuration to settings.json."""
        try:
            with open("settings.json", "w") as f:
                json.dump(self.settings, f, indent=2)
        except:
            pass

    def change_filmstrip_size(self):
        """Allows the user to adjust the number of thumbnails preloaded in the strip."""
        from PyQt6.QtWidgets import QInputDialog
        val, ok = QInputDialog.getInt(
            self, "Filmstrip Size", 
            "Number of thumbnails to preload around current image:", 
            self.settings["filmstrip_window"], 5, 50
        )
        if ok:
            self.settings["filmstrip_window"] = val
            self.save_settings()
            self.display_current()

    def reset_to_menu(self):
        for task in self.active_tasks.values():
            task.cancel()
        self.active_tasks.clear()
        self.thread_pool.clear()

        self.image_paths = []
        self.results = {}
        self.cache.clear()
        self.current_index = -1
        self.root_folder = ""
        self.stack.setCurrentIndex(0)
        self.adjust_layout_to_screen()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.adjust_layout_to_screen()

    def adjust_layout_to_screen(self):
        if not hasattr(self, "side_panel") or not self.side_panel:
            return

        # Detect active screen and orientation
        screen = self.screen()
        if not screen:
            return

        # We check the window geometry relative to the screen
        win_geom = self.geometry()
        is_portrait = win_geom.height() > win_geom.width()

        # Adjust Side Panel width based on orientation
        target_width = 300  # Prevent HUD clipping on vertical displays
        if hasattr(self, "side_scroll") and self.side_scroll.width() != target_width:
            self.side_scroll.setFixedWidth(target_width)

        # Force re-fit of image
        QTimer.singleShot(50, self.viewer.force_fit)

    def confirm_return_to_menu(self):
        if len(self.results) > 0:
            ans = QMessageBox.question(
                self,
                "Confirm Exit",
                "You have started sorting images. Are you sure you want to return to the main menu?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if ans != QMessageBox.StandardButton.Yes:
                return
        self.reset_to_menu()

    def create_checkpoint(self, created_folders=None, operations=None):
        cp_path = os.path.join(self.root_folder, ".photosorter_checkpoint.json")
        data = {}
        if os.path.exists(cp_path):
            try:
                with open(cp_path, "r") as f:
                    data = json.load(f)
            except Exception:
                # If corrupted, start a fresh data structure
                pass

        if not data or data.get("version") != "2.0":
            data = {
                "version": "2.0",
                "root": self.root_folder,
                "created_by": "PhotoSorterV1",
                "created_at": datetime.datetime.now().isoformat(),
                "created_folders": [],
                "operations": [],
            }

        if created_folders:
            existing_folders = data.get("created_folders", [])
            for f in created_folders:
                if f not in existing_folders:
                    existing_folders.append(f)
            data["created_folders"] = existing_folders

        if operations:
            data.setdefault("operations", []).extend(operations)

        # Atomic write
        tmp_path = cp_path + ".tmp"
        try:
            with open(tmp_path, "w") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_path, cp_path)
            logging.info(f"Checkpoint updated: {cp_path}")
        except Exception as e:
            logging.error(f"Checkpoint failed: {e}")
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    def request_load(self, path, is_preload=False):
        if path in self.cache or path in self.active_tasks:
            return

        task = ImageLoadTask(path, is_preload)
        self.active_tasks[path] = task

        task.signals.loaded.connect(self.on_image_loaded)
        task.signals.error.connect(self.on_image_error)

        # Current image gets higher priority (0 is higher priority in QRunnable if supported, but start() priority argument works: higher number = higher priority)
        priority = 0 if is_preload else 10
        self.thread_pool.start(task, priority)

    def display_current(self):
        if 0 <= self.current_index < len(self.image_paths):
            path = self.image_paths[self.current_index]
            self.update_info_panel(path)
            
            # Update Filmstrip state
            self.filmstrip.set_active(path)
            
            # Request thumbnails for a window around the current image
            window_size = self.settings.get("filmstrip_window", 15)
            start = max(0, self.current_index - window_size)
            end = min(len(self.image_paths), self.current_index + window_size)
            for i in range(start, end):
                self.request_thumb(self.image_paths[i])

            qimage = self.cache.get(path)
            rotation = self.rotations.get(path, 0)
            if qimage:
                self.viewer.set_image(qimage, rotation)
            else:
                self.request_load(path, is_preload=False)

            self.update_preload_window()
        else:
            self.current_index = max(
                0, min(self.current_index, len(self.image_paths) - 1)
            )

    def update_preload_window(self):
        # Sliding window: Prev 1, Current, Next 1-3
        window_indices = []
        if self.current_index > 0:
            window_indices.append(self.current_index - 1)
        # Preload 5 images ahead for smoother fast-culling
        for i in range(1, 6):
            if self.current_index + i < len(self.image_paths):
                window_indices.append(self.current_index + i)

        target_paths = set(self.image_paths[i] for i in window_indices)

        # Cancel tasks outside the window
        for p, task in list(self.active_tasks.items()):
            if p != self.image_paths[self.current_index] and p not in target_paths:
                task.cancel()
                del self.active_tasks[p]

        # Start preload tasks
        for p in target_paths:
            self.request_load(p, is_preload=True)

    def update_info_panel(self, path):
        self.info_progress.setText(
            f"{self.current_index + 1} / {len(self.image_paths)}"
        )
        self.info_filename.setText(os.path.basename(path))
        ext = Path(path).suffix[1:].upper()
        self.info_type.setText(
            f"{ext} {'(RAW)' if f'.{ext.lower()}' in RAW_EXTENSIONS else ''}"
        )

    def update_stats(self):
        counts = {"BAD": 0, "OK": 0, "GOOD": 0}
        for cat in self.results.values():
            if cat in counts:
                counts[cat] += 1
        for cat, val in counts.items():
            if cat in self.stat_widgets:
                self.stat_widgets[cat].setText(str(val))
        
        # Update high-end progress bar
        total = len(self.image_paths)
        if total > 0:
            progress_val = int(((self.current_index + 1) / total) * 100)
            self.progress_bar.setValue(progress_val)

    def on_image_loaded(self, path, qimage):
        if path in self.active_tasks:
            del self.active_tasks[path]

        self.cache.put(path, qimage)

        if self.stack.currentIndex() == 1 and 0 <= self.current_index < len(
            self.image_paths
        ):
            if path == self.image_paths[self.current_index]:
                rotation = self.rotations.get(path, 0)
                self.viewer.set_image(qimage, rotation)

    def on_image_error(self, path, err):
        if path in self.active_tasks:
            del self.active_tasks[path]
        logging.error(f"Error loading {path}: {err}")

    def jump_to_image_by_path(self, path: str):
        """Jumps to a specific image when clicked in the filmstrip."""
        if path in self.image_paths:
            self.current_index = self.image_paths.index(path)
            self.display_current()

    def request_thumb(self, path: str):
        """Requests a low-resolution thumbnail for the filmstrip."""
        if path in self.thumb_cache:
            blur = self.blur_scores.get(path, 0.0)
            self.filmstrip.set_thumbnail(path, self.thumb_cache.get(path), blur)
            return
        
        if path in self.active_thumbs:
            return
            
        task = ThumbnailTask(path)
        task.signals.thumb_loaded.connect(self.on_thumb_loaded)
        self.active_thumbs[path] = task
        self.thumb_pool.start(task)

    def on_thumb_loaded(self, path, qimage, blur_score):
        """Callback for when a thumbnail finishes background loading."""
        if path in self.active_thumbs:
            del self.active_thumbs[path]
        
        self.thumb_cache.put(path, qimage)
        self.blur_scores[path] = blur_score
        self.filmstrip.set_thumbnail(path, qimage, blur_score)

    def next_image(self) -> None:
        """Moves to the next image in the library."""
        if self.current_index < len(self.image_paths) - 1:
            self.current_index += 1
            self.display_current()

    def prev_image(self) -> None:
        """Moves to the previous image in the library."""
        if self.current_index > 0:
            self.current_index -= 1
            self.display_current()

    def rate_current_image(self, category: str, color: QColor) -> None:
        """Rates the current image and triggers the feedback animation."""
        if self.current_index < 0 or self.is_processing:
            return
        self.is_processing = True
        self.results[self.image_paths[self.current_index]] = category
        self.viewer.flash(color)
        self.filmstrip.update_rating(self.image_paths[self.current_index], category)
        self.update_stats()
        # Reduced delay from 250ms to 100ms for faster sorting workflow
        QTimer.singleShot(100, self.after_rating)

    def rotate_current_image(self, direction: int) -> None:
        """Rotates the current image by 90 degrees (1 for right, -1 for left)."""
        if self.current_index < 0 or self.is_processing:
            return
        path = self.image_paths[self.current_index]
        current_rot = self.rotations.get(path, 0)
        new_rot = (current_rot + (direction * 90)) % 360
        self.rotations[path] = new_rot
        self.viewer.set_rotation(new_rot)

    def handle_joystick_input(self, axis: str, value: int) -> None:
        """Stores the current state of joystick axes and switches mode."""
        # Normalize axes (Xbox RX/RY vs PS Z/RZ)
        if axis == "ABS_X":
            self.left_stick[0] = value
        elif axis == "ABS_Y":
            self.left_stick[1] = value
        elif axis in ["ABS_RX", "ABS_Z"]:
            self.right_stick[0] = value
        elif axis in ["ABS_RY", "ABS_RZ"]:
            self.right_stick[1] = value

        # Switch to gamepad HUD if joystick is moved significantly
        if axis in ["ABS_X", "ABS_Y", "ABS_RX", "ABS_RY", "ABS_Z", "ABS_RZ"] and abs(value) > 8000:
            if not self.gamepad_mode:
                self.gamepad_mode = True
                self.update_hotkey_hud()

    def on_gamepad_connection_changed(self, connected: bool) -> None:
        """Updates the UI HUD when a gamepad is connected or disconnected."""
        if not connected and self.gamepad_mode:
            self.gamepad_mode = False
            self.update_hotkey_hud()
            logging.info("Gamepad disconnected. HUD reverted to keyboard.")
        elif connected:
            logging.info("Gamepad connected.")

    def process_joysticks(self) -> None:
        """Processes the stored joystick states for smooth panning and zooming."""
        if self.stack.currentIndex() != 1:
            return

        # Panning with Left Stick
        lx, ly = self.left_stick
        deadzone = 8000
        if abs(lx) > deadzone or abs(ly) > deadzone:
            # Scale input to reasonable movement speed
            step_x = (lx // 1000) if abs(lx) > deadzone else 0
            # Invert Y axis so that pushing Up reveals the top of the image
            step_y = -(ly // 1000) if abs(ly) > deadzone else 0
            
            h_bar = self.viewer.horizontalScrollBar()
            v_bar = self.viewer.verticalScrollBar()
            h_bar.setValue(h_bar.value() + step_x)
            v_bar.setValue(v_bar.value() + step_y)

        # Zooming with Right Stick Y (Up/Down)
        # Up is typically negative in many drivers for Xbox 360
        ry = self.right_stick[1]
        if abs(ry) > deadzone:
            # Invert ry if up should zoom in (ry < 0 is usually Up)
            zoom_factor = 1.03 if ry < 0 else 0.97
            self.viewer.zoom_controller.apply_zoom_at_center(zoom_factor)

    def handle_gamepad_input(self, code: str) -> None:
        """Handles Universal Gamepad button mapping (Xbox, PS2-PS5)."""
        if not self.gamepad_mode:
            self.gamepad_mode = True
            self.update_hotkey_hud()

        # Multi-Standard Normalization
        is_confirm = code in ["BTN_SOUTH", "BTN_THUMB", "BTN_A"]
        is_back = code in ["BTN_EAST", "BTN_THUMB2", "BTN_B"]
        is_ok = code in ["BTN_WEST", "BTN_PINKIE", "BTN_X"]
        is_reset = code in ["BTN_NORTH", "BTN_TOP", "BTN_Y"]
        
        # Handle Modal Dialogs (Popups)
        modal = QApplication.activeModalWidget()
        if modal:
            if code in ["DPAD_LEFT", "DPAD_RIGHT"]:
                # Cycle through buttons using Tab/Backtab logic
                key = Qt.Key.Key_Tab if code == "DPAD_RIGHT" else Qt.Key.Key_Backtab
                ev = QKeyEvent(QEvent.Type.KeyPress, key, Qt.KeyboardModifier.NoModifier)
                QApplication.sendEvent(modal, ev)
            elif is_confirm:  # A / Cross -> Click focused button
                focus_widget = modal.focusWidget()
                if focus_widget:
                    if isinstance(focus_widget, QPushButton):
                        focus_widget.click()
            elif is_back:  # B / Circle -> Close/Reject
                if hasattr(modal, "reject"):
                    modal.reject()
                else:
                    modal.close()
            return

        # Menu Navigation
        if self.stack.currentIndex() == 0:
            if code == "DPAD_UP":
                self.menu_focus_index = (self.menu_focus_index - 1) % len(self.menu_buttons)
                self.menu_buttons[self.menu_focus_index].setFocus()
            elif code == "DPAD_DOWN":
                self.menu_focus_index = (self.menu_focus_index + 1) % len(self.menu_buttons)
                self.menu_buttons[self.menu_focus_index].setFocus()
            elif is_confirm:  # A / Cross -> Click
                self.menu_buttons[self.menu_focus_index].click()
            return

        if self.is_processing:
            return

        # Rating: A/Cross (Good), B/Circle (Bad), X/Square (OK)
        if is_confirm:
            self.rate_current_image("GOOD", QColor(102, 187, 106))
        elif is_back:
            self.rate_current_image("BAD", QColor(239, 83, 80))
        elif is_ok:
            self.rate_current_image("OK", QColor(255, 202, 40))
        # Navigation: D-Pad or Bumpers
        elif code in ["DPAD_RIGHT", "BTN_TR"]:  # RB / R1
            self.next_image()
        elif code in ["DPAD_LEFT", "BTN_TL"]:   # LB / L1
            self.prev_image()
        # Rotation Triggers
        elif code in ["TRIGGER_LEFT", "BTN_TL2"]:  # LT / L2
            self.rotate_current_image(-1)
        elif code in ["TRIGGER_RIGHT", "BTN_TR2"]: # RT / R2
            self.rotate_current_image(1)
        # Extras
        elif is_reset:  # Y / Triangle (Reset Zoom)
            self.viewer.force_fit()
        elif code == "BTN_SELECT": # Select / Share (Back to Menu)
            self.confirm_return_to_menu()
        elif code == "BTN_START":  # Start / Options (Finalize)
            self.finish_sorting()
        elif code == "BTN_THUMBR": # Right Stick Click (HUD)
            self.toggle_hotkey_hud()

    def keyPressEvent(self, a0: QKeyEvent) -> None:
        """Central keyboard event handler for navigation and rating."""
        if self.gamepad_mode:
            self.gamepad_mode = False
            self.update_hotkey_hud()

        if a0.isAutoRepeat():
            return

        # Menu Navigation
        if self.stack.currentIndex() == 0:
            key = a0.key()
            if key == Qt.Key.Key_Up:
                self.menu_focus_index = (self.menu_focus_index - 1) % len(self.menu_buttons)
                self.menu_buttons[self.menu_focus_index].setFocus()
            elif key == Qt.Key.Key_Down:
                self.menu_focus_index = (self.menu_focus_index + 1) % len(self.menu_buttons)
                self.menu_buttons[self.menu_focus_index].setFocus()
            return

        if self.stack.currentIndex() != 1 or self.is_processing:
            return

        key = a0.key()
        mod = a0.modifiers()

        if key == Qt.Key.Key_Escape:
            self.confirm_return_to_menu()
            return
        elif key in [Qt.Key.Key_Return, Qt.Key.Key_Enter]:
            self.finish_sorting()
            return
        elif key == Qt.Key.Key_F:
            if self.windowState() & Qt.WindowState.WindowFullScreen:
                self.setWindowState(Qt.WindowState.WindowNoState)
            else:
                self.setWindowState(Qt.WindowState.WindowFullScreen)
            QTimer.singleShot(100, self.adjust_layout_to_screen)
            return
        elif key == Qt.Key.Key_H:
            self.toggle_hotkey_hud()
            return

        if mod & MOD_MASK:
            if key in [Qt.Key.Key_Plus, Qt.Key.Key_Equal]:
                self.viewer.zoom_controller.apply_zoom(1.2)
            elif key == Qt.Key.Key_Minus:
                self.viewer.zoom_controller.apply_zoom(0.8)
            elif key == Qt.Key.Key_0:
                self.viewer.force_fit()
            return

        if self.current_index < 0:
            return

        if key == Qt.Key.Key_N:
            self.next_image()
        elif key == Qt.Key.Key_P:
            self.prev_image()
        elif key == Qt.Key.Key_1:
            self.rate_current_image("BAD", QColor(239, 83, 80))
        elif key == Qt.Key.Key_2:
            self.rate_current_image("OK", QColor(255, 202, 40))
        elif key == Qt.Key.Key_3:
            self.rate_current_image("GOOD", QColor(102, 187, 106))
        elif key == Qt.Key.Key_R:
            if mod & Qt.KeyboardModifier.ShiftModifier:
                self.rotate_current_image(-1)
            else:
                self.rotate_current_image(1)

    def after_rating(self):
        self.next_image()
        self.is_processing = False

    def finish_sorting(self):
        if not self.results:
            return
        moved_count = 0
        newly_created = []
        operations = []

        for path, category in self.results.items():
            try:
                # Option A: Preserve relative path hierarchy
                rel_path = Path(path).relative_to(self.root_folder)
                target_path = os.path.join(self.root_folder, category, str(rel_path))
                target_dir = os.path.dirname(target_path)

                # We need to track created folders relative to root for cleanup
                rel_target_dir = str(Path(target_dir).relative_to(self.root_folder))

                if not os.path.exists(target_dir):
                    os.makedirs(target_dir, exist_ok=True)
                    # Track all created subdirectories safely
                    parts = Path(rel_target_dir).parts
                    curr = ""
                    for p in parts:
                        curr = os.path.join(curr, p) if curr else p
                        if curr not in newly_created:
                            newly_created.append(curr)

                if os.path.exists(path):
                    size, sha1 = compute_file_metadata(path)
                    safe_move(path, target_path)
                    moved_count += 1

                    operations.append(
                        {
                            "original_path": path,
                            "exported_path": target_path,
                            "category": category,
                            "status": "completed",
                            "size": size,
                            "sha1": sha1,
                        }
                    )
            except Exception as e:
                logging.error(f"Move failed for {path}: {e}")

        self.create_checkpoint(created_folders=newly_created, operations=operations)

        summary = {"BAD": 0, "OK": 0, "GOOD": 0}
        for cat in self.results.values():
            summary[cat] += 1
        msg = f"Export Finished!\nMoved: {moved_count} files.\n"
        msg += f"BAD: {summary['BAD']} | OK: {summary['OK']} | GOOD: {summary['GOOD']}"
        QMessageBox.information(self, "Export Complete", msg)
        self.reset_to_menu()

    def restore_checkpoint(self):
        cp_path = os.path.join(self.root_folder, ".photosorter_checkpoint.json")
        if not os.path.exists(cp_path):
            QMessageBox.warning(
                self,
                "Restore",
                "No checkpoint file found in this folder.\n(Make sure you select the root folder of your project)",
            )
            return

        ans = QMessageBox.question(
            self, "Restore Checkpoint", "Restore all files and clean generated folders?"
        )
        if ans != QMessageBox.StandardButton.Yes:
            return

        try:
            with open(cp_path, "r") as f:
                data = json.load(f)
            restored = 0

            if data.get("version") == "2.0":
                # V2 Schema
                operations = data.get("operations", [])
                for op in operations:
                    orig = op.get("original_path")
                    exp = op.get("exported_path")
                    if os.path.exists(exp):
                        os.makedirs(os.path.dirname(orig), exist_ok=True)
                        safe_move(exp, orig)
                        restored += 1
            else:
                # Fallback for V1 schema
                for original_path in data.get("files", []):
                    if os.path.exists(original_path):
                        continue
                    filename = os.path.basename(original_path)
                    for cat in ["BAD", "OK", "GOOD"]:
                        search_path = os.path.join(self.root_folder, cat, filename)
                        if os.path.exists(search_path):
                            os.makedirs(os.path.dirname(original_path), exist_ok=True)
                            safe_move(search_path, original_path)
                            restored += 1
                            break

            removed_folders = 0
            # Sort created folders by depth descending, so we remove children before parents
            folders = data.get("created_folders", [])
            folders.sort(key=lambda x: len(Path(x).parts), reverse=True)

            for folder in folders:
                fpath = os.path.join(self.root_folder, folder)
                if os.path.exists(fpath) and not os.listdir(fpath):
                    try:
                        os.rmdir(fpath)
                        removed_folders += 1
                    except Exception:
                        # Folder might not be empty or permission denied
                        pass

            QMessageBox.information(
                self,
                "Restore",
                f"Restored {restored} files.\nRemoved {removed_folders} empty generated folders.",
            )
            if self.stack.currentIndex() == 1:
                self.load_images(self.root_folder)
        except Exception as e:
            logging.error(f"Restore failed: {e}")

    def closeEvent(self, a0: QEvent) -> None:
        """Ensures the user confirms exit if sorting is in progress."""
        if self.stack.currentIndex() == 1 and len(self.results) > 0:
            ans = QMessageBox.question(
                self,
                "Confirm Exit",
                "You have started sorting images. Are you sure you want to exit?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if ans == QMessageBox.StandardButton.Yes:
                a0.accept()
            else:
                a0.ignore()
        else:
            a0.accept()



