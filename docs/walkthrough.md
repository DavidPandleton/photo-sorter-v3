# Photo Sorter V1: A quick walkthrough

I wanted to make a tool that felt simple and fast. This document walks you through how I set up the workflow and what everything does.

---

## 🖥️ The Main Screen

I tried to keep the interface as quiet as possible. When you open the app, you're greeted with just a few options. I didn't want you to have to dig through menus just to get started.

![Main Menu](../ss/main%20menu.png)

### Picking your best shots
Once you're in, the image is the only thing that matters. To keep you moving fast, I mapped the rating keys to `1`, `2`, and `3`. 

<p align="center">
  <img src="../ss/bad yellow.png" width="200" alt="Rating: BAD">
  <img src="../ss/ok yellow.png" width="200" alt="Rating: OK">
  <img src="../ss/good green.png" width="200" alt="Rating: GOOD">
</p>

I added the color flashes (Red for BAD, Yellow for OK, Green for GOOD) so you can be 100% sure you hit the right key without having to look away from the screen.

---

## 🛠️ Performance stuff

I spent a lot of time making sure the app doesn't slow you down:
- **Background Loading**: While you're judging the current photo, the app is already decoding the next few in the background.
- **Memory Management**: High-res photos take up a lot of RAM. I set a 1GB limit—once the app hits that, it starts clearing out the oldest previews to keep your system from getting sluggish.

---

## 🛡️ Keeping your data safe

Moving files is serious business. I built the app to be non-destructive and completely reversible.

### The Checkpoint File
Every time you finish a sorting session, a hidden `.photosorter_checkpoint.json` file is created. This is basically an "undo" button for the whole folder. 
- If you make a mistake, just hit **Restore** and the app uses that file to move everything back exactly where it was.
- It uses "atomic writes," which is just a fancy way of saying it writes to a temporary file first so that if your computer crashes mid-save, your checkpoint doesn't get corrupted.

---

## 📂 Handling folders

When you're ready to move the files (by hitting **Enter**), the app respects your existing organization. 

If your photos are tucked into subfolders like `Shoot/Day1/IMG_001.jpg`, the app will recreate those folders inside the category buckets. You'll end up with `GOOD/Shoot/Day1/IMG_001.jpg`. It keeps things tidy and easy to find later.

---

## 💬 A final thought

I built Photo Sorter V1 to be a "pre-filter." It's not here to replace your main editor, but hopefully, it makes that first hour after a big shoot a lot less painful. If you have any ideas on how to make it better, I'm all ears.
