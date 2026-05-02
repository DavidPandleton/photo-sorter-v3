import os
import sys
import shutil
import logging
import json
from pathlib import Path
from PyQt6.QtWidgets import (QApplication, QMainWindow, QLabel, QVBoxLayout, 
                             QHBoxLayout, QWidget, QFileDialog, QFrame, 
                             QPushButton, QGraphicsOpacityEffect, QMessageBox,
                             QGraphicsView, QGraphicsScene, QGraphicsPixmapItem,
                             QGraphicsRectItem)
from PyQt6.QtGui import (QPixmap, QImage, QColor, QPalette, QKeyEvent, 
                         QPainter, QImageReader, QFont, QIcon, QBrush, QPen, QTransform)
from PyQt6.QtCore import Qt, QTimer, QThread, pyqtSignal, QPropertyAnimation, QRect, QRectF, QVariantAnimation

import rawpy
import numpy as np

# DEPENDENCIES:
# pip install PyQt6 rawpy numpy

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

class ImageLoader(QThread):
    loaded = pyqtSignal(str, QImage)
    error = pyqtSignal(str, str)

    def __init__(self, path):
        super().__init__()
        self.path = path

    def run(self):
        try:
            ext = Path(self.path).suffix.lower()
            if ext in ['.cr2', '.arw', '.nef']:
                with rawpy.imread(self.path) as raw:
                    rgb = raw.postprocess(use_camera_wb=True, no_auto_bright=False, bright=1.0)
                    h, w, c = rgb.shape
                    bytes_per_line = c * w
                    qimage = QImage(rgb.data, w, h, bytes_per_line, QImage.Format.Format_RGB888)
                    self.loaded.emit(self.path, qimage.copy())
            else:
                reader = QImageReader(self.path)
                reader.setAutoTransform(True)
                qimage = reader.read()
                if qimage.isNull():
                    self.error.emit(self.path, f"Failed to load: {reader.errorString()}")
                else:
                    self.loaded.emit(self.path, qimage)
        except Exception as e:
            self.error.emit(self.path, str(e))

class PhotoViewer(QGraphicsView):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.scene = QGraphicsScene(self)
        self.setScene(self.scene)
        
        self.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
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

        self.anim = None

    def set_image(self, qimage):
        pixmap = QPixmap.fromImage(qimage)
        self.pixmap_item.setPixmap(pixmap)
        rect = QRectF(pixmap.rect())
        self.scene.setSceneRect(rect)
        self.overlay_item.setRect(rect)
        self.fitInView(self.pixmap_item, Qt.AspectRatioMode.KeepAspectRatio)

    def flash(self, color, duration=250):
        self.overlay_item.setBrush(QBrush(color))
        if self.anim: self.anim.stop()
        self.anim = QVariantAnimation(self)
        self.anim.setDuration(duration)
        self.anim.setStartValue(0.4)
        self.anim.setEndValue(0.0)
        self.anim.valueChanged.connect(self.overlay_item.setOpacity)
        self.anim.start()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.setDragMode(QGraphicsView.DragMode.ScrollHandDrag)
        super().mousePressEvent(event)
    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.setDragMode(QGraphicsView.DragMode.NoDrag)
        super().mouseReleaseEvent(event)

    def wheelEvent(self, event):
        # Zoom factor
        zoom_in_factor = 1.15
        zoom_out_factor = 1 / zoom_in_factor

        # Zoom
        if event.angleDelta().y() > 0:
            self.zoom(zoom_in_factor)
        else:
            self.zoom(zoom_out_factor)

    def zoom(self, factor):
        self.scale(factor, factor)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if self.transform().m11() <= self.get_fit_scale():
            self.fitInView(self.pixmap_item, Qt.AspectRatioMode.KeepAspectRatio)

    def get_fit_scale(self):
        if self.pixmap_item.pixmap().isNull(): return 1.0
        s = self.viewport().size()
        p = self.pixmap_item.pixmap().size()
        return min(s.width() / p.width(), s.height() / p.height())

