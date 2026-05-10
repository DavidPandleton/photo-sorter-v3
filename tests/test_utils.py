import os
import tempfile
from pathlib import Path
from PyQt6.QtGui import QImage
from PyQt6.QtCore import Qt

from photosorter.utils import MemoryBoundedCache, safe_move, compute_file_metadata


def _make_image(w: int = 100, h: int = 100):
    img = QImage(w, h, QImage.Format.Format_RGB32)
    img.fill(Qt.GlobalColor.white)
    return img


class TestMemoryBoundedCache:
    def test_put_and_get(self):
        cache = MemoryBoundedCache(max_mb=10)
        img = _make_image()
        cache.put("key1", img)
        assert cache.get("key1") is img

    def test_eviction(self):
        cache = MemoryBoundedCache(max_mb=1)
        for i in range(100):
            cache.put(f"key{i}", _make_image(200, 200))
        assert cache.current_bytes <= cache.max_bytes

    def test_clear(self):
        cache = MemoryBoundedCache(max_mb=10)
        cache.put("a", _make_image())
        cache.put("b", _make_image())
        cache.clear()
        assert cache.get("a") is None
        assert cache.current_bytes == 0

    def test_contains(self):
        cache = MemoryBoundedCache(max_mb=10)
        cache.put("x", _make_image())
        assert "x" in cache
        assert "y" not in cache

    def test_lru_order(self):
        cache = MemoryBoundedCache(max_mb=10)
        cache.put("a", _make_image())
        cache.put("b", _make_image())
        cache.get("a")
        assert list(cache.cache.keys())[-1] == "a"


class TestSafeMove:
    def test_basic_move(self):
        src = tempfile.NamedTemporaryFile(delete=False)
        src.write(b"hello")
        src.close()
        dst = src.name + ".moved"
        safe_move(src.name, dst)
        assert os.path.exists(dst)
        assert not os.path.exists(src.name)
        os.unlink(dst)

    def test_move_nonexistent_source(self):
        import pytest
        with pytest.raises((FileNotFoundError, OSError)):
            safe_move("/nonexistent/path", "/tmp/dest")


class TestComputeFileMetadata:
    def test_metadata(self):
        f = tempfile.NamedTemporaryFile(delete=False)
        f.write(b"test data for hash")
        f.close()
        size, sha1 = compute_file_metadata(f.name)
        assert size > 0
        assert len(sha1) == 40  # SHA1 hex length
        os.unlink(f.name)

    def test_nonexistent(self):
        size, sha1 = compute_file_metadata("/nonexistent/file")
        assert size == 0
        assert sha1 == ""
