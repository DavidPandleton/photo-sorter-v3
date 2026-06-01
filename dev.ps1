# Photo Sorter V3 — Dev Environment Setup
$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')

# MSVC Build Tools
$vcTools = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207"
$kit = "C:\Program Files (x86)\Windows Kits\10"
$kitVer = "10.0.26100.0"

$env:LIB = "$vcTools\lib\x64;$kit\Lib\$kitVer\um\x64;$kit\Lib\$kitVer\ucrt\x64"
$env:INCLUDE = "$vcTools\include;$kit\Include\$kitVer\um;$kit\Include\$kitVer\ucrt;$kit\Include\$kitVer\shared"

bunx tauri dev
