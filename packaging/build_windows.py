import os
import sys
import subprocess
import shutil
from pathlib import Path

def run_command(command, msg=None):
    if msg:
        print(f"--> {msg}")
    print(f"Running: {command}")
    result = subprocess.run(command, shell=True)
    if result.returncode != 0:
        print(f"Error: Command failed with return code {result.returncode}")
        sys.exit(1)

def package():
    # 1. Ensure PyInstaller is installed
    try:
        import PyInstaller
    except ImportError:
        run_command("pip install pyinstaller", "Installing PyInstaller...")

    # 2. Identify rawpy path for binaries
    import rawpy
    rawpy_path = Path(rawpy.__file__).parent
    print(f"Detected rawpy at: {rawpy_path}")
    
    # We need to add the binaries from rawpy directory
    # On Windows, these are .dll files
    binaries = []
    if sys.platform == "win32":
        for dll in rawpy_path.glob("*.dll"):
            binaries.append(f"--add-binary \"{dll}{os.pathsep}rawpy\"")
    elif sys.platform == "darwin":
        for dylib in rawpy_path.glob("*.dylib"):
            binaries.append(f"--add-binary \"{dylib}{os.pathsep}rawpy\"")
    else: # Linux
        for so in rawpy_path.glob("*.so"):
            binaries.append(f"--add-binary \"{so}{os.pathsep}rawpy\"")

    binary_args = " ".join(binaries)

    # 3. Base PyInstaller command
    # Using --onedir for 1:1 performance parity (no unpack delay)
    # Paths relative to project root
    script_path = "sorter.py"
    icon_path = "assets/icon.ico"
    version_path = "packaging/version_info.txt"

    cmd = [
        "python -m PyInstaller",
        "--noconsole",
        "--onedir",
        "--clean",
        "--name PhotoSorter",
        f"--icon {icon_path}" if sys.platform == "win32" and os.path.exists(icon_path) else "",
        f"--version-file {version_path}" if sys.platform == "win32" and os.path.exists(version_path) else "",
        "--add-data photosorter;photosorter" if sys.platform == "win32" else "--add-data photosorter:photosorter",
        binary_args,
        script_path
    ]

    # Filter out empty strings
    cmd = [c for c in cmd if c]
    
    print("Executing PyInstaller...")
    run_command(" ".join(cmd))

    print("\n" + "="*40)
    print("BUILD COMPLETE!")
    print("="*40)
    print(f"Application location: {os.path.abspath('dist/PhotoSorter')}")
    if sys.platform == "win32":
        print(f"Executable: PhotoSorter.exe")
    print("="*40)

if __name__ == "__main__":
    package()
