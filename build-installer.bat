@echo off
setlocal

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Release"

call "%~dp0build.bat" "%CONFIG%"
if errorlevel 1 exit /b %errorlevel%

where iscc >nul 2>nul
if errorlevel 1 (
    echo Inno Setup compiler iscc.exe was not found.
    echo Install Inno Setup, then run this script again to generate Output\Installer\StellarisModManager-Setup.exe.
    exit /b 1
)

iscc /Qp "/DSourceDir=Output\\StellarisModManager" "/DSetupOutputDir=Output\\Installer" "installer.iss"
if errorlevel 1 exit /b %errorlevel%

echo Installer created: Output\Installer\StellarisModManager-Setup.exe
exit /b 0
