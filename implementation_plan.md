# Porting Photo Sorter to Rust (Tauri + Vite + TypeScript)

The goal of this project (v3) is to completely port the existing Python (PySide6) photo-culling application into a high-performance, lightweight, and stable **Rust** application using the **Tauri v2** framework. 

By migrating to Rust + Tauri, we will achieve:
1. **Unmatched Performance:** Decoupled multi-threaded image loading, RAW parsing, focus score calculation, and database synchronization in native Rust.
2. **Minimal Resource Usage:** Very low RAM overhead, eliminating the need for a Python interpreter and massive Qt libraries, compiling down to a single compact binary (<15MB).
3. **Stunning & Responsive UI:** An elegant, GPU-accelerated HTML/CSS/JS/TS frontend with fluid glassmorphism, responsive sidebar widgets, canvas-based zoom & pan viewer, and high-performance scrolling.
4. **Platform Native Integration:** Robust filesystem watches, local SQLite storage, system-native file trash, and low-latency input handling.

---

## User Review Required

We have carefully analyzed the existing Python codebase. Before initiating the port, we have designed a state-of-the-art architecture using standard Tauri conventions. 

> [!IMPORTANT]
> **Suggested Framework Stack:**
> We strongly recommend **Tauri v2 + Vite + TypeScript + Vanilla CSS** (keeps it ultra-light while keeping strict types matching our Rust backend).
> * **Backend:** Rust, using `rusqlite` for caching, `kamadak-exif` for EXIF extraction, `image` + RAW parsing crates for decoding, and `trash` for undo-able deletes.
> * **Frontend:** Vite-powered HTML5 Canvas for the PhotoViewer (extremely fast zoom/pan), coupled with a modern CSS Grid/Flexbox UI implementing dark mode, gold/amber star overlays, and glassmorphic HUD.
> 
> Please let us know if you have any constraints or if you prefer a specific UI framework (e.g., React, Svelte) instead of vanilla JS.

---

## Open Questions

> [!WARNING]
> **1. RAW Image Decoding Crate**
> In the Python code, `rawpy` (LibRaw wrapper) is used. In Rust, we have a few options:
> - **`libraw-rs` / `libraw-sys`:** Binds directly to native `LibRaw` (equivalent to rawpy). Requires native compiler tools to build.
> - **`rawloader`:** A pure Rust RAW reader, but supports a slightly smaller set of cameras compared to LibRaw.
> *Recommendation:* We propose starting with native `libraw-rs` bindings or extracting embedded JPEG previews from RAW files (which is extremely fast and how professional culling tools like Photo Mechanic achieve speed).
> 
> **2. Gamepad Input Support**
> Python v2 supports Xbox controllers via `inputs`. Do you still require Gamepad support in v3? 
> *Recommendation:* If yes, we can implement it natively in Rust using the `gilrs` crate. We suggest prioritizing the core keyboard/mouse workflow first, then adding gamepad as a secondary phase.

---

## Proposed Changes

We will restructure the application into a standard Tauri workspace. The backend will live in `src-tauri` and the frontend in `src`.

### Backend (Rust / `src-tauri`)

The Rust backend will handle database caching, EXIF parsing, image decoding, and culling state.

#### [NEW] [Cargo.toml](file:///c:/Users/fatamorgana/Documents/photo-sorter-v3/src-tauri/Cargo.toml)
Defines project metadata and dependencies:
- `tauri` & `tauri-build` (v2)
- `rusqlite` (with `bundled` feature for zero-dependency SQLite compilation)
- `kamadak-exif` (efficient metadata parsing)
- `image` (fast JPEG/PNG/WebP decoding)
- `rawloader` / `libraw-rs` (RAW file parsing)
- `rayon` (data-parallelism for blur/focus calculations)
- `trash` (native trash folder integration)
- `serde` & `serde_json` (state serializing/checkpoints)

#### [NEW] [main.rs](file:///c:/Users/fatamorgana/Documents/photo-sorter-v3/src-tauri/src/main.rs)
The application entry point. Sets up the Tauri application builder, custom asset protocols (for serving local images securely and fast), and wires up Tauri Command handlers.

