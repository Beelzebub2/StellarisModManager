@echo off
setlocal enabledelayedexpansion

if /I "%~1"=="/?"     goto :usage
if /I "%~1"=="-h"     goto :usage
if /I "%~1"=="--help" goto :usage

set "ROOT=%~dp0"
set "APP_DIR=%ROOT%ElectronSpike"
set "INSTALLER_DIR=%ROOT%installer"
set "OUTPUT_DIR=%ROOT%Output\Installer"
set "UNPACKED_DIR=%APP_DIR%\release\win-unpacked"
set "ISS_FILE=%INSTALLER_DIR%\stellaris-mod-manager.iss"
set "UPDATER_DIR=%ROOT%updater"
set "UPDATER_EXE=%UPDATER_DIR%\target\release\smm-updater.exe"

rem ----- Arg 1: configuration (kept for backwards compatibility; not used by Electron) -----
set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Release"

rem ----- Arg 2: version (required) -----
set "VERSION=%~2"
if "%VERSION%"=="" (
    echo ERROR: A release version must be supplied.
    echo.
    goto :usage_error
)

if not exist "%APP_DIR%\package.json" (
    echo ERROR: ElectronSpike\package.json not found.
    echo Run this script from the repository root.
    exit /b 1
)

if not exist "%ISS_FILE%" (
    echo ERROR: Inno Setup script not found at "%ISS_FILE%".
    exit /b 1
)

echo === Stellaris Mod Manager installer build ===
echo Configuration: %CONFIG%
echo Version:       %VERSION%
echo Repo root:     %ROOT%
echo.

rem ----- 1. Resolve tools -----
where npm >nul 2>nul
if errorlevel 1 (
    echo ERROR: npm was not found in PATH. Install Node.js 18+ and retry.
    exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
    echo ERROR: cargo was not found in PATH. Install Rust 1.79+ ^(https://rustup.rs^) and retry.
    exit /b 1
)

call :find_iscc
if errorlevel 1 (
    echo ERROR: Inno Setup compiler ^(iscc.exe^) was not found.
    echo Install Inno Setup 6 or add its folder to PATH.
    exit /b 1
)
echo Using Inno Setup: "%ISCC%"
echo.

rem ----- 2. Install deps + build + produce unpacked Electron app -----
pushd "%APP_DIR%" >nul

if not exist "node_modules" (
    echo Installing Electron dependencies...
    call npm ci
    if errorlevel 1 (
        echo npm ci failed.
        popd >nul
        exit /b 1
    )
) else (
    echo Reusing existing node_modules.
)

echo.
echo Patching package.json version to %VERSION%...
call npm version "%VERSION%" --no-git-tag-version --allow-same-version
if errorlevel 1 (
    echo npm version failed.
    popd >nul
    exit /b 1
)

echo.
echo Cleaning previous Electron build output...
if exist "release" rmdir /S /Q "release"
if exist "dist"    rmdir /S /Q "dist"

echo.
echo Compiling TypeScript...
call npm run build
if errorlevel 1 (
    echo TypeScript build failed.
    popd >nul
    exit /b 1
)

echo.
echo Packaging Electron app (electron-builder --win dir)...
call npx --no-install electron-builder --win dir
if errorlevel 1 (
    echo electron-builder failed.
    popd >nul
    exit /b 1
)

popd >nul

if not exist "%UNPACKED_DIR%\Stellaris Mod Manager.exe" (
    echo ERROR: Expected unpacked app at "%UNPACKED_DIR%" but the executable is missing.
    echo Contents:
    dir /B "%UNPACKED_DIR%" 2>nul
    exit /b 1
)

rem ----- 2b. Build the native updater companion -----
pushd "%UPDATER_DIR%" >nul
echo Building smm-updater (release)...
call cargo build --release
if errorlevel 1 (
    echo Updater build failed.
    popd >nul
    exit /b 1
)
popd >nul

if not exist "%UPDATER_EXE%" (
    echo ERROR: Expected updater binary at "%UPDATER_EXE%" but it is missing.
    exit /b 1
)

echo Bundling updater into Electron payload...
copy /Y "%UPDATER_EXE%" "%UNPACKED_DIR%\smm-updater.exe" >nul
if errorlevel 1 (
    echo ERROR: Failed to copy updater into "%UNPACKED_DIR%".
    exit /b 1
)

rem ----- 3. Build the Inno Setup installer -----
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

echo.
echo Compiling Inno Setup installer...
"%ISCC%" ^
    /DMyAppVersion=%VERSION% ^
    "/DSourceDir=%UNPACKED_DIR%" ^
    "/DOutputDir=%OUTPUT_DIR%" ^
    "%ISS_FILE%"
if errorlevel 1 (
    echo Inno Setup compilation failed.
    exit /b 1
)

echo.
echo === Installer build succeeded ===
echo Installer directory: %OUTPUT_DIR%
dir /B "%OUTPUT_DIR%"
exit /b 0


:find_iscc
set "ISCC="
for %%P in (
    "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
    "%ProgramFiles%\Inno Setup 6\ISCC.exe"
    "%ProgramFiles(x86)%\Inno Setup 5\ISCC.exe"
    "%ProgramFiles%\Inno Setup 5\ISCC.exe"
) do (
    if exist "%%~P" (
        set "ISCC=%%~P"
        exit /b 0
    )
)
for /f "delims=" %%I in ('where iscc 2^>nul') do (
    set "ISCC=%%I"
    exit /b 0
)
exit /b 1


:usage
echo Usage: build-installer.bat [Configuration] ^<Version^>
echo.
echo   Configuration   Retained for compatibility with the previous .NET flow.
echo                   Any value is accepted; "Release" is the default.
echo   Version         Semver version string (e.g. 1.2.0). Required.
echo.
echo Example:
echo   build-installer.bat Release 1.2.0
exit /b 0

:usage_error
call :usage
exit /b 1
