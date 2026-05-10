import json
import logging
import os
from pathlib import Path

from PyQt6.QtCore import QEvent, Qt, QThreadPool, QTimer
from PyQt6.QtGui import QColor, QGuiApplication, QKeyEvent
from PyQt6.QtWidgets import (
    QApplication,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from .controller import PhotoController
from .exif import format_exif_for_display
from .ui import FilmstripWidget, PhotoViewer
from .utils import (
    GAMEPAD_SUPPORTED,
    IS_MAC,
    MOD_MASK,
    MemoryBoundedCache,
)
from .widgets import DateBrowser, FolderBrowser, SearchBar
from .workers import GamepadThread, ImageLoadTask, ThumbnailTask

QGuiApplication.setHighDpiScaleFactorRoundingPolicy(
    Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
)

BASE_DIR = Path(__file__).resolve().parent.parent


class PhotoSorter(QMainWindow):
    """
    The main application window.
    Delegates all business logic to PhotoController.
    """

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Photo Sorter V1")
        self.resize(1400, 900)

        self.thread_pool = QThreadPool()
        self.thread_pool.setMaxThreadCount(6)

        self.thumb_pool = QThreadPool()
        self.thumb_pool.setMaxThreadCount(4)
        self.thumb_cache = MemoryBoundedCache(max_mb=200)
        self.active_thumbs = {}
        self.cache = MemoryBoundedCache(max_mb=1000)
        self.active_tasks: dict[str, ImageLoadTask] = {}

        # Gamepad
        self.gamepad_thread = None
        self.gamepad_mode = False
        self.left_stick = [0, 0]
        self.right_stick = [0, 0]
        self.settings = {"filmstrip_window": 15, "filmstrip_visible": True}
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

        self.is_processing = False
        self.folder_browser: FolderBrowser | None = None
        self.search_bar: SearchBar | None = None
        self.date_browser: DateBrowser | None = None
        self.side_layout: QVBoxLayout | None = None

        # Controller — owns all state and business logic
        self.ctrl = PhotoController()
        self._connect_controller_signals()

        self.stack = QStackedWidget()
        self.setCentralWidget(self.stack)

        self.setup_styles()
        self.setup_menu_bar()
        self.build_menu_ui()
        self.build_main_ui()

        self.menu_focus_index = 0
        self.stack.setCurrentIndex(0)

    # ----- Controller signal wiring -----

    def _connect_controller_signals(self):
        c = self.ctrl
        c.rating_changed.connect(self._on_rating_changed)
        c.stats_updated.connect(self._on_stats_updated)
        c.image_navigated.connect(self._on_image_navigated)
        c.pick_toggled.connect(self._on_pick_toggled)
        c.star_changed.connect(self._on_star_changed)
        c.rotation_applied.connect(self._on_rotation_applied)
        c.filter_applied.connect(self._on_filter_applied)
        c.export_finished.connect(self._on_export_finished)
        c.reset.connect(self._on_reset)
        c.info_changed.connect(self._on_info_changed)
        c.filmstrip_rebuild_needed.connect(self._on_filmstrip_rebuild)
        c.filmstrip_rating_needed.connect(self._on_filmstrip_rating)

    def _on_rating_changed(self, path: str, color: QColor):
        self.viewer.flash(color)

    def _on_stats_updated(self):
        counts = self.ctrl.get_stats_counts()
        for cat, val in counts.items():
            if cat in self.stat_widgets:
                self.stat_widgets[cat].setText(str(val))
        self.pick_count_label.setText(str(self.ctrl.get_pick_count()))
        total = len(self.ctrl.image_paths)
        if total > 0:
            self.progress_bar.setValue(int(((self.ctrl.current_index + 1) / total) * 100))

    def _on_image_navigated(self, path: str):
        self.filmstrip.set_active(path)
        window_size = self.settings.get("filmstrip_window", 15)
        start = max(0, self.ctrl.current_index - window_size)
        end = min(len(self.ctrl.image_paths), self.ctrl.current_index + window_size)
        for i in range(start, end):
            self.request_thumb(self.ctrl.image_paths[i])

        qimage = self.cache.get(path)
        rotation = self.ctrl.rotations.get(path, 0)
        if qimage:
            self.viewer.set_image(qimage, rotation)
        else:
            self.request_load(path, is_preload=False)

        # Restore pick/star display
        img = self.ctrl.get_image(path)
        if img:
            self.viewer.set_pick(bool(img["pick"]))
            self.viewer.set_stars(img["star_rating"] or 0)

        self.update_preload_window()

    def _on_pick_toggled(self, picked: bool):
        self.viewer.set_pick(picked)

    def _on_star_changed(self, stars: int):
        self.viewer.set_stars(stars)

    def _on_rotation_applied(self, rotation: int):
        self.viewer.set_rotation(rotation)

    def _on_filter_applied(self, paths: list):
        pass  # handled by controller directly

    def _on_export_finished(self, moved_count: int, summary: dict):
        msg = f"Export Finished!\nMoved: {moved_count} files.\n"
        msg += f"BAD: {summary['BAD']} | OK: {summary['OK']} | GOOD: {summary['GOOD']}"
        QMessageBox.information(self, "Export Complete", msg)

    def _on_reset(self):
        self.cache.clear()
        self.stack.setCurrentIndex(0)
        self.adjust_layout_to_screen()

    def _on_info_changed(self, progress: str, filename: str, img_type: str):
        self.info_progress.setText(progress)
        self.info_filename.setText(filename)
        self.info_type.setText(img_type)

    def _on_filmstrip_rebuild(self, paths: list):
        self.filmstrip.rebuild(paths)
        self.update_stats()

    def _on_filmstrip_rating(self, path: str, rating):
        self.filmstrip.update_rating(path, rating)

    # ----- UI setup -----

    def setup_menu_bar(self):
        menubar = self.menuBar()
        if IS_MAC:
            menubar.setNativeMenuBar(True)

        file_menu = menubar.addMenu("File")

        act_open = file_menu.addAction("Open Folder")
        act_open.triggered.connect(self.select_folder)
        act_open.setShortcut("Ctrl+O")

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
                color: white; border: none; padding: 10px 25px;
            }
            QPushButton#ActionBtn:hover { background-color: #64b5f6; }

            #HotkeyLabel { font-size: 13px; padding: 12px; border-radius: 8px; background-color: #1a1a1a; border: 1px solid #252525; color: #aaa; }
            #StatCard { background-color: #1a1a1a; padding: 18px; border-radius: 10px; margin-bottom: 12px; border: 1px solid #252525; }
            #StatValue { font-size: 28px; font-weight: bold; color: #fff; padding: 0px 5px; }
            #StatTitle { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; }
            #MenuTitle { font-size: 56px; font-weight: 900; color: #42a5f5; margin-bottom: 40px; letter-spacing: -1px; }

            QProgressBar { background-color: #1a1a1a; border: none; height: 4px; max-height: 4px; border-radius: 0px; }
            QProgressBar::chunk { background-color: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #42a5f5, stop:1 #64b5f6); }
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

        self.btn_browser = QPushButton("Browser")
        self.btn_browser.setCheckable(True)
        self.btn_browser.setChecked(True)
        self.btn_browser.clicked.connect(self.toggle_side_panels)
        top_layout.addWidget(self.btn_browser)

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
        self.side_layout.setContentsMargins(12, 8, 12, 8)
        self.side_layout.setSpacing(4)

        self.search_bar = SearchBar()
        self.search_bar.search_changed.connect(self.ctrl.on_search_changed)
        self.search_bar.filter_changed.connect(self.ctrl.on_filter_changed)
        self.side_layout.addWidget(self.search_bar)

        self.folder_browser = FolderBrowser()
        self.folder_browser.folder_selected.connect(self.ctrl.on_folder_selected)
        self.side_layout.addWidget(self.folder_browser)

        self.date_browser = DateBrowser()
        self.date_browser.date_selected.connect(self.ctrl.on_date_selected)
        self.date_browser.hide()
        self.side_layout.addWidget(self.date_browser)

        self.side_layout.addSpacing(8)
        self.create_hotkey_panel()
        self.side_layout.addSpacing(8)
        self.create_stats_panel()
        self.side_layout.addStretch()
        self.create_info_panel()

        self.side_scroll.setWidget(self.side_panel)
        content_layout.addWidget(self.side_scroll)

        self.viewer = PhotoViewer()
        content_layout.addWidget(self.viewer, 1)
        main_layout.addWidget(content)

        self.filmstrip = FilmstripWidget()
        self.filmstrip.image_selected.connect(self.ctrl.jump_to_image_by_path)
        main_layout.addWidget(self.filmstrip)

        self.stack.addWidget(page)
        self.adjust_layout_to_screen()

    # ----- Hotkey / Stats / Info panels -----

    def create_hotkey_panel(self):
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

    def toggle_hotkey_hud(self):
        self.hotkey_container.setVisible(not self.hotkey_container.isVisible())

    def update_hotkey_hud(self):
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
                "<span style='color:#888'>[0]</span> Unrate | <b>[DEL]</b> Delete",
                "<b>[SPACE]</b> Pick | <b>[I]</b> EXIF | <b>[C]</b> Compare",
                "<b>[P/N]</b> Prev / Next | <b>[H]</b> HUD | <b>[U]</b> Filter",
                "<b>[CTRL+Z]</b> Undo | <b>[CTRL+1-5]</b> Stars",
                "<b>[CTRL+G]</b> Jump | <b>[CTRL +/-]</b> Zoom",
                "<b>[F]</b> Fullscreen | <b>[ESC]</b> Exit",
            ]
        self.hotkey_label.setText("<br><br>".join(hk))

    def create_stats_panel(self):
        self.stat_widgets = {}
        symbols = {"BAD": "●", "OK": "●", "GOOD": "●"}
        colors = {"BAD": "#ef5350", "OK": "#ffca28", "GOOD": "#66bb6a"}

        pick_card = QFrame()
        pick_card.setObjectName("StatCard")
        pick_layout = QVBoxLayout(pick_card)
        pick_layout.setSpacing(4)
        pick_title = QLabel("PICKED")
        pick_title.setObjectName("StatTitle")
        pick_title.setStyleSheet("color: #ffc107; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;")
        self.pick_count_label = QLabel("0")
        self.pick_count_label.setObjectName("StatValue")
        pick_layout.addWidget(pick_title)
        pick_layout.addWidget(self.pick_count_label)
        self.side_layout.addWidget(pick_card)

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

    # ----- File operations -----

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Folder")
        if folder:
            self.load_images(folder)

    def restore_from_menu(self):
        folder = QFileDialog.getExistingDirectory(self, "Select folder that contains the checkpoint")
        if folder:
            self.ctrl.root_folder = os.path.abspath(folder)
            self.ctrl.project_mgr.open_folder(self.ctrl.root_folder)
            self.restore_checkpoint()

    def load_images(self, folder):
        ok = self.ctrl.load_images(folder)
        if not ok:
            QMessageBox.warning(self, "No Images", "Folder is empty or formats not supported.")
            return
        # Handle checkpoint prompt
        cp_path = os.path.join(self.ctrl.root_folder, ".photosorter_checkpoint.json")
        overwrite = True
        if os.path.exists(cp_path):
            ans = QMessageBox.question(
                self, "Checkpoint Exists",
                "A previous checkpoint was found. Do you want to replace it?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if ans == QMessageBox.StandardButton.No:
                overwrite = False
        if overwrite:
            self.ctrl.create_checkpoint()

        self.stack.setCurrentIndex(1)
        if self.folder_browser:
            self.folder_browser.load_folder(self.ctrl.root_folder)
        if self.date_browser:
            dates = self.ctrl.get_date_hierarchy()
            self.date_browser.load_dates(dates)
        if self.search_bar:
            self.search_bar.set_search_text("")
            self.search_bar.filter_combo.setCurrentText("All")
        self.display_current()

    def confirm_return_to_menu(self):
        if len(self.ctrl.results) > 0:
            ans = QMessageBox.question(
                self, "Confirm Exit",
                "You have started sorting images. Are you sure you want to return to the main menu?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if ans != QMessageBox.StandardButton.Yes:
                return
        self.ctrl.reset_to_menu()

    def display_current(self):
        self.ctrl.display_current()

    # ----- Image load / preload -----

    def request_load(self, path, is_preload=False):
        if path in self.cache or path in self.active_tasks:
            return
        task = ImageLoadTask(path, is_preload)
        self.active_tasks[path] = task
        task.signals.loaded.connect(self.on_image_loaded)
        task.signals.exif_loaded.connect(self.on_exif_loaded)
        task.signals.error.connect(self.on_image_error)
        priority = 0 if is_preload else 10
        self.thread_pool.start(task, priority)

    def on_image_loaded(self, path, qimage):
        if path in self.active_tasks:
            del self.active_tasks[path]
        self.cache.put(path, qimage)
        if self.stack.currentIndex() == 1 and 0 <= self.ctrl.current_index < len(self.ctrl.image_paths):
            if path == self.ctrl.image_paths[self.ctrl.current_index]:
                rotation = self.ctrl.rotations.get(path, 0)
                self.viewer.set_image(qimage, rotation)

    def on_image_error(self, path, err):
        if path in self.active_tasks:
            del self.active_tasks[path]
        logging.error(f"Error loading {path}: {err}")

    def on_exif_loaded(self, path: str, exif_data: dict):
        db = self.ctrl.get_db()
        pid = self.ctrl.get_project_id()
        if not db or not pid:
            return
        img = db.get_image_by_path(pid, path)
        if not img:
            return
        mapped = {
            "iso": exif_data.get("ISOSpeedRatings") or exif_data.get("iso"),
            "aperture": exif_data.get("ApertureValue") or exif_data.get("aperture"),
            "shutter_speed": exif_data.get("ShutterSpeedValue") or exif_data.get("shutter_speed"),
            "focal_length": exif_data.get("FocalLength") or exif_data.get("focal_length"),
            "lens": exif_data.get("LensModel") or exif_data.get("lens"),
            "camera_model": exif_data.get("Model") or exif_data.get("camera_model"),
            "date_taken": exif_data.get("DateTimeOriginal") or exif_data.get("date_taken"),
        }
        if self.ctrl.project_mgr.current_project:
            db.update_exif(img["id"], mapped)

    def update_preload_window(self):
        window_indices = []
        if self.ctrl.current_index > 0:
            window_indices.append(self.ctrl.current_index - 1)
        for i in range(1, 6):
            if self.ctrl.current_index + i < len(self.ctrl.image_paths):
                window_indices.append(self.ctrl.current_index + i)
        target_paths = set(self.ctrl.image_paths[i] for i in window_indices)
        for p, task in list(self.active_tasks.items()):
            if p != self.ctrl.image_paths[self.ctrl.current_index] and p not in target_paths:
                task.cancel()
                del self.active_tasks[p]
        for p in target_paths:
            self.request_load(p, is_preload=True)

    # ----- Thumbnails -----

    def request_thumb(self, path: str):
        if path in self.thumb_cache:
            blur = self.ctrl.blur_scores.get(path, 0.0)
            self.filmstrip.set_thumbnail(path, self.thumb_cache.get(path), blur)
            return
        if path in self.active_thumbs:
            return
        task = ThumbnailTask(path)
        task.signals.thumb_loaded.connect(self.on_thumb_loaded)
        self.active_thumbs[path] = task
        self.thumb_pool.start(task)

    def on_thumb_loaded(self, path, qimage, blur_score):
        if path in self.active_thumbs:
            del self.active_thumbs[path]
        self.thumb_cache.put(path, qimage)
        self.ctrl.blur_scores[path] = blur_score
        db = self.ctrl.get_db()
        pid = self.ctrl.get_project_id()
        if db and pid and blur_score > 0:
            img = db.get_image_by_path(pid, path)
            if img:
                db.set_blur_score(img["id"], blur_score)
        self.filmstrip.set_thumbnail(path, qimage, blur_score)

    # ----- Export / Checkpoint -----

    def finish_sorting(self):
        self.ctrl.finish_sorting()

    def restore_checkpoint(self):
        restored = self.ctrl.restore_checkpoint()
        if restored == -1:
            QMessageBox.warning(
                self, "Restore",
                "No checkpoint file found in this folder.\n(Make sure you select the root folder of your project)"
            )
            return
        QMessageBox.information(self, "Restore", f"Restored {restored} files.\n")
        if self.stack.currentIndex() == 1:
            self.load_images(self.ctrl.root_folder)

    # ----- Filter / search (UI integration) -----

    def update_stats(self):
        self._on_stats_updated()

    def toggle_side_panels(self):
        visible = self.btn_browser.isChecked()
        if self.folder_browser:
            self.folder_browser.setVisible(visible)
        if self.search_bar:
            self.search_bar.setVisible(visible)
        if self.date_browser:
            self.date_browser.setVisible(visible)

    # ----- Settings -----

    def load_settings(self):
        try:
            settings_path = BASE_DIR / "settings.json"
            if settings_path.exists():
                with open(settings_path) as f:
                    self.settings.update(json.load(f))
        except (OSError, json.JSONDecodeError):
            pass

    def save_settings(self):
        try:
            with open(BASE_DIR / "settings.json", "w") as f:
                json.dump(self.settings, f, indent=2)
        except (OSError, json.JSONDecodeError):
            pass

    def change_filmstrip_size(self):
        val, ok = QInputDialog.getInt(
            self, "Filmstrip Size",
            "Number of thumbnails to preload around current image:",
            self.settings["filmstrip_window"], 5, 50
        )
        if ok:
            self.settings["filmstrip_window"] = val
            self.save_settings()
            self.display_current()

    # ----- Window -----

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.adjust_layout_to_screen()

    def adjust_layout_to_screen(self):
        if not hasattr(self, "side_panel") or not self.side_panel:
            return
        screen = self.screen()
        if not screen:
            return
        self.geometry()
        target_width = 300
        if hasattr(self, "side_scroll") and self.side_scroll.width() != target_width:
            self.side_scroll.setFixedWidth(target_width)
        QTimer.singleShot(50, self.viewer.force_fit)

    def closeEvent(self, a0: QEvent):
        if self.gamepad_thread:
            self.gamepad_thread.stop()
            self.gamepad_thread.wait(2000)
        if self.stack.currentIndex() == 1 and len(self.ctrl.results) > 0:
            ans = QMessageBox.question(
                self, "Confirm Exit",
                "You have started sorting images. Are you sure you want to exit?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if ans == QMessageBox.StandardButton.Yes:
                a0.accept()
            else:
                a0.ignore()
        else:
            a0.accept()

    # ----- Keyboard -----

    def keyPressEvent(self, a0: QKeyEvent):
        if self.gamepad_mode:
            self.gamepad_mode = False
            self.update_hotkey_hud()

        if a0.isAutoRepeat():
            return

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
            elif key == Qt.Key.Key_G:
                self.jump_to_number()
            elif key == Qt.Key.Key_Z:
                self.ctrl.undo_last_rating()
            elif key == Qt.Key.Key_1:
                self.ctrl.set_star_rating(1)
            elif key == Qt.Key.Key_2:
                self.ctrl.set_star_rating(2)
            elif key == Qt.Key.Key_3:
                self.ctrl.set_star_rating(3)
            elif key == Qt.Key.Key_4:
                self.ctrl.set_star_rating(4)
            elif key == Qt.Key.Key_5:
                self.ctrl.set_star_rating(5)
            return

        if self.ctrl.current_index < 0:
            return

        if key == Qt.Key.Key_N:
            self.ctrl.next_image()
        elif key == Qt.Key.Key_P:
            self.ctrl.prev_image()
        elif key == Qt.Key.Key_1:
            self.ctrl.rate_current_image("BAD", QColor(239, 83, 80))
        elif key == Qt.Key.Key_2:
            self.ctrl.rate_current_image("OK", QColor(255, 202, 40))
        elif key == Qt.Key.Key_3:
            self.ctrl.rate_current_image("GOOD", QColor(102, 187, 106))
        elif key == Qt.Key.Key_0:
            self.ctrl.unrate_current_image()
        elif key == Qt.Key.Key_U:
            self.ctrl.toggle_filter_mode()
            self.show_filter_indicator()
        elif key == Qt.Key.Key_Space:
            self.ctrl.toggle_pick()
        elif key == Qt.Key.Key_I:
            self.toggle_exif_overlay()
        elif key == Qt.Key.Key_C:
            self.toggle_compare_mode()
        elif key in [Qt.Key.Key_Delete, Qt.Key.Key_Backspace]:
            self.delete_current_image()
        elif key == Qt.Key.Key_R:
            if mod & Qt.KeyboardModifier.ShiftModifier:
                self.ctrl.rotate_current_image(-1)
            else:
                self.ctrl.rotate_current_image(1)

    def jump_to_number(self):
        if not self.ctrl.image_paths:
            return
        val, ok = QInputDialog.getInt(
            self, "Jump to Image",
            f"Enter image number (1-{len(self.ctrl.image_paths)}):",
            self.ctrl.current_index + 1, 1, len(self.ctrl.image_paths)
        )
        if ok:
            self.ctrl.jump_to_number(val - 1)

    def show_filter_indicator(self):
        mode = self.ctrl.filter_mode
        self.info_type.setText(
            f"{'FILTER: UNRATED' if mode == 'unrated' else 'FILTER: ALL'}"
        )
        self.ctrl.image_paths[self.ctrl.current_index] if self.ctrl.image_paths else ""
        QTimer.singleShot(1500, lambda: self._on_info_changed(
            self.info_progress.text(), self.info_filename.text(), self.info_type.text()
        ))

    # ----- EXIF / Compare / Delete (UI-specific) -----

    def toggle_exif_overlay(self):
        if self.ctrl.current_index < 0:
            return
        showing = self.viewer.toggle_exif()
        if showing:
            path = self.ctrl.image_paths[self.ctrl.current_index]
            exif_text = ""
            img = self.ctrl.get_image(path)
            if img:
                exif_data = {
                    "iso": img.get("iso"),
                    "aperture": img.get("aperture"),
                    "shutter_speed": img.get("shutter_speed"),
                    "focal_length": img.get("focal_length"),
                    "lens": img.get("lens"),
                    "camera_model": img.get("camera_model"),
                }
                exif_text = format_exif_for_display(exif_data)
            self.viewer.set_exif_text(exif_text)

    def toggle_compare_mode(self):
        if self.ctrl.current_index < 0:
            return
        showing = self.viewer.toggle_compare()
        if showing and self.ctrl.current_index > 0:
            prev_path = self.ctrl.image_paths[self.ctrl.current_index - 1]
            prev_img = self.cache.get(prev_path)
            if prev_img:
                self.viewer.set_compare_image(prev_img)

    def delete_current_image(self):
        if self.ctrl.current_index < 0:
            return
        path = self.ctrl.image_paths[self.ctrl.current_index]
        ans = QMessageBox.question(
            self, "Delete Photo",
            f"Permanently delete this file?\n{Path(path).name}",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if ans != QMessageBox.StandardButton.Yes:
            return
        result = self.ctrl.delete_current_image()
        if result is None:
            QMessageBox.warning(self, "Delete Failed", "Could not delete the file.")

    # ----- Gamepad -----

    def handle_joystick_input(self, axis: str, value: int):
        if axis == "ABS_X":
            self.left_stick[0] = value
        elif axis == "ABS_Y":
            self.left_stick[1] = value
        elif axis in ["ABS_RX", "ABS_Z"]:
            self.right_stick[0] = value
        elif axis in ["ABS_RY", "ABS_RZ"]:
            self.right_stick[1] = value
        if axis in ["ABS_X", "ABS_Y", "ABS_RX", "ABS_RY", "ABS_Z", "ABS_RZ"] and abs(value) > 8000:
            if not self.gamepad_mode:
                self.gamepad_mode = True
                self.update_hotkey_hud()

    def on_gamepad_connection_changed(self, connected: bool):
        if not connected and self.gamepad_mode:
            self.gamepad_mode = False
            self.update_hotkey_hud()
            logging.info("Gamepad disconnected. HUD reverted to keyboard.")
        elif connected:
            logging.info("Gamepad connected.")

    def process_joysticks(self):
        if self.stack.currentIndex() != 1:
            return
        lx, ly = self.left_stick
        deadzone = 8000
        if abs(lx) > deadzone or abs(ly) > deadzone:
            step_x = (lx // 1000) if abs(lx) > deadzone else 0
            step_y = -(ly // 1000) if abs(ly) > deadzone else 0
            h_bar = self.viewer.horizontalScrollBar()
            v_bar = self.viewer.verticalScrollBar()
            h_bar.setValue(h_bar.value() + step_x)
            v_bar.setValue(v_bar.value() + step_y)
        ry = self.right_stick[1]
        if abs(ry) > deadzone:
            zoom_factor = 1.03 if ry < 0 else 0.97
            self.viewer.zoom_controller.apply_zoom_at_center(zoom_factor)

    def handle_gamepad_input(self, code: str):
        if not self.gamepad_mode:
            self.gamepad_mode = True
            self.update_hotkey_hud()

        is_confirm = code in ["BTN_SOUTH", "BTN_THUMB", "BTN_A"]
        is_back = code in ["BTN_EAST", "BTN_THUMB2", "BTN_B"]
        is_ok = code in ["BTN_WEST", "BTN_PINKIE", "BTN_X"]
        is_reset = code in ["BTN_NORTH", "BTN_TOP", "BTN_Y"]

        modal = QApplication.activeModalWidget()
        if modal:
            if code in ["DPAD_LEFT", "DPAD_RIGHT"]:
                key = Qt.Key.Key_Tab if code == "DPAD_RIGHT" else Qt.Key.Key_Backtab
                ev = QKeyEvent(QEvent.Type.KeyPress, key, Qt.KeyboardModifier.NoModifier)
                QApplication.sendEvent(modal, ev)
            elif is_confirm:
                focus_widget = modal.focusWidget()
                if focus_widget and isinstance(focus_widget, QPushButton):
                    focus_widget.click()
            elif is_back:
                if hasattr(modal, "reject"):
                    modal.reject()
                else:
                    modal.close()
            return

        if self.stack.currentIndex() == 0:
            if code == "DPAD_UP":
                self.menu_focus_index = (self.menu_focus_index - 1) % len(self.menu_buttons)
                self.menu_buttons[self.menu_focus_index].setFocus()
            elif code == "DPAD_DOWN":
                self.menu_focus_index = (self.menu_focus_index + 1) % len(self.menu_buttons)
                self.menu_buttons[self.menu_focus_index].setFocus()
            elif is_confirm:
                self.menu_buttons[self.menu_focus_index].click()
            return

        if self.is_processing:
            return

        if is_confirm:
            self.ctrl.rate_current_image("GOOD", QColor(102, 187, 106))
        elif is_back:
            self.ctrl.rate_current_image("BAD", QColor(239, 83, 80))
        elif is_ok:
            self.ctrl.rate_current_image("OK", QColor(255, 202, 40))
        elif code in ["DPAD_RIGHT", "BTN_TR"]:
            self.ctrl.next_image()
        elif code in ["DPAD_LEFT", "BTN_TL"]:
            self.ctrl.prev_image()
        elif code in ["TRIGGER_LEFT", "BTN_TL2"]:
            self.ctrl.rotate_current_image(-1)
        elif code in ["TRIGGER_RIGHT", "BTN_TR2"]:
            self.ctrl.rotate_current_image(1)
        elif is_reset:
            self.viewer.force_fit()
        elif code == "BTN_SELECT":
            self.confirm_return_to_menu()
        elif code == "BTN_START":
            self.finish_sorting()
        elif code == "BTN_THUMBR":
            self.toggle_hotkey_hud()
