#!/usr/bin/env bash

# Photo Sorter V3 — Dev Setup & Dependency Diagnostic Tool (macOS / Linux)
# This script diagnoses and configures the environment to compile the Rust + Tauri v3 application.

# Colors
CYAN='\033[0;36m'
GRAY='\033[0;37m'
DARK_GRAY='\033[1;30m'
WHITE='\033[1;37m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0;37m' # No Color

clear

echo -e "${CYAN}================================================================================${NC}"
echo -e "${CYAN}             PHOTO SORTER V3 — DEVELOPMENT SETUP & DIAGNOSTIC                   ${NC}"
echo -e "${CYAN}================================================================================${NC}"
echo -e "${DARK_GRAY}Checking system dependencies to build the Rust/Tauri v3 binary...${NC}"
echo ""

all_passed=true
pkg_manager="none"

show_status_row() {
    local name=$1
    local status=$2
    local version=$3
    local color=$4
    
    # Format pads
    printf "  * %-25s [" "${name}"
    echo -ne "${color}${status}${NC}"
    printf "] "
    if [ -n "$version" ]; then
        echo -e "${DARK_GRAY}(${version})${NC}"
    else
        echo ""
    fi
}

# 1. Detect OS
OS_TYPE="unknown"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS_TYPE="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS_TYPE="macos"
fi

# 2. Check Rust
if command -v rustc &> /dev/null && command -v cargo &> /dev/null; then
    rust_ver=$(rustc --version | awk '{print $2}')
    show_status_row "Rust / Cargo" "Installed" "$rust_ver" "$GREEN"
else
    show_status_row "Rust / Cargo" "Missing" "Install via https://rustup.rs" "$RED"
    all_passed=false
fi

# 3. Check Bun/Node/NPM
if command -v bun &> /dev/null; then
    bun_ver=$(bun --version)
    show_status_row "Package Manager" "Installed" "Bun $bun_ver" "$GREEN"
    pkg_manager="bun"
elif command -v npm &> /dev/null && command -v node &> /dev/null; then
    node_ver=$(node --version)
    npm_ver=$(npm --version)
    show_status_row "Package Manager" "Installed" "Node $node_ver / NPM $npm_ver" "$GREEN"
    pkg_manager="npm"
else
    show_status_row "Package Manager" "Missing" "Install Bun or Node.js" "$RED"
    all_passed=false
fi

# 4. Check Compilers & System Libraries
if [[ "$OS_TYPE" == "macos" ]]; then
    # macOS compilation checks
    if command -v clang &> /dev/null && xcode-select -p &> /dev/null; then
        clang_ver=$(clang --version | head -n 1 | awk '{print $4}')
        show_status_row "Xcode Compiler Tools" "Installed" "Clang $clang_ver" "$GREEN"
    else
        show_status_row "Xcode Compiler Tools" "Missing" "Run 'xcode-select --install'" "$RED"
        all_passed=false
    fi
elif [[ "$OS_TYPE" == "linux" ]]; then
    # Linux compilation checks
    if command -v gcc &> /dev/null; then
        gcc_ver=$(gcc -dumpversion)
        show_status_row "GCC Compiler" "Installed" "$gcc_ver" "$GREEN"
    else
        show_status_row "GCC Compiler" "Missing" "Install build-essential" "$RED"
        all_passed=false
    fi
    
    # Check Webkit2gtk on Linux (approximate check using pkg-config)
    if command -v pkg-config &> /dev/null; then
        if pkg-config --exists webkit2gtk-4.1; then
            show_status_row "WebKit2GTK dev libs" "Installed" "webkit2gtk-4.1" "$GREEN"
        elif pkg-config --exists webkit2gtk-4.0; then
            show_status_row "WebKit2GTK dev libs" "Installed" "webkit2gtk-4.0" "$GREEN"
        else
            show_status_row "WebKit2GTK dev libs" "Missing" "Required for Tauri compilation" "$RED"
            all_passed=false
        fi
    else
        show_status_row "WebKit2GTK dev libs" "Unknown" "pkg-config missing" "$YELLOW"
    fi
else
    show_status_row "OS Compiler Tools" "Unknown" "Unsupported platform: $OSTYPE" "$YELLOW"
fi

echo ""

if [ "$all_passed" = true ]; then
    echo -e "${GREEN}\033[1m✅ ENVIRONMENT IS READY TO COMPILE!${NC}"
    echo -e "${GRAY}All core prerequisites are satisfied.${NC}"
    echo ""
    
    if [ "$pkg_manager" != "none" ]; then
        read -p "Do you want to run package installation ($pkg_manager install) now? (y/n) " ans
        if [[ "$ans" =~ ^[Yy]$ || "$ans" == "yes" ]]; then
            echo -e "${CYAN}Running dependencies installation...${NC}"
            if [ "$pkg_manager" = "bun" ]; then
                bun install
            else
                npm install
            fi
            echo -e "${GREEN}Dependencies successfully installed!${NC}"
        fi
    fi
    
    echo ""
    echo -e "${GRAY}To launch in development mode, run:${NC}"
    echo -e "  ${CYAN}bun run tauri dev${NC}"
    echo ""
    echo -e "${GRAY}To compile a production build installer, run:${NC}"
    echo -e "  ${CYAN}bun run tauri build${NC}"
else
    echo -e "${YELLOW}⚠️  SOME DEPENDENCIES ARE MISSING OR NOT CONFIGURED.${NC}"
    echo -e "${GRAY}Please follow the prerequisites guide to set up the compile environment.${NC}"
    echo -e "Check details in ${BLUE}./docs/installation.md${NC}"
fi

echo ""
