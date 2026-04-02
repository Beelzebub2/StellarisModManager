@echo off
setlocal

pushd "%~dp0"

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Release"

set "APP_VERSION=%~2"
if "%APP_VERSION%"=="" set "APP_VERSION=1.0.0"

call "build.bat" "%CONFIG%" "%APP_VERSION%"
if errorlevel 1 exit /b %errorlevel%

set "ASSETSDIR=Output\InstallerAssets"
set "BANNER_SOURCE=%CD%\UI\Assets\splash-art.png"
set "ICON_SOURCE=%CD%\UI\Assets\icon.jpg"
set "SETUP_ICON=%CD%\%ASSETSDIR%\setup-icon.ico"
set "WIZARD_IMAGE=%CD%\%ASSETSDIR%\wizard-banner.bmp"
set "WIZARD_SMALL_IMAGE=%CD%\%ASSETSDIR%\wizard-banner-small.bmp"
set "ISCC_EXE="

for /f "delims=" %%I in ('where iscc.exe 2^>nul') do (
    if not defined ISCC_EXE set "ISCC_EXE=%%I"
)

if not defined ISCC_EXE if exist "C:\Program Files (x86)\Inno Setup 7\ISCC.exe" set "ISCC_EXE=C:\Program Files (x86)\Inno Setup 7\ISCC.exe"
if not defined ISCC_EXE if exist "C:\Program Files\Inno Setup 7\ISCC.exe" set "ISCC_EXE=C:\Program Files\Inno Setup 7\ISCC.exe"
if not defined ISCC_EXE if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set "ISCC_EXE=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not defined ISCC_EXE if exist "C:\Program Files\Inno Setup 6\ISCC.exe" set "ISCC_EXE=C:\Program Files\Inno Setup 6\ISCC.exe"

if not defined ISCC_EXE (
    echo Inno Setup compiler iscc.exe was not found.
    echo Install Inno Setup or add ISCC.exe to PATH, then run this script again to generate Output\Installer\StellarisModManager-Setup.exe.
    exit /b 1
)

echo Using Inno Setup compiler: %ISCC_EXE%

for %%I in ("%ISCC_EXE%") do set "ISCC_DIR=%%~dpI"
set "ISCC_VERSION=0.0.0"
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "$whatsNew = Join-Path $env:ISCC_DIR 'whatsnew.htm'; if (Test-Path $whatsNew) { $m = [regex]::Match((Get-Content $whatsNew -Raw), '<span class=\"ver\">([0-9]+\.[0-9]+\.[0-9]+)'); if ($m.Success) { $m.Groups[1].Value } else { '0.0.0' } } else { '0.0.0' }"`) do set "ISCC_VERSION=%%V"

set "ENABLE_DARK_WIZARD=0"
for /f %%D in ('powershell -NoProfile -Command "$v = [version]$env:ISCC_VERSION; if ($v -ge [version]'6.6.0') { '1' } else { '0' }"') do set "ENABLE_DARK_WIZARD=%%D"

set "ISCC_DARK_DEFINE="
if "%ENABLE_DARK_WIZARD%"=="1" (
    echo Inno Setup version %ISCC_VERSION% detected. Enabling dark wizard style.
    set "ISCC_DARK_DEFINE=/DEnableDarkWizardStyle"
) else (
    echo Inno Setup version %ISCC_VERSION% detected. Falling back to modern style; dark wizard style requires Inno Setup 6.6.0+.
)

if not exist "%ICON_SOURCE%" (
    echo Icon source file was not found: %ICON_SOURCE%
    popd
    exit /b 1
)

if not exist "%BANNER_SOURCE%" (
    echo Banner source file was not found: %BANNER_SOURCE%
    popd
    exit /b 1
)

if not exist "%ASSETSDIR%" mkdir "%ASSETSDIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; $iconSrc=$env:ICON_SOURCE; $bannerSrc=$env:BANNER_SOURCE; $iconOut=$env:SETUP_ICON; $bannerOut=$env:WIZARD_IMAGE; $smallOut=$env:WIZARD_SMALL_IMAGE; $iconSrcImg=[System.Drawing.Image]::FromFile($iconSrc); $iconBmp=New-Object System.Drawing.Bitmap 256,256; $ig=[System.Drawing.Graphics]::FromImage($iconBmp); $ig.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $ig.DrawImage($iconSrcImg,0,0,256,256); $iconPng=New-Object System.IO.MemoryStream; $iconBmp.Save($iconPng,[System.Drawing.Imaging.ImageFormat]::Png); $iconBytes=$iconPng.ToArray(); $iconFs=[System.IO.File]::Create($iconOut); $bw=New-Object System.IO.BinaryWriter($iconFs); $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$iconBytes.Length); $bw.Write([UInt32]22); $bw.Write($iconBytes); $bw.Dispose(); $iconFs.Dispose(); $iconPng.Dispose(); $ig.Dispose(); $iconBmp.Dispose(); $iconSrcImg.Dispose(); $banner=[System.Drawing.Image]::FromFile($bannerSrc); $mainBmp=New-Object System.Drawing.Bitmap 164,314; $g=[System.Drawing.Graphics]::FromImage($mainBmp); $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $g.DrawImage($banner, 0, 0, 164, 314); $mainBmp.Save($bannerOut, [System.Drawing.Imaging.ImageFormat]::Bmp); $g.Dispose(); $mainBmp.Dispose(); $smallBmp=New-Object System.Drawing.Bitmap 55,55; $g2=[System.Drawing.Graphics]::FromImage($smallBmp); $g2.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $g2.DrawImage($banner, 0, 0, 55, 55); $smallBmp.Save($smallOut, [System.Drawing.Imaging.ImageFormat]::Bmp); $g2.Dispose(); $smallBmp.Dispose(); $banner.Dispose();"
if errorlevel 1 (
    echo Failed to prepare installer icon/banner assets.
    popd
    exit /b 1
)

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "BUILDSTAMP=%%I"
set "SETUP_BASENAME=StellarisModManager-Setup-v%APP_VERSION%-%BUILDSTAMP%"

"%ISCC_EXE%" /Qp "/DSourceDir=Output\\StellarisModManager" "/DSetupOutputDir=Output\\Installer" "/DSetupOutputBase=%SETUP_BASENAME%" "/DMyAppVersion=%APP_VERSION%" "/DSetupIconPath=%SETUP_ICON%" "/DWizardImagePath=%WIZARD_IMAGE%" "/DWizardSmallImagePath=%WIZARD_SMALL_IMAGE%" %ISCC_DARK_DEFINE% "installer.iss"
if errorlevel 1 (
    popd
    exit /b %errorlevel%
)

echo Installer created: Output\Installer\%SETUP_BASENAME%.exe
popd
exit /b 0
