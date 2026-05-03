# Photo Sorter V1: Feature Tour

Welcome to the guided walkthrough of Photo Sorter V1. This document highlights the core features and design philosophy that make this the fastest culling tool for photographers.

---

## 🖥️ Application Interface

Photo Sorter V1 is designed with a "Photo-Hero" philosophy. The UI is minimal to keep your focus entirely on the image quality and composition.

![Application Preview](../assets/screenshots/ui_preview.png)

### Key UI Elements
- **Stage**: The central viewing area with high-performance rendering.
- **Rating Overlay**: A subtle, semi-transparent color flash (Red, Yellow, Green) appears when you rate an image, providing instant visual feedback.
- **Stats Bar**: A quiet indicator at the bottom showing your progress (e.g., "12/500 | 5 GOOD, 2 OK, 1 BAD").

---

## 🎨 Professional Branding

The application features a premium, custom-designed identity.

<p align="center">
  <img src="../assets/icon.png" alt="App Icon" width="200">
</p>

---

## 🚀 Performance Engineering

- **Background Decoding**: While you look at the current photo, the next 3 images are already being decoded in the background.
- **Memory-Bounded LRU Cache**: The app intelligently caches high-resolution pixmaps but respects a strict 1GB memory budget to ensure your OS stays responsive.
- **RAW Pipeline**: Optimized fallback logic (Embedded Thumbnail -> Half-size -> Full) ensures you can cull professional RAW files at the same speed as JPEGs.

---

## 🛡️ The Checkpoint System

Safety is built-in. Every time you finalize an export, the app creates a `.photosorter_checkpoint.json` file.
- **Reversible Actions**: If you accidentally export to the wrong folder, the "Restore" button will atomically move every file back to its exact original location.
- **Hierarchy Preservation**: The app respects your directory structure. If you sort a file from `Trip/Day1/img.jpg`, it will move to `GOOD/Trip/Day1/img.jpg`.

---

## ⌨️ Unified Controls

Whether you are using a precision trackpad on Windows or a Magic Trackpad on macOS, the zoom and pan experience is normalized.
- **Exponential Zoom**: Predictable, smooth scaling that centers on your cursor.
- **Pinch-to-Zoom**: Native gesture support for a modern, fluid feel.
