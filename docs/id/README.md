# Photo Sorter V1

<p align="center">
  <img src="../../assets/screenshots/main menu.png" alt="Photo Sorter V1 Main Menu" width="600">
</p>

<p align="center">
  🇺🇸 [English](../../README.md) | 🇮🇩 **Bahasa Indonesia**
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/Python-3.9%2B-blueviolet" alt="Python Version">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

## 📸 Apa ini?

Photo Sorter V1 adalah tool yang saya bikin buat nyelesain satu masalah spesifik: nyortir foto dalam jumlah banyak dengan cepat. Tool ini bukan pengganti Lightroom atau sistem manajemen foto yang ribet. Fungsinya cuma satu: bantu kamu nentuin mana foto yang mau dipake dan mana yang mau dibuang sebelum masuk ke tahap editing.

Kalau kamu pernah ngerasa pegel harus ngeklik ratusan foto hasil pemotretan dan berharap ada cara yang lebih cepet lewat keyboard atau gamepad tanpa bikin komputer lemot, nah tool ini cocok buat kamu.

---

## ✨ Apa yang Baru?

- **Filmstrip Navigator**: "Minimap" keren di bagian bawah buat liat posisi kamu di antara ribuan foto.
- **Deteksi Blur Otomatis**: Analisis fokus real-time yang ngasih label SHARP, SOFT, atau BLUR di thumbnail.
- **Dukungan Gamepad Universal**: Bisa pake Xbox, PlayStation (PS2-PS5), dan kebanyakan kontroler generik.
- **Performa Lebih Kenceng**: Loading RAW lebih cepet dan ada engine thumbnail khusus.
- **Rotasi Gambar**: Perbaiki orientasi foto langsung lewat keyboard atau trigger gamepad.
- **UI Premium**: Tema gelap yang lebih rapih dengan animasi halus dan feedback yang lebih oke.

---

## 🎞️ Filmstrip Navigator

Filmstrip baru di bagian bawah bantu kamu dapet konteks visual tanpa menuh-menuhin layar:
- **Konteks Visual**: Liat foto sebelum dan sesudahnya dengan sekali lirik.
- **Rating Ribbon**: Tiap thumbnail punya garis warna (Merah/Kuning/Hijau) biar kamu bisa liat progres sortir secara visual.
- **Klik & Lompat**: Tinggal klik thumbnail buat langsung lompat ke foto itu.
- **Auto-Sync**: Strip ini bakal ngikutin navigasi kamu dan otomatis nengahin foto yang lagi aktif.
- **Bisa Diatur**: Kamu bisa ganti jumlah thumbnail yang keliatan lewat menu **Settings > Filmstrip Window Size**.

---

## ✨ Alur Kerja

Konsep utamanya adalah tangan tetep di input device dan mata fokus ke foto. Kamu tinggal pilih folder, terus mulai sortir foto ke tiga kategori:

<p align="center">
  <img src="../../assets/screenshots/bad yellow.png" width="250" alt="Rating: BAD">
  <img src="../../assets/screenshots/ok yellow.png" width="250" alt="Rating: OK">
  <img src="../../assets/screenshots/good green.png" width="250" alt="Rating: GOOD">
</p>

1. **Pilih folder** yang isinya foto-foto kamu.
2. **Kasih rating sambil jalan** pake tombol angka atau tombol gamepad:
   - `1` / **[B / ○]** : **BAD** (Flash Merah) - Buat foto yang blur atau gagal.
   - `2` / **[X / □]** : **OK** (Flash Kuning) - Buat foto yang "lumayan".
   - `3` / **[A / ✕]** : **GOOD** (Flash Hijau) - Foto-foto terbaik kamu.
3. **Navigasi** pake `N`/`P` atau D-Pad.
4. **Selesai**: Tekan `Enter` atau tombol **Start**. Aplikasi bakal mindahin semua foto ke folder `/BAD`, `/OK`, dan `/GOOD`.

---

## ⌨️ Shortcut Keyboard

| Tombol | Aksi | Apa yang terjadi |
| :--- | :--- | :--- |
| **1 / 2 / 3** | Rating Foto | Feedback 🔴 / 🟡 / 🟢 |
| **N / P** | Selanjutnya / Sebelumnya | Ganti foto |
| **R / Shift+R** | Putar Kanan / Kiri | Perbaiki orientasi |
| **F** | Fullscreen | Layar penuh |
| **H** | Toggle HUD | Muncul/Sembunyikan shortcut |
| **Ctrl + Scroll** | Zoom | Fokus detail (tengah) |
| **Enter** | **Finalize** | Pindahin file |

---

## 🎮 Dukungan Gamepad Universal

Sekarang udah dukung Xbox, PlayStation, dan kontroler generik. Legend di UI bakal otomatis ganti ikon sesuai device kamu (misal: `[A / ✕]`).

| Tombol | Aksi |
| :--- | :--- |
| **A / ✕** | Rating **GOOD** (Sortir) / Pilih (Menu) |
| **X / □** | Rating **OK** |
| **B / ○** | Rating **BAD** |
| **LB / RB** | Selanjutnya / Sebelumnya |
| **L-Stick** | Geser Foto (Pan) |
| **R-Stick** | Zoom Foto |
| **LT / RT** (L2 / R2) | Putar Kiri / Kanan |
| **R-Thumb** | Toggle Hotkey HUD |
| **Y / △** | Reset Zoom |
| **Start** | Selesai & Pindah File |
| **Back/Select** | Kembali ke Menu |

---

## 🛠️ Performa & Keamanan

- **Engine Terpisah**: Viewer utama dan filmstrip pake thread pool yang beda, jadi loading thumbnail nggak bakal ganggu kecepatan sortir kamu.
- **Ekstraksi RAW**: Kita pake preview bawaan dari file RAW biar nampilnya instan.
- **Keamanan Utama**: Tiap sesi bakal bikin `.photosorter_checkpoint.json`. Kalau mau batalin semua export, tinggal pake fitur **Restore** dan semua file balik ke tempat asalnya.
- **Pengaturan Tersimpan**: Ukuran window filmstrip dan preferensi lainnya bakal kesimpen di `settings.json`.

---

## 🚀 Cara Cepat Mulai

1. **Pastikan punya Python 3.9+**.
2. Jalankan **`install.bat`** (Windows) atau **`install.sh`** (Linux/macOS).
3. Jalankan **`run.bat`** atau **`run.sh`** buat mulai.

Buat detail cara instalasi manual, cek **[Panduan Instalasi](install.md)**.

---

## 💬 Feedback

Saya bikin ini buat bantu kerjaan fotografi saya sendiri. Kalau nemu bug atau punya ide biar tool ini makin oke tapi tetep simpel, kabarin ya.

Lisensi di bawah [MIT License](../../LICENSE).
