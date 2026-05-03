#!/bin/bash

echo "========================================"
echo "  PHOTO SORTER V1 - Linux INSTALLER"
echo "========================================"

# 1. Distro Detection & System Deps
if command -v apt &> /dev/null; then
    echo "--> Detected Debian/Ubuntu family"
    echo "--> Note: You may need to run: sudo apt install python3-venv libraw-dev"
elif command -v pacman &> /dev/null; then
    echo "--> Detected Arch family"
    echo "--> Note: You may need to run: sudo pacman -S libraw qt6-base"
elif command -v dnf &> /dev/null; then
    echo "--> Detected Fedora family"
    echo "--> Note: You may need to run: sudo dnf install libraw-devel qt6-qtbase"
fi

# 2. Setup Venv
if [ ! -d "venv" ]; then
    echo "--> Creating virtual environment..."
    python3 -m venv venv
fi

# 3. Install
echo "--> Installing dependencies..."
source venv/bin/activate
pip install -r requirements.txt

echo "========================================"
echo "  INSTALLATION COMPLETE!"
echo "========================================"
echo "Run the app using './run.sh'"
