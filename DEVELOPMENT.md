# Developer Documentation: Photo Sorter V1

This document provides a technical overview of the architecture, design patterns, and engineering decisions behind Photo Sorter V1.

---

## 1. Architecture Overview

Photo Sorter follows a modular, event-driven architecture built on top of the **PyQt6** framework. It leverages a custom threading model and caching strategy to handle high-resolution image data without blocking the main UI thread.

### Core Components
- **`PhotoSorter` (QMainWindow)**: The central controller. Manages state (image paths, results, current index), UI stack transitions, and the export/restore logic.
- **`PhotoViewer` (QGraphicsView)**: The hero component. Optimized for high-performance rendering of pixmaps with built-in panning and normalized zooming.
- **`ZoomController`**: A dedicated subsystem for input normalization. Translates varying hardware signals (mouse, trackpad, gestures) into a symmetric exponential scaling curve.

---

## 2. Threading Model

To ensure a "zero-lag" UI, all image decoding operations are offloaded to a background thread pool.

- **Bounded Concurrency**: Uses `QThreadPool` with a maximum of 4 worker threads to prevent CPU saturation during massive preloads.
- **`ImageLoadTask` (QRunnable)**: Encapsulates the loading logic. It supports "cancellation" via a flag, allowing the pool to bail early if the user navigates past an image before it finishes loading.
- **Signal/Slot Communication**: Workers communicate back to the UI thread via `WorkerSignals` to ensure thread-safe UI updates.

---

## 3. Caching & Memory Management

Photo Sorter implements a deterministic memory management strategy to handle large RAW collections.

- **`MemoryBoundedCache`**: A custom LRU (Least Recently Used) cache.
- **Byte-Aware Eviction**: Instead of counting items, the cache tracks the approximate memory footprint of `QImage` objects (Width × Height × 4 bytes).
- **Default Budget**: Set to 1GB by default. Once exceeded, the oldest image is evicted from memory.

---

## 4. RAW Processing Pipeline

RAW files are processed via the `rawpy` (LibRaw) library using a performance-optimized fallback chain:

1. **Embedded Thumbnail**: Rapidly extracts the camera's JPEG preview (`raw.extract_thumb()`).
2. **Half-Size Demosaic**: If no thumbnail is found, performs a fast half-resolution decode.
3. **Full Render**: Standard full-resolution decode as a final fallback.

---

## 5. Checkpoint Schema (v2.0)

The checkpoint system is designed to be atomic and crash-safe. It is stored as a JSON file (`.photosorter_checkpoint.json`).

### Data Structure
```json
{
  "version": "2.0",
  "root": "/path/to/project",
  "created_at": "ISO-TIMESTAMP",
  "created_folders": ["BAD", "OK", "GOOD/Subfolder"],
  "operations": [
    {
      "original_path": "/path/to/image.jpg",
      "exported_path": "/path/to/BAD/image.jpg",
      "category": "BAD",
      "status": "completed",
      "size": 102456,
      "sha1": "da39a3ee5e6b4b0d3255bfef95601890afd80709"
    }
  ]
}
```

### Safety Features
- **Atomic Writes**: Data is written to a `.tmp` file and then swapped (`os.replace`) to ensure the file is never left in a corrupted state.
- **Integrity Checks**: SHA1 hashes and file sizes are used to validate files during the restoration process.

---

## 6. Export Pipeline (Option A)

The export pipeline preserves the original directory structure to ensure it is 100% reversible and avoids filename collisions.

- **Relative Mapping**: Uses `pathlib.Path.relative_to(root)` to calculate the destination sub-path.
- **Recursive Directory Creation**: Automatically generates nested subfolders inside the category buckets (`/BAD`, `/OK`, `/GOOD`) as needed.
- **Safe Move**: Implements a cross-filesystem move logic that falls back to `copy2` + `os.remove` if a simple rename fails (common on Linux/Unix partitions).
