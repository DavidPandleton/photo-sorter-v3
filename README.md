# Photo Sorter V1

A simple, keyboard-driven tool to help you cull and organize large batches of photos quickly. It’s designed to be fast, reliable, and stay out of your way.

---

## Features

- **Sort by Rating**: Quickly categorize photos into **BAD**, **OK**, or **GOOD**.
- **Wide Format Support**: Works with standard images (JPG, PNG) and RAW files (CR2, ARW, NEF) if `rawpy` is installed.
- **Fast Workflow**: Optimized for keyboard use (1, 2, 3, N, P, Enter).
- **Interactive Viewer**: Simple zoom and pan support to check details.
- **Visual Feedback**: Subtle color overlays when you rate an image so you know it registered.
- **Safety First**: Includes a checkpoint system to restore files if you change your mind.
- **Cross-Platform**: Runs on Windows, Linux, and macOS.

---

## Controls

### Rating & Export
- **1** → Rate **BAD** (Red flash)
- **2** → Rate **OK** (Yellow flash)
- **3** → Rate **GOOD** (Green flash)
- **Enter** → **Finish Export** (Moves rated files to their folders)

### Navigation
- **N** → Next image
- **P** → Previous image
- **ESC** → Back to menu (it will ask for confirmation if you have progress)
- **F** → Toggle Fullscreen
- **Ctrl + Plus/Minus** (or **Cmd** on Mac) → Zoom In/Out

*Note: I've disabled key auto-repeat, so holding down a key won't accidentally skip five images.*

---

## How it works

1. **Select a folder**: The app scans for all supported images inside.
2. **Rate your photos**: Use the 1, 2, and 3 keys as you browse.
3. **Finish Export**: When you're done, press Enter. The app will physically move the rated files into three new subfolders: `/BAD`, `/OK`, and `/GOOD`.
4. Files you didn't rate are left exactly where they were.

---

## Checkpoint System

To keep things safe, the app creates a small file called `.photosorter_checkpoint.json` in your folder.

- **What it does**: It remembers where every file was originally and which folders the app created.
- **If you return**: If you open the same folder again, the app will ask if you want to keep the old checkpoint or start fresh.
- **Restore feature**: If you want to "undo" everything, use the **Restore** button. It will move files back to their original spots and delete the `/BAD`, `/OK`, and `/GOOD` folders—but only if they are empty. It won't touch your own folders.

---

## Platform Notes

- **Windows**: Should work fine out of the box.
- **Linux**: You might need `libraw` installed for `rawpy` to work. If RAW support fails, the app will just skip those files and let you keep working with JPGs.
- **macOS**: Uses the **Command (⌘)** key instead of Ctrl for shortcuts. Fullscreen follows the standard macOS "Spaces" style.

### Linux Notes

On some distributions (especially Arch-based), you may need:

- `libraw` (for RAW support via rawpy)
- `qt6-base` (for PyQt6 GUI)

Using a virtual environment is recommended:
```bash
python -m venv venv
source venv/bin/activate
```

### macOS Notes

You may need to install `libraw` manually:
```bash
brew install libraw
```

Also recommended:
- Use Python 3.9 or newer
- Use a virtual environment

---

## DPI & Scaling

If your Windows display scaling is set to something like 150%, the layout might look a bit different. I've added some code to handle this automatically, but keeping your display at 100% is always the most predictable.

---

## Installation

1. Make sure you have Python installed.
2. Install the few libraries needed:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the app:
   ```bash
   python sorter.py
   ```

---

## Requirements

- **Python 3.9+**
- **PyQt6** (The interface)
- **rawpy** (Optional, only needed if you want to sort RAW files)
- **numpy** (For image processing)

---

## Known Limitations

- RAW support depends on the `rawpy` library; some newer cameras might not be supported yet.
- If you have thousands of photos in one folder, it might take a second or two to scan them all.
- Multi-monitor behavior can vary a bit depending on your operating system's settings.

---

## A Final Note

This is a simple tool I made to help sort photos faster. It’s not perfect, but it works well for my workflow and helps me get through big shoots without getting a headache.

Feel free to use it, share it, or modify it to fit your own needs. Hope it helps!
