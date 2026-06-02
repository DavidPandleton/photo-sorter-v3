# Photo Sorter V3 — Dev Setup & Dependency Diagnostic Tool
# This script diagnoses and configures the environment to compile the Rust + Tauri v3 application.

$ErrorActionPreference = "SilentlyContinue"
Clear-Host

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "             PHOTO SORTER V3 — DEVELOPMENT SETUP & DIAGNOSTIC" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "Checking system dependencies to build the Rust/Tauri v3 binary..." -ForegroundColor DarkGray
Write-Host ""

$diagnostics = @{}
$allPassed = $true

# Helper: Print Status Row
function Show-StatusRow([string]$name, [string]$status, [string]$version, [ConsoleColor]$color) {
    $padName = $name.PadRight(25)
    $padStatus = $status.PadRight(12)
    Write-Host "  * " -NoNewline -ForegroundColor Gray
    Write-Host $padName -NoNewline -ForegroundColor White
    Write-Host " [" -NoNewline -ForegroundColor Gray
    Write-Host $padStatus -NoNewline -ForegroundColor $color
    Write-Host "] " -NoNewline -ForegroundColor Gray
    if ($version) {
        Write-Host "($version)" -ForegroundColor DarkGray
    } else {
        Write-Host ""
    }
}

# Helper: Locate Visual Studio VC++ Tools
function Get-VCTools {
    $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vsWhere) {
        $installPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($installPath) {
            $toolsPath = Join-Path $installPath "VC\Tools\MSVC"
            if (Test-Path $toolsPath) {
                $latestVer = Get-ChildItem $toolsPath | Sort-Object Name -Descending | Select-Object -First 1
                if ($latestVer) {
                    return Join-Path $toolsPath $latestVer.Name
                }
            }
        }
    }
    return $null
}

# Helper: Locate Windows 10/11 SDK
function Get-WinSDK {
    $regPath = "HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots"
    if (Test-Path $regPath) {
        $kitRoot = (Get-ItemProperty $regPath -Name "KitsRoot10" -ErrorAction SilentlyContinue).KitsRoot10
        if ($kitRoot -and (Test-Path (Join-Path $kitRoot "Lib"))) {
            $libPath = Join-Path $kitRoot "Lib"
            $latestVer = Get-ChildItem $libPath | Sort-Object Name -Descending | Select-Object -First 1
            if ($latestVer) {
                return @{ Path = $kitRoot; Version = $latestVer.Name }
            }
        }
    }
    return $null
}

# 1. Check Rust / Cargo
$cargoVer = (cargo --version)
if ($cargoVer -match "cargo (\d+\.\d+\.\d+)") {
    $diagnostics["Rust"] = @{ Status = "Installed"; Ver = $Matches[1]; Color = "Green" }
} else {
    $diagnostics["Rust"] = @{ Status = "Missing"; Ver = "Install via https://rustup.rs"; Color = "Red" }
    $allPassed = $false
}

# 2. Check JavaScript Package Manager (Bun/Node/NPM)
$bunVer = (bun --version)
$nodeVer = (node --version)
$npmVer = (npm --version)

if ($bunVer -match "^(\d+\.\d+\.\d+)") {
    $diagnostics["Package Manager (Bun)"] = @{ Status = "Installed"; Ver = "Bun $bunVer"; Color = "Green" }
    $pkgManager = "bun"
} elseif ($npmVer -match "^(\d+\.\d+\.\d+)") {
    $diagnostics["Package Manager (NPM)"] = @{ Status = "Installed"; Ver = "Node $nodeVer / NPM $npmVer"; Color = "Green" }
    $pkgManager = "npm"
} else {
    $diagnostics["Package Manager"] = @{ Status = "Missing"; Ver = "Bun or Node.js required"; Color = "Red" }
    $pkgManager = "none"
    $allPassed = $false
}

# 3. Check C++ Compiler / Visual Studio Build Tools
$vcToolsPath = Get-VCTools
if ($vcToolsPath) {
    $diagnostics["MSVC Compiler Tools"] = @{ Status = "Installed"; Ver = (Split-Path $vcToolsPath -Leaf); Color = "Green" }
} else {
    # Check if cl.exe is in environment path already
    $clCheck = (cl.exe 2>&1)
    if ($clCheck -match "Microsoft \(R\) C/C\+\+") {
        $diagnostics["MSVC Compiler Tools"] = @{ Status = "Installed"; Ver = "cl.exe in PATH"; Color = "Green" }
    } else {
        $diagnostics["MSVC Compiler Tools"] = @{ Status = "Missing"; Ver = "Install VS Build Tools C++ component"; Color = "Yellow" }
        $allPassed = $false
    }
}

# 4. Check Windows SDK
$winSDK = Get-WinSDK
if ($winSDK) {
    $diagnostics["Windows 10/11 SDK"] = @{ Status = "Installed"; Ver = $winSDK.Version; Color = "Green" }
} else {
    $diagnostics["Windows 10/11 SDK"] = @{ Status = "Missing"; Ver = "Required for C++ build environment"; Color = "Yellow" }
    $allPassed = $false
}

# 5. Check WebView2 Runtime
$wvKey1 = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8ABB-3D58C73B2544}"
$wvKey2 = "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8ABB-3D58C73B2544}"
$wvVer = $null
if (Test-Path $wvKey1) {
    $wvVer = (Get-ItemProperty $wvKey1 -Name "pv" -ErrorAction SilentlyContinue).pv
} elseif (Test-Path $wvKey2) {
    $wvVer = (Get-ItemProperty $wvKey2 -Name "pv" -ErrorAction SilentlyContinue).pv
}
if ($wvVer) {
    $diagnostics["WebView2 Runtime"] = @{ Status = "Installed"; Ver = $wvVer; Color = "Green" }
} else {
    $diagnostics["WebView2 Runtime"] = @{ Status = "Missing"; Ver = "Auto-downloads on first launch or install manually"; Color = "Yellow" }
}

# Render Diagnostic Statuses
Write-Host "Diagnostic Report:" -ForegroundColor White -Bold
foreach ($key in $diagnostics.Keys) {
    $diag = $diagnostics[$key]
    Show-StatusRow $key $diag.Status $diag.Ver $diag.Color
}
Write-Host ""

# Provide Actionable Feedback
if ($allPassed) {
    Write-Host "✅ ENVIRONMENT IS READY TO COMPILE!" -ForegroundColor Green -Bold
    Write-Host "All core prerequisites are satisfied." -ForegroundColor Gray
    Write-Host ""
    
    if ($pkgManager -ne "none") {
        Write-Host "Do you want to run package installation ($pkgManager install) now? (y/n)" -ForegroundColor Yellow -NoNewline
        $ans = Read-Host
        if ($ans -eq "y" -or $ans -eq "yes") {
            Write-Host "Running dependencies installation..." -ForegroundColor Cyan
            if ($pkgManager -eq "bun") {
                bun install
            } else {
                npm install
            }
            Write-Host "Dependencies successfully installed!" -ForegroundColor Green
        }
    }
    
    Write-Host ""
    Write-Host "To launch in development mode, run:" -ForegroundColor Gray
    Write-Host "  bun run tauri dev" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "To compile a production build installer, run:" -ForegroundColor Gray
    Write-Host "  bun run tauri build" -ForegroundColor Cyan
} else {
    Write-Warning "SOME DEPENDENCIES ARE MISSING OR NOT CONFIGURED."
    Write-Host "Please follow the prerequisites guide to set up the compile environment." -ForegroundColor Gray
    Write-Host "Check details in ./docs/installation.md" -ForegroundColor DarkCyan
}
Write-Host ""
