# Changelog

All notable changes to Photo Sorter V3 are documented here. Release
bodies are generated from the section matching the git tag.

## v3.2.0

The de-slop release: two-agent audit of every line, 24 tracked bugs fixed.

- **Performance**: raw-byte IPC (no more JSON number arrays for image data),
  dedicated DB connection for the thumbnail batch (UI never queues behind
  folder indexing), single async EXIF path.
- **Safety**: real SHA1 integrity checks on export/restore checkpoints,
  export never clobbers an existing file, restore refuses tampered files,
  failed trash is reported honestly (no silent permanent delete).
- **Data**: SQLite is the single source of truth for ratings/rotation/pick
  (removed three drifting in-memory caches); versioned schema migration to
  v5; dead `hud_widgets` feature and never-written columns dropped.
- **Errors**: typed `AppError` across the backend; silent `.catch(() => {})`
  in the UI replaced with visible toasts.
- **Frontend**: `app.ts` god class split into modules; native confirm/prompt
  replaced with in-app dialogs plus keyboard modal guard; Windows folder
  tree fix; debounced search; user input HTML-escaped.
- **Gamepad**: Web API path only; the never-listened-to Rust gilrs event
  loop is gone.
- **Tooling**: npm everywhere (bun removed), CSP enabled, self-hosted fonts,
  Tauri 2.11 stable, CI runs Rust + frontend test suites, release notes are
  generated from this file.
- **Tests**: 38 Rust + 22 frontend tests (was: 9).

## v3.1.0

- **JPG performance**: Fast-path dimension check skips full decode for small images
- **Cross-platform**: Proper Cmd/Ctrl key handling on macOS, trash fallback, CI builds for all platforms
- **RAW handling**: Optimized preview extraction for non-RAW files
- **Info panel**: EXIF data, filename, dimensions
- **UI**: Better HUD, settings persistence, toast positions
