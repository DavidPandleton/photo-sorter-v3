@echo off
setlocal
title Photo Sorter V1 - Installer

echo ========================================
echo   PHOTO SORTER V1 - INSTALLATION
echo ========================================

:: 1. Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found!
    echo Please install Python 3.9+ from https://www.python.org/
    echo IMPORTANT: Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

:: 2. Create Virtual Environment
if not exist "venv" (
    echo "--> Creating virtual environment..."
    python -m venv venv
) else (
    echo "--> Virtual environment already exists."
)

:: 3. Install Dependencies
echo "--> Installing dependencies..."
call venv\Scripts\activate
pip install -r requirements.txt

if %errorlevel% neq 0 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
)

echo ========================================
echo   INSTALLATION COMPLETE!
echo ========================================
echo You can now launch the app using 'run.bat'
echo ========================================
pause
