# Photo Sorter V1

<p align="center">
  <img src="assets/screenshots/main menu.png" alt="Photo Sorter V1 Main Menu" width="600">
</p>

<p align="center">
  🇺🇸 **English** | 🇮🇩 [Bahasa Indonesia](docs/id/README.md)
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/Python-3.9%2B-blueviolet" alt="Python Version">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/tests-40%20passing-brightgreen" alt="Tests">
</p>

Photo Sorter V1 is a fast, distraction-free tool for culling large batches of photos. It is **not** Lightroom — it is a pre-filter to quickly decide what to keep before you start editing.

---

## Quick Start

1. **Python 3.9+** required.
2. Run `scripts/install.bat` (Windows) or `scripts/install.sh` (Linux/macOS).
3. Run `scripts/run.bat` or `scripts/run.sh` to launch.

Or manually:

```bash
python -m venv venv
venv\Scripts\activate    # Windows
# source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
python sorter.py
```

---

## Features

### Core Workflow

| Action | Key | Description |
|--------|-----|-------------|
| BAD | `1` | Red flash — blurry, mistakes |
| OK | `2` | Yellow flash — maybes |
| GOOD | `3` | Green flash — winners |
| Unrate | `0` | Remove rating, gray flash |
| Next/Prev | `N` / `P` | Navigate images |
| Finish Export | `Enter` | Moves files into BAD/OK/GOOD folders |
| Delete | `Del` | Permanently delete with confirmation |
| Undo Rating | `Ctrl+Z` | Stack-based revert of last rating |

### Pro Features

| Action | Key | Description |
|--------|-----|-------------|
| EXIF Overlay | `I` | Toggle ISO, aperture, shutter speed, focal length, lens, camera model |
| Compare Mode | `C` | Side-by-side view with previous image |
| Jump to Image | `Ctrl+G` | Type a number to jump directly |
| Fullscreen | `F` | Toggle fullscreen mode |
| HUD Toggle | `H` | Show/hide the controls legend |
| Zoom In/Out | `Ctrl+` / `Ctrl-` | Smooth exponential zoom |
| Reset Zoom | `Ctrl+0` | Fit image to window |
| Rotate | `R` / `Shift+R` | Rotate right/left 90 degrees |

### Library Management

| Action | Key | Description |
|--------|-----|-------------|
| Pick/Flag | `Space` | Toggle gold star pick flag |
| Star Rating | `Ctrl+1` to `Ctrl+5` | 1-5 star rating; press same number to clear |
| Filter Unrated | `U` | Skip already-rated images during navigation |
| Filter by rating | Dropdown | All / Unrated / Picked / BAD / OK / GOOD |
| Text Search | Search bar | Search by filename, lens, or camera model |
| Folder Browse | Click tree | Navigate subdirectories to filter images |
| Date Browse | Click date | Show photos from a specific date |

All ratings, picks, stars, rotations, and blur scores persist across sessions via SQLite database.

### Persistence

- **SQLite database** stored at `~/.photosorter/dbs/`
- **Project index** at `~/.photosorter/projects.json`
- **Rotating logs** at `~/.photosorter/logs/photosorter.log`
- **Checkpoint system** (`.photosorter_checkpoint.json`) makes exports fully reversible

---

## Gamepad Controls

| Button | Action |
|--------|--------|
| **A / Cross** | Rate GOOD |
| **X / Square** | Rate OK |
| **B / Circle** | Rate BAD |
| **LB / RB** | Prev / Next Image |
| **L-Stick** | Pan Image |
| **R-Stick** | Zoom In/Out |
| **LT / RT** (L2/R2) | Rotate Left / Right |
| **Start** | Finalize Export |
| **Select/Back** | Return to Menu |
| **Y / Triangle** | Reset Zoom |
| **R-Thumb** | Toggle HUD |

---

## Build Standalone Executable

```bash
python packaging/build_windows.py
```

The output is placed in `dist/PhotoSorter/`. Use `packaging/photo_sorter_setup.iss` with Inno Setup to create an installer.

---

## Development

```bash
pip install -e ".[dev]"
pytest tests/        # 40+ tests
ruff check .         # linting
```

See [docs/development.md](docs/development.md) for full details.

---

## License

MIT. See [LICENSE](LICENSE).
