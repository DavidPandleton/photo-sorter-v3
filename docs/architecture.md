# Architecture Overview

Photo Sorter follows a modular, event-driven architecture built on top of the **PyQt6** framework. It leverages a custom threading model and caching strategy to handle high-resolution image data without blocking the main UI thread.

## Core Components
- **`PhotoSorter` (QMainWindow)**: The central controller. Manages state (image paths, results, current index), UI stack transitions, and the export/restore logic.
- **`PhotoViewer` (QGraphicsView)**: The hero component. Optimized for high-performance rendering of pixmaps with built-in panning and normalized zooming.
- **`ZoomController`**: A dedicated subsystem for input normalization. Translates varying hardware signals (mouse, trackpad, gestures) into a symmetric exponential scaling curve.

## Threading Model

To ensure a "zero-lag" UI, all image decoding operations are offloaded to a background thread pool.

- **Bounded Concurrency**: Uses `QThreadPool` with a maximum of 6 worker threads to handle simultaneous preloading and UI tasks without saturation.
- **`ImageLoadTask` (QRunnable)**: Encapsulates the loading logic. It supports "cancellation" via a flag, allowing the pool to bail early if the user navigates past an image before it finishes loading.
- **Signal/Slot Communication**: Workers communicate back to the UI thread via `WorkerSignals` to ensure thread-safe UI updates.

## Filmstrip Navigator & Thumbnail Engine

To provide visual context without impacting main viewer performance, a secondary high-performance pipeline was implemented:

- **Isolated Thread Pool**: A dedicated `QThreadPool` (4 workers) handles all filmstrip thumbnail generation. This ensures that even during rapid scrolling in the filmstrip, the main high-res image decoding (handled by the primary 6-worker pool) remains prioritized.
- **`ThumbnailTask` (QRunnable)**: Specifically optimized for rapid visual feedback:
    - **RAW Optimization**: Uses `rawpy.extract_thumb()` to fetch the camera-embedded JPEG preview instead of full demosaicing.
    - **Memory-Efficient Scaling**: Uses `QImageReader.setScaledSize()` to decode directly into the target thumbnail dimensions, drastically reducing memory overhead during load.
- **Layered Caching**: A secondary `MemoryBoundedCache` (200MB budget) stores rendered thumbnails, allowing for instantaneous scrolling through previously viewed regions of the strip.

## Input Normalization Layer

The gamepad and keyboard systems have been unified into a hardware-agnostic mapping layer:

- **Universal Mapping**: Normalizes varying axis and button codes (e.g., Xbox `RX/RY` vs. PlayStation `Z/RZ`) into standard logical actions like `Zoom` or `Pan`.
- **Dynamic HUD Engine**: A signal-driven observer that monitors the last-used input device and swaps the UI hotkey legend in real-time.
- **Hardware Debouncing**: Implemented a 100ms software-level debounce for all rating actions to prevent accidental multi-triggers on sensitive controller buttons.

## Caching & Memory Management

Photo Sorter implements a deterministic memory management strategy to handle large RAW collections.

- **`MemoryBoundedCache`**: A custom LRU (Least Recently Used) cache.
- **Byte-Aware Eviction**: Instead of counting items, the cache tracks the approximate memory footprint of `QImage` objects (Width × Height × 4 bytes).
- **Global Budget**: Main high-res images are budgeted at 1GB, while filmstrip thumbnails are budgeted separately at 200MB.

## RAW Processing Pipeline

RAW files are processed via the `rawpy` (LibRaw) library using a performance-optimized fallback chain:

1. **Embedded Thumbnail**: Rapidly extracts the camera's JPEG preview (`raw.extract_thumb()`).
2. **Half-Size Demosaic**: If no thumbnail is found, performs a fast half-resolution decode.
3. **Full Render**: Standard full-resolution decode as a final fallback.
