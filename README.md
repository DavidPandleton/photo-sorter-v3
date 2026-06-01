# Photo Sorter v3

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/Rust-1.96%2B-orange" alt="Rust Version">
  <img src="https://img.shields.io/badge/Tauri-v2-teal" alt="Tauri">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

A blazing-fast, keyboard-driven tool for culling and rating large photo batches — rewritten in Rust with a Tauri v2 shell.

Work through hundreds of photos in minutes. Rate with a single keypress. Export sorted folders in one click.

---

## v3 vs v2

| | v2 (Python/PySide6) | v3 (Rust/Tauri) |
|---|---|---|
| **Backend** | Python 3.9+ | Rust 1.96+ |
| **UI** | PySide6 Qt widget | HTML5 Canvas + CSS |
| **Performance** | Interpreted | Native compiled |
| **RAM** | ~200MB+ | ~50MB |
| **Startup** | 2-3s | < 500ms |
| **Thumbnails** | Python Pillow/rawpy | Native `image` crate + embedded JPEG extraction |

---

## Features

- **Keyboard-first workflow** — rate, navigate, zoom, delete, pick — all without touching the mouse
- **Three-tier rating** — BAD (1), OK (2), GOOD (3) with instant color feedback
- **Star ratings** — `Ctrl+1` through `Ctrl+5` for fine-grained quality scoring
- **Pick flagging** — `Space` to mark favorites, shown as gold star overlay
- **Compare mode** — `C` for side-by-side split-screen comparison
- **Focus meter** — automatic Laplacian variance blur detection, cached in SQLite
- **RAW support** — NEF, CR2, CR3, ARW, DNG, ORF, RW2, PEF with embedded preview extraction
- **EXIF extraction** — camera model, ISO, aperture, shutter speed, focal length, lens
- **SQLite persistence** — ratings, picks, stars, rotations survive restarts
- **Undo support** — `Ctrl+Z` to revert last action
- **Native trash** — deleted files go to system Recycle Bin, not permanently erased
- **Checkpoint/restore** — `.photosorter_checkpoint.json` for full export rollback
- **Pre-loader cache** — next 5 images loaded into RAM, instant navigation
- **Gamepad support** — Xbox/PlayStation controllers (optional `--features gamepad`)
- **Cross-platform** — Windows, macOS, Linux via Tauri v2

---

## Quick Start

### Prerequisites

- **Rust** 1.96+ ([rustup.rs](https://rustup.rs))
- **Bun** (or Node.js/npm) ([bun.sh](https://bun.sh))
- **Windows:** Visual Studio Build Tools with C++ workload
- **macOS:** Xcode Command Line Tools
- **Linux:** `build-essential`, `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`

### Setup

```bash
bun install
```

### Development

```pwsh
# Windows (PowerShell)
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
bun run tauri dev

# macOS / Linux
bun run tauri dev
```

### Production Build

```bash
bun run tauri build
```

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
2. Navigate with `N` / `P` (or arrow keys)
3. Rate each photo: `1` (BAD), `2` (OK), `3` (GOOD)
4. Press `Enter` to export — files move into `BAD/`, `OK/`, `GOOD/` folders

All ratings auto-save to SQLite. Close and reopen anytime — your work is preserved.

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
| `Ctrl+1` — `Ctrl+5` | Star rating |

### Navigation

| Key | Action |
|-----|--------|
| `N` / `P` | Next / Previous image |
| `C` | Compare side-by-side with previous |
| `U` | Filter: hide rated images |

### Display

| Key | Action |
|-----|--------|
| `Del` | Delete (moves to Recycle Bin) |
| `Arrow Up` / `Arrow Down` | Rotate CW / CCW |

---

## Architecture

```
photo-sorter-v3/
├── src-tauri/              ← Rust backend
│   ├── src/
│   │   ├── main.rs         ← Tauri commands, IPC bridge
│   │   ├── lib.rs          ← Module declarations
│   │   ├── database.rs     ← SQLite (WAL mode, thumbnail cache)
│   │   ├── exif.rs         ← EXIF extraction (kamadak-exif)
│   │   ├── image_loader.rs ← RAW preview, thumbnail gen, focus score
│   │   └── state.rs        ← AppState, filters, checkpoint, undo
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    ← Vite + TypeScript frontend
│   ├── app.ts              ← Orchestrator, keyboard, filmstrip, pre-loader
│   ├── viewer.ts           ← HTML5 Canvas viewer (zoom/pan/compare)
│   └── style.css           ← Glassmorphic dark theme
├── index.html              ← Application shell
├── vite.config.ts
├── tsconfig.json
└── package.json
```

- **Tauri v2** — native windowing, IPC, filesystem access
- **rusqlite** — bundled SQLite with WAL mode for parallel reads
- **Canvas 2D** — sub-pixel coordinate-anchored zoom with exponential scaling
- **Pre-loader** — next 5 images asynchronously decoded, stored in JS `Map<path, Image>`

---

## License

MIT. See [LICENSE](LICENSE).
