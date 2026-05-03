@echo off
setlocal
title Photo Sorter V1

if not exist "venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found.
    echo Please run 'install.bat' first!
    pause
    exit /b 1
)

echo "--> Launching Photo Sorter V1..."
start "" "venv\Scripts\pythonw.exe" "sorter.py"
