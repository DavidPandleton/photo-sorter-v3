# Photo Sorter V1

A professional, high-performance desktop application designed for rapid photo culling and organization. Whether you are a professional photographer or a hobbyist, Photo Sorter V1 helps you move through thousands of photos with zero lag and total precision.

---

## 📸 Overview

Photo Sorter V1 is built for **speed**. It allows you to sort your photos into three categories (**BAD**, **OK**, **GOOD**) using simple keyboard shortcuts. The application is designed to be "photo-first," meaning the image is always the hero of the interface, with controls staying quietly out of your way.

### Why use Photo Sorter?
- **Zero Lag**: Images load instantly using a multi-threaded background loader.
- **Smart Memory**: Doesn't slow down your computer; it manages its own memory budget.
- **RAW Support**: Works natively with professional formats (CR2, ARW, NEF).
- **Safety**: Your original files are never deleted. Every action is reversible via the Checkpoint system.

---

## 🚀 Installation Guide

This guide is written for everyone, even if you have never used a command line before. Follow the steps for your specific computer type.

### 🪟 Windows (Windows 10 & 11)

#### 1. Install Python
Python is the "engine" that runs this app.
1. Go to [python.org/downloads](https://www.python.org/downloads/).
2. Click the yellow **Download Python 3.xx** button.
3. **CRITICAL STEP**: When the installer starts, check the box that says **"Add Python to PATH"** at the bottom. If you miss this, the app won't run!
4. Click **Install Now**.

#### 2. Open the Command Terminal
1. Press the **Windows Key** on your keyboard.
2. Type `cmd` and press **Enter**. This opens the Command Prompt.
3. Verify it works by typing `python --version` and pressing Enter. You should see "Python 3.xx.x".

#### 3. Setup the Project
1. Navigate to where you downloaded this project. For example, if it's on your Desktop:
   ```cmd
   cd Desktop\photo-sorter
   ```
2. Create a "Virtual Environment" (a clean space for the app):
   ```cmd
   python -m venv venv
   ```
3. Activate the environment:
   ```cmd
   venv\Scripts\activate
   ```
   *(You should now see `(venv)` appearing at the start of your command line.)*

#### 4. Install Dependencies & Run
1. Install the needed libraries:
   ```cmd
   pip install -r requirements.txt
   ```
2. Start the app:
   ```cmd
   python sorter.py
   ```

**Windows Troubleshooting:**
- **"Python not found"**: You forgot to check "Add Python to PATH" during installation. Uninstall and reinstall Python, making sure to check that box.
- **SmartScreen/Defender**: If Windows warns you about running a script, click "More Info" and then "Run Anyway". This is common for local Python scripts.
- **Missing DLLs**: If you get a "DLL load failed" error, you might need the [Microsoft Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe).

---

### 🍎 macOS (Intel & Apple Silicon M1/M2/M3/M4)

MacOS comes with Python, but we recommend a clean installation using **Homebrew**.

#### 1. Install Homebrew (The Mac Package Manager)
1. Open the **Terminal** app (Press `Cmd + Space`, type `Terminal`, and hit Enter).
2. Paste this command and hit Enter:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
3. Follow the instructions on the screen (it may ask for your Mac password).

#### 2. Install Python & LibRaw
1. In the same terminal, run:
   ```bash
   brew install python libraw
   ```

#### 3. Setup the Project
1. Navigate to the project folder:
   ```bash
   cd ~/Downloads/photo-sorter
   ```
2. Create and activate a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

#### 4. Install & Run
1. Install libraries:
   ```bash
   pip install -r requirements.txt
   ```
2. Start the app:
   ```bash
   python3 sorter.py
   ```

**macOS Troubleshooting:**
- **Permissions**: If the app can't see your photos, go to `System Settings > Privacy & Security > Full Disk Access` and ensure `Terminal` (or your code editor) is allowed.
- **Intel vs Silicon**: The commands above work for both. `pip` will automatically download the correct version for your chip.

---

### 🐧 Linux (All Major Distributions)

Linux users typically need to install a few system libraries before the Python libraries can work.

#### **Debian / Ubuntu / Linux Mint / Pop!_OS**
```bash
sudo apt update
sudo apt install python3-venv libraw-dev
```

#### **Arch Linux / Manjaro / EndeavourOS**
```bash
sudo pacman -S python libraw qt6-base
```

#### **Fedora / Nobara**
```bash
sudo dnf install python3 libraw-devel qt6-qtbase
```

#### **openSUSE Tumbleweed / Leap**
```bash
sudo zypper install python3 libraw-devel libqt6-qtbase-devel
```

#### **Setup & Run (Universal for Linux)**
1. Navigate to the folder: `cd photo-sorter`
2. Create venv: `python3 -m venv venv`
3. Activate: `source venv/bin/activate`
4. Install: `pip install -r requirements.txt`
5. Run: `python3 sorter.py`

**Linux Troubleshooting:**
- **Wayland Issues**: If the UI looks strange or fails to launch, try running with `QT_QPA_PLATFORM=xcb python3 sorter.py`.
- **Permissions**: Ensure your user has read/write access to the photo folders.

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| **1** | Rate **BAD** (Red Flash) |
| **2** | Rate **OK** (Yellow Flash) |
| **3** | Rate **GOOD** (Green Flash) |
| **N / P** | Next / Previous Image |
| **F** | Toggle Fullscreen |
| **Ctrl + Scroll** | Zoom In/Out (Cmd ⌘ on Mac) |
| **Pinch** | Native Trackpad Pinch-to-Zoom |
| **Enter** | **Finalize Export** (Moves files to folders) |
| **ESC** | Back to Menu |

---

## 🛠️ How it Works (The Simple Version)

1. **Select Folder**: Point the app to a folder full of photos.
2. **Cull**: Use the `1`, `2`, and `3` keys to rate your images.
3. **Finish**: Press **Enter**. The app creates three folders: `/BAD`, `/OK`, and `/GOOD`.
4. **Export**: It moves your rated photos into those folders. **Don't worry**, it preserves your subfolder structure! If your photo was in `Summer/Beach.jpg`, it will move to `GOOD/Summer/Beach.jpg`.

---

## 🛡️ Safety & Checkpoints

Photo Sorter is non-destructive.
- **Checkpoint**: Every folder you open gets a hidden `.photosorter_checkpoint.json` file. This acts as a "memory" of where your files were originally.
- **Restore**: If you made a mistake or want to "undo" your sorting, just click the **Restore Checkpoint** button. The app will move every file back to its original spot and remove the category folders.

---

## 📋 Requirements

- **Python 3.9 or newer**
- **PyQt6** (Interface)
- **rawpy** (For RAW support)
- **numpy** (For image math)

*Note: The app will run without RAW support if `rawpy` fails to install, but you will only be able to sort standard images like JPG and PNG.*

---

## ✉️ Final Note for Beginners

Don't be intimidated by the command line! Once you have it set up once, running the app is as simple as opening your terminal and typing `python sorter.py`. If you run into any errors, look closely at the "Troubleshooting" section for your OS—99% of issues are solved by installing Python correctly.

Happy Sorting!
