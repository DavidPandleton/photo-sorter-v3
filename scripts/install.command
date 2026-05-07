#!/bin/bash
cd "$(dirname "$0")"

echo "========================================"
echo "  PHOTO SORTER V1 - macOS INSTALLER"
echo "========================================"

# 1. Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 not found!"
    echo "Please install Python 3.9+ or use Homebrew: brew install python"
    exit 1
fi

# 2. Setup Venv
if [ ! -d "venv" ]; then
    echo "--> Creating virtual environment..."
    python3 -m venv venv
fi

# 3. Install
echo "--> Installing dependencies..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "========================================"
echo "  INSTALLATION COMPLETE!"
echo "========================================"
echo "You can now launch the app using 'run.command'"
