import math
import os
from pathlib import Path

from PyQt6.QtCore import QEvent, QRectF, Qt, QTimer, QVariantAnimation, pyqtSignal
from PyQt6.QtGui import (
    QBrush,
    QColor,
    QFont,
    QImage,
    QMouseEvent,
    QPainter,
    QPen,
    QPixmap,
    QResizeEvent,
    QWheelEvent,
)
from PyQt6.QtWidgets import (
    QFrame,
    QGestureEvent,
    QGraphicsPixmapItem,
    QGraphicsRectItem,
    QGraphicsScene,
    QGraphicsTextItem,
    QGraphicsView,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from .utils import MOD_MASK


class ThumbnailItem(QFrame):
    """
    A single cell in the filmstrip.
    Displays the image, rating status, and handles selection.
    """
    clicked = pyqtSignal(str)

    def __init__(self, path: str, target_height: int = 100):
        super().__init__()
        self.path = path
        self.target_height = target_height
        self.setFixedWidth(int(target_height * 1.5))
        self.setFixedHeight(target_height + 20)
        self.setObjectName("ThumbnailItem")
        self.setCursor(Qt.CursorShape.PointingHandCursor)

        # Explicit State Initialization
        self.rating = None
        self.is_active = False

        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(4, 4, 4, 4)
        self.layout.setSpacing(2)

        # Rating Ribbon (Top)
        self.ribbon = QWidget()
        self.ribbon.setFixedHeight(4)
        self.ribbon.setStyleSheet("border-radius: 2px;")
        self.ribbon.hide()
        self.layout.addWidget(self.ribbon)

        self.img_label = QLabel()
        self.img_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.img_label.setStyleSheet("background-color: #1a1a1a; border-radius: 3px;")
        self.layout.addWidget(self.img_label)

        # Blur/Focus Score Overlay (Bottom Right)
        self.blur_label = QLabel(self)
        self.blur_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.blur_label.setStyleSheet("""
            background-color: rgba(0, 0, 0, 180);
            color: #eee;
            font-size: 10px;
            font-weight: bold;
            padding: 2px 5px;
            border-radius: 4px;
            border: 1px solid #444;
        """)
        self.blur_label.hide()

        self.set_active(False)

    def set_image(self, qimage: QImage):
        pixmap = QPixmap.fromImage(qimage)
        # Scaled smoothly for the UI cell
        scaled = pixmap.scaled(
            self.width() - 8, self.target_height - 10,
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation
        )
        self.img_label.setPixmap(scaled)

        # Position blur label relative to the scaled image
        # This is a simple approximation; for perfect center it needs more math
        self.blur_label.raise_()
        self.update_tooltip()

    def set_blur(self, score: float):
        """Sets the focus score and updates the UI indicator."""
        if score <= 0:
            self.blur_label.hide()
            return

        # Qualitative thresholds (empirically derived for 400px thumbnails)
        # > 1500: Tack Sharp
        # > 500: Acceptable
        # < 200: Blurry
        text = "SHARP" if score > 1000 else "SOFT" if score > 300 else "BLUR"
        color = "#4caf50" if score > 1000 else "#ff9800" if score > 300 else "#f44336"

        self.blur_label.setText(text)
        self.blur_label.setStyleSheet(f"""
            background-color: rgba(0, 0, 0, 180);
            color: {color};
            font-size: 9px;
            font-weight: 800;
            padding: 1px 4px;
            border-radius: 3px;
            border: 1px solid {color}44;
        """)
        self.blur_label.show()

        # Reposition to bottom right of the image container
        self.blur_label.adjustSize()
        self.blur_label.move(
            self.width() - self.blur_label.width() - 8,
            self.height() - self.blur_label.height() - 8
        )

    def set_rating(self, rating: str):
        self.rating = rating
        if not rating:
            self.ribbon.hide()
            self.update_tooltip()
            return

        colors = {"BAD": "#ef5350", "OK": "#ffca28", "GOOD": "#66bb6a"}
        self.ribbon.setStyleSheet(f"background-color: {colors.get(rating, 'transparent')}; border-radius: 2px;")
        self.ribbon.show()
        self.update_tooltip()

    def update_tooltip(self):
        # Defensive metadata extraction
        name = os.path.basename(self.path) if self.path else "Unknown"
        rating_text = f"Rating: {self.rating}" if self.rating else "Unrated"
        ext = ""
        if self.path:
            ext_part = Path(self.path).suffix
            if ext_part:
                ext = ext_part[1:].upper()

        self.setToolTip(f"<b>{name}</b><br>{rating_text}<br>Type: {ext}")

    def set_active(self, active: bool):
        self.is_active = active
        if active:
            self.setStyleSheet("""
                #ThumbnailItem {
                    border: 2px solid #42a5f5;
                    background-color: #222;
                    border-radius: 6px;
                }
            """)
        else:
            self.setStyleSheet("""
                #ThumbnailItem {
                    border: 1px solid #252525;
                    background-color: transparent;
                    border-radius: 6px;
                }
            """)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self.path)


