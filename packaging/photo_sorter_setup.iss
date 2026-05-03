; Photo Sorter V1 Inno Setup Script
; This script creates a professional Windows installer.

[Setup]
AppName=Photo Sorter V1
AppVersion=1.0.0
DefaultDirName={autopf}\Photo Sorter V1
DefaultGroupName=Photo Sorter V1
OutputDir=..\dist
OutputBaseFilename=PhotoSorter_Setup
SetupIconFile=..\assets\icon.ico
Compression=lzma
SolidCompression=yes
PrivilegesRequired=lowest

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Source the entire dist folder created by build_windows.py
Source: "..\dist\PhotoSorter\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Photo Sorter V1"; Filename: "{app}\PhotoSorter.exe"
Name: "{autodesktop}\Photo Sorter V1"; Filename: "{app}\PhotoSorter.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\PhotoSorter.exe"; Description: "{cm:LaunchProgram,Photo Sorter V1}"; Flags: nowait postinstall skipifsilent
