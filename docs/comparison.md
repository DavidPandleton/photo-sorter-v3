# Photo Sorter v2 vs v3 — Honest Feature Comparison

> Ditulis oleh Violet, June 2 2026. Perbandingan objektif antara v2 (Python/PySide6) dan v3 (Rust/Tauri).

---

## TL;DR

v3 punya fondasi yang solid secara arsitektur (**kode lebih rapi, performa native, UI modern**), tapi masih **jauh dari feature-complete** dibanding v2. Sekitar ~45% fitur v2 sudah ada di v3.

---

## 1. Backend Architecture

| Area | v2 (Python) | v3 (Rust) | 🏆 |
|---|---|---|---|
| Language | Python 3.9+ | Rust 1.96+ | v3 |
| Framework | PySide6 (Qt) | Tauri v2 | v3 |
| DB Layer | sqlite3 + threading.local | rusqlite + WAL + Mutex | v3 |
| EXIF | rawpy + Pillow | kamadak-exif | 🟰 (v2 lebih comprehensive) |
| Image Decode | QImageReader + rawpy | image crate + TIFF offsets | 🟰 |
| Focus Score | Laplacian variance (Python) | Laplacian variance (Rust) | 🟰 |
| Performance | Interpreted (~200ms decode) | Native compiled (~20ms decode) | v3 |
| RAM Usage | ~200MB (Qt + Python) | ~50MB (Tauri webview) | v3 |
| Build Output | Python script + venv | Single EXE (12MB) + MSI + NSIS | v3 |

---

## 2. Keyboard Shortcuts — Full Grid

| Key | Action | v2 | v3 |
|---|---|---|---|
| `1` | Rate BAD | ✅ | ✅ |
| `2` | Rate OK | ✅ | ✅ |
| `3` | Rate GOOD | ✅ | ✅ |
| `0` | Unrate | ✅ | ✅ |
| `Ctrl+Z` | Undo last rating | ✅ | ✅ |
| `Space` | Toggle pick/flag | ✅ | ✅ |
| `Ctrl+1–5` | Star rating | ✅ | ✅ |
| `N` | Next image | ✅ | ✅ |
| `P` | Previous image | ✅ | ✅ |
| `Del` | Delete (trash) | ✅ | ✅ |
| `U` | Filter unrated | ✅ | ✅ |
| `Arrow Up/Down` | Rotate CW/CCW | ✅ | ✅ |
| `C` | Compare mode | ✅ | ❌ (stub exists, not wired) |
| `F` | Fullscreen | ✅ | ❌ |
| `H` | Toggle HUD | ✅ | ❌ |
| `I` | Toggle info panel | ✅ | ❌ |
| `Home` / `End` | First / Last image | ✅ | ❌ |
| `Ctrl+G` | Jump to image number | ✅ | ❌ |
| `Escape` | Return to menu | ✅ | ❌ |
| `Ctrl+O` | Open folder | ✅ | ❌ |
| `Ctrl+Q` | Exit | ✅ | ❌ |
| `Ctrl++/-` | Zoom in/out | ✅ | ❌ (stub in viewer.ts) |
| `Ctrl+0` | Reset zoom | ✅ | ❌ (dbl-click only) |
| `R` / `Shift+R` | Rotate | ✅ | ⚠️ (Arrow Up/Down only) |
| `Enter` | Export | ✅ | ⚠️ (button only) |

**Score: 14/24 keyboard shortcuts match**

---

## 3. UI Features

