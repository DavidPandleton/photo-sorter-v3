# Photo Sorter V1: Workflow Walkthrough

This document explains the features and design of Photo Sorter V1. The tool is designed to be a simple companion for the first stage of your photo editing workflow.

---

## 🖥️ The Interface

The interface is intentionally minimal. When you start sorting, the image takes center stage.

![Main Menu](../ss/main%20menu.png)

### Sorting & Rating
The main goal is to get through your images quickly. You have three rating categories, each mapped to a number key:

<p align="center">
  <img src="../ss/bad yellow.png" width="200" alt="Rating: BAD">
  <img src="../ss/ok yellow.png" width="200" alt="Rating: OK">
  <img src="../ss/good green.png" width="200" alt="Rating: GOOD">
</p>

- **Key [1] - BAD (Red Flash)**: For photos to be discarded or archived.
- **Key [2] - OK (Yellow Flash)**: For middle-ground photos that aren't quite "keepers."
- **Key [3] - GOOD (Green Flash)**: For your best shots.

The color flash provides immediate confirmation of your choice so you can move to the next image with confidence.

---

## 🛠️ Performance & Caching

To keep the experience fluid, the app does a few things in the background:
- **Background Loading**: The app tries to decode the next few images while you are looking at the current one.
- **Memory Management**: We track how much RAM the image previews are using and clear out older ones when a 1GB limit is reached. This helps keep your system responsive.

---

## 🛡️ Data Safety

We know how important your photos are. Photo Sorter is designed to be non-destructive and reversible.

### The Checkpoint System
Every time you finalize a session, a `.photosorter_checkpoint.json` file is created. This file stores exactly where every photo was moved.
- If you need to undo your work, the **Restore** feature uses this file to move everything back to its original location.
- We use "atomic writes" for this file, meaning it's written to a temporary file first to prevent corruption if the app crashes mid-write.

---

## 📂 Export Logic

When you press **Enter** to finalize, the app doesn't just dump everything into a flat folder. It preserves your directory structure.

For example, if you have:
`Shoot/Day1/IMG_001.jpg`

And you rate it as **GOOD**, it will move to:
`GOOD/Shoot/Day1/IMG_001.jpg`

This makes it easy to integrate the sorted photos back into your existing organization.

---

## 💬 A Note on Simplicity

Photo Sorter V1 isn't meant to replace your professional cataloging software. It's a "pre-filter" designed to save you time before you import your photos into heavier editors. We hope it makes your workflow a little less tedious.