class FilmstripWidget(QScrollArea):
    """
    A horizontal strip of thumbnails that auto-centers the active image.
    Integrated with a background loader to handle large batches smoothly.
    """
    image_selected = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWidgetResizable(True)
        self.setFixedHeight(150)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setObjectName("Filmstrip")

        self.container = QWidget()
        self.container.setObjectName("FilmstripContainer")
        self.strip_layout = QHBoxLayout(self.container)
        self.strip_layout.setContentsMargins(20, 10, 20, 10)
        self.strip_layout.setSpacing(10)
        self.strip_layout.setAlignment(Qt.AlignmentFlag.AlignLeft)

        self.setWidget(self.container)

        self.items = {} # path -> ThumbnailItem
        self.ordered_items = []
        self.current_path = ""

    def rebuild(self, paths: list[str]):
        """Clears and rebuilds the strip from a new list of paths."""
        # Clear layout
        while self.strip_layout.count():
            item = self.strip_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        self.items.clear()
        self.ordered_items.clear()

        for p in paths:
            item = ThumbnailItem(p)
            item.clicked.connect(self.image_selected.emit)
            self.strip_layout.addWidget(item)
            self.items[p] = item
            self.ordered_items.append(item)

    def update_rating(self, path: str, rating: str):
        if path in self.items:
            self.items[path].set_rating(rating)

    def set_active(self, path: str):
        if self.current_path in self.items:
            self.items[self.current_path].set_active(False)

        self.current_path = path
        if path in self.items:
            item = self.items[path]
            item.set_active(True)
            # Smooth scroll to center
            QTimer.singleShot(50, lambda: self.center_on_item(item))

    def center_on_item(self, item: ThumbnailItem):
        """Scrolls the area to bring the item to the center."""
        scroll_bar = self.horizontalScrollBar()
        item_center = item.geometry().center().x()
        viewport_width = self.viewport().width()
        scroll_bar.setValue(item_center - viewport_width // 2)

    def set_thumbnail(self, path: str, qimage: QImage, blur_score: float = 0.0):
        if path in self.items:
            self.items[path].set_image(qimage)
            if blur_score > 0:
                self.items[path].set_blur(blur_score)


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

    def apply_zoom_at_center(self, factor: float) -> None:
        """Applies zoom anchored at the viewport center (global zoom)."""
        current_scale = self.viewer.transform().m11()
        fit_scale = self.viewer.get_fit_scale()

        if factor > 1.0 and current_scale > fit_scale * self.max_scale_multiplier:
            return
        if factor < 1.0 and current_scale <= fit_scale:
            self.viewer.force_fit()
            return

        old_anchor = self.viewer.transformationAnchor()
        self.viewer.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorViewCenter)
        self.viewer.scale(factor, factor)
        self.viewer.setTransformationAnchor(old_anchor)

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

        self.compare_item = QGraphicsPixmapItem()
        self.compare_item.hide()
        self.scene.addItem(self.compare_item)

        self.overlay_item = QGraphicsRectItem(self.pixmap_item)
        self.overlay_item.setPen(QPen(Qt.PenStyle.NoPen))
        self.overlay_item.setZValue(1)
        self.overlay_item.setOpacity(0.0)

        self.exif_item = QGraphicsTextItem()
        self.exif_item.setDefaultTextColor(QColor(255, 255, 255))
        self.exif_item.setZValue(2)
        exif_font = QFont("Consolas", 12)
        exif_font.setBold(True)
        self.exif_item.setFont(exif_font)
        self.exif_item.hide()

        self.exif_bg = QGraphicsRectItem()
        self.exif_bg.setBrush(QBrush(QColor(0, 0, 0, 160)))
        self.exif_bg.setPen(QPen(Qt.PenStyle.NoPen))
        self.exif_bg.setZValue(1)
        self.exif_bg.hide()

        self.flag_item = QGraphicsTextItem()
        self.flag_item.setDefaultTextColor(QColor(255, 193, 7))
        flag_font = QFont("Segoe UI", 28)
        flag_font.setBold(True)
        self.flag_item.setFont(flag_font)
        self.flag_item.setPlainText("★")
        self.flag_item.setZValue(3)
        self.flag_item.hide()

        self.star_item = QGraphicsTextItem()
        self.star_item.setDefaultTextColor(QColor(255, 193, 7))
        star_font = QFont("Segoe UI", 16)
        self.star_item.setFont(star_font)
        self.star_item.setZValue(3)
        self.star_item.hide()

        self.showing_exif = False
        self.showing_compare = False
        self._exif_text = ""
        self._picked = False
        self._stars = 0

        self.anim: QVariantAnimation | None = None
        self.zoom_controller = ZoomController(self)

    def set_exif_text(self, text: str) -> None:
        self._exif_text = text
        if not text:
            self.exif_item.hide()
            self.exif_bg.hide()
            return
        self.exif_item.setPlainText(text)
        doc = self.exif_item.document()
        doc.setTextWidth(doc.idealWidth())
        text_rect = self.exif_item.boundingRect()
        margin = 8
        self.exif_bg.setRect(
            text_rect.x() - margin, text_rect.y() - margin,
            text_rect.width() + margin * 2, text_rect.height() + margin * 2,
        )
        self.exif_item.setPos(self.viewport().width() - text_rect.width() - 20, 10)
        self.exif_bg.setPos(self.exif_item.pos().x() - margin, self.exif_item.pos().y() - margin)
        if self.showing_exif:
            self.exif_item.show()
            self.exif_bg.show()

    def toggle_exif(self) -> bool:
        self.showing_exif = not self.showing_exif
        if self.showing_exif and self._exif_text:
            self.set_exif_text(self._exif_text)
        else:
            self.exif_item.hide()
            self.exif_bg.hide()
        return self.showing_exif

    def set_compare_image(self, qimage: QImage) -> None:
        self.compare_item.setPixmap(QPixmap.fromImage(qimage))

    def toggle_compare(self) -> bool:
        self.showing_compare = not self.showing_compare
        if self.showing_compare:
            self.compare_item.show()
            self.fit_split_view()
        else:
            self.compare_item.hide()
            self.fitInView(self.pixmap_item, Qt.AspectRatioMode.KeepAspectRatio)
        return self.showing_compare

    def fit_split_view(self) -> None:
        vpw = self.viewport().width()
        vph = self.viewport().height()
        half = vpw // 2
        pw = self.pixmap_item.pixmap().width()
        ph = self.pixmap_item.pixmap().height()
        if pw == 0 or ph == 0:
            return
        scale = min((half - 10) / pw, vph / ph)
        self.pixmap_item.setPos(0, 0)
        self.pixmap_item.setTransformOriginPoint(pw / 2, ph / 2)
        self.pixmap_item.setScale(scale)
        self.compare_item.setPos(half, 0)
        cw = self.compare_item.pixmap().width()
        ch = self.compare_item.pixmap().height()
        if cw > 0 and ch > 0:
            cscale = min((half - 10) / cw, vph / ch)
            self.compare_item.setTransformOriginPoint(cw / 2, ch / 2)
            self.compare_item.setScale(cscale)
        self.setSceneRect(0, 0, vpw, vph)

    def set_pick(self, picked: bool) -> None:
        self._picked = picked
        self.flag_item.setVisible(picked)

    def set_stars(self, count: int) -> None:
        self._stars = count
        if count > 0:
            self.star_item.setPlainText("★" * count)
            self.star_item.show()
        else:
            self.star_item.hide()

    def _reposition_overlays(self):
        vpw = self.viewport().width()
        flag_rect = self.flag_item.boundingRect()
        self.flag_item.setPos(vpw - flag_rect.width() - 15, 10)
        star_rect = self.star_item.boundingRect()
        self.star_item.setPos(vpw - star_rect.width() - 15, self.flag_item.isVisible() and 55 or 10)

    def set_image(self, qimage: QImage, rotation: int = 0) -> None:
        """Sets the current image and fits it to the view."""
        pixmap = QPixmap.fromImage(qimage)
        self.pixmap_item.setPixmap(pixmap)
        self.set_rotation(rotation)
        rect = QRectF(pixmap.rect())
        self.scene.setSceneRect(rect)
        self.overlay_item.setRect(rect)
        self.fitInView(self.pixmap_item, Qt.AspectRatioMode.KeepAspectRatio)
        self._reposition_overlays()

    def set_rotation(self, angle: int) -> None:
        """Sets the visual rotation of the image."""
        self.pixmap_item.setRotation(angle)
        rect = self.pixmap_item.boundingRect()
        self.pixmap_item.setTransformOriginPoint(rect.center())
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


