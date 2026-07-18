# Photo Sorter v3

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/Rust-1.96%2B-orange" alt="Rust">
  <img src="https://img.shields.io/badge/Tauri-v2-teal" alt="Tauri">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  <img src="https://img.shields.io/github/v/tag/DavidPandleton/photo-sorter-v3?label=version" alt="Version">
</p>

<p align="center">
  <b>Manual sorting, cepet pake keyboard. Zero AI.</b><br>
  Pencet 1/2/3, export, beres.<br>
  Bukan Lightroom. Ini alat buat milah foto — <i>sebelum</i> masuk ke tahap editing.
</p>

<p align="center">
  <a href="https://davidpandleton.github.io/photo-sorter-v3">🌐 Buka landing page</a>
  ·
  <a href="../../README.md">🇺🇸 English version</a>
</p>

<p align="center">
  <img src="../photo%20or%20gif/demo.gif" alt="Demo" width="720">
</p>

---

## 📥 Download

**Nggak perlu install Python, Rust, atau ribet-ribet.** Tinggal download, install, langsung pake.

| Platform | File yang didownload |
|----------|---------------------|
| 🪟 **Windows** | `Photo-Sorter_3.2.0_x64-setup.exe` (installer) atau `.msi` |
| 🍎 **macOS Intel** | `Photo-Sorter_3.2.0_x64.dmg` |
| 🍎 **macOS Apple Silicon** (M1/M2/M3) | `Photo-Sorter_3.2.0_aarch64.dmg` |
| 🐧 **Linux** | `Photo-Sorter_3.2.0_amd64.deb` atau `.AppImage` |

**Cara download:**
1. Buka link ini → [halaman download](https://github.com/DavidPandleton/photo-sorter-v3/releases/latest)
2. Cari tulisan **"Assets"** (biasanya di bagian bawah halaman)
3. Klik file yang sesuai sama kompi lu (lihat tabel di atas)
4. Buka file yang ke-download, jalanin, selesai!

> Buat yang pengen compile sendiri: [Petunjuk Build dari Source](#-build-dari-source)

---

## 🚀 Cara Pake

Konsepnya simpel banget:

```
Buka folder foto  →  Pencet 1/2/3 tiap foto  →  Enter (export beres)
```

Foto bakal otomatis ke-sortir ke dalam folder:

```
📁 folder-project-lu/
├── 📁 BAD/      ← foto yang jelek (1)
├── 📁 OK/       ← foto yang mungkin (2)
└── 📁 GOOD/     ← foto yang bagus (3)
```

### Tombol-tombol penting

| Tombol | Fungsi |
|--------|--------|
| `1` | BAD — fotonya jelek, blur, nggak kepake |
| `2` | OK — mungkin, ragu-ragu |
| `3` | GOOD — bagus, keep |
| `Space` | Tandai favorit (bintang emas) |
| `Ctrl+1` sampe `Ctrl+5` | Rating bintang |
| `N` / `P` | Next / Previous foto |
| `C` | Mode compare (liat 2 foto barengan) |
| `Del` | Hapus (masuk recycle bin/trash, aman) |
| `Ctrl+Z` | Balikin rating terakhir |
| `U` | Filter: sembunyiin foto yang udah di-rating |
| `F` | Fullscreen |
| `H` | Tampilkan/sembunyiin petunjuk tombol |
| `Enter` | Export — pindahin foto ke folder BAD/OK/GOOD |

---

## ✨ Fitur

- **Keyboard-first** — nggak perlu mouse sama sekali.
- **RAW support** — NEF, CR2, CR3, ARW, DNG, ORF, RW2, PEF. Pake preview biar cepet.
- **EXIF display** — liat ISO, aperture, shutter speed, lens, kamera.
- **Compare mode** — pencet `C` buat liat 2 foto side-by-side. Pilih yang paling tajam.
- **Focus meter** — deteksi blur otomatis, ditampilin pake warna (ijo/kuning/merah).
- **Checkpoint** — sebelum export, aplikasi nyimpen checkpoint. Kalo ada salah, tinggal pencet restore.
- **Gamepad** — colok controller Xbox/PlayStation (USB atau Bluetooth). Bisa buat sorting dari sofa.
- **SQLite persistence** — rating, bintang, rotasi, pick — semua aman meskipun aplikasi ditutup.
- **Category kustom** — ganti nama kategori, shortcut, folder tujuan, warnanya — bebas.
- **Keybinding customization** — ganti shortcut sesuka hati lewat menu Settings.
- **Fullscreen** — `F` buat review foto tanpa gangguan.
- **Cross-platform** — Windows, macOS, Linux.

---

## 🎮 Gamepad (Controller)

Colok controller Xbox atau PlayStation, langsung jalan. Nggak perlu setting apa-apa.

| Tombol | Fungsi |
|--------|--------|
| A | GOOD |
| B | BAD |
| X | OK |
| LB / RB | Prev / Next foto |
| LT / RT | Rotasi kiri / kanan |
| Joystick kiri | Pan (geser-geser foto) |
| Joystick kanan | Zoom |
| Start | Export |
| Select | Menu |

---

## 🛠️ Build dari Source

Buat yang familiar sama coding dan mau compile sendiri:

### Prasyarat

- [Rust](https://rustup.rs) — minimal versi 1.96+
- [Bun](https://bun.sh) atau npm
- **Windows**: Visual Studio Build Tools (C++ workload)
- **macOS**: `xcode-select --install`
- **Linux**: `sudo apt install build-essential libwebkit2gtk-4.1-dev libgtk-3-dev`

### Compile

```bash
git clone https://github.com/DavidPandleton/photo-sorter-v3.git
cd photo-sorter-v3
bun install
bun run tauri build
```

Hasilnya ada di folder `src-tauri/target/release/`.

---

## 🏗️ Arsitektur (buat kontributor)

```
photo-sorter-v3/
├── src-tauri/              ← Backend Rust
│   ├── src/
│   │   ├── main.rs         ← Perintah-perintah Tauri IPC
│   │   ├── database.rs     ← SQLite + cache thumbnail
│   │   ├── image_loader.rs ← Decode RAW + resize + blur score
│   │   ├── exif.rs         ← Ekstrak EXIF
│   │   └── state.rs        ← AppState, ImageCache, filter, export
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    ← Frontend TypeScript
│   ├── app.ts              ← Logic utama, keyboard, filmstrip, settings
│   ├── viewer.ts           ← Render Canvas 2D (zoom/pan/compare)
│   ├── filmstrip.ts        ← Virtual-scrolling thumbnail bar
│   ├── gamepad.ts          ← Web Gamepad API
│   ├── cache.ts            ← Cache gambar LRU
│   └── style.css           ← Dark glassmorphic theme
├── index.html
├── package.json
└── vite.config.ts
```

**Stack:** Tauri v2 + Rust + Vite + TypeScript + SQLite (rusqlite) + HTML5 Canvas.

---

## 📜 Lisensi

MIT. Lihat [LICENSE](../../LICENSE).


