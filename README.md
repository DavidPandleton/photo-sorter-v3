# Photo Sorter V1

<p align="center">
  <img src="ss/main menu.png" alt="Photo Sorter V1 Main Menu" width="600">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/Python-3.9%2B-blueviolet" alt="Python Version">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

## 📸 Overview

Photo Sorter V1 is a simple, straightforward utility designed to help you cull large batches of photos quickly. It doesn't try to be a full photo editor or a complex management system—it just focuses on making the initial selection process fast and uncomplicated.

It was built to solve a specific workflow problem: moving through hundreds of images from a shoot and deciding what to keep and what to toss, without the lag or distraction of heavier software.

---

## ✨ How it Works

The workflow is centered around your keyboard, allowing you to stay focused on the images.

<p align="center">
  <img src="ss/good green.png" alt="Sorting Interface" width="600">
</p>

1. **Select a folder** containing your photos.
2. **Rate images** using the `1`, `2`, and `3` keys.
3. **Navigate** with `N` (Next) and `P` (Previous).
4. **Finalize** by pressing `Enter`. The app moves your rated files into `/BAD`, `/OK`, and `/GOOD` folders.

---

## 🛠️ Key Design Choices

- **Keyboard-First**: Designed so you don't have to reach for your mouse while culling.
- **Visual Feedback**: Simple color overlays provide immediate confirmation of your rating.
- **Safe Operations**: A checkpoint system tracks every move. If you change your mind or make a mistake, you can restore everything to its original state.
- **Hierarchy Preservation**: If your photos are in subfolders, the app maintains that structure within the category folders.

---

## ⌨️ Shortcuts

| Key | Action |
| :--- | :--- |
| **1 / 2 / 3** | Rate **BAD** / **OK** / **GOOD** |
| **N / P** | Next / Previous Image |
| **F** | Toggle Fullscreen |
| **Ctrl + Scroll** | Zoom In/Out |
| **Enter** | **Finalize Export** |

---

## 📖 Important Notes

### ⚠️ Current Limitations
- **RAW Support**: Depends on `rawpy`. If the library isn't available on your system, the app will fall back to standard images (JPG/PNG).
- **Performance**: While we use background loading to keep things smooth, very large RAW files or slow drives may still show brief loading states.
- **Experimental**: This tool is still evolving. While we focus on stability and safety, we always recommend having a backup of your photos before running major operations.

---

## 🚀 Quick Start

1. **Install Python 3.9+**.
2. Run **`install.bat`** (Windows) or **`install.sh`** (Linux/macOS).
3. Run **`run.bat`** or **`run.sh`** to start sorting.

For detailed setup instructions, see the **[Installation Guide](docs/installation.md)**.

---

## 💬 Feedback

This project was made to be a useful tool for a specific task. If you find bugs or have ideas for improvements that keep the tool fast and simple, feedback is always welcome.

Licensed under the [MIT License](LICENSE).
