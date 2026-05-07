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

Photo Sorter V1 is a tool I built to solve a specific problem: culling large batches of photos quickly. It isn't trying to be Lightroom or a complex cataloging system. It's just a fast, distraction-free way to decide what to keep and what to toss before you start editing.

If you've ever had to click through hundreds of images from a shoot and wished you could just do it with a few keystrokes (or a gamepad) without your computer lagging, this is for you.

---

## ✨ What's New?

- **Filmstrip Navigator**: A sleek "minimap" at the bottom to see where you are in your batch.
- **Blur Detection (AI Assisted)**: Real-time focus analysis that labels thumbnails as SHARP, SOFT, or BLUR.
- **Universal Gamepad Support**: Works with Xbox, PlayStation (PS2-PS5), and most generic controllers.
- **Improved Performance**: Faster RAW loading and a dedicated thumbnail engine.
- **Image Rotation**: Fix orientation on the fly with the keyboard or gamepad triggers.
- **Premium UI**: Refined dark theme with smooth animations and better feedback.

---

## 🎞️ The Filmstrip Navigator

The new filmstrip at the bottom gives you visual context without cluttering the screen:
- **Visual Context**: See your previous and upcoming shots at a glance.
- **Rating Ribbons**: Each thumbnail has a color-coded strip (Red/Yellow/Green) so you can see your sorting progress visually.
- **Jump Anywhere**: Just click a thumbnail to jump straight to that photo.
- **Auto-Sync**: The strip follows your navigation and auto-centers the current image.
- **Configurable**: You can change how many thumbnails are visible via **Settings > Filmstrip Window Size**.

---

## ✨ The Workflow

The whole idea is to keep your hands on your input device and your eyes on the images. You just pick a folder and start sorting into three simple buckets:

<p align="center">
  <img src="assets/screenshots/bad yellow.png" width="250" alt="Rating: BAD">
  <img src="assets/screenshots/ok yellow.png" width="250" alt="Rating: OK">
  <img src="assets/screenshots/good green.png" width="250" alt="Rating: GOOD">
</p>

1. **Pick your folder** containing the photos.
2. **Rate as you go** using the number keys or gamepad buttons:
   - `1` / **[B / ○]** : **BAD** (Red flash) - For the blurry ones or the mistakes.
   - `2` / **[X / □]** : **OK** (Yellow flash) - For the "maybe" pile.
   - `3` / **[A / ✕]** : **GOOD** (Green flash) - Your winners.
3. **Move around** with `N`/`P` or the D-Pad.
4. **Finish up**: Hit `Enter` or the **Start** button. The app moves everything into `/BAD`, `/OK`, and `/GOOD` folders in your directory.

---

## ⌨️ Keyboard Shortcuts

| Key | Action | What happens |
| :--- | :--- | :--- |
| **1 / 2 / 3** | Rate Image | 🔴 / 🟡 / 🟢 Feedback |
| **N / P** | Next / Previous | Switch images |
| **R / Shift+R** | Rotate Right / Left | Fix orientation |
| **F** | Fullscreen | Toggle view |
| **H** | Toggle HUD | Show/Hide shortcuts |
| **Ctrl + Scroll** | Zoom | Focus in (anchored to center) |
| **Enter** | **Finalize** | Move the files |

---

## 🎮 Universal Gamepad Support

The app now supports Xbox, PlayStation, and generic controllers. The UI legend automatically updates to show icons for your device (e.g., `[A / ✕]`).

| Button | Action |
| :--- | :--- |
| **A / ✕** | Rate **GOOD** (Sorting) / Confirm (Menu) |
| **X / □** | Rate **OK** |
| **B / ○** | Rate **BAD** |
| **LB / RB** | Next / Previous Image |
| **L-Stick** | Pan Image |
| **R-Stick** | Zoom In/Out |
| **LT / RT** (L2 / R2) | Rotate Left / Right |
| **R-Thumb** | Toggle Hotkey HUD |
| **Y / △** | Reset Zoom |
| **Start** | Finalize Export |
| **Back/Select** | Return to Menu |

---

## 🛠️ Performance & Reliability

- **Dedicated Engines**: The main viewer and the filmstrip use separate thread pools, so loading thumbnails never slows down your high-res sorting.
- **RAW Extraction**: We use embedded previews for RAW files to give you near-instant viewing.
- **Safety First**: Every session creates a `.photosorter_checkpoint.json`. If you want to undo the whole export, just use the **Restore** feature and everything will move back to its original location.
- **Settings Persistence**: Your filmstrip window size and other preferences are saved to `settings.json`.

---

## 🚀 Quick Start

1. **Have Python 3.9+** ready.
2. Run **`install.bat`** (Windows) or **`install.sh`** (Linux/macOS).
3. Run **`run.bat`** or **`run.sh`** to launch.

For manual setup details, see the **[Installation Guide](docs/installation.md)**.

---

## 💬 Feedback

I made this to be a useful tool for my own photography work. If you find bugs or have ideas on how to make it even better while keeping it simple, please let me know.

Licensed under the [MIT License](LICENSE).
