# Photo Sorter V1: Workflow Walkthrough

This document explains the features and design of Photo Sorter V1. The tool is designed to be a simple companion for the first stage of your photo editing workflow.

---

## 🖥️ The Interface

The interface is intentionally minimal. When you start sorting, the image takes center stage.

![Main Menu](../ss/main%20menu.png)

### Sorting & Rating
The main goal is to get through your images quickly. When you press a rating key (`1`, `2`, or `3`), a subtle color flash confirms your choice.

![Rating Feedback](../ss/good%20green.png)

- **Red**: Rate as BAD (to be discarded).
- **Yellow**: Rate as OK (middle ground).
- **Green**: Rate as GOOD (your best shots).

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
