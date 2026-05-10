import hashlib
import os
import shutil
import sys
from collections import OrderedDict

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QImage

IS_MAC = sys.platform == "darwin"
MOD_MASK = Qt.KeyboardModifier.MetaModifier if IS_MAC else Qt.KeyboardModifier.ControlModifier

try:
    import rawpy
    RAW_SUPPORTED = True
except ImportError:
    RAW_SUPPORTED = False

RAW_EXTENSIONS = [".cr2", ".cr3", ".arw", ".nef", ".nrw", ".dng", ".raf", ".orf", ".rw2", ".srw", ".pef", ".x3f"]

try:
    import numpy as np
    NUMPY_SUPPORTED = True
except ImportError:
    NUMPY_SUPPORTED = False

try:
    import inputs
    GAMEPAD_SUPPORTED = True
except ImportError:
    GAMEPAD_SUPPORTED = False

def safe_move(src: str, dst: str) -> None:
    """
    Safely moves a file from src to dst.
    Handles cross-filesystem transfers by falling back to copy+delete, with size verification.
    """
    try:
        shutil.move(src, dst)
    except Exception:
        # Fallback for cross-device moves
        shutil.copy2(src, dst)
        if os.path.exists(dst) and os.path.getsize(src) == os.path.getsize(dst):
            os.remove(src)
        else:
            raise OSError(f"File copy verification failed for {src} to {dst}")


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

        # Calculate actual byte size + overhead, or fallback
        size = int(qimage.sizeInBytes() * 1.5) if hasattr(qimage, 'sizeInBytes') else qimage.width() * qimage.height() * 4
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
            _, (_, size) = self.cache.popitem(last=False)
            self.current_bytes -= size

    def clear(self) -> None:
        """Clears all items from the cache."""
        self.cache.clear()
        self.current_bytes = 0

    def __contains__(self, key: str) -> bool:
        return key in self.cache


