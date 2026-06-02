# Developer Guide (v3)

This guide documents the software architecture, design guidelines, code organization, testing protocols, and build pipelines for developers contributing to **Photo Sorter v3**.

---

## 🏗️ System Architecture

Photo Sorter v3 splits the workload between a compiled Rust backend and an asynchronous Vite + TypeScript frontend, communicating via Tauri v2's high-speed IPC (Inter-Process Communication) layer.

```
                  ┌──────────────────────────────────────────────┐
                  │                 Tauri Shell                  │
                  └──────────────────────────────────────────────┘
                       ▲                                    ▲
                       │ IPC Invokes                        │ Events (Gamepad/EXIF)
                       ▼                                    ▼
       ┌───────────────────────────────┐    ┌───────────────────────────────┐
       │   Vite + TypeScript UI        │    │    Rust Backend Engine        │
       │                               │    │                               │
       │ - PhotoViewer (Canvas 2D)     │    │ - AppState Manager (Mutex)    │
       │ - FilmstripBuilder            │    │ - SQLite Database (rusqlite)  │
       │ - ImageCacheManager (LRU)     │    │ - RAW Image Decoder (Tiff)    │
       │ - GamepadHandler              │    │ - Focus Score Meter (Rayon)   │
       └───────────────────────────────┘    └───────────────────────────────┘
```

---

## 📁 Repository Structure

```
photo-sorter-v3/
├── src-tauri/                 # 🦀 Rust Backend
│   ├── src/
│   │   ├── main.rs            # Tauri IPC command registrations & plugins setup
│   │   ├── lib.rs             # Module definitions
│   │   ├── database.rs        # SQLite schema migrations, queries, and writes
│   │   ├── exif.rs            # metadata extractor (using kamadak-exif)
│   │   ├── image_loader.rs    # RAW preview extraction, focus scores, and decoding
│   │   ├── state.rs           # Thread-safe global AppState fields accessors
│   │   ├── filter.rs          # Image filter engine logic (text, folder, date, rating)
│   │   ├── undo.rs            # Stack-based culling actions undo manager
│   │   └── export.rs          # finish_sorting safe moves & checkpoints logic
│   ├── Cargo.toml             # Rust dependencies, features, and settings
│   └── tauri.conf.json        # Tauri windowing, permissions, and build settings
├── src/                       # ⚡ TypeScript Frontend
│   ├── app.ts                 # Main orchestrator, dynamic keyboard, sidebar UI
│   ├── filmstrip.ts           # Horizontal thumbnail scrollbar widget builder
│   ├── cache.ts               # Memory-bounded LRU image caches manager
│   ├── gamepad.ts             # Stick/trigger controller input listener
│   ├── viewer.ts              # HTML5 Canvas 2D precision zoom, pan, and split-screen
│   ├── constants.ts           # Global thresholds, cache sizes, extension checks
│   └── style.css              # Premium dark glassmorphic styling
├── index.html                 # Main interface markup & settings overlay shell
├── setup.ps1 / setup.sh       # Developer setup and environmental diagnostic scripts
├── pyproject.toml             # Legacy/comparison v2 files metadata (ignore)
└── package.json               # Node/Bun script triggers and dependencies
```

---

## 🧪 Testing & Validation

We maintain strict test-driven development practices. All core database queries and structural migrations must be validated via Rust's native testing framework.

### Running Rust Backend Unit Tests
To execute the complete database, rating, flagging, unrating, and deletion unit tests:
```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

### Running Frontend Type Checks
To verify that the TypeScript compiler produces clean types with zero unused imports or variable mismatches:
```bash
bun run build
# or: tsc --noEmit
```

---

## 🧹 Code Quality & Linting

Before pushing commits to the remote branch, compile checks and style guides must be validated.

### 🦀 Rust Linting (Clippy)
Ensure the Rust backend maintains idiomatically clean code without dead warnings:
```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

### ⚡ JavaScript/TypeScript Format
Ensure the web assets maintain styling and code formatting rules:
```bash
bun run build
```

---

## 🎮 Gamepad Integrations

Tauri compiles with an optional conditional feature flag for gamepad support, drawing input events from the `gilrs` native framework.

- Gamepad code is located in `src-tauri/src/gamepad.rs` and `src/gamepad.ts`.
- It registers an asynchronous system thread during app startup to poll connected hardware.
- It translates analog joystick vectors to sub-pixel canvas offsets for panning, and trigger values to exponential zoom scales.

---

## 🖼️ Frontend: Filmstrip Virtual Scrolling

`src/filmstrip.ts` implements **virtual scrolling** for performance with large collections:

- DOM elements created for ALL images (fast, no thumbnail data loaded)
- Only visible items (viewport + 4 buffer) trigger `invoke('get_thumbnail_data')`
- Scroll event listener loads thumbnails on-demand as user scrolls
- Concurrency limited to 8 workers via internal task queue
- `loadedIndices: Set<number>` prevents redundant loads

---

## 🦀 Backend: Rust Image Cache

`src-tauri/src/state.rs` contains `ImageCache` — an in-memory LRU cache for decoded image bytes:

- **30 slots** for scaled (1920px) images, **10 slots** for full-resolution
- LRU eviction via `HashMap<String, Vec<u8>>` + `VecDeque<String>` order tracking
- `get_image_data` and `get_full_image_data` check cache before decoding RAW
- Second navigation to same image: <1ms instead of 200-500ms RAW decode
- Cache cleared on `reset()` (new folder open)
