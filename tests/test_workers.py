import numpy as np
from photosorter.workers import ThumbnailTask


class TestThumbnailTask:
    def test_cancel_before_run(self):
        task = ThumbnailTask("/nonexistent.jpg")
        task.cancel()
        assert task._is_cancelled
        # Should not raise
        task.run()

    def test_initial_state(self):
        task = ThumbnailTask("/test.jpg")
        assert task.path == "/test.jpg"
        assert not task._is_cancelled


class TestImageLoadTask:
    def test_cancel_before_run(self):
        from photosorter.workers import ImageLoadTask
        task = ImageLoadTask("/nonexistent.jpg")
        task.cancel()
        assert task._is_cancelled
        task.run()
