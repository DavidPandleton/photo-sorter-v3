# Photo Sorter V1

A professional-grade, high-performance desktop utility for rapid photo culling and organization. Designed for photographers who need to move through large shoots with speed and precision.

---

## Overview

Photo Sorter V1 is a lightweight yet robust tool that prioritizes workflow efficiency. It allows you to quickly categorize images into three simple buckets (**BAD**, **OK**, and **GOOD**) using a keyboard-first interface. Built with Python and PyQt6, it handles both standard web formats and professional RAW files with ease.

## Why Photo Sorter?

Most photo managers are bloated and slow. Photo Sorter is built for a single purpose: **Fast Culling**. It stays out of your way and focuses on making your selection process as frictionless as possible.

---

## Key Features

- **High-Performance Architecture**: Uses a multi-threaded `QThreadPool` loader with bounded concurrency to keep the UI responsive, even with large RAW files.
- **Intelligent Caching**: Implements a memory-bounded LRU (Least Recently Used) cache to keep your experience smooth without exhausting system RAM.
- **Standardized Zoom**: Unified zoom mechanics across Windows, macOS, and Linux, supporting mouse wheels, precision touchpads, and native pinch gestures.
- **Smart RAW Pipeline**: Optimized for speed using a fallback chain (Embedded Thumbnail → Half-size Demosaic → Full Demosaic).
- **Safety First**: Features an atomic checkpoint system (v2.0) with SHA1 validation to ensure your files are always recoverable.
- **Preserved Hierarchy**: Maintains your original subfolder structure during export (Option A).
- **Cross-Platform**: Tailored experience for Windows, macOS (Retina/Silicon support), and Linux.

---

## Keyboard Shortcuts

### Sorting & Workflow
| Key | Action |
| :--- | :--- |
| **1** | Rate as **BAD** (Red Flash) |
| **2** | Rate as **OK** (Yellow Flash) |
| **3** | Rate as **GOOD** (Green Flash) |
| **Enter** | **Finalize Export** (Moves rated files to category folders) |
| **ESC** | Return to Menu (with confirmation if progress exists) |

### Navigation & View
| Key | Action |
| :--- | :--- |
| **N** | Next Image |
| **P** | Previous Image |
| **F** | Toggle Fullscreen |
| **Ctrl + Scroll** | Smooth Zoom (Cmd on macOS) |
| **Pinch** | Native Pinch-to-Zoom (if supported by hardware) |
| **Ctrl + 0** | Reset Zoom to Fit (Cmd on macOS) |
| **Double-Click** | Reset Zoom to Fit |

---

## Supported Formats

- **Standard**: `.jpg`, `.jpeg`, `.png`, `.webp`
- **RAW**: `.cr2` (Canon), `.arw` (Sony), `.nef` (Nikon)
  - *Requires `rawpy` for RAW support.*

---

## Installation

### Prerequisites
- **Python 3.9+**
- **pip** (Python package manager)

### Setup
1. Clone or download the repository.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the application:
   ```bash
   python sorter.py
   ```

### Platform-Specific Notes

#### macOS
- Installs via virtual environment are highly recommended.
- You may need to install `libraw` via Homebrew for RAW support:
  ```bash
  brew install libraw
  ```

#### Linux
- Ensure `qt6-base` is installed for your distribution.
- For RAW support, ensure `libraw` is available (e.g., `sudo pacman -S libraw` or `sudo apt install libraw-dev`).

---

## How Export Works

When you finalize an export:
1. The app calculates the relative path of your rated images.
2. It creates `/BAD`, `/OK`, and `/GOOD` folders in your root directory.
3. It moves your files into these folders, **preserving the original subfolder hierarchy**.
4. Files you did not rate remain untouched in their original locations.

---

## Checkpoint & Restore

Photo Sorter maintains a `.photosorter_checkpoint.json` file in your project folder.
- **Atomic Writes**: Uses temporary file replacement to prevent data loss during crashes.
- **Validation**: Tracks file sizes and SHA1 hashes to ensure integrity.
- **Restore**: The "Restore" feature will reverse all moves and clean up empty generated folders, returning your directory to its exact original state.

---

## Troubleshooting

- **Sluggish RAW loading**: This is usually due to missing embedded thumbnails in old or obscure RAW formats. The app will fallback to a half-size render.
- **UI Scaling Issues**: On High-DPI displays (Windows/Retina), the app automatically applies a `PassThrough` policy. If things look small, check your OS scaling settings.
- **Missing Shortcuts**: Some Linux desktop environments intercept standard keys. Check your global shortcut settings if `N` or `P` are not registering.

---

## Roadmap

- [ ] Native support for DNG and HEIC formats.
- [ ] Side-by-side comparison mode.
- [ ] Non-destructive rating (XMP metadata writing).
- [ ] Integrated histogram display.

---

## License

*This project is provided as-is for personal use. [LICENSE placeholder]*
