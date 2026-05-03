# Panduan Instalasi & Setup

Panduan ini berisi instruksi lengkap buat nginstall dan jalanin Photo Sorter V1 di semua sistem operasi utama.

---

## 🪟 Windows (10 & 11)

### 1. Install Python
1. Buka [python.org/downloads](https://www.python.org/downloads/).
2. Klik tombol **Download Python 3.xx**.
3. **PENTING**: Centang kotak **"Add Python to PATH"** pas lagi install.

### 2. Setup Environment
1. Buka Command Prompt (`cmd`).
2. Masuk ke folder project: `cd path\to\photo-sorter`
3. Bikin venv: `python -m venv venv`
4. Aktifkan: `venv\Scripts\activate`

### 3. Install & Jalanin
1. `pip install -r requirements.txt`
2. `python src/sorter.py`

---

## 🍎 macOS (Intel & Apple Silicon)

### 1. Install Dependencies
1. Install Homebrew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
2. `brew install python libraw`

### 2. Setup Environment
1. `cd path/to/photo-sorter`
2. `python3 -m venv venv`
3. `source venv/bin/activate`

### 3. Install & Jalanin
1. `pip install -r requirements.txt`
2. `python3 src/sorter.py`

---

## 🐧 Linux

### System Dependencies
- **Ubuntu/Debian**: `sudo apt install python3-venv libraw-dev`
- **Arch**: `sudo pacman -S python libraw qt6-base`
- **Fedora**: `sudo dnf install python3 libraw-devel qt6-qtbase`

### Setup & Jalanin
1. `python3 -m venv venv`
2. `source venv/bin/activate`
3. `pip install -r requirements.txt`
4. `python3 src/sorter.py`

---

## 🛠️ Build Executable Mandiri

Kalau mau bikin file `.exe` atau binary sendiri:
1. Masuk ke folder `packaging/`.
2. Jalanin script build: `python build_windows.py`
3. Hasilnya bakal ada di folder `dist/`.
