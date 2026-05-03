"""
Photo Sorter V1
A high-performance, keyboard-driven desktop application for culling and 
organizing large batches of photos and RAW files.
"""

import os
import sys
import shutil
import logging
import json
import datetime
import hashlib
import math
from collections import OrderedDict
from pathlib import Path
from PyQt6.QtWidgets import (
    QApplication,
    QMainWindow,
    QLabel,
    QVBoxLayout,
    QHBoxLayout,
    QWidget,
    QFileDialog,
    QFrame,
    QPushButton,
    QMessageBox,
    QGraphicsView,
    QGraphicsScene,
    QGraphicsPixmapItem,
    QGraphicsRectItem,
    QStackedWidget,
    QGestureEvent,
)
from PyQt6.QtGui import (
    QPixmap,
    QImage,
    QColor,
    QKeyEvent,
    QMouseEvent,
    QResizeEvent,
    QPainter,
    QImageReader,
    QBrush,
    QPen,
    QGuiApplication,
    QWheelEvent,
)
from PyQt6.QtCore import (
    Qt,
    QTimer,
    pyqtSignal,
    QRectF,
    QVariantAnimation,
    QRunnable,
    QThreadPool,
    QObject,
    QEvent,
)

QGuiApplication.setHighDpiScaleFactorRoundingPolicy(
    Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
)

try:
    import rawpy

    RAW_SUPPORTED = True
except ImportError:
    RAW_SUPPORTED = False


# DEPENDENCIES:
# pip install PyQt6 rawpy numpy

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

IS_MAC = sys.platform == "darwin"
MOD_MASK = (
    Qt.KeyboardModifier.MetaModifier if IS_MAC else Qt.KeyboardModifier.ControlModifier
)


def safe_move(src: str, dst: str) -> None:
    """
    Safely moves a file from src to dst. 
    Handles cross-filesystem transfers by falling back to copy+delete.
    """
    try:
        shutil.move(src, dst)
    except Exception:
        # Fallback for cross-device moves
        shutil.copy2(src, dst)
        os.remove(src)


def compute_file_metadata(path: str) -> tuple[int, str]:
    """
    Computes critical file metadata for the checkpoint system.
    Returns a tuple of (file_size_bytes, sha1_hash).
    """
    if not os.path.exists(path):
        return 0, ""
    size = os.path.getsize(path)
    sha1 = hashlib.sha1()
    try:
        with open(path, "rb") as f:
            while chunk := f.read(8192):
                sha1.update(chunk)
        return size, sha1.hexdigest()
    except Exception:
        # Return size even if hash fails for basic validation
        return size, ""


class MemoryBoundedCache:
    """
    An LRU (Least Recently Used) cache for QImage objects, 
    bounded by an approximate memory budget in megabytes.
    """

    def __init__(self, max_mb: int = 500):
        self.cache: OrderedDict[str, tuple[QImage, int]] = OrderedDict()
        self.max_bytes = max_mb * 1024 * 1024
        self.current_bytes = 0

    def put(self, key: str, qimage: QImage) -> None:
        """Adds an image to the cache, evicting old items if the budget is exceeded."""
        if key in self.cache:
            self._remove(key)

        # Approximate size in bytes (width * height * 32-bit depth)
        size = qimage.width() * qimage.height() * 4
        self.cache[key] = (qimage, size)
        self.current_bytes += size

        self.evict_if_needed()

    def get(self, key: str) -> QImage | None:
        """Retrieves an image from the cache and marks it as recently used."""
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key][0]
        return None

    def _remove(self, key: str) -> None:
        """Internal helper to remove an item and update byte count."""
        if key in self.cache:
            _, size = self.cache.pop(key)
            self.current_bytes -= size

    def evict_if_needed(self) -> None:
        """Evicts the oldest items until the memory usage is within budget."""
        while self.current_bytes > self.max_bytes and self.cache:
            self.cache.popitem(last=False)

    def clear(self) -> None:
        """Clears all items from the cache."""
        self.cache.clear()
        self.current_bytes = 0

    def __contains__(self, key: str) -> bool:
        return key in self.cache