| Feature | v2 | v3 |
|---|---|---|
| Dark glassmorphic theme | ✅ | ✅ (premium CSS) |
| Menu screen + cards | ✅ | ✅ |
| Recent projects | ✅ (5 items) | ✅ (5 items) |
| Side panel (folders/search/dates) | ✅ | ✅ |
| Folder browser tree | ✅ | ✅ |
| Date browser tree | ✅ | ✅ |
| Search bar | ✅ | ✅ |
| Stats HUD (floating) | ✅ | ✅ |
| Progress bar | ✅ | ✅ |
| Filmstrip thumbnail strip | ✅ | ✅ (was broken, now fixed) |
| Thumbnail rating ribbon | ✅ | ✅ |
| Thumbnail star badge | ✅ | ✅ |
| Thumbnail focus meter | ✅ | ✅ |
| Image info card | ✅ | ✅ |
| Canvas viewer (zoom/pan) | ✅ | ✅ |
| Flash overlay on rating | ✅ | ✅ |
| Compare mode (split screen) | ✅ | ❌ (viewer.ts has splitScreen code, but no C keybinding or wiring) |
| Fullscreen mode | ✅ | ❌ |
| HUD keybinding display | ✅ | ✅ |
| Controls toggle | ✅ | ❌ |
| Pinch-to-zoom (trackpad) | ✅ | ❌ |
| Memory-bounded LRU cache | ✅ | ⚠️ (Map with eviction at >15 items) |
| Two-phase loading (1920px → full) | ✅ | ❌ (1920px only) |
| Filmstrip size customization | ✅ | ❌ |
| Custom dialog (glassmorphic) | ❌ | ✅ |
| Toast notifications | ✅ | ❌ (console.log only) |

---

## 4. Gamepad Support

| Area | v2 | v3 |
|---|---|---|
| Library | `inputs` (Python) | `gilrs` (optional feature) |
| A / X / B = Rate | ✅ | ❌ |
| LB/RB = Prev/Next | ✅ | ❌ |
| LT/RT = Rotate | ✅ | ❌ |
| Left stick = Pan | ✅ | ❌ |
| Right stick Y = Zoom | ✅ | ❌ |
| Start = Export | ✅ | ❌ |
| Select = Menu | ✅ | ❌ |
| Auto-detect connect/disconnect | ✅ | ❌ |
| Auto-switch HUD gamepad/keyboard | ✅ | ❌ |
| Dialog navigation with D-Pad | ✅ | ❌ |

**Score: 0/11 gamepad features in v3** (optional crate exists, not wired)

---

## 5. Image Processing

| Capability | v2 | v3 |
|---|---|---|
| RAW preview extraction | ✅ (rawpy embedded JPEG) | ✅ (TIFF offset extraction) |
| RAW fallback decode | ✅ (rawpy half_size) | ✅ (image crate) |
| Blur/focus score | ✅ (Laplacian variance) | ✅ (Laplacian variance) |
| Thumbnail caching | ✅ (SQLite BLOB + runtime) | ✅ (SQLite BLOB) |
| Background EXIF sync | ✅ (5 img / 50ms batch timer) | ✅ (thread per navigation) |
| EXIF fields extracted | ISO, aperture, shutter, FL, lens, model, date | ISO, aperture, shutter, FL, lens, model, date |
| Rotation from EXIF orientation | ✅ | ❌ |
| 12 RAW formats | ✅ (.x3f, .srw, .nrw extra) | ⚠️ 8 formats |

---

## 6. Database

| Area | v2 | v3 |
|---|---|---|
| Schema version | 2 | 2 |
| Tables | 6 (projects, images, thumbnail_cache, collections, image_collections, tags, image_tags) | 3 (projects, images, thumbnail_cache) |
| Indexes | 5 | 4 |
| Thread safety | threading.local | Mutex (single conn) |
| WAL mode | ✅ | ✅ |
| Foreign keys | ✅ | ✅ |

---

## 7. Export / Checkpoint

| Capability | v2 | v3 |
|---|---|---|
| Export to BAD/OK/GOOD | ✅ | ✅ |
| Subfolder preservation | ✅ | ✅ |
| Checkpoint JSON v2 | ✅ | ✅ |
| Checkpoint merge | ✅ | ✅ |
| Restore checkpoint | ✅ (v1 + v2 formats) | ✅ (v2 only) |
| Atomic checkpoint write | ✅ (tmp → rename) | ❌ |
| SHA1 in operations | ✅ | ❌ |
| Cross-filesystem safe_move | ✅ | ❌ (fs::rename only) |
| Cleanup empty dirs on restore | ✅ | ✅ |

