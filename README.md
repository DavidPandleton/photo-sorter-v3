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
  Ini alat buat milah-milih foto. Tekan 1 (BAD), 2 (OK), 3 (GOOD). Export. Selesai.<br>
  Gak ada slider, gak ada layer, gak ada curve tool. Cuma culling. Cepet.
</p>

<p align="center">
  <img src="docs/demo.gif" alt="Demo" width="720">
</p>

---

## Download

Gak perlu install Rust atau npm. Tinggal download installer, jalanin.

| Platform | Download |
|----------|----------|
| Windows | [`Photo-Sorter-Setup.exe` (NSIS)](https://github.com/DavidPandleton/photo-sorter-v3/releases/latest) or [`Photo-Sorter.msi`](https://github.com/DavidPandleton/photo-sorter-v3/releases/latest) |
| macOS | [`Photo-Sorter.dmg`](https://github.com/DavidPandleton/photo-sorter-v3/releases/latest) |
| Linux | [`Photo-Sorter.AppImage`](https://github.com/DavidPandleton/photo-sorter-v3/releases/latest) or `.deb` |

Atau kalo mau compile sendiri, liat [Build dari Source](#build-dari-source).

---

## Cara Pake

```
Buka folder foto  →  Tekan 1/2/3 tiap foto  →  Enter (export)
```

| Tombol | Action |
|--------|--------|
| `1` | BAD (blur, salah posisi, etc — bakal ke folder BAD) |
| `2` | OK (maybe, bingung) |
| `3` | GOOD (mantap, keep) |
| `Space` | Tandai favorit (gold star) |
| `Ctrl+1` - `Ctrl+5` | Rating bintang |
| `N` / `P` | Next / Previous foto |
| `C` | Compare mode (split-screen sama foto sebelumnya) |
| `Del` | Hapus (masuk Recycle Bin, bukan permanen) |
| `Ctrl+Z` | Undo rating terakhir |
| `U` | Filter: sembunyiin foto yang udah di-rate |
| `F` | Fullscreen |
| `H` | Sembunyiin HUD |

**Export:** pas pencet Enter, foto lo bakal ke-sort ke folder:
```
📁 project-folder/
├── 📁 BAD/     ← foto yang lo kasih rating 1
├── 📁 OK/      ← rating 2
└── 📁 GOOD/    ← rating 3
```

---

## Fitur

- **Keyboard-first** — gak perlu sentuh mouse sama sekali
- **RAW support** — NEF, CR2, CR3, ARW, DNG, ORF, RW2, PEF. Pake embedded JPEG preview, cepet
- **EXIF otomatis** — ISO, aperture, shutter speed, lens, camera model — tinggal liat
- **Compare mode** — liat 2 foto bersebelahan buat milih mana yang lebih tajam
- **Focus meter** — deteksi blur otomatis pake Laplace variance, disimpen di DB
- **Checkpoint** — kalo export error atau salah folder, tinggal restore
- **Gamepad** — dukung Xbox/PlayStation controller (optional)
- **SQLite** — rating, star, rotation, pick — semua survive restart. Gak perlu save manual
- **Cross-platform** — Windows, macOS, Linux

---

## Build dari Source

Buat yang mau compile sendiri atau contribute:

### Prerequisites

| Platform | Dependency |
|----------|------------|
| **Semua** | [Rust](https://rustup.rs) 1.96+, [Bun](https://bun.sh) (atau npm) |
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

Opsional: `bun run tauri build --features gamepad` kalo mau dukung controller.

---

## Arsitektur (buat yang mau ngoprek)

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

## License

MIT. See [LICENSE](LICENSE).
