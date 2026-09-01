# Changelog

All notable changes to Photo Sorter V3 are documented here. Release
bodies are generated from the section matching the git tag.

## v3.1.0

- **JPG performance**: Fast-path dimension check skips full decode for small images
- **Cross-platform**: Proper Cmd/Ctrl key handling on macOS, trash fallback, CI builds for all platforms
- **RAW handling**: Optimized preview extraction for non-RAW files
- **Info panel**: EXIF data, filename, dimensions
- **UI**: Better HUD, settings persistence, toast positions