class PhotoSorter(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Photo Sorter V1")
        self.resize(1400, 900)
        
        self.image_paths = []
        self.current_index = -1
        self.results = {}
        self.cache = {}
        self.active_loaders = []
        self.root_folder = ""
        self.side_layout = None  # Pre-initialize to avoid AttributeErrors
        
        self.setup_styles()
        self.build_ui()
        
        QTimer.singleShot(100, self.select_folder)

    def setup_styles(self):
        self.setStyleSheet("""
            QMainWindow { background-color: #121212; }
            QWidget { color: #e0e0e0; font-family: 'Segoe UI', 'Roboto', sans-serif; }
            #SidePanel { background-color: #1a1a1a; border-left: 1px solid #333; }
            #TopBar { background-color: #1a1a1a; border-bottom: 1px solid #333; min-height: 60px; }
            #Title { font-size: 20px; font-weight: bold; color: #42a5f5; padding-left: 20px; }
            QPushButton { background-color: #333; border: none; padding: 8px 15px; border-radius: 4px; font-weight: 600; }
            QPushButton:hover { background-color: #444; }
            QPushButton#ActionBtn { background-color: #42a5f5; color: white; }
            #HotkeyLabel { font-size: 13px; padding: 10px; border-radius: 4px; margin-bottom: 5px; background-color: #252525; border: 1px solid #333; }
            #StatCard { background-color: #222; padding: 15px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #333; }
            #StatValue { font-size: 24px; font-weight: bold; }
            #StatTitle { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
        """)

    def build_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        main_layout = QVBoxLayout(main_widget)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Top Bar
        top_bar = QWidget(); top_bar.setObjectName("TopBar")
        top_layout = QHBoxLayout(top_bar)
        title = QLabel("PHOTO SORTER V1"); title.setObjectName("Title")
        top_layout.addWidget(title)
        top_layout.addStretch()
        btn_open = QPushButton("Open Folder"); btn_open.clicked.connect(self.select_folder)
        top_layout.addWidget(btn_open)
        btn_restore = QPushButton("Restore Checkpoint"); btn_restore.clicked.connect(self.restore_checkpoint)
        top_layout.addWidget(btn_restore)
        btn_export = QPushButton("Finish Export"); btn_export.setObjectName("ActionBtn"); btn_export.clicked.connect(self.finish_sorting)
        top_layout.addWidget(btn_export)
        main_layout.addWidget(top_bar)

        # Content
        content = QWidget()
        content_layout = QHBoxLayout(content); content_layout.setContentsMargins(0, 0, 0, 0); content_layout.setSpacing(0)
        
        # Left Viewer
        self.viewer = PhotoViewer()
        content_layout.addWidget(self.viewer, 1)
        
        # Right Panel
        side_panel = QFrame()
        side_panel.setObjectName("SidePanel")
        side_panel.setFixedWidth(300)
        self.side_layout = QVBoxLayout(side_panel)
        self.side_layout.setContentsMargins(20, 20, 20, 20)
        
        self.create_hotkey_panel()
        self.side_layout.addSpacing(20)
        self.create_stats_panel()
        self.side_layout.addStretch()
        self.create_info_panel()
        
        content_layout.addWidget(side_panel)
        main_layout.addWidget(content)

    def create_hotkey_panel(self):
        if not self.side_layout: return
        self.side_layout.addWidget(QLabel("CONTROLS"))
        hk = [
            ("<span style='color:#ef5350'>[1]</span> BAD", "BadLabel"),
            ("<span style='color:#ffca28'>[2]</span> OK", "OkLabel"),
            ("<span style='color:#66bb6a'>[3]</span> GOOD", "GoodLabel"),
            ("<b>[P/N]</b> Prev / Next", ""),
            ("<b>[CTRL +/-]</b> Zoom", ""),
            ("<b>[F]</b> Fullscreen | <b>[ESC]</b> Exit", "")
        ]
        for text, _ in hk:
            l = QLabel(text); l.setObjectName("HotkeyLabel")
            self.side_layout.addWidget(l)

    def create_stats_panel(self):
        if not self.side_layout: return
        self.stat_widgets = {}
        for cat in ["BAD", "OK", "GOOD"]:
            card = QFrame(); card.setObjectName("StatCard")
            l = QVBoxLayout(card)
            t = QLabel(cat); t.setObjectName("StatTitle")
            v = QLabel("0"); v.setObjectName("StatValue")
            l.addWidget(t); l.addWidget(v)
            self.side_layout.addWidget(card)
            self.stat_widgets[cat] = v

    def create_info_panel(self):
        if not self.side_layout: return
        self.info_progress = QLabel("0 / 0"); self.info_progress.setStyleSheet("font-size: 18px; font-weight: bold;")
        self.info_filename = QLabel("-"); self.info_filename.setWordWrap(True); self.info_filename.setStyleSheet("color: #aaa;")
        self.info_type = QLabel("-"); self.info_type.setStyleSheet("color: #42a5f5; font-weight: bold;")
        self.side_layout.addWidget(self.info_progress)
        self.side_layout.addWidget(self.info_filename)
        self.side_layout.addWidget(self.info_type)

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Folder")
        if folder: self.load_images(folder)

    def load_images(self, folder):
        self.root_folder = os.path.abspath(folder)
        exts = {'.jpg', '.jpeg', '.png', '.cr2', '.arw', '.nef'}
        self.image_paths = []
        for r, _, fs in os.walk(self.root_folder):
            # Skip subfolders we created
            if any(x in r for x in ['/BAD', '/OK', '/GOOD', '\\BAD', '\\OK', '\\GOOD']): continue
            for f in fs:
                if Path(f).suffix.lower() in exts: 
                    self.image_paths.append(os.path.abspath(os.path.join(r, f)))
        
        if not self.image_paths:
            QMessageBox.warning(self, "No Images", "Folder is empty or formats not supported.")
            return

        self.create_checkpoint()
        self.current_index = 0
        self.results = {}
        self.update_stats()
        self.display_current()

    def create_checkpoint(self):
        cp_path = os.path.join(self.root_folder, ".photosorter_checkpoint.json")
        if not os.path.exists(cp_path):
            data = {"root": self.root_folder, "files": self.image_paths}
            try:
                with open(cp_path, 'w') as f: json.dump(data, f, indent=2)
                logging.info(f"Checkpoint created: {cp_path}")
            except Exception as e: logging.error(f"Checkpoint failed: {e}")

    def display_current(self):
        if 0 <= self.current_index < len(self.image_paths):
            path = self.image_paths[self.current_index]
            self.update_info_panel(path)
            if path in self.cache: self.viewer.set_image(self.cache[path])
            else:
                loader = ImageLoader(path)
                self.active_loaders.append(loader)
                loader.loaded.connect(self.on_image_loaded)
                loader.error.connect(self.on_image_error)
                loader.finished.connect(lambda l=loader: self.safe_remove_loader(l))
                loader.start()
            self.preload_next()
        else: self.current_index = max(0, min(self.current_index, len(self.image_paths)-1))

    def update_info_panel(self, path):
        self.info_progress.setText(f"{self.current_index + 1} / {len(self.image_paths)}")
        self.info_filename.setText(os.path.basename(path))
        ext = Path(path).suffix[1:].upper()
        self.info_type.setText(f"{ext} {'(RAW)' if ext in ['CR2', 'ARW', 'NEF'] else ''}")

    def update_stats(self):
        counts = {"BAD": 0, "OK": 0, "GOOD": 0}
        for cat in self.results.values():
            if cat in counts: counts[cat] += 1
        for cat, val in counts.items():
            if cat in self.stat_widgets: self.stat_widgets[cat].setText(str(val))

    def preload_next(self):
        ni = self.current_index + 1
        if ni < len(self.image_paths):
            p = self.image_paths[ni]
            if p not in self.cache:
                loader = ImageLoader(p)
                self.active_loaders.append(loader)
                loader.loaded.connect(self.on_preloaded)
                loader.error.connect(lambda path, err: logging.error(f"Preload error {path}: {err}"))
                loader.finished.connect(lambda l=loader: self.safe_remove_loader(l))
                loader.start()

    def on_image_loaded(self, path, qimage):
        self.cache[path] = qimage
        if 0 <= self.current_index < len(self.image_paths):
            if path == self.image_paths[self.current_index]:
                self.viewer.set_image(qimage)

    def on_preloaded(self, path, qimage):
        self.cache[path] = qimage

    def on_image_error(self, path, err):
        logging.error(f"Error {path}: {err}")

    def safe_remove_loader(self, loader):
        if loader in self.active_loaders: self.active_loaders.remove(loader)

    def keyPressEvent(self, event: QKeyEvent):
        key = event.key()
        mod = event.modifiers()
        if key == Qt.Key.Key_Escape: self.close()
        elif key == Qt.Key.Key_F:
            if self.isFullScreen(): self.showNormal()
            else: self.showFullScreen()
        if mod & Qt.KeyboardModifier.ControlModifier:
            if key in [Qt.Key.Key_Plus, Qt.Key.Key_Equal]: self.viewer.zoom(1.2)
            elif key == Qt.Key.Key_Minus: self.viewer.zoom(0.8)
            return
        if self.current_index < 0: return
        if key == Qt.Key.Key_N:
            self.current_index = min(len(self.image_paths) - 1, self.current_index + 1)
            self.display_current()
        elif key == Qt.Key.Key_P:
            self.current_index = max(0, self.current_index - 1)
            self.display_current()
        category = None; color = None
        if key == Qt.Key.Key_1: category, color = "BAD", QColor(239, 83, 80)
        elif key == Qt.Key.Key_2: category, color = "OK", QColor(255, 202, 40)
        elif key == Qt.Key.Key_3: category, color = "GOOD", QColor(102, 187, 106)
        if category:
            self.results[self.image_paths[self.current_index]] = category
            self.viewer.flash(color)
            self.update_stats()
            QTimer.singleShot(250, lambda: self.navigate_auto_advance())

    def navigate_auto_advance(self):
        if self.current_index < len(self.image_paths) - 1:
            self.current_index += 1
            self.display_current()

    def finish_sorting(self):
        if not self.results:
            QMessageBox.information(self, "Export", "No images rated yet.")
            return
        
        moved_count = 0
        errors = []
        for path, category in self.results.items():
            try:
                target_dir = os.path.join(self.root_folder, category)
                os.makedirs(target_dir, exist_ok=True)
                target_path = os.path.join(target_dir, os.path.basename(path))
                if os.path.exists(path):
                    shutil.move(path, target_path)
                    moved_count += 1
            except Exception as e:
                errors.append(f"{os.path.basename(path)}: {str(e)}")
        
        summary = {"BAD": 0, "OK": 0, "GOOD": 0}
        for cat in self.results.values(): summary[cat] += 1
        
        msg = f"Export Finished!\nMoved: {moved_count} files.\n"
        msg += f"BAD: {summary['BAD']} | OK: {summary['OK']} | GOOD: {summary['GOOD']}"
        QMessageBox.information(self, "Export Complete", msg)
        
        self.results = {}
        self.load_images(self.root_folder)

    def restore_checkpoint(self):
        cp_path = os.path.join(self.root_folder, ".photosorter_checkpoint.json")
        if not os.path.exists(cp_path):
            QMessageBox.warning(self, "Restore", "No checkpoint found.")
            return
            
        try:
            with open(cp_path, 'r') as f: data = json.load(f)
            restored = 0
            for original_path in data.get("files", []):
                if os.path.exists(original_path): continue
                filename = os.path.basename(original_path)
                for cat in ["BAD", "OK", "GOOD"]:
                    search_path = os.path.join(self.root_folder, cat, filename)
                    if os.path.exists(search_path):
                        os.makedirs(os.path.dirname(original_path), exist_ok=True)
                        shutil.move(search_path, original_path)
                        restored += 1
                        break
            QMessageBox.information(self, "Restore", f"Restored {restored} files.")
            self.load_images(self.root_folder)
        except Exception as e:
            QMessageBox.critical(self, "Restore Error", f"Failed: {e}")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    window = PhotoSorter()
    window.show()
    sys.exit(app.exec())
