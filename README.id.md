# Photo Sorter V1

Tool sederhana berbasis keyboard buat bantu kamu sortir dan ngerapihin ribuan foto dengan cepat. Ga ribet, ga berat, dan langsung to-the-point.

---

## Fitur

- **Sortir Cepat**: Masukin foto ke kategori **BAD**, **OK**, atau **GOOD** cuma sekali tekan.
- **Support Banyak Format**: Bisa buat foto biasa (JPG, PNG) sampai file RAW (CR2, ARW, NEF) kalau ada `rawpy`.
- **Navigasi Keyboard**: Fokus di keyboard biar kerjaan cepat beres (1, 2, 3, N, P, Enter).
- **Viewer Interaktif**: Bisa zoom dan geser (pan) buat liat detail foto.
- **Feedback Visual**: Ada efek warna pas kamu kasih rating biar makin mantap.
- **Sistem Checkpoint**: Ada fitur buat balikin posisi file ke awal kalau kamu berubah pikiran.
- **Multi-Platform**: Jalan lancar di Windows, Linux, dan macOS.

---

## Kontrol (Hotkeys)

### Rating & Ekspor
- **1** → Kasih rating **BAD** (Overlay merah)
- **2** → Kasih rating **OK** (Overlay kuning)
- **3** → Kasih rating **GOOD** (Overlay hijau)
- **Enter** → **Finish Export** (Pindahin foto ke folder masing-masing)

### Navigasi
- **N** → Foto selanjutnya
- **P** → Foto sebelumnya
- **ESC** → Balik ke menu utama (bakal nanya dulu kalau lagi ada progres)
- **F** → Fullscreen
- **Ctrl + Plus/Minus** (atau **Cmd** di Mac) → Zoom In/Out

*Catatan: Tombol keyboard ga bisa ditahan (auto-repeat mati), biar kamu ga ga sengaja skip banyak foto sekaligus.*

---

## Cara Pakai

1. **Buka folder**: Pilih folder tempat foto-foto kamu berada.
2. **Sortir**: Pakai tombol 1, 2, atau 3 sambil browsing pakai N atau P.
3. **Selesai**: Kalau sudah beres, tekan Enter. Aplikasi bakal otomatis mindahin foto yang sudah kamu kasih rating ke folder: `/BAD`, `/OK`, dan `/GOOD`.
4. Foto yang ga dikasih rating bakal tetap aman di tempat asalnya.

---

## Sistem Checkpoint

Biar aman, aplikasi bakal bikin file tersembunyi namanya `.photosorter_checkpoint.json` di folder kamu.

- **Fungsinya**: Nyimpen data lokasi awal foto dan folder apa aja yang dibuat sama aplikasi ini.
- **Kalau Buka Lagi**: Kalau kamu buka folder yang sama, aplikasi bakal nanya mau pakai data lama atau mulai dari nol.
- **Fitur Restore**: Kalau mau batalin semua sortirannya, klik tombol **Restore**. Foto bakal balik ke posisi asal dan folder kosong (`/BAD`, `/OK`, `/GOOD`) bakal dihapus otomatis.

---

## Catatan Platform

- **Windows**: Biasanya langsung jalan tanpa masalah.
- **Linux**: Mungkin butuh install `libraw` biar `rawpy` bisa jalan. Kalau RAW ga kebaca, aplikasi bakal otomatis skip file RAW dan lanjut di JPG saja.
- **macOS**: Pakai tombol **Command (⌘)** buat shortcut (bukan Ctrl). Fullscreen-nya juga pakai gaya macOS (Spaces).

---

## Catatan Scaling

Kalau display Windows kamu pakai scaling di atas 100% (misal 150%), tampilan mungkin agak sedikit beda. Aplikasi sudah coba nanganin ini otomatis, tapi settingan 100% tetap yang paling aman buat dapet tampilan paling pas.

---

## Cara Install

1. Pastikan sudah ada Python di komputer kamu.
2. Install library yang dibutuhin:
   ```bash
   pip install -r requirements.txt
   ```
3. Jalankan aplikasinya:
   ```bash
   python sorter.py
   ```

---

## Requirements

- **Python 3.9+**
- **PyQt6** (Buat tampilannya)
- **rawpy** (Opsional, buat yang butuh sortir file RAW)
- **numpy** (Buat proses gambarnya)

---

## Kekurangan / Limitasi

- Support RAW tergantung library `rawpy`, jadi mungkin ada beberapa kamera baru yang belum langsung support.
- Kalau folder isinya ribuan banget, proses scan awal mungkin butuh waktu 1-2 detik.
- Tampilan di monitor tambahan (multi-monitor) bisa beda-beda tergantung sistem operasinya.

---

## Penutup

Ini cuma tool sederhana yang aku buat buat bantu sortir foto lebih cepat. Masih jauh dari sempurna, tapi sejauh ini cukup ngebantu alur kerjaku sehari-hari biar ga pusing liat ribuan foto.

Silakan kalau mau dipakai, disebarin, atau mau dioprek sendiri kodenya biar makin keren. Semoga bermanfaat!
