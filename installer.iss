#define MyAppName "Stellaris Mod Manager"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "StellarisModManager"
#define MyAppExeName "StellarisModManager.exe"

#ifndef SourceDir
  #define SourceDir "Output\\StellarisModManager"
#endif

#ifndef SetupOutputDir
  #define SetupOutputDir "Output\\Installer"
#endif

[Setup]
AppId={{F8A45C0A-7C66-4C03-A9ED-8A2E2D0F04D3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir={#SetupOutputDir}
OutputBaseFilename=StellarisModManager-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"
Name: "{autodesktop}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