#### [NEW] [database.rs](file:///c:/Users/fatamorgana/Documents/photo-sorter-v3/src-tauri/src/database.rs)
Direct port of `database.py`. Manages SQLite tables: `schema_version`, `projects`, `images`, `thumbnail_cache`. Supports WAL mode and handles background image synchronization, metadata storage, and rating states.

#### [NEW] [exif.rs](file:///c:/Users/fatamorgana/Documents/photo-sorter-v3/src-tauri/src/exif.rs)
Extracts camera model, ISO, aperture, shutter speed, focal length, lens, and date taken from JPEG and RAW formats.

#### [NEW] [image_loader.rs](file:///c:/Users/fatamorgana/Documents/photo-sorter-v3/src-tauri/src/image_loader.rs)
Manages asynchronous loading of full-size and viewport-scaled images. Implements:
- Focus score calculation (efficient subsampled Laplacian variance in Rust, utilizing `image` and `rayon` for speed).
- Thumbnail generation and caching (saving JPEG blobs directly into SQLite).

#### [NEW] [state.rs](file:///c:/Users/fatamorgana/Documents/photo-sorter-v3/src-tauri/src/state.rs)
Port of `controller.py`. Manages `AppState` struct (thread-safe behind Tauri State):
- Current directory, image list, current index, filters, and undo stack.
- Checkpoint generation (`.photosorter_checkpoint.json`) and restoration.

---

### Frontend (HTML/JS/CSS / `src`)

The frontend will be built as a responsive single-page web app styled with premium, dark-mode glassmorphic aesthetics.

#### [NEW] [index.html](file:///c:/Users/fatamorgana/Documents/photo-sorter-v3/src/index.html)
Main application shell. Layout sections:
1. **Sidebar:** Search, Folder tree browser, Date tree browser, Image Info card, and Controls HUD.
2. **Viewport Viewer:** Canvas-based high-performance viewer supporting zoom, pan, split-screen comparison mode, and quick ratings flash overlays.
3. **Filmstrip:** Horizontal scrolling thumbnail strip with rating ribbons, gold star rating overlays, and focus score indicators.

#### [NEW] [style.css](file:///c:/Users/fatamorgana/Documents/photo-sorter-v3/src/style.css)
Core styling implementing rich dark aesthetics:
- Harmonious palette: Deep slates `#0d0d0d`, vibrant teal accents `#2dd4bf`, gold rating stars `#ffab40`, OK status `#f59e0b`, BAD status `#ef4444`, GOOD status `#10b981`.
- Glassmorphic panels with backdrop blurs (`backdrop-filter: blur(12px)`).
- Custom high-fidelity animations for state transitions, rating selections, and thumbnail selection borders.

#### [NEW] [viewer.ts](file:///c:/Users/fatamorgana/Documents/photo-sorter-v3/src/viewer.ts)
High-performance HTML5 Canvas implementation of the PhotoViewer in TypeScript. Manages:
- Sub-pixel precise canvas drawing with smooth transforms.
- Coordinate-anchored mouse scroll and pinch-to-zoom gestures.
- Fast panning via click-and-drag.
- Side-by-side split screen for Compare Mode.

#### [NEW] [app.ts](file:///c:/Users/fatamorgana/Documents/photo-sorter-v3/src/app.ts)
Manages event handling, keystroke capture (matching v2 bindings: `1`-`3` ratings, `Space` flag, `C` compare, `N`/`P` navigate, `Del delete, Ctrl+Z undo), and calls Rust backend commands via `@tauri-apps/api`.

---

## Verification Plan

We will systematically verify each component to ensure parity with the v2 Python test suite.

### Automated Tests
- **Rust Unit Tests:** Write `cargo test` modules in `database.rs`, `exif.rs`, and `image_loader.rs` to verify correct SQLite queries, EXIF reading, and focus score calculations.
- **Tauri Mock Testing:** Test command handlers using Tauri's test suites.

### Manual Verification
- **Aesthetic Validation:** Launch the application in dev mode (`npm run tauri dev`), check backdrop filters, layout stability under resize, and responsive layouts.
- **Gesture and Zoom Testing:** Verify mouse wheel and trackpad pinch gestures achieve smooth zoom centering.
- **Workflow Culling Test:** Load a folder of 100+ images (including RAW formats), execute ratings, toggle compare mode, test undo stack, and verify export checkpoint generation.