class WorkerSignals(QObject):
    loaded = pyqtSignal(str, QImage)
    error = pyqtSignal(str, str)


class ImageLoadTask(QRunnable):
    """
    A worker task for loading images in a background thread.
    Supports standard formats via QImageReader and RAW formats via rawpy.
    """

    def __init__(self, path: str, is_preload: bool = False):
        super().__init__()
        self.path = path
        self.is_preload = is_preload
        self.signals = WorkerSignals()
        self._is_cancelled = False

    def cancel(self) -> None:
        """Signals the task to stop execution at the next cancellation point."""
        self._is_cancelled = True

    def run(self) -> None:
        """Main execution logic for the image loading thread."""
        if self._is_cancelled:
            return
        try:
            ext = Path(self.path).suffix.lower()
            qimage = None
            if RAW_SUPPORTED and ext in [".cr2", ".arw", ".nef"]:
                with rawpy.imread(self.path) as raw:
                    if self._is_cancelled:
                        return

                    # RAW Optimization: Fallback chain
                    # 1. Embedded thumbnail (fastest)
                    # 2. Half-size demosaic
                    # 3. Full demosaic (slowest)
                    try:
                        thumb = raw.extract_thumb()
                        if thumb.format == rawpy.ThumbFormat.JPEG:
                            qimage = QImage()
                            qimage.loadFromData(thumb.data, "JPEG")
                        elif thumb.format == rawpy.ThumbFormat.BITMAP:
                            qimage = QImage(
                                thumb.data,
                                thumb.width,
                                thumb.height,
                                QImage.Format.Format_RGB888,
                            )
                    except rawpy.LibRawNoThumbnailError:
                        pass

                    if qimage is None or qimage.isNull():
                        if self._is_cancelled:
                            return
                        rgb = raw.postprocess(
                            use_camera_wb=True,
                            half_size=True,
                            no_auto_bright=False,
                            bright=1.0,
                        )
                        h, w, c = rgb.shape
                        bytes_per_line = c * w
                        qimage = QImage(
                            rgb.data, w, h, bytes_per_line, QImage.Format.Format_RGB888
                        ).copy()
            else:
                reader = QImageReader(self.path)
                reader.setAutoTransform(True)
                # For huge JPGs, we could optionally shrink them, but reader.read() is usually fast enough
                qimage = reader.read()

            if self._is_cancelled:
                return

            if qimage is None or qimage.isNull():
                err = (
                    reader.errorString()
                    if not RAW_SUPPORTED or ext not in [".cr2", ".arw", ".nef"]
                    else "Failed to decode RAW"
                )
                self.signals.error.emit(self.path, f"Failed to load: {err}")
            else:
                self.signals.loaded.emit(self.path, qimage)

        except Exception as e:
            if not self._is_cancelled:
                self.signals.error.emit(self.path, str(e))


