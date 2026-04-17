; Inno Setup script for Stellaris Mod Manager (Electron build).
;
; Inputs (passed on the ISCC command line with /D):
;   MyAppVersion  - Semver string (e.g. 1.2.0). Required.
;   SourceDir     - Path to the electron-builder "win-unpacked" folder. Required.
;   OutputDir     - Where the installer .exe is written. Required.
;
; Example:
;   iscc /DMyAppVersion=1.2.0 ^
;        /DSourceDir=..\ElectronSpike\release\win-unpacked ^
;        /DOutputDir=..\Output\Installer ^
;        stellaris-mod-manager.iss

#ifndef MyAppVersion
  #error "MyAppVersion must be defined (pass /DMyAppVersion=x.y.z on the ISCC command line)."
#endif

#ifndef SourceDir
  #error "SourceDir must be defined (pass /DSourceDir=path\to\win-unpacked)."
#endif

#ifndef OutputDir
  #error "OutputDir must be defined (pass /DOutputDir=path\to\installer\output)."
#endif

#define MyAppName      "Stellaris Mod Manager"
#define MyAppPublisher "Stellaris Mod Manager"
#define MyAppURL       "https://github.com/Beelzebub/StellarisModManager"
#define MyAppExeName   "Stellaris Mod Manager.exe"

[Setup]
; A stable AppId lets Inno Setup recognize upgrades in place.
AppId={{8F4A2B9C-5E3D-4A1F-9C2D-STELLARISMMGR}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
VersionInfoVersion={#MyAppVersion}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
OutputDir={#OutputDir}
OutputBaseFilename=StellarisModManager-Setup-{#MyAppVersion}
SetupIconFile={#SourceDir}\resources\assets\app.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=force
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
; Pull in the entire electron-builder win-unpacked folder.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Remove any caches the app writes next to itself (user data under %APPDATA% is preserved).
Type: filesandordirs; Name: "{app}"
