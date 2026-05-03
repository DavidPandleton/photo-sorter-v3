#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f "venv/bin/python" ]; then
    echo "[ERROR] Virtual environment not found."
    echo "Please run 'install.command' first!"
    exit 1
fi

echo "--> Launching Photo Sorter V1..."
source venv/bin/activate
python sorter.py