class ZoomController:
    """
    Normalizes zoom interaction across standard mouse wheels, 
    trackpads, and native pinch gestures. 
    Uses symmetric exponential scaling for a smooth, high-end feel.
    """

    def __init__(self, viewer: "PhotoViewer"):
        self.viewer = viewer

        # Micro-sensitivity for high-resolution pixelDelta (trackpads)
        self.pixel_sensitivity = 0.005
        # Macro-sensitivity for angleDelta (standard mouse wheel)
        self.angle_sensitivity = 0.001

        self.deadzone = 0.002  # Jitter threshold to ignore tiny deltas

        # Cap for absolute magnification (relative to fit-to-view baseline)
        self.max_scale_multiplier = 20.0

        # Enable pinch gestures on the viewport
        self.viewer.viewport().grabGesture(Qt.GestureType.PinchGesture)

    def handle_wheel_event(self, event: QWheelEvent) -> bool:
        """Processes wheel events and normalizes them into a symmetric zoom factor."""
        # Require Cmd (Mac) or Ctrl (Win/Linux) for scroll-based zooming
        if not (event.modifiers() & MOD_MASK):
            return False

        delta = 0.0
        if not event.pixelDelta().isNull():
            delta = event.pixelDelta().y() * self.pixel_sensitivity
        elif not event.angleDelta().isNull():
            delta = event.angleDelta().y() * self.angle_sensitivity

        if abs(delta) < self.deadzone:
            return True  # Consume the event but don't act (noise filtering)

        # Symmetric exponential scaling ensures zooming in and out is perfectly reversible
        factor = math.exp(delta)
        self.apply_zoom(factor)
        return True

    def handle_gesture_event(self, event: QGestureEvent) -> bool:
        """Handles native pinch-to-zoom gestures."""
        pinch = event.gesture(Qt.GestureType.PinchGesture)
        if pinch:
            factor = pinch.scaleFactor()
            if abs(factor - 1.0) > self.deadzone:
                self.apply_zoom(factor)
            return True
        return False

    def apply_zoom(self, factor: float) -> None:
        """Applies a relative zoom factor while enforcing min/max scale boundaries."""
        current_scale = self.viewer.transform().m11()
        target_scale = current_scale * factor

        fit_scale = self.viewer.get_fit_scale()
        max_scale = fit_scale * self.max_scale_multiplier

        # Enforce boundaries
        if target_scale < fit_scale:
            factor = fit_scale / current_scale
        elif target_scale > max_scale:
            factor = max_scale / current_scale

        if abs(factor - 1.0) > 0.0001:
            self.viewer.scale(factor, factor)


