# Architecture Overview

Photo Sorter follows a modular, event-driven architecture built on top of the **PyQt6** framework. It leverages a custom threading model and caching strategy to handle high-resolution image data without blocking the main UI thread.

---

## Core Components

### `PhotoSorter` (QMainWindow)
The central controller in `photosorter/main.py`. Responsible for:
- Application state (image paths, results, current index)
- UI stack transitions (menu ↔ viewer)
- Keyboard/gamepad event dispatch
- Export/restore pipeline
- Database persistence wiring

### `PhotoViewer` (QGraphicsView)
The hero component in `photosorter/ui.py`. Optimized for high-performance rendering of pixmaps with built-in panning and normalized zooming. Supports:
- EXIF text overlay (toggled via `I`)
- Compare mode overlay (toggled via `C`)
- Pick flag (★) and star rating (★★★★★) overlays
- Color flash animation on rating

### `ZoomController`
A dedicated subsystem for input normalization in `photosorter/ui.py`. Translates varying hardware signals (mouse, trackpad, gestures) into a symmetric exponential scaling curve.

---

## Database Layer

### `PhotoDatabase` (SQLite)
Defined in `photosorter/database.py`. Provides full CRUD operations for:

| Table | Purpose |
|-------|---------|
| `images` | Per-image metadata: rating, pick, stars, rotation, EXIF data, blur score |
| `projects` | Folder-backed projects with timestamps |
| `collections` | User-curated named sets across projects |
| `collection_images` | Many-to-many collection membership |
| `tags` | User-defined labels |
| `image_tags` | Many-to-many tag membership |

Key features:
- **WAL mode** for concurrent read/write from multiple threads
- **Schema versioning** via `_migrate_schema()` for forward-compatible upgrades
- **Parameterized queries** throughout to prevent SQL injection

### `ProjectManager`
Defined in `photosorter/project.py`. Handles:
- Opening folders and creating per-folder SQLite databases
- Recent projects index (`~/.photosorter/projects.json`)
- Project metadata (name, root path, created date)

---

## Widget System

### `FoldersBrowser` (QTreeWidget)
Displays the directory tree of the currently opened project. Clicking a subfolder filters the image list to only show images in that subtree.

### `SearchBar` (QLineEdit + QComboBox)
Provides text search across filenames, camera model, and lens. Combined with a rating filter dropdown (All / Unrated / Picked / BAD / OK / GOOD).

### `DateBrowser` (QTreeWidget)
Queries `get_date_hierarchy()` from the database to display a year → month → day tree. Clicking a date filters images taken on that day.

All widgets are in `photosorter/widgets.py`.

---

## Threading Model

To ensure a "zero-lag" UI, all image decoding operations are offloaded to a background thread pool defined in `photosorter/workers.py`.

- **Bounded Concurrency**: Uses `QThreadPool` with a maximum of 6 worker threads to handle simultaneous preloading and UI tasks without saturation.
- **`ImageLoadTask` (QRunnable)**: Encapsulates the loading logic. Supports cancellation via a flag, allowing the pool to bail early if the user navigates past an image before it finishes loading.
- **Signal/Slot Communication**: Workers communicate back to the UI thread via `WorkerSignals` to ensure thread-safe UI updates.

### Filmstrip Navigator & Thumbnail Engine

A secondary high-performance pipeline for thumbnail generation:

- **Isolated Thread Pool**: A dedicated `QThreadPool` (4 workers) handles all filmstrip thumbnail generation independently from main image decoding.
- **`ThumbnailTask` (QRunnable)**:
    - **RAW Optimization**: Uses `rawpy.extract_thumb()` to fetch the camera-embedded JPEG preview instead of full demosaicing.
    - **Memory-Efficient Scaling**: Uses `QImageReader.setScaledSize()` to decode directly into target dimensions.
- **Layered Caching**: A secondary `MemoryBoundedCache` (200MB budget) stores rendered thumbnails for instantaneous scrolling.

### Gamepad Support

**`GamepadThread`** (QThread) polls the `inputs` library in a loop and emits signals for axis/button events. Key features:
- **Universal Mapping**: Normalizes Xbox/PlayStation axis codes into standard logical actions (Zoom, Pan).
- **Hardware Debouncing**: 100ms software debounce for rating actions to prevent accidental multi-triggers.

---

## EXIF Extraction Pipeline

Defined in `photosorter/exif.py`. Two strategies:

1. **RAW files** (`.CR2`, `.NEF`, `.ARW`, `.DNG`, etc.): Uses `rawpy` to extract EXIF metadata directly.
2. **JPEG/TIFF files**: Falls back to `Pillow` (`PIL.Image._getexif()`).

Extracted fields: ISO, aperture, shutter speed, focal length, lens model, camera model, date taken. All data is cached in the database and rendered via `format_exif_for_display()`.

---

## Input Normalization Layer

The gamepad and keyboard systems have been unified into a hardware-agnostic mapping layer:

- **Universal Mapping**: Normalizes varying axis and button codes (e.g., Xbox `RX/RY` vs. PlayStation `Z/RZ`) into standard logical actions like `Zoom` or `Pan`.
- **Dynamic HUD Engine**: A signal-driven observer that monitors the last-used input device and swaps the UI hotkey legend in real-time.
- **Hardware Debouncing**: Implemented a 100ms software-level debounce for all rating actions to prevent accidental multi-triggers on sensitive controller buttons.

---

## Caching & Memory Management

Photo Sorter implements a deterministic memory management strategy to handle large RAW collections.

- **`MemoryBoundedCache`**: A custom LRU (Least Recently Used) cache in `photosorter/utils.py`:
    - **Byte-Aware Eviction**: Tracks approximate memory footprint of `QImage` objects (Width × Height × 4 bytes).
    - **Global Budget**: Main high-res images at 1GB, filmstrip thumbnails at 200MB.
    - **Correct LRU Order**: Uses `OrderedDict.move_to_end()` on access and `popitem(last=False)` on eviction.

---

## RAW Processing Pipeline

RAW files are processed via the `rawpy` (LibRaw) library:

1. **Embedded Thumbnail**: Rapidly extracts the camera's JPEG preview (`raw.extract_thumb()`).
2. **Half-Size Demosaic**: Fallback if no embedded thumbnail is found.
3. **Full Render**: Standard full-resolution decode as final fallback.
