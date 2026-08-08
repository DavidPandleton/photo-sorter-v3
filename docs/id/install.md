# Panduan Install — Buat yang Nggak Mau Ribet

Photo Sorter itu aplikasi desktop, **nggak butuh internet** setelah di-install, **nggak ada iklan**, **nggak perlu login**.

---

## 🪟 Windows (10 & 11)

### Cara 1: Download Installer (Paling Gampang)

1. Buka link ini: [halaman download Photo Sorter](https://github.com/DavidPandleton/photo-sorter-v3/releases/latest)
2. Nanti lu bakal liat halaman **"Releases"**. Di bagian **"Assets"**, cari file yang namanya `Photo-Sorter_3.2.0_x64-setup.exe`
3. Klik file itu — otomatis ke-download
4. Buka file `.exe` yang udah di-download
5. Klik **Next** aja terus samselesai
6. Kalo Windows nanya "Apakah lu yakin mau install aplikasi ini?" — klik **Run Anyway** / **Tetap Jalankan**
7. Selesai! Buka Photo Sorter dari Start Menu atau desktop

> **Kalo bingung:** Cari aja file yang namanya ada tulisan "setup" atau "installer". Jangan klik file "Source code" — itu buat developer.

### Cara 2: Portable (Nggak perlu install)

Buat yang males install, download file `.msi` di halaman yang sama. Jalankan, langsung pake. Nggak perlu setup wizard.

---

## 🍎 macOS (Intel & Apple Silicon)

1. Buka link ini: [halaman download Photo Sorter](https://github.com/DavidPandleton/photo-sorter-v3/releases/latest)
2. Cari file yang cocok sama Mac lu:
   - **Mac Intel** (Core i5/i7/i9): download yang namanya `Photo-Sorter_3.2.0_x64.dmg`
   - **Mac Apple Silicon** (M1/M2/M3/M4): download yang `Photo-Sorter_3.2.0_aarch64.dmg`
3. Klik file `.dmg` — nanti kebuka jendela baru
4. **Drag** icon Photo Sorter ke folder **Applications**
5. Tutup jendela installer, buka **Launchpad** atau **Applications** → klik **Photo Sorter**
6. Kalo pertama kali muncul peringatan "tidak bisa dibuka karena developer tidak terverifikasi":
   - Buka **System Settings** → **Privacy & Security**
   - Scroll ke bawah sampe liat tulisan **"Photo Sorter was blocked..."**
   - Klik **Open Anyway**
   - Masukin password, klik **Open**

---

## 🐧 Linux (Ubuntu/Debian)

1. Buka link ini: [halaman download Photo Sorter](https://github.com/DavidPandleton/photo-sorter-v3/releases/latest)
2. Cari file yang namanya `Photo-Sorter_3.2.0_amd64.deb`
3. Klik, nanti ke-download
4. Klik 2 kali file `.deb` — biasanya kebuka **Software Install** atau **GDebi**
5. Klik **Install**
6. Selesai! Cari "Photo Sorter" di menu aplikasi

> Alternatif: download `.AppImage` — tinggal kasih izin execute (`chmod +x`) terus jalankan. Nggak perlu install.

---

## 🧪 Buat yang Ngoding (Build dari Source)

Buat yang udah familiar sama terminal dan mau compile sendiri:

**Prasyarat:**
- [Rust](https://rustup.rs) (minimal versi 1.96)
- [Bun](https://bun.sh) atau npm
- **Windows:** Visual Studio Build Tools (centang C++ workload pas install)
- **macOS:** `xcode-select --install` di terminal
- **Linux:** `sudo apt install build-essential libwebkit2gtk-4.1-dev libgtk-3-dev`

**Langkah-langkah:**
```bash
# 1. Clone project
git clone https://github.com/DavidPandleton/photo-sorter-v3.git

# 2. Masuk ke folder
cd photo-sorter-v3

# 3. Install dependencies
bun install

# 4. Build
bun run tauri build
```

Hasil binary ada di folder `src-tauri/target/release/`.

---

## ❓ Masalah yang Sering Muncul

| Masalah | Solusi |
|---------|--------|
| **Windows ngeblock file** | Klik kanan file → Properties → centang "Unblock" → OK |
| **macOS "cannot be opened"** | System Settings → Privacy & Security → Open Anyway |
| **Linux .deb error** | Coba download `.AppImage` aja, lebih gampang |
| **Aplikasi nggak mau nyala** | Cek folder tujuan install, coba run sebagai Administrator (Windows) |
