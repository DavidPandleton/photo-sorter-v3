# Photo Sorter v3

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/Rust-1.96%2B-orange" alt="Rust Version">
  <img src="https://img.shields.io/badge/Tauri-v2-teal" alt="Tauri">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  <img src="https://img.shields.io/github/v/tag/DavidPandleton/photo-sorter-v3?label=version&cache=v3.1.0" alt="Version">
</p>

<p align="center">
  <b>Manual culling, keyboard-fast. Zero AI.</b><br>
  Press 1/2/3, export, done.<br>
  No sliders, no layers, no magic auto-tagging. Just culling. Fast.
</p>

<p align="center">
  <img src="docs/photo%20or%20gif/demo.gif" alt="Demo" width="720">
</p>

<p align="center">
  <img src="docs/photo%20or%20gif/ss%20main%20menu.png" alt="Main Menu" width="400">
</p>

---

## Download

No Rust or Node.js required. Download for your platform:

| Platform | Download |
|----------|----------|
| Windows | `Photo-Sorter_3.1.0_x64-setup.exe` or `.msi` |
| macOS (Intel) | `Photo-Sorter_3.1.0_x64.dmg` |
| macOS (Apple Silicon) | `Photo-Sorter_3.1.0_aarch64.dmg` |
| Linux | `Photo-Sorter_3.1.0_amd64.deb` or `.AppImage` |
| Source | `Photo-Sorter-source-v3.1.0.zip` |

All assets are attached to the [latest release](https://github.com/DavidPandleton/photo-sorter-v3/releases/latest).

Or [build from source](#build-from-source).

---

## Usage

```
Open a photo folder  →  Press 1/2/3 on each photo  →  Enter (export)
```

| Key | Action |
|--------|--------|
| `1` | BAD (blurry, misframed, etc — goes to BAD folder) |
| `2` | OK (maybe, not sure) |
| `3` | GOOD (sharp, keep) |
| `Space` | Toggle pick flag (gold star) |
| `Ctrl+1` - `Ctrl+5` | Star rating |
| `N` / `P` | Next / Previous photo |
| `C` | Compare mode (split-screen with previous photo) |
| `Del` | Delete (moves to Trash, not permanent) |
| `Ctrl+Z` | Undo last rating |
| `U` | Filter: hide already-rated photos |
| `F` | Fullscreen |
| `H` | Toggle HUD overlay |

**Export:** Press Enter (with confirmation dialog). Files are sorted into:

```
📁 project-folder/
├── 📁 BAD/     ← photos rated 1
├── 📁 OK/      ← rated 2
└── 📁 GOOD/    ← rated 3
```

> **Tip:** After rating hundreds of photos, you might feel a slight delay. Go back to the main menu, re-open the folder, and press `U` to filter unrated photos — continue where you left off.

### Rating Examples

<img src="docs/photo%20or%20gif/good%20green.png" width="600">
<p><em>GOOD — sharp, keep</em></p>

<img src="docs/photo%20or%20gif/ok%20yellow.png" width="600">
<p><em>OK — maybe, not sure</em></p>

<img src="docs/photo%20or%20gif/bad%20red.png" width="600">
<p><em>BAD — blurry, misframed, reject</em></p>

---

## Features

- **Keyboard-first** — no mouse needed
- **RAW support** — NEF, CR2, CR3, ARW, DNG, ORF, RW2, PEF. Uses embedded JPEG preview for speed
- **EXIF display** — ISO, aperture, shutter speed, lens, camera model
- **Compare mode** — view 2 photos side-by-side to pick the sharpest
- **Focus meter** — auto blur detection via Laplacian variance, cached in SQLite
- **Checkpoint** — if export fails or goes to the wrong folder, one-click restore
- **Gamepad** — Xbox/PlayStation controller support via Web Gamepad API (USB & Bluetooth, no feature flag needed)
- **SQLite persistence** — ratings, stars, rotation, picks survive restart. No manual save
- **Cross-platform** — Windows, macOS, Linux

---

## Build from Source

For developers who want to compile or contribute:

### Prerequisites

| Platform | Dependency |
|----------|------------|
| **All** | [Rust](https://rustup.rs) 1.96+, [Bun](https://bun.sh) (or npm) |
| **Windows** | Visual Studio Build Tools (C++ workload) |
| **macOS** | Xcode Command Line Tools: `xcode-select --install` |
| **Linux** | `sudo apt install build-essential libwebkit2gtk-4.1-dev libgtk-3-dev` |

### Compile

```bash
git clone https://github.com/DavidPandleton/photo-sorter-v3.git
cd photo-sorter-v3
bun install
bun run tauri build
```

Binary output: `src-tauri/target/release/photo-sorter-v3` (or `.exe` on Windows).

Gamepad support is built-in via the Web Gamepad API — no special flags needed.
Enable the Rust `gilrs` backend for rumble support: `bun run tauri build -- --features gamepad`

---

## Architecture (for contributors)

```
photo-sorter-v3/
├── src-tauri/              ← Rust backend
│   ├── src/
│   │   ├── main.rs         ← Tauri IPC commands
│   │   ├── database.rs     ← SQLite + thumbnail cache
│   │   ├── image_loader.rs ← RAW decode + resize + blur score
│   │   ├── exif.rs         ← EXIF extraction
│   │   └── state.rs        ← AppState, ImageCache (LRU), filter, export
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    ← TypeScript frontend
│   ├── app.ts              ← Main logic, keyboard, filmstrip, settings
│   ├── viewer.ts           ← Canvas 2D renderer (zoom/pan/compare)
│   ├── filmstrip.ts        ← Virtual-scrolling thumbnail bar
│   ├── gamepad.ts          ← Web Gamepad API handler (USB/Bluetooth)
│   ├── cache.ts            ← Frontend LRU image cache
│   └── style.css           ← Dark glassmorphic theme
├── index.html
├── package.json
└── vite.config.ts
```

**Stack:** Tauri v2 + Rust + Vite + TypeScript + SQLite (rusqlite) + HTML5 Canvas.

---

## v2 → v3

Photo Sorter v3 is strictly better than v2 in every way. Tested on 700+ Sony RAW files — smooth sailing.

**v3 wins on:** speed (Rust backend beats Python hands down), cross-platform (Windows/macOS/Linux), customizable keybindings, gamepad (USB/Bluetooth), compare mode, settings persistence, native trash integration, parallel thumbnail generation, modern UI, SQLite cache, focus meter.

**v2:** Deprecated. Use v3.

---

## License

MIT. See [LICENSE](LICENSE).
