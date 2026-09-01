# Architecture Overview (v3)

Photo Sorter v3 is built on **Tauri v2** with a **Rust** backend and **Vite + TypeScript** frontend. Communication between layers uses Tauri's high-speed IPC.

---

## Core Components

### `AppState` (Rust — `state.rs`)
Thread-safe global state behind a single `Mutex<Inner>` (accessors are the
only way in/out; SQLite is the sole source of truth for ratings/rotations):
- Image paths, current index, filter state
- Undo stack for ctrl+z
- DB connection (Arc-shared)
- **`ImageCache`** — LRU cache for decoded image bytes (30 scaled, 10 full-res)
- Project ID, startup folder
- Errors flow as `AppError` (thiserror), serialized as plain strings over IPC

### Frontend modules (TS — `src/`)
`app.ts` is the orchestrator (PhotoSorterApp: state, navigation, rating,
lifecycle); UI concerns live in dedicated modules:
- `settings.ts` — SettingsModal (categories, keybindings, HUD tabs) behind a
  SettingsHost callback interface
- `browser.ts` — BrowserPanel (folder tree, date hierarchy, panel toggles)
- `keyboard.ts` — pure combo parsing (buildCombo, getActionFromCombo)
- `ui.ts` — pure DOM widgets: toast, dialog/prompt, progress, flash, HUD/stats/
  metadata renderers, color helpers
- `types.ts` — backend record interfaces mirrored from Rust
- `viewer.ts` — canvas renderer; `filmstrip.ts` — virtual scroll; `cache.ts` —
  frontend LRU; `gamepad.ts` — Web Gamepad API polling; `ipc.ts` — raw-bytes
  invoke helpers

### `PhotoViewer` (TS — `viewer.ts`)
HTML5 Canvas 2D renderer:
- Exponential zoom centered on cursor
- Pan via mouse drag / gamepad stick
- Split-screen compare mode (C key)
- EXIF overlay, pick flag, star rating overlays
- Auto-swap to full-res on zoom > 1.5x

### `FilmstripBuilder` (TS — `filmstrip.ts`)
Horizontal scrollbar with virtual scrolling:
- Only loads thumbnails for visible items (~15-20 of N)
- Lazy-loads as user scrolls, concurrency 8 workers
- Rating ribbon, star badge, focus score bar, pick badge

### `ImageCacheManager` (TS — `cache.ts`)
Frontend LRU memory cache for HTMLImageElements:
- Preview cache (limit 15), Full-res cache (limit 5)
- Smart eviction: protects current + compare + preload targets
- Triggered preload for N images ahead

---

## Backend Layer

### `main.rs` — Tauri Commands
Registers all IPC command handlers. Key image commands:
- `get_image_data` → serves from `ImageCache` or decodes RAW → caches result
- `get_full_image_data` → same with full-resolution path
- `get_thumbnail_data` → checks SQLite thumbnail cache, generates on miss

### `database.rs` — SQLite (rusqlite, WAL mode)
Tables:
| Table | Purpose |
|-------|---------|
| `images` | Per-image metadata, rating, EXIF, blur score |
| `projects` | Folder-backed projects |
| `categories` | Dynamic rating categories with folder/shortcut/color |
| `keybindings` | Remappable shortcuts |
| `hud_items` | HUD action visibility & order |
| `thumbnail_cache` | JPEG thumbnail blobs keyed by image_id |

Key: schema versioning, WAL mode, migrations.

### `image_loader.rs` — RAW Decoder
Two strategies:
1. **Embedded JPEG preview** (fast) — extracts camera's embedded preview via TIFF EXIF offsets
2. **Fallback** — full decode via `image` crate

Also computes Laplacian variance blur score.

### `state.rs` — State + Image Cache
- `ImageCache`: LRU cache with `HashMap` + `VecDeque` ordering
- 30 slots for scaled (1920px) images, 10 for full-res
- Cache cleared on `reset()` (new folder open)

---

## Data Flow (Rating Cycle)

```
User press 1/2/3
  → app.ts: rateCurrent()
    → IPC: rate_image (Rust: DB write + undo push)
    → 100ms debounce
    → navigateNext()
      → IPC: get_image_data (Rust: ImageCache hit/miss → RAW decode → cache)
      → IPC: get_image_metadata_info (Rust: DB read)
      → IPC: get_project_stats (Rust: DB aggregate)
      → triggerPreloaders → 5× IPC: get_image_data (background)
```

---

## Performance Optimizations

1. **Virtual Scrolling Filmstrip** — Only renders thumbnails for visible viewport + 4 buffer. 8 concurrent workers.
2. **Rust-side ImageCache** — 30-image LRU cache avoids redundant RAW decode on navigation.
3. **SQLite Thumbnail Cache** — Thumbnails stored as JPEG blobs; generated once, served forever.
4. **Two-Phase Loading** — 1920px preview first (fast), full-res swaps in on zoom > 1.5x.
5. **Frontend LRU Cache** — 15 preview + 5 full-res HTMLImageElements.
