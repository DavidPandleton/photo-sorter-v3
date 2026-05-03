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

Photo Sorter V1 adalah tool simpel yang saya bikin buat nyelesain satu masalah spesifik: nyortir foto dalam jumlah banyak dengan cepat. Tool ini bukan pengganti Lightroom atau sistem manajemen foto yang ribet. Fungsinya cuma satu: bantu kamu nentuin mana foto yang mau dipake dan mana yang mau dibuang sebelum masuk ke tahap editing.

Kalau kamu pernah ngerasa pegel harus ngeklik ratusan foto hasil pemotretan dan berharap ada cara yang lebih cepet lewat keyboard tanpa bikin komputer lemot, nah tool ini cocok buat kamu.

---

## ✨ Alur Kerja

Konsep utamanya adalah tangan tetep di keyboard dan mata fokus ke foto. Kamu tinggal pilih folder, terus mulai sortir foto ke tiga kategori:

<p align="center">
  <img src="../../assets/screenshots/bad yellow.png" width="250" alt="Rating: BAD">
  <img src="../../assets/screenshots/ok yellow.png" width="250" alt="Rating: OK">
  <img src="../../assets/screenshots/good green.png" width="250" alt="Rating: GOOD">
</p>

1. **Pilih folder** yang isinya foto-foto kamu.
2. **Kasih rating sambil jalan** pake tombol angka:
   - `1` : **BAD** (Overlay Merah) - Buat foto yang blur atau gagal.
   - `2` : **OK** (Overlay Kuning) - Buat foto yang "lumayan".
   - `3` : **GOOD** (Overlay Hijau) - Foto-foto terbaik kamu.
3. **Navigasi** pake `N` (Next/Selanjutnya) dan `P` (Previous/Sebelumnya).
4. **Selesai**: Tekan `Enter`. Aplikasi bakal mindahin semua foto yang udah kamu rating ke folder `/BAD`, `/OK`, dan `/GOOD` di dalam direktori kamu.

---

## 🛠️ Kenapa saya bikin begini?

- **Nggak butuh mouse**: Saya paling males kalau harus bolak-balik pegang mouse pas lagi nyortir. Semua fungsi utama ada di keyboard.
- **Feedback instan**: Overlay warna itu ada biar kamu tau tombol mana yang kepencet tanpa harus liat label UI yang kecil.
- **Keamanan**: Saya tau rasanya ngeri kalau ada tool yang mindah-mindahin file. Makanya, tiap sesi bakal bikin file checkpoint. Kalau ada salah atau mau batalin semuanya, tinggal klik **Restore** dan semua file bakal balik ke posisi semula.
- **Struktur Folder**: Kalau foto kamu ada di dalam sub-folder, aplikasi ini bakal tetep jaga strukturnya di dalam folder kategori. Jadi rapihnya nggak ilang.

---

## ⌨️ Shortcut Keyboard

| Tombol | Aksi | Apa yang terjadi |
| :--- | :--- | :--- |
| **1** | Rating **BAD** | 🔴 Flash Merah |
| **2** | Rating **OK** | 🟡 Flash Kuning |
| **3** | Rating **GOOD** | 🟢 Flash Hijau |
| **N / P** | Next / Previous | Ganti foto |
| **F** | Fullscreen | Layar penuh |
| **Ctrl + Scroll** | Zoom | Fokus detail |
| **Enter** | **Finalize** | Pindahin file |

---

## 📖 Catatan Penting

### ⚠️ Limitasi & Tradeoffs
- **File RAW**: Tool ini butuh `rawpy`. Kalau di sistem kamu nggak ada, aplikasi bakal skip file RAW dan cuma nampilin gambar standar kayak JPG/PNG.
- **Kecepatan**: Saya pake sistem background loading biar cepet, tapi kalau harddisk kamu lambat atau file RAW-nya gede banget, mungkin bakal ada loading bentar.
- **Eksperimental**: Saya fokus bikin tool ini aman dan stabil, tapi tetep aja ini masih tahap pengembangan. Selalu disaranin buat backup foto kamu dulu sebelum pake tool baru apa pun.

---

## 🚀 Cara Cepat Mulai

1. **Pastikan punya Python 3.9+**.
2. Jalankan **`install.bat`** (Windows) atau **`install.sh`** (Linux/macOS).
3. Jalankan **`run.bat`** atau **`run.sh`** buat mulai.

Buat detail cara instalasi manual, cek **[Panduan Instalasi](install.md)**.

---

## 💬 Feedback

Saya bikin ini buat bantu kerjaan saya sendiri, dan semoga bisa bantu kerjaan kamu juga. Kalau nemu bug atau punya ide biar tool ini tetep simpel dan kenceng, jangan ragu buat kasih tau ya.

Lisensi di bawah [MIT License](../../LICENSE).
