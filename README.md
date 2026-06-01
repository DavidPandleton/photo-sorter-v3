# Photo Sorter

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/Python-3.9%2B-teal" alt="Python Version">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/tests-54%20passing-brightgreen" alt="Tests">
</p>

<p align="center">
  <b>Bahasa Indonesia:</b> <a href="docs/id/README.md">🇮🇩 Baca di sini</a>
</p>

A fast, keyboard-driven tool for culling and rating large photo batches.  
This is **not** Lightroom — it's a pre-filter to quickly decide what to keep *before* you open your editor.

Work through hundreds of photos in minutes. Rate with a single keypress. Export sorted folders in one click.

---

## Features

- **Keyboard-first workflow** — rate, navigate, zoom, delete, pick — all without touching the mouse
- **Three-tier rating** — BAD (1), OK (2), GOOD (3) with instant color feedback
- **Star ratings** — `Ctrl+1` through `Ctrl+5` for fine-grained quality scoring
- **Pick flagging** — `Space` to mark favorites, shown as gold star overlay
- **Compare mode** — `C` for side-by-side with the previous image
- **Focus meter** — automatic blur detection on every thumbnail (no NumPy needed)
- **EXIF extraction** — reads camera metadata from JPEG and RAW (CR2/CR3/ARW/NEF/DNG/etc.)
- **Thumbnail cache** — SQLite-backed, loads instantly on revisit
- **Background EXIF sync** — processes metadata in batches without blocking the UI
- **Viewport-scaled loading** — shows a 1920px version instantly, then full resolution
- **Undo support** — `Ctrl+Z` to revert the last rating
- **Fullscreen mode** — `F` for distraction-free review
- **Gamepad support** — Xbox/PlayStation controllers for ergonomic sorting
- **SQLite persistence** — ratings survive restarts, with checkpoint/restore
- **Cross-platform** — Windows (`.bat`), macOS (`.command`), Linux (`.sh` + native `.desktop` launcher)

---

## Quick Start

### Prerequisites

- **Python 3.9+** installed ([python.org](https://python.org))

### Windows

```batch
scripts\install.bat
scripts\run.bat
```

### macOS

```bash
bash scripts/install.command
bash scripts/run.command
```

### Linux

```bash
bash scripts/install.sh
bash scripts/run.sh
```

After installation, Linux users can find **Photo Sorter** in their app launcher menu (GNOME/KDE).

---

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Open       │ ──> │  Rate with   │ ──> │  Export     │
│  folder     │     │  1 / 2 / 3   │     │  (Enter)    │
└─────────────┘     └──────────────┘     └─────────────┘
                          │
                     ┌────┴────┐
                     │  BAD (1) │ → blurry, deleted later
                     │  OK  (2) │ → maybe
                     │ GOOD (3) │ → keeper
                     └─────────┘
```

1. Open a folder of photos
2. Navigate with `N` / `P` (or arrow keys / gamepad)
3. Rate each photo: `1` (BAD), `2` (OK), `3` (GOOD)
4. Press `Enter` to export — files move into `BAD/`, `OK/`, `GOOD/` folders

All ratings auto-save to a local SQLite database. Close and reopen anytime — your work is preserved.

---

## Keyboard Shortcuts

### Rating

| Key | Action |
|-----|--------|
| `1` | BAD |
| `2` | OK |
| `3` | GOOD |
| `0` | Remove rating |
| `Ctrl+Z` | Undo last rating |

### Picks & Stars

| Key | Action |
|-----|--------|
| `Space` | Toggle pick flag (gold star) |
| `Ctrl+1` — `Ctrl+5` | Star rating (press same key to clear) |

### Navigation

| Key | Action |
|-----|--------|
| `N` / `P` | Next / Previous image |
| `Home` / `End` | First / Last image |
| `Ctrl+G` | Jump to image number |
| `C` | Compare side-by-side with previous |

### Display

| Key | Action |
|-----|--------|
| `F` | Toggle fullscreen |
| `H` | Toggle controls HUD |
| `I` | Toggle info panel |
| `Ctrl+`+ / `Ctrl+-` | Zoom in / out |
| `Ctrl+0` | Reset zoom |
| `Double-click` | Fit to view |

### Editing

| Key | Action |
|-----|--------|
| `Del` | Permanently delete (with confirmation) |
| `R` / `Shift+R` | Rotate CW / CCW |
| `U` | Filter: hide rated images |

### Export

| Key | Action |
|-----|--------|
| `Enter` | Finish sorting & export to `BAD/` / `OK/` / `GOOD/` folders |

Full reference: [docs/keyboard_shortcuts.md](docs/keyboard_shortcuts.md)

---

## Architecture

```
sorter.py                 ← entry point
  └── photosorter/
        ├── main.py       ← window, key handlers, signal wiring
        ├── controller.py ← business logic, signals, filters
        ├── database.py   ← SQLite layer
        ├── ui.py         ← PhotoViewer, Filmstrip, StatsHUD
        ├── widgets.py    ← FolderBrowser, SearchBar, DateBrowser
        ├── workers.py    ← ImageLoadTask, ThumbnailTask, GamepadThread
        ├── exif.py       ← RAW + JPEG EXIF extraction
        └── utils.py      ← cache, file ops, platform detection
```

- **Signals & slots** pattern — controller emits signals, main.py wires them to UI
- **Background loading** — image loading and thumbnail generation run in thread pools
- **Two-pass rendering** — viewport-sized image loads first, full resolution follows

---

## Storage

| Data | Location |
|------|----------|
| Ratings DB | `~/.photosorter/dbs/` |
| Project index | `~/.photosorter/projects.json` |
| Logs | `~/.photosorter/logs/photosorter.log` |
| Checkpoint | `.photosorter_checkpoint.json` (in project folder) |

---

## Development

```bash
pip install -e ".[dev]"
pytest tests/       # 54 tests
ruff check photosorter/
```

Key principles:
- Each module under 1000 lines
- No NumPy dependency (pure Python blur detection)
- No external services — fully offline
- Cross-platform from day one

---

## License

MIT. See [LICENSE](LICENSE).
