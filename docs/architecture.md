# Architecture Overview

Photo Sorter follows a modular, event-driven architecture built on top of the **PyQt6** framework. It leverages a custom threading model and caching strategy to handle high-resolution image data without blocking the main UI thread.

## Core Components
- **`PhotoSorter` (QMainWindow)**: The central controller. Manages state (image paths, results, current index), UI stack transitions, and the export/restore logic.
- **`PhotoViewer` (QGraphicsView)**: The hero component. Optimized for high-performance rendering of pixmaps with built-in panning and normalized zooming.
- **`ZoomController`**: A dedicated subsystem for input normalization. Translates varying hardware signals (mouse, trackpad, gestures) into a symmetric exponential scaling curve.

## Threading Model

To ensure a "zero-lag" UI, all image decoding operations are offloaded to a background thread pool.

- **Bounded Concurrency**: Uses `QThreadPool` with a maximum of 4 worker threads to prevent CPU saturation during massive preloads.
- **`ImageLoadTask` (QRunnable)**: Encapsulates the loading logic. It supports "cancellation" via a flag, allowing the pool to bail early if the user navigates past an image before it finishes loading.
- **Signal/Slot Communication**: Workers communicate back to the UI thread via `WorkerSignals` to ensure thread-safe UI updates.

## Caching & Memory Management

Photo Sorter implements a deterministic memory management strategy to handle large RAW collections.

- **`MemoryBoundedCache`**: A custom LRU (Least Recently Used) cache.
- **Byte-Aware Eviction**: Instead of counting items, the cache tracks the approximate memory footprint of `QImage` objects (Width × Height × 4 bytes).
- **Default Budget**: Set to 1GB by default. Once exceeded, the oldest image is evicted from memory.

## RAW Processing Pipeline

RAW files are processed via the `rawpy` (LibRaw) library using a performance-optimized fallback chain:

1. **Embedded Thumbnail**: Rapidly extracts the camera's JPEG preview (`raw.extract_thumb()`).
2. **Half-Size Demosaic**: If no thumbnail is found, performs a fast half-resolution decode.
3. **Full Render**: Standard full-resolution decode as a final fallback.
