# Development Guide

## Prerequisites

- Python 3.9+
- [Poetry](https://python-poetry.org/) or `pip`

## Setup

```bash
git clone <repo-url>
cd photo-sorter
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
```

For development extras:

```bash
pip install -e ".[dev]"
```

## Running Tests

The test suite covers database, EXIF formatting, caching, project management, and worker task cancellation:

```bash
python -m pytest tests/ -v
```

Run a specific test file:

```bash
python -m pytest tests/test_database.py -v
```

Run tests with coverage (install `pytest-cov` first):

```bash
python -m pytest tests/ --cov=photosorter --cov-report=term-missing
```

## Linting

We use [Ruff](https://docs.astral.sh/ruff/) for linting and formatting:

```bash
ruff check .        # Check for issues
ruff format .       # Auto-format code
```

Configuration is in `pyproject.toml` under `[tool.ruff]`.

## Project Structure

```
photo-sorter/
├── photosorter/          # Main package
│   ├── main.py           # Application window & event handlers
│   ├── database.py       # SQLite persistence layer
│   ├── project.py        # Project/folder management
│   ├── ui.py             # PhotoViewer, Filmstrip, ZoomController
│   ├── widgets.py        # FolderBrowser, SearchBar, DateBrowser
│   ├── workers.py        # Thread pool tasks (image/thumbnail/gamepad)
│   ├── exif.py           # EXIF extraction & formatting
│   ├── utils.py          # Cache, file ops, platform detection
│   └── logging_setup.py  # Rotating file logger & crash handler
├── tests/                # pytest test suite
│   ├── test_database.py  # 18 tests
│   ├── test_exif.py      # 8 tests
│   ├── test_utils.py     # 9 tests
│   ├── test_project.py   # 2 tests
│   └── test_workers.py   # 3 tests
├── assets/screenshots/   # Screenshots for documentation
├── docs/                 # Documentation
│   ├── architecture.md
│   ├── walkthrough.md
│   ├── keyboard_shortcuts.md
│   ├── installation.md
│   ├── development.md
│   └── id/               # Indonesian translations
├── scripts/              # Helper scripts (install, run)
├── packaging/            # PyInstaller spec, Inno Setup
├── pyproject.toml        # Project & tool config
└── requirements.txt      # Dependencies
```

## Building Standalone Executable

### Windows

```bash
python packaging/build_windows.py
```

The output is placed in `dist/PhotoSorter/`. To create an installer:

1. Open `packaging/photo_sorter_setup.iss` with Inno Setup.
2. Compile to produce a `.exe` installer.

### Cross-platform

A PyInstaller spec is provided in `packaging/photo_sorter.spec`:

```bash
pyinstaller packaging/photo_sorter.spec
```

## Continuous Integration

GitHub Actions runs on every push/PR to `main`:

- **Lint**: Ruff check on Windows, macOS, Linux
- **Test**: pytest on 3 OS × 4 Python versions (3.9, 3.10, 3.11, 3.12)
- **Build**: PyInstaller on all 3 platforms

The workflow is defined in `.github/workflows/ci.yml`.

## Adding a New Database Migration

The database uses a simple version table. To add new columns:

1. Update `CREATE_IMAGES_TABLE` in `database.py` with the new column.
2. Add an `ALTER TABLE` migration in `PhotoDatabase._migrate_schema()`.
3. Add tests in `test_database.py`.
4. Run the existing test suite to confirm backward compatibility.
