# Photo Sorter V1

<p align="center">
  <img src="assets/screenshots/main menu.png" alt="Photo Sorter V1 Main Menu" width="600">
</p>

<p align="center">
  🇺🇸 **English** | 🇮🇩 [Bahasa Indonesia](docs/id/README.md)
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms">
  <img src="https://img.shields.io/badge/Python-3.9%2B-blueviolet" alt="Python Version">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

## 📸 What is this?

Photo Sorter V1 is a simple tool I built to solve a specific problem: culling large batches of photos quickly. It isn't trying to be Lightroom or a complex management system. It's just a fast way to decide what to keep and what to toss before you start editing.

If you've ever had to click through hundreds of images from a shoot and wished you could just do it with a few keystrokes without your computer lagging, this is for you.

---

## ✨ The Workflow

The whole idea is to keep your hands on the keyboard and your eyes on the images. You just pick a folder and start sorting into three simple buckets:

<p align="center">
  <img src="assets/screenshots/bad yellow.png" width="250" alt="Rating: BAD">
  <img src="assets/screenshots/ok yellow.png" width="250" alt="Rating: OK">
  <img src="assets/screenshots/good green.png" width="250" alt="Rating: GOOD">
</p>

1. **Pick your folder** containing the photos.
2. **Rate as you go** using the number keys:
   - `1` : **BAD** (Red flash) - For the blurry ones or the mistakes.
   - `2` : **OK** (Yellow flash) - For the "maybe" pile.
   - `3` : **GOOD** (Green flash) - Your winners.
3. **Move around** with `N` (Next) and `P` (Previous).
4. **Finish up**: Hit `Enter`. The app moves everything you rated into `/BAD`, `/OK`, and `/GOOD` folders in your directory.

---

## 🛠️ Why I built it this way

- **No mouse needed**: I hate reaching for the mouse while culling. Every core action is mapped to a key.
- **Instant feedback**: The color flashes are there so you know you hit the right key without having to look at a small UI label.
- **Safety**: I know how scary it is to have a tool move your files. Every session creates a checkpoint file. If you make a mistake or want to undo the whole thing, just hit **Restore** and everything moves back to exactly where it was.
- **Organization**: If you have photos in subdirectories, the app preserves that structure within the category folders so you don't lose your folder organization.

---

## ⌨️ Shortcuts

| Key | Action | What happens |
| :--- | :--- | :--- |
| **1** | Rate **BAD** | 🔴 Red Flash |
| **2** | Rate **OK** | 🟡 Yellow Flash |
| **3** | Rate **GOOD** | 🟢 Green Flash |
| **N / P** | Next / Previous | Switch images |
| **F** | Fullscreen | Toggle view |
| **Ctrl + Scroll** | Zoom | Focus in |
| **Enter** | **Finalize** | Move the files |

---

## 📖 A few things to note

### ⚠️ Current Tradeoffs & Limitations
- **RAW Files**: This depends on `rawpy`. If that library isn't on your system, the app will just skip the RAW files and stick to standard images like JPG/PNG.
- **Speed**: I use background loading to keep things fast, but if you're on a slower drive or working with massive RAW files, you might see a brief loading state. 
- **Experimental**: I've focused on making this safe and stable, but it's still a work in progress. I'd always recommend having a backup of your photos before running major operations with any new tool.

---

## 🚀 Quick Start

1. **Have Python 3.9+** ready.
2. Run **`install.bat`** (Windows) or **`install.sh`** (Linux/macOS).
3. Run **`run.bat`** or **`run.sh`** to launch.

For more details on setting things up manually, check the **[Installation Guide](docs/installation.md)**.

---

## 💬 Feedback

I made this to be a useful tool for my own work, and I hope it's useful for yours too. If you find any bugs or have ideas on how to keep it fast and simple, feel free to reach out.

Licensed under the [MIT License](LICENSE).
