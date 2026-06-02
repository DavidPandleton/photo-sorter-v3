# Checkpoint & Export System

The checkpoint system is designed to be atomic and crash-safe, ensuring that your photo organization process is 100% reversible.

## Checkpoint Schema (v2.0)

The state is stored as a JSON file (`.photosorter_checkpoint.json`) in the root of the project folder.

### Data Structure
```json
{
  "version": "2.0",
  "root": "/path/to/project",
  "created_at": "ISO-TIMESTAMP",
  "created_folders": ["BAD", "OK", "GOOD/Subfolder"],
  "operations": [
    {
      "original_path": "/path/to/image.jpg",
      "exported_path": "/path/to/BAD/image.jpg",
      "category": "BAD",
      "status": "completed",
      "size": 102456,
      "sha1": "da39a3ee5e6b4b0d3255bfef95601890afd80709"
    }
  ]
}
```

### Safety Features
- **Atomic Writes**: Data is written to a `.tmp` file and then swapped (`os.replace`) to ensure the file is never left in a corrupted state.
- **Integrity Checks**: SHA1 hashes and file sizes are used to validate files during the restoration process.

## Export Pipeline (Option A)

The export pipeline preserves the original directory structure to ensure it is 100% reversible and avoids filename collisions.

- **Relative Mapping**: Uses `pathlib.Path.relative_to(root)` to calculate the destination sub-path.
- **Recursive Directory Creation**: Automatically generates nested subfolders inside the category buckets (`/BAD`, `/OK`, `/GOOD`) as needed.
- **Safe Move**: Implements a cross-filesystem move logic that falls back to `copy2` + `os.remove` if a simple rename fails (common on Linux/Unix partitions).
