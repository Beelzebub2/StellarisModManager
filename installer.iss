#define MyAppName "Stellaris Mod Manager"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppPublisher "StellarisModManager"
#define MyAppExeName "StellarisModManager.exe"

#ifndef SourceDir
  #define SourceDir "Output\\StellarisModManager"
#endif

#ifndef SetupOutputDir
  #define SetupOutputDir "Output\\Installer"
#endif

#ifndef SetupOutputBase
  #define SetupOutputBase "StellarisModManager-Setup"
#endif

#ifndef SetupIconPath
  #define SetupIconPath "Output\\InstallerAssets\\setup-icon.ico"
#endif

#ifndef WizardImagePath
  #define WizardImagePath "Output\\InstallerAssets\\wizard-banner.bmp"
#endif

#ifndef WizardSmallImagePath
  #define WizardSmallImagePath "Output\\InstallerAssets\\wizard-banner-small.bmp"
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
OutputBaseFilename={#SetupOutputBase}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern dynamic windows11
SetupIconFile={#SetupIconPath}
WizardImageFile={#WizardImagePath}
WizardImageAlphaFormat=defined
WizardImageBackColor=$F0F0F0
WizardSmallImageFile={#WizardSmallImagePath}
WizardSmallImageBackColor=$F0F0F0
#ifdef EnableDarkWizardStyle
WizardImageFileDynamicDark={#WizardImagePath}
WizardImageBackColorDynamicDark=$202020
WizardSmallImageFileDynamicDark={#WizardSmallImagePath}
WizardSmallImageBackColorDynamicDark=$202020
#endif
WizardImageStretch=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; IconFilename: "{app}\\UI\\Assets\\app.ico"
Name: "{autodesktop}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; IconFilename: "{app}\\UI\\Assets\\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