---

## 8. Development / Testing

| Area | v2 | v3 |
|---|---|---|
| Test framework | pytest | cargo test |
| Test count | 54 (Python) | 9 (Rust, DB only) |
| Test coverage | Unit + Integration | Unit (DB only) |
| Linting | ruff | tsc + cargo check |
| Build time (first) | <5s | ~2 min (Rust compile) |
| Build output | Python wheel | EXE + MSI + NSIS |

---

## 9. Installation / Distribution

| Area | v2 | v3 |
|---|---|---|
| Windows install | `scripts/install.bat` + pip | `Photo Sorter.exe` (12MB) or MSI |
| macOS install | `scripts/install.command` + pip | DMG (via Tauri, not yet built) |
| Linux install | `scripts/install.sh` + pip + .desktop | AppImage (via Tauri, not yet built) |
| Auto-update | ❌ | ❌ |

---

## 10. Overall Scorecard

| Category | v2 Score | v3 Score | Winner |
|---|---|---|---|
| Performance | 6/10 | 10/10 | v3 |
| Keyboard shortcuts | 24/24 | 14/24 | v2 |
| UI polish | 8/10 | 7/10 | v2 |
| Gamepad support | 11/11 | 0/11 | v2 |
| Image features | 9/10 | 7/10 | v2 |
| Export system | 9/10 | 6/10 | v2 |
| Distribution | 5/10 | 9/10 | v3 |
| Code quality | 7/10 | 9/10 | v3 |
| Test coverage | 8/10 | 3/10 | v2 |
| Memory efficiency | 5/10 | 9/10 | v3 |
| **TOTAL** | **91/114** | **74/114** | **v2 (but v3 foundation is leagues better)** |

---

## Bottom Line

**v3 is a beautiful, high-performance skeleton with solid architecture. v2 is feature-complete but built on slower tech.**

Kalau mau honest: v3 perlu ~2 minggu lagi buat catch-up fitur. Tapi dengan fondasi Rust/Tauri sekarang, begitu fitur lengkap, ini bakal jadi app yang jauh lebih cepat, ringan, dan mudah distribusinya dibanding v2.

Priority fix utk Blanc/Violet:
1. Compare mode (C) — kode sudah ada di viewer.ts, tinggal wiring
2. Fullscreen (F) — gampang via window.toggleMaximize()
3. Zoom keyboard + pinch — viewer.ts sudah punya onWheel, tinggal tambah keyboard
4. Gamepad — gilrs crate udah ready, tinggal wiring ke Tauri events
5. Home/End, Escape, Enter, Ctrl+G — pure event listener, no backend needed
6. EXIF orientation rotation — image crate bisa baca orientation
7. Safe cross-filesystem move — ganti fs::rename dengan copy+delete pattern

---

## 11. CI/CD — ⚠️ CRITICAL

**Current `.github/workflows/ci.yml` masih v2 Python!**

| CI Job | v2 (current) | Should be v3 |
|---|---|---|
| Lint | `ruff check photosorter/ tests/` | `cargo clippy` + `tsc --noEmit` |
| Test | 54 pytest × 12 matrix jobs (3 OS × 4 Python) | `cargo test` (Rust) + maybe vitest |
| Build | PyInstaller (Python exe) | `tauri build` (Rust binary) |
| OS | ubuntu, windows, macos | All three still valid |
| Artifacts | `dist/` Python wheel | `src-tauri/target/release/*.exe` / `.msi` / `.dmg` |

**Impact:** CI bakal **FAIL** setiap push karena `ruff`/`pytest` cari file Python yg udah di-`.gitignore`-in. Pipeline harus ditulis ulang dari nol buat Rust + Tauri. Estimasi: ~2 jam kerja.
