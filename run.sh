#!/bin/bash

if [ ! -f "venv/bin/python" ]; then
    echo "[ERROR] Virtual environment not found. Run ./install.sh first."
    exit 1
fi

source venv/bin/activate
python sorter.py
