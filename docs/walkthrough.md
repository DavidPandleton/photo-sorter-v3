# Walkthrough

This guide walks through the complete Photo Sorter V1 workflow — from opening a folder to exporting your selects.

---

## 1. Starting Up

When you launch the app, you'll see the main menu:

![Main Menu](../assets/screenshots/main%20menu.png)

- **Open Folder** (`Ctrl+O`) — choose a folder of photos to sort
- **Recent Projects** — quick access to previously opened folders
- **Quit** (`Ctrl+Q`)

---

## 2. Rating Images

Once inside, use `1` (BAD), `2` (OK), and `3` (GOOD) to rate each photo. A colored flash confirms your selection:

| Rating | Flash Color | Description |
|--------|-------------|-------------|
| **1** — GOOD | Green `#66bb6a` | Winners worth editing |
| **2** — OK | Yellow `#ffca28` | Maybes or duplicates |
| **3** — BAD | Red `#ef5350` | Blurry, misfires, mistakes |
| **0** — Unrate | Gray | Remove current rating |

After each rating the app advances to the next image automatically. Navigate freely with `N` (next) and `P` (previous).

### Undo

Made a mistake? `Ctrl+Z` reverts the last rating action. The undo stack persists until you close the folder.

---

## 3. Pro Culling Tools

### Pick / Flag (`Space`)

Mark standout images with a gold star flag. Picked images get a ★ overlay and can be filtered in the side panel. Useful for marking absolute favorites within your GOOD selects.

### Star Ratings (`Ctrl+1` through `Ctrl+5`)

Assign a 1-5 star rating independent of the BAD/OK/GOOD sort. The stars display as ★★★★★ on the image. Press the same number again to clear.

### Compare Mode (`C`)

Toggle side-by-side comparison with the previous image. Zoom and pan are synchronized between the two views — ideal for picking the best of near-identical shots.

### EXIF Overlay (`I`)

Press `I` to overlay camera settings on the current image:

> 1/200s  f/2.8  ISO 400  50mm  
> Canon EOS R5  RF 24-70mm f/2.8L

All EXIF data is extracted on import and cached in the database.

### Delete (`Del`)

Permanently delete a photo. A confirmation dialog prevents accidents. The image is removed from disk and the database.

### Rotate (`R` / `Shift+R`)

Rotate right (`R`) or left (`Shift+R`) by 90 degrees. Rotation is saved to the database and restored when you reopen the folder.

---

## 4. Zoom & View

| Shortcut | Action |
|----------|--------|
| `Ctrl++` | Zoom in |
| `Ctrl+-` | Zoom out |
| `Ctrl+0` | Fit to window |
| Mouse wheel | Zoom (centered on cursor) |
| Drag | Pan while zoomed |
| `F` | Toggle fullscreen |
| `H` | Toggle on-screen shortcut guide |

---

## 5. Library Management (Side Panel)

The side panel provides three tools for filtering and browsing:

### Folder Browser
A tree view of the current folder's subdirectories. Click any subfolder to filter the image list to only show files from that location.

### Search Bar
Type text to filter images by filename, camera model, or lens. Combine with the dropdown filter:

| Filter | Shows |
|--------|-------|
| All | All images |
| Unrated | Only images without a rating |
| Picked | Only flagged (★) images |
| BAD | Only BAD-rated images |
| OK | Only OK-rated images |
| GOOD | Only GOOD-rated images |

### Date Browser
A year → month → day hierarchy. Click a date to show photos taken that day. Data comes from EXIF `DateTimeOriginal`.

### Stats Cards
At the top of the side panel you'll see counters:

- **PICKED** — number of flagged images
- **● BAD** — red count
- **● OK** — yellow count
- **● GOOD** — green count

---

## 6. Export

When you're done sorting, press `Enter`. The app creates three subfolders inside your source folder:

```
your-folder/
├── BAD/
│   └── IMG_0001.jpg
├── OK/
│   └── IMG_0002.jpg
└── GOOD/
    └── IMG_0003.jpg
```

Subfolder structure is preserved: a photo at `Shoot/Day1/IMG_001.jpg` becomes `GOOD/Shoot/Day1/IMG_001.jpg`.

### Restore

Each export creates a `.photosorter_checkpoint.json` file. The next time you open the folder, a **Restore** button appears in the menu. Click it to reverse the export and return all files to their original locations.

---

## 7. Gamepad

Connect an Xbox or PlayStation controller for sofa culling:

| Button | Action |
|--------|--------|
| A | GOOD |
| X | OK |
| B | BAD |
| LB / RB | Prev / Next |
| L-Stick | Pan |
| R-Stick | Zoom |
| LT / RT | Rotate |
| Start | Export |
| Select | Back to menu |

---

## 8. Closing & Continuing

All ratings, picks, stars, rotations, and EXIF data are saved to a SQLite database in `~/.photosorter/dbs/`. Re-open the same folder later and everything is restored instantly.

### Recent Projects

The main menu shows your 10 most recently opened folders. Click any to jump back in.

---

## Tips

- **Fast mode**: Hold `1`/`2`/`3` down to rapid-rate through a burst sequence.
- **Unrated filter** (`U`): Skip already-rated images to focus on the remaining decisions.
- **Filmstrip**: The thumbnail strip at the bottom shows all images; rated ones show a colored border.
- **Export markers**: After export, rated images get `_G`, `_OK`, or `_B` appended to their filenames for easy identification in other tools.
