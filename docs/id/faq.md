# Tanya Jawab (FAQ)

### Ini aplikasi berbayar?
Gratis, 100%. Photo Sorter adalah **open source** — artinya kode programnya bisa dilihat siapa aja di GitHub. Nggak ada iklan, nggak ada trial, nggak ada fitur premium. Bebas pake selamanya.

### Ini bisa gantiin Lightroom?
**Bukan.** Photo Sorter itu alat buat **milah foto** (culling), bukan buat edit foto. Lo pakenya *sebelum* masuk Lightroom/Capture One. Ibaratnya: ini saringan, bukan alat masak. Lo pake ini buat mutusin "mana yang keep, mana yang discard" — baru setelah itu lo edit foto yang keep di Lightroom.

Workflow-nya gini:
```
📸 Ambil foto → 🔍 Saring pake Photo Sorter → ✂️ Edit yang keep di Lightroom
```

### Aman nggak pake ini? File gua bisa rusak?
Aman. Photo Sorter cuma **mindahin file** ke folder — bukan ngedit, bukan ngeconvert, bukan ngekompres. File aslinya nggak berubah sama sekali.

Plus setiap mau export, aplikasi otomatis bikin **checkpoint** (catetan). Kalo ada yang salah — misalnya lu salah pencet — tinggal balikin pake satu klik, semua file balik ke posisi semula.

Udah dites sama ribuan file RAW, aman aja.

### RAW itu apa?
RAW itu format file kamera profesional. Bedanya sama JPG:
- **JPG** — udah diproses sama kamera, warnanya fix, ukurannya kecil
- **RAW** — mentahan, data asli dari sensor kamera, ukurannya gede, warnanya flat

Photo Sorter bisa baca RAW dari kamera manapun: Nikon (NEF), Canon (CR2/CR3), Sony (ARW), Fuji (RAF), dan lain-lain.

Caranya pake preview yang ada di dalem file RAW — jadi cepet, nggak perlu nunggu render.

### Bisa pake controller / gamepad?
Bisa. Colok controller Xbox atau PlayStation lewat USB atau Bluetooth, langsung jalan. Nggak perlu setting apa-apa.

Tombol-tombolnya:
- **A** = GOOD | **B** = BAD | **X** = OK
- **LB/RB** = ganti foto
- **Joystick** = geser-geser / zoom
- **Start** = export

Enak dipake sambil santai di sofa.

### Setting-an gua ilang nggak pas aplikasi ditutup?
Nggak. Semua rating, bintang, rotasi, dan pick flag disimpen di database SQLite lokal. Mau ditutup, direstart, besok dibuka lagi — data lo aman. Nggak perlu nyimpen manual.

### Bisa ganti shortcut keyboard?
Bisa. Buka menu **Settings** → tab **Keybindings**. Tinggal klik shortcut yang mau diganti, terus pencet tombol baru. Selesai.

### Bisa ganti warna rating?
Bisa. Di menu **Settings** → tab **Categories**, lu bisa nambah/edit kategori sendiri. Mau ganti nama, ganti warna flash, ganti shortcut, ganti folder tujuan — semua bebas.

### File gua dipindah kemana pas export?
Di dalem folder foto yang lagi lo sortir. Contoh:

```
📁 Liburan-2025/           ← folder asli
├── 📁 BAD/                ← foto yang dikasih rating 1
├── 📁 OK/                 ← rating 2
└── 📁 GOOD/               ← rating 3
```

Folder cuma kepengaruh kalo lo pencet **Enter** (export). Kalo nggak, file diem aja di tempat asal.

### Ada versi HP-nya?
Belum. Photo Sorter cuma buat desktop (Windows, macOS, Linux). Soalnya workflow culling emang paling enak di layar gede pake keyboard/controller.

### Ukuran filenya gede?
Nggak. Installer cuma sekitar **12 MB**. Bandingin sama Lightroom yang bisa 1-2 GB.

### Aplikasi ini butuh internet?
Nggak. Begitu di-install, jalan offline total. Foto lo nggak dikirim kemana-mana.

### Ada rencana nambah fitur editing?
Nggak. Fokus Photo Sorter cuma satu: **milah foto secepat mungkin**. Kalo lo butuh edit, pake Lightroom / Capture One / aplikasi edit lainnya.

### Siapa yang buat aplikasi ini?
Source code-nya bisa dilihat di [GitHub](https://github.com/DavidPandleton/photo-sorter-v3).
