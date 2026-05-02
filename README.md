# Photo Sorter V1

A professional-grade, keyboard-driven photo culling and organization tool built with PyQt6. Designed for photographers who need to sort through large batches of images (JPG, PNG) and RAW files (CR2, ARW, NEF) quickly and reliably.

---

## 🚀 Features

- **Fast RAW Previews**: Optimized loading for high-resolution RAW formats.
- **High DPI Support**: Fully compatible with Windows display scaling (125%, 150%, 200%).
- **Stable Navigation**: Input locks and auto-repeat prevention ensure no images are skipped during rapid culling.
- **Smart Checkpoints**: A non-destructive "Time Machine" system that tracks your project's original state.

---

## ⌨️ Controls

### Rating & Export
- **[1]**: Rate **BAD** (Red Flash)
- **[2]**: Rate **OK** (Yellow Flash)
- **[3]**: Rate **GOOD** (Green Flash)
- **[ENTER]**: Finish & Export (Moves rated files to subfolders)

### Navigation
- **[N]**: Next Image
- **[P]**: Previous Image
- **[ESC]**: Return to Main Menu (Shows confirmation if progress exists)
- **[F]**: Toggle Fullscreen
- **[Window X]**: Close App (Shows confirmation if progress exists)

### Viewer
- **[CTRL + Plus/Minus]**: Zoom In / Out
- **[Mouse Scroll]**: Zoom at cursor position
- **[Left Mouse Drag]**: Pan while zoomed

---

## 📂 Export System

When you click **Finish Export** or press **ENTER**:
1. The app identifies all images you have rated.
2. It physically **MOVES** those files into organized subfolders: `/BAD`, `/OK`, and `/GOOD`.
3. Files you haven't rated are left untouched in their original location.
4. The application state is then safely reset.

---

## 💾 Checkpoint & Restore System

### Automatic Checkpoints
Every time you start sorting a new folder, the app creates a hidden `.photosorter_checkpoint.json` file. 
- If a checkpoint already exists, the app will ask if you want to **replace** it or keep the original baseline.

### Smart Restoration
If you need to undo your organization:
1. Select **Restore Checkpoint** from the menu.
2. Select the **Root Folder** of your project.
3. The app will move files from `/BAD`, `/OK`, and `/GOOD` back to their **original relative paths**.
4. **Smart Cleanup**: The app will only delete the folders it created (`/BAD`, `/OK`, `/GOOD`) and only if they are **completely empty** after restoration. Your own folders and files are never touched.

---

## 🛠️ Installation

1. Ensure you have **Python 3.10+** installed.
2. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

---

## 📋 Requirements

- **PyQt6**: Core UI Framework
- **rawpy**: RAW image decoding
- **numpy**: Image data processing

---

*Made for efficiency. Sorting photos shouldn't be a chore.*
