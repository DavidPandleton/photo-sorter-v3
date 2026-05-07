import time
from pathlib import Path
from PyQt6.QtCore import QThread, pyqtSignal, QRunnable, QObject
from PyQt6.QtGui import QImage, QImageReader
from PyQt6.QtCore import Qt
from .utils import RAW_SUPPORTED, RAW_EXTENSIONS, NUMPY_SUPPORTED, GAMEPAD_SUPPORTED

if GAMEPAD_SUPPORTED:
    import inputs
if RAW_SUPPORTED:
    import rawpy
if NUMPY_SUPPORTED:
    import numpy as np

class GamepadThread(QThread):
    """
    Background thread that monitors Xbox 360 gamepad events.
    Emits signals for buttons, D-pad, and joysticks.
    """
    button_pressed = pyqtSignal(str)
    joystick_moved = pyqtSignal(str, int)  # Axis name, value
    connection_changed = pyqtSignal(bool)

    def run(self) -> None:
        is_connected = False
        last_button_time = {} # code -> timestamp
        while True:
            lt_pressed = False
            rt_pressed = False
            try:
                # Check connection status
                current_devices = inputs.devices.gamepads
                if not current_devices:
                    if is_connected:
                        is_connected = False
                        self.connection_changed.emit(False)
                    self.msleep(1000)
                    continue
                
                if not is_connected:
                    is_connected = True
                    self.connection_changed.emit(True)

                events = inputs.get_gamepad()
                for event in events:
                    # Buttons
                    if event.ev_type == "Key" and event.state == 1:
                        now = time.time()
                        last_t = last_button_time.get(event.code, 0)
                        if now - last_t > 0.1:  # 100ms debounce
                            self.button_pressed.emit(event.code)
                            last_button_time[event.code] = now
                    # Absolute Axes (Sticks, D-Pad, Triggers)
                    elif event.ev_type == "Absolute":
                        if event.code in ["ABS_X", "ABS_Y", "ABS_RX", "ABS_RY", "ABS_Z", "ABS_RZ"]:
                            self.joystick_moved.emit(event.code, event.state)
                        elif event.code == "ABS_HAT0X":
                            if event.state == 1:
                                self.button_pressed.emit("DPAD_RIGHT")
                            elif event.state == -1:
                                self.button_pressed.emit("DPAD_LEFT")
                        elif event.code == "ABS_HAT0Y":
                            if event.state == -1:
                                self.button_pressed.emit("DPAD_UP")
                            elif event.state == 1:
                                self.button_pressed.emit("DPAD_DOWN")
                        
                        # Trigger threshold detection (still emitting as buttons for simplicity)
                        if event.code == "ABS_Z":
                            if event.state > 200 and not lt_pressed:
                                self.button_pressed.emit("TRIGGER_LEFT")
                                lt_pressed = True
                            elif event.state < 50:
                                lt_pressed = False
                        elif event.code == "ABS_RZ":
                            if event.state > 200 and not rt_pressed:
                                self.button_pressed.emit("TRIGGER_RIGHT")
                                rt_pressed = True
                            elif event.state < 50:
                                rt_pressed = False
                self.msleep(5)  # Yield to prevent aggressive CPU lockups
            except Exception:
                if is_connected:
                    is_connected = False
                    self.connection_changed.emit(False)
                self.msleep(1000)
                continue

class WorkerSignals(QObject):
    loaded = pyqtSignal(str, QImage)
    thumb_loaded = pyqtSignal(str, QImage, float)  # path, image, blur_score
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
            if RAW_SUPPORTED and ext in RAW_EXTENSIONS:
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
                    if not RAW_SUPPORTED or ext not in RAW_EXTENSIONS
                    else "Failed to decode RAW"
                )
                self.signals.error.emit(self.path, f"Failed to load: {err}")
            else:
                self.signals.loaded.emit(self.path, qimage)

        except Exception as e:
            if not self._is_cancelled:
                self.signals.error.emit(self.path, str(e))


class ThumbnailTask(QRunnable):
    """
    A specialized background worker for generating small, lightweight thumbnails.
    Uses aggressive hardware-accelerated scaling for maximum speed.
    """
    def __init__(self, path: str, target_height: int = 120):
        super().__init__()
        self.path = path
        self.target_height = target_height
        self.signals = WorkerSignals()
        self._is_cancelled = False

    def cancel(self) -> None:
        self._is_cancelled = True

    def run(self) -> None:
        if self._is_cancelled:
            return
        try:
            ext = Path(self.path).suffix.lower()
            qimage = None
            
            # Optimized RAW extraction: only use embedded thumbnails for the filmstrip
            if RAW_SUPPORTED and ext in RAW_EXTENSIONS:
                try:
                    with rawpy.imread(self.path) as raw:
                        thumb = raw.extract_thumb()
                        if thumb.format == rawpy.ThumbFormat.JPEG:
                            qimage = QImage()
                            qimage.loadFromData(thumb.data, "JPEG")
                except:
                    pass
            
            # Standard reader: use setScaledSize to decode at low resolution (much faster)
            if qimage is None or qimage.isNull():
                reader = QImageReader(self.path)
                reader.setAutoTransform(True)
                size = reader.size()
                if size.isValid():
                    ratio = self.target_height / size.height()
                    new_size = size * ratio
                    reader.setScaledSize(new_size)
                qimage = reader.read()

            if qimage and not self._is_cancelled:
                # Downscale further if needed for perfect UI fit
                if qimage.height() > self.target_height:
                    qimage = qimage.scaledToHeight(self.target_height, Qt.TransformationMode.SmoothTransformation)
                
                # Blur Detection (AI Rating)
                blur_score = 0.0
                if NUMPY_SUPPORTED:
                    blur_score = self.detect_blur(qimage)

                self.signals.thumb_loaded.emit(self.path, qimage, blur_score)
        except:
            pass

    def detect_blur(self, qimage: QImage) -> float:
        """Calculates a focus score using the variance of the Laplacian."""
        try:
            # Ensure it's in a format we can work with (Grayscale)
            img = qimage.convertToFormat(QImage.Format.Format_Grayscale8)
            width = img.width()
            height = img.height()
            
            if width < 3 or height < 3:
                return 0.0

            ptr = img.bits()
            ptr.setsize(height * width)
            arr = np.frombuffer(ptr, np.uint8).reshape((height, width))
            
            # Center-weighted Laplacian to avoid penalizing bokeh
            cy, cx = height // 2, width // 2
            # Use center 50% of the image
            dy, dx = height // 4, width // 4
            arr_center = arr[cy-dy:cy+dy, cx-dx:cx+dx]
            
            if arr_center.shape[0] < 3 or arr_center.shape[1] < 3:
                arr_center = arr
                
            laplacian = (
                arr_center[1:-1, 0:-2].astype(np.int32) + 
                arr_center[1:-1, 2:].astype(np.int32) + 
                arr_center[0:-2, 1:-1].astype(np.int32) + 
                arr_center[2:, 1:-1].astype(np.int32) - 
                4 * arr_center[1:-1, 1:-1].astype(np.int32)
            )
            return float(np.var(laplacian))
        except:
            return 0.0


