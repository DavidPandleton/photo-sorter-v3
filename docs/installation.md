# Installation & Setup Guide (v3)

This guide provides comprehensive instructions for installing and running **Photo Sorter v3** from source. Version 3 is a compiled Rust application leveraging the high-performance Tauri v2 framework.

---

## 💻 System Prerequisites

Before self-compiling the application, you must install the core compilation toolchains for your operating system:

### 🪟 Windows (10 & 11)
1. **Rust Toolchain:** Install via [rustup.rs](https://rustup.rs).
2. **C++ Build Tools:** Install **Visual Studio Build Tools 2022** (or Visual Studio Community). Select the **"Desktop development with C++"** workload during installation.
3. **Package Manager:** Install [Bun](https://bun.sh) (recommended) or [Node.js](https://nodejs.org).
4. **WebView2:** Standard on Windows 11. If on Windows 10, it will auto-install on first run.

### 🍎 macOS (Intel & Apple Silicon)
1. **Rust Toolchain:** Install via [rustup.rs](https://rustup.rs).
2. **Compiler Tools:** Open Terminal and install Xcode Command Line Tools:
   ```bash
   xcode-select --install
   ```
3. **Package Manager:** Install [Bun](https://bun.sh) or [Node.js](https://nodejs.org).

### 🐧 Linux (Debian / Ubuntu)
1. **Rust Toolchain:** Install via [rustup.rs](https://rustup.rs).
2. **System Dependencies:** Install the GTK/WebKit dev headers and standard compilation tools:
   ```bash
   sudo apt update
   sudo apt install -y build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev libgtk-3-dev
   ```
3. **Package Manager:** Install [Bun](https://bun.sh) or [Node.js](https://nodejs.org).

---

## 🛠️ Automated Setup & Diagnostics

To quickly check if your system meets all compilation requirements and install node dependencies, we've provided interactive diagnostic setup scripts:

### On Windows (PowerShell):
```pwsh
.\setup.ps1
```

### On macOS / Linux (Terminal):
```bash
chmod +x ./setup.sh
./setup.sh
```

These scripts will run a complete suite of checks (detecting Rust compiler, Node/Bun packages, OS compiler SDKs, and Webview layers) and optionally fetch the frontend dependencies.

---

## 🚀 Running in Development

Once your environment is validated, you can run the app in live development mode:

1. **Install JavaScript dependencies:**
   ```bash
   bun install   # or: npm install
   ```
2. **Run Tauri hot-reload shell:**
   ```bash
   bun run tauri dev   # or: npm run tauri dev
   ```

*Note: Tauri compiles the Rust backend engine in debug mode, spins up the Vite dev server, and links them through the safe IPC bridge.*

---

## 📦 Bundling Production Installers

To compile a highly optimized release binary and generate standalone platform installers:

```bash
bun run tauri build   # or: npm run tauri build
```

The resulting installers will be placed in the `/src-tauri/target/release/bundle/` folder:
- **Windows:** `.msi` (Wix Installer) and `.exe` (NSIS Installer)
- **macOS:** `.dmg` (Disk Image) and `.app`
- **Linux:** `.AppImage` and `.deb` (Debian Package)

---

## 🎮 Gamepad Controller Build

To compile the application with full gamepad support (PlayStation, Xbox, and generic controllers) using the native Rust `gilrs` framework:

```bash
# Development Mode
bun run tauri dev -- --features gamepad

# Production Installer
bun run tauri build -- --features gamepad
```