class PhotoViewer(QGraphicsView):
    """
    A high-performance image viewer widget based on QGraphicsView.
    Handles image rendering, panning, and coordinate-aware zooming.
    """

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self.scene = QGraphicsScene(self)
        self.setScene(self.scene)

        # Quality-first rendering settings
        self.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)

        # Anchor settings to ensure zoom happens around the mouse cursor
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)

        self.setDragMode(QGraphicsView.DragMode.NoDrag)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setBackgroundBrush(QBrush(QColor(18, 18, 18)))
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.pixmap_item = QGraphicsPixmapItem()
        self.scene.addItem(self.pixmap_item)

        self.overlay_item = QGraphicsRectItem()
        self.overlay_item.setPen(QPen(Qt.PenStyle.NoPen))
        self.overlay_item.setZValue(1)
        self.overlay_item.setOpacity(0.0)
        self.scene.addItem(self.overlay_item)

        self.anim: QVariantAnimation | None = None
        self.zoom_controller = ZoomController(self)

    def set_image(self, qimage: QImage) -> None:
        """Sets the current image and fits it to the view."""
        pixmap = QPixmap.fromImage(qimage)
        self.pixmap_item.setPixmap(pixmap)
        rect = QRectF(pixmap.rect())
        self.scene.setSceneRect(rect)
        self.overlay_item.setRect(rect)
        self.fitInView(self.pixmap_item, Qt.AspectRatioMode.KeepAspectRatio)

    def flash(self, color: QColor, duration: int = 250) -> None:
        """Triggers a brief color overlay animation on the image."""
        self.overlay_item.setBrush(QBrush(color))
        if self.anim:
            self.anim.stop()
        self.anim = QVariantAnimation(self)
        self.anim.setDuration(duration)
        self.anim.setStartValue(0.4)
        self.anim.setEndValue(0.0)
        self.anim.valueChanged.connect(self.overlay_item.setOpacity)
        self.anim.start()

    def mousePressEvent(self, a0: QMouseEvent) -> None:
        """Activates panning mode on left-click."""
        if a0.button() == Qt.MouseButton.LeftButton:
            self.setDragMode(QGraphicsView.DragMode.ScrollHandDrag)
        super().mousePressEvent(a0)

    def mouseReleaseEvent(self, a0: QMouseEvent) -> None:
        """Deactivates panning mode on release."""
        if a0.button() == Qt.MouseButton.LeftButton:
            self.setDragMode(QGraphicsView.DragMode.NoDrag)
        super().mouseReleaseEvent(a0)

    def mouseDoubleClickEvent(self, a0: QMouseEvent) -> None:
        """Resets the image to fit-to-view on double-click."""
        if a0.button() == Qt.MouseButton.LeftButton:
            self.force_fit()
        super().mouseDoubleClickEvent(a0)

    def wheelEvent(self, a0: QWheelEvent) -> None:
        """Delegates wheel events to the ZoomController."""
        if not self.zoom_controller.handle_wheel_event(a0):
            super().wheelEvent(a0)

    def viewportEvent(self, a0: QEvent) -> bool:
        """Delegates gesture events to the ZoomController."""
        if a0.type() == QEvent.Type.Gesture:
            if self.zoom_controller.handle_gesture_event(a0):  # type: ignore
                return True
        return super().viewportEvent(a0)

    def resizeEvent(self, a0: QResizeEvent) -> None:
        """Ensures the image remains fitted to the view during window resizing."""
        super().resizeEvent(a0)
        if self.transform().m11() <= self.zoom_controller.viewer.get_fit_scale():
            self.fitInView(self.pixmap_item, Qt.AspectRatioMode.KeepAspectRatio)

    def get_fit_scale(self) -> float:
        """Calculates the scaling factor required to fit the image to the viewport."""
        if self.pixmap_item.pixmap().isNull():
            return 1.0
        s = self.viewport().size()
        p = self.pixmap_item.pixmap().size()
        return min(s.width() / p.width(), s.height() / p.height())

    def force_fit(self) -> None:
        """Forces the image to fit within the current viewport."""
        if not self.pixmap_item.pixmap().isNull():
            self.fitInView(self.pixmap_item, Qt.AspectRatioMode.KeepAspectRatio)


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
        self.cache = MemoryBoundedCache(max_mb=1000)  # 1GB memory budget
        self.active_tasks: dict[str, ImageLoadTask] = {}
        self.thread_pool = QThreadPool()
        self.thread_pool.setMaxThreadCount(4)  # Bounded concurrency

        self.root_folder = ""
        self.is_processing = False
        self.side_layout: QVBoxLayout | None = None

        self.stack = QStackedWidget()
        self.setCentralWidget(self.stack)

        self.setup_styles()
        self.setup_menu_bar()
        self.build_menu_ui()
        self.build_main_ui()

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

    def setup_styles(self):
        self.setStyleSheet("""
            QMainWindow { background-color: #121212; }
            QWidget { color: #e0e0e0; font-family: 'Segoe UI', 'Roboto', 'Ubuntu', 'San Francisco', 'Helvetica Neue', 'Arial', sans-serif; }
            #SidePanel { background-color: #1a1a1a; border-left: 1px solid #333; }
            #TopBar { background-color: #1a1a1a; border-bottom: 1px solid #333; min-height: 60px; }
            #Title { font-size: 20px; font-weight: bold; color: #42a5f5; padding-left: 20px; }
            QPushButton { background-color: #333; border: none; padding: 8px 15px; border-radius: 4px; font-weight: 600; min-height: 35px; }
            QPushButton:hover { background-color: #444; }
            QPushButton#ActionBtn { background-color: #42a5f5; color: white; }
            #HotkeyLabel { font-size: 13px; padding: 10px; border-radius: 4px; margin-bottom: 5px; background-color: #252525; border: 1px solid #333; }
            #StatCard { background-color: #222; padding: 15px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #333; }
            #StatValue { font-size: 24px; font-weight: bold; }
            #StatTitle { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
            #MenuTitle { font-size: 48px; font-weight: bold; color: #42a5f5; margin-bottom: 30px; }
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

        self.stack.addWidget(page)

    def build_main_ui(self):
        page = QWidget()
        main_layout = QVBoxLayout(page)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        top_bar = QWidget()
        top_bar.setObjectName("TopBar")
        top_layout = QHBoxLayout(top_bar)
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
        main_layout.addWidget(top_bar)

        content = QWidget()
        content_layout = QHBoxLayout(content)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        self.viewer = PhotoViewer()
        content_layout.addWidget(self.viewer, 1)

        self.side_panel = QFrame()
        self.side_panel.setObjectName("SidePanel")
        self.side_panel.setFixedWidth(300)
        self.side_layout = QVBoxLayout(self.side_panel)
        self.side_layout.setContentsMargins(20, 20, 20, 20)

        self.create_hotkey_panel()
        self.side_layout.addSpacing(20)
        self.create_stats_panel()
        self.side_layout.addStretch()
        self.create_info_panel()

        content_layout.addWidget(self.side_panel)
        main_layout.addWidget(content)
        self.stack.addWidget(page)
        self.adjust_layout_to_screen()

    def create_hotkey_panel(self) -> None:
        """Builds the controls legend in the side panel."""
        self.side_layout.addWidget(QLabel("CONTROLS"))
        hk = [
            ("<span style='color:#ef5350'>[1]</span> BAD", "BadLabel"),
            ("<span style='color:#ffca28'>[2]</span> OK", "OkLabel"),
            ("<span style='color:#66bb6a'>[3]</span> GOOD", "GoodLabel"),
            ("<b>[P/N]</b> Prev / Next", ""),
            ("<b>[CTRL +/-]</b> Zoom", ""),
            ("<b>[F]</b> Fullscreen | <b>[ESC]</b> Exit", ""),
        ]
        for text, _ in hk:
            label = QLabel(text)
            label.setObjectName("HotkeyLabel")
            if self.side_layout:
                self.side_layout.addWidget(label)

    def create_stats_panel(self) -> None:
        """Builds the category counters in the side panel."""
        self.stat_widgets = {}
        for cat in ["BAD", "OK", "GOOD"]:
            card = QFrame()
            card.setObjectName("StatCard")
            layout = QVBoxLayout(card)
            title_label = QLabel(cat)
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
        exts = {".jpg", ".jpeg", ".png", ".cr2", ".arw", ".nef"}
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
        self.update_stats()
        self.stack.setCurrentIndex(1)
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
        target_width = 220 if is_portrait else 300
        if self.side_panel.width() != target_width:
            self.side_panel.setFixedWidth(target_width)

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

            qimage = self.cache.get(path)
            if qimage:
                self.viewer.set_image(qimage)
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
        for i in range(1, 4):
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
            f"{ext} {'(RAW)' if ext in ['CR2', 'ARW', 'NEF'] else ''}"
        )

    def update_stats(self):
        counts = {"BAD": 0, "OK": 0, "GOOD": 0}
        for cat in self.results.values():
            if cat in counts:
                counts[cat] += 1
        for cat, val in counts.items():
            if cat in self.stat_widgets:
                self.stat_widgets[cat].setText(str(val))

    def on_image_loaded(self, path, qimage):
        if path in self.active_tasks:
            del self.active_tasks[path]

        self.cache.put(path, qimage)

        if self.stack.currentIndex() == 1 and 0 <= self.current_index < len(
            self.image_paths
        ):
            if path == self.image_paths[self.current_index]:
                self.viewer.set_image(qimage)

    def on_image_error(self, path, err):
        if path in self.active_tasks:
            del self.active_tasks[path]
        logging.error(f"Error loading {path}: {err}")

    def keyPressEvent(self, a0: QKeyEvent) -> None:
        """Central keyboard event handler for navigation and rating."""
        if self.stack.currentIndex() != 1 or a0.isAutoRepeat():
            return
        if self.is_processing:
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
            self.current_index = min(len(self.image_paths) - 1, self.current_index + 1)
            self.display_current()
        elif key == Qt.Key.Key_P:
            self.current_index = max(0, self.current_index - 1)
            self.display_current()
        
        category: str | None = None
        color: QColor | None = None
        if key == Qt.Key.Key_1:
            category, color = "BAD", QColor(239, 83, 80)
        elif key == Qt.Key.Key_2:
            category, color = "OK", QColor(255, 202, 40)
        elif key == Qt.Key.Key_3:
            category, color = "GOOD", QColor(102, 187, 106)
            
        if category and color:
            self.is_processing = True
            self.results[self.image_paths[self.current_index]] = category
            self.viewer.flash(color)
            self.update_stats()
            QTimer.singleShot(250, self.after_rating)

    def after_rating(self):
        if self.current_index < len(self.image_paths) - 1:
            self.current_index += 1
            self.display_current()
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



