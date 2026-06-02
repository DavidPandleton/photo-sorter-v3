# Photo Sorter v3

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/Rust-1.96%2B-orange" alt="Rust Version">
  <img src="https://img.shields.io/badge/Tauri-v2-teal" alt="Tauri">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  <img src="https://img.shields.io/github/v/release/DavidPandleton/photo-sorter-v3" alt="Latest Release">
</p>

<p align="center">
  <b>Ini Bukan Photoshop.</b><br>
  A keyboard-driven photo culling tool. Press 1/2/3, export, done.<br>
  No sliders, no layers, no curve tools. Just culling. Fast.
</p>

<p align="center">
  <img src="docs/demo.gif" alt="Demo" width="720">
</p>

---

## Download

No Rust or Node.js required. Download the installer for your platform:

| Platform | Download |
|----------|----------|
| Windows | [`Photo-Sorter-Setup.exe`](https://github.com/DavidPandleton/photo-sorter-v3/releases/latest) or `.msi` |
| macOS | `.dmg` |
| Linux | `.AppImage` or `.deb` |

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
| `Del` | Delete (moves to Recycle Bin, not permanent) |
| `Ctrl+Z` | Undo last rating |
| `U` | Filter: hide already-rated photos |
| `F` | Fullscreen |
| `H` | Toggle HUD overlay |

**Export:** Press Enter. Files are sorted into:

```
📁 project-folder/
├── 📁 BAD/     ← photos rated 1
├── 📁 OK/      ← rated 2
└── 📁 GOOD/    ← rated 3
```

---

## Features

- **Keyboard-first** — no mouse needed
- **RAW support** — NEF, CR2, CR3, ARW, DNG, ORF, RW2, PEF. Uses embedded JPEG preview for speed
- **EXIF display** — ISO, aperture, shutter speed, lens, camera model
- **Compare mode** — view 2 photos side-by-side to pick the sharpest
- **Focus meter** — auto blur detection via Laplacian variance, cached in SQLite
- **Checkpoint** — if export fails or goes to the wrong folder, one-click restore
- **Gamepad** — Xbox/PlayStation controller support (optional feature)
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

Binary output: `src-tauri/target/release/photo-sorter-v3.exe`

Optional: `bun run tauri build --features gamepad` to enable controller support.

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
│   ├── cache.ts            ← Frontend LRU image cache
│   └── style.css           ← Dark glassmorphic theme
├── index.html
├── package.json
└── vite.config.ts
```

**Stack:** Tauri v2 + Rust + Vite + TypeScript + SQLite (rusqlite) + HTML5 Canvas.

---

## Honest Comparison: v2 vs v3

Photo Sorter v2 (Python/PySide6) is still **significantly faster for RAW-heavy workflows** — it uses LibRaw C library directly, has zero IPC overhead, and the thumbnail pipeline is more mature. Benchmarks on 100 NEF files:

| Scenario | v2 (Python) | v3 (Rust) |
|----------|-------------|-----------|
| Open folder + render filmstrip | ~2-3s | ~3-5s |
| Hold N (rapid navigate) | Butter smooth | Can lag with large RAWs |
| CPU usage during culling | Moderate | Higher (IPC overhead) |

**v3 wins on:** modern UI, cross-platform (Windows/macOS/Linux), customizable keybindings, gamepad support, compare mode, settings persistence, native trash integration.

**v2 wins on:** raw speed, mature codebase, lower resource usage, filmstrip smoothness.

Both projects are maintained. Use v3 for its features; use v2 if your priority is maximum speed with RAW files.

---

## License

MIT. See [LICENSE](LICENSE).
