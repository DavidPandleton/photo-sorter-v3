# Photo Sorter

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/Python-3.9%2B-teal" alt="Python Version">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/tests-54%20passing-brightgreen" alt="Tests">
</p>

<p align="center">
  <b>English:</b> <a href="../../README.md">🇺🇸 Read here</a>
</p>

Tool cepat berbasis keyboard buat nyortir dan nge-rating foto dalam jumlah banyak.
**Bukan** pengganti Lightroom — ini pre-filter buat mutusin mana yang dipake *sebelum* masuk ke tahap editing.

Kerjain ratusan foto dalam menit. Rating dengan sekali tekan tombol. Export folder terurut dalam satu klik.

---

## Fitur

- **Keyboard-first workflow** — rate, navigasi, zoom, hapus, pick — semua tanpa mouse
- **Rating tiga level** — BAD (1), OK (2), GOOD (3) dengan animasi warna instan
- **Star rating** — `Ctrl+1` sampai `Ctrl+5` buat skor kualitas detail
- **Pick flag** — `Space` buat tandai favorit, tampil sebagai overlay bintang emas
- **Compare mode** — `C` buat lihat side-by-side dengan foto sebelumnya
- **Focus meter** — deteksi blur otomatis di setiap thumbnail (tanpa NumPy)
- **EXIF extraction** — baca metadata kamera dari JPEG dan RAW (CR2/CR3/ARW/NEF/DNG/dll)
- **Thumbnail cache** — tersimpan di SQLite, langsung muncul pas dibuka lagi
- **Background EXIF sync** — proses metadata secara batch tanpa ngeblokir UI
- **Viewport-scaled loading** — tampilkan versi 1920px dulu, baru resolusi penuh
- **Undo** — `Ctrl+Z` buat balikin rating terakhir
- **Fullscreen** — `F` buat review tanpa gangguan
- **Gamepad support** — controller Xbox/PlayStation buat sorting ergonomis
- **SQLite persistence** — rating aman meskipun aplikasi ditutup
- **Cross-platform** — Windows (`.bat`), macOS (`.command`), Linux (`.sh` + launcher `.desktop`)

---

## Cara Cepat Mulai

### Prasyarat

- **Python 3.9+** install dari [python.org](https://python.org)

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

Setelah install, user Linux bisa cari **Photo Sorter** di menu aplikasi (GNOME/KDE).

---

## Gimana Kerjanya

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Buka       │ ──> │  Rating      │ ──> │  Export     │
│  folder     │     │  1 / 2 / 3   │     │  (Enter)    │
└─────────────┘     └──────────────┘     └─────────────┘
                          │
                     ┌────┴────┐
                     │  BAD (1) │ → blur, nanti dihapus
                     │  OK  (2) │ → mungkin
                     │ GOOD (3) │ → keep
                     └─────────┘
```

1. Buka folder foto
2. Navigasi pake `N` / `P` (atau arrow keys / gamepad)
3. Rating tiap foto: `1` (BAD), `2` (OK), `3` (GOOD)
4. Tekan `Enter` buat export — file pindah ke folder `BAD/`, `OK/`, `GOOD/`

Semua rating auto-save ke database SQLite lokal. Tutup dan buka lagi kapan aja — kerjaan lo aman.

---

## Pintasan Keyboard

### Rating

| Tombol | Aksi |
|--------|------|
| `1` | BAD |
| `2` | OK |
| `3` | GOOD |
| `0` | Hapus rating |
| `Ctrl+Z` | Undo rating terakhir |

### Pick & Bintang

| Tombol | Aksi |
|--------|------|
| `Space` | Toggle pick flag (bintang emas) |
| `Ctrl+1` — `Ctrl+5` | Star rating (tekan sama buat clear) |

### Navigasi

| Tombol | Aksi |
|--------|------|
| `N` / `P` | Next / Previous |
| `Home` / `End` | Ke gambar pertama / terakhir |
| `Ctrl+G` | Loncat ke nomor gambar |
| `C` | Compare side-by-side dengan sebelumnya |

### Tampilan

| Tombol | Aksi |
|--------|------|
| `F` | Fullscreen |
| `H` | Tampilkan/sembunyikan HUD kontrol |
| `I` | Tampilkan/sembunyikan panel info |
| `Ctrl+`+ / `Ctrl+-` | Zoom in / out |
| `Ctrl+0` | Reset zoom |
| `Double-click` | Fit ke layar |

### Edit

| Tombol | Aksi |
|--------|------|
| `Del` | Hapus permanen (dengan konfirmasi) |
| `R` / `Shift+R` | Rotasi kanan / kiri |
| `U` | Filter: sembunyikan foto yang sudah di-rating |

### Export

| Tombol | Aksi |
|--------|------|
| `Enter` | Selesai & export ke folder `BAD/` / `OK/` / `GOOD/` |

Referensi lengkap: [docs/keyboard_shortcuts.md](../keyboard_shortcuts.md)

---

## Arsitektur

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

- **Signals & slots** — controller emit sinyal, main.py wiring ke UI
- **Background loading** — loading gambar dan thumbnail jalan di thread pool
- **Two-pass rendering** — versi viewport dulu, resolusi penuh nyusul

---

## Penyimpanan

| Data | Lokasi |
|------|--------|
| Database rating | `~/.photosorter/dbs/` |
| Index project | `~/.photosorter/projects.json` |
| Log | `~/.photosorter/logs/photosorter.log` |
| Checkpoint | `.photosorter_checkpoint.json` (di folder project) |

---

## Development

```bash
pip install -e ".[dev]"
pytest tests/       # 54 test
ruff check photosorter/
```

Prinsip utama:
- Tiap module di bawah 1000 baris
- Tanpa NumPy (blur detection pake Python murni)
- Fully offline — tanpa service eksternal
- Cross-platform dari awal

---

## Lisensi

MIT. Lihat [LICENSE](../../LICENSE).
