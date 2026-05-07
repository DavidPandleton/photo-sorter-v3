# Installation & Setup Guide

This guide provides comprehensive instructions for installing and running Photo Sorter V1 from source on all major operating systems.

---

## 🪟 Windows (10 & 11)

### 1. Install Python
1. Go to [python.org/downloads](https://www.python.org/downloads/).
2. Click **Download Python 3.xx**.
3. **IMPORTANT**: Check the box **"Add Python to PATH"** in the installer.

### 2. Setup Environment
1. Open Command Prompt (`cmd`).
2. Navigate to the project: `cd path\to\photo-sorter`
3. Create venv: `python -m venv venv`
4. Activate: `venv\Scripts\activate`

### 3. Install & Run
1. `pip install -r requirements.txt`
2. `python sorter.py`

> [!TIP]
> You can also use the helper scripts in the `scripts/` folder:
> - Run `.\scripts\install.bat` for automatic setup.
> - Run `.\scripts\run.bat` to launch the app.

---

## 🍎 macOS (Intel & Apple Silicon)

### 1. Install Dependencies
1. Install Homebrew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
2. `brew install python libraw`

### 2. Setup Environment
1. `cd path/to/photo-sorter`
2. `python3 -m venv venv`
3. `source venv/bin/activate`

### 3. Install & Run
1. `pip install -r requirements.txt`
2. `python3 sorter.py`

---

## 🐧 Linux

### System Dependencies
- **Ubuntu/Debian**: `sudo apt install python3-venv libraw-dev`
- **Arch**: `sudo pacman -S python libraw qt6-base`
- **Fedora**: `sudo dnf install python3 libraw-devel qt6-qtbase`

### Setup & Run
1. `python3 -m venv venv`
2. `source venv/bin/activate`
3. `pip install -r requirements.txt`
4. `python3 sorter.py`

---

## 🎮 Gamepad Notes
Gamepad support relies on the `inputs` library. On some Linux distributions, you may need to add your user to the `input` group to access joystick events:
`sudo usermod -a -G input $USER`
(Log out and back in for changes to take effect).

---

## 🛠️ Build Standalone Executable

To build a standalone `.exe` or binary:
1. Navigate to the `packaging/` directory.
2. Run the build script: `python build_windows.py`
3. The result will be in the `dist/` folder.
