# Pertanyaan yang Sering Diajukan (FAQ)

### Apa aman mindah-mindahin file pake tool ini?
Aman. Saya udah desain tool ini buat jadi non-destruktif. Tiap kali kamu mindahin file, aplikasi bakal nyatet di file checkpoint. Kalau ada yang salah, tinggal pake fitur **Restore** buat balikin semuanya ke folder asal. Tapi, tetep disaranin buat punya backup foto ya, buat jaga-jaga.

### Kok file RAW saya nggak kebaca?
Biasanya karena library `rawpy` belum terinstall atau nggak cocok sama sistem kamu. Coba cek lagi langkah instalasi di bagian [Panduan Instalasi](install.md). Kalau tetep nggak bisa, aplikasi bakal otomatis cuma nampilin file standar kayak JPG/PNG.

### Shortcut keyboard nggak jalan di Linux?
Beberapa desktop environment di Linux (kayak GNOME atau KDE) mungkin udah pake shortcut `N` atau `P` buat fungsi sistem. Coba cek settingan shortcut global di Linux kamu kalau tombolnya nggak ngerespon di aplikasi.

### Apa aplikasi ini bakal hapus file asli saya?
Nggak akan. Aplikasi ini cuma mindahin file ke folder kategori (`BAD`, `OK`, `GOOD`). Nggak ada fitur hapus otomatis di sini.

### Bisa nggak saya ganti warna flash overlay-nya?
Untuk sekarang warnanya udah fix (Merah, Kuning, Hijau). Tapi kalau kamu ngerti Python, kamu bisa edit variabel warnanya di dalam file `src/main.py` di bagian fungsi `flash`.
