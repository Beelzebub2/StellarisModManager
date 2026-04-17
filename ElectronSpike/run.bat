@echo off
setlocal

if /I "%~1"=="/?" goto :usage
if /I "%~1"=="-h" goto :usage
if /I "%~1"=="--help" goto :usage

set "ROOT=%~dp0"
set "SKIP_INSTALL=0"

if /I "%~1"=="--skip-install" (
    set "SKIP_INSTALL=1"
    shift
)

pushd "%ROOT%" >nul

where npm >nul 2>nul
if errorlevel 1 (
    echo npm was not found in PATH. Install Node.js 18+ and retry.
    popd >nul
    exit /b 1
)

if "%SKIP_INSTALL%"=="0" (
    if not exist "%ROOT%node_modules" (
        echo Installing Electron dependencies...
        call npm install
        if errorlevel 1 (
            popd >nul
            exit /b %errorlevel%
        )
    )
)

call npm start -- %*
set "RC=%errorlevel%"
popd >nul
exit /b %RC%

:usage
echo Usage: run.bat [--skip-install] [-- electron args...]
echo Example: run.bat -- --inspect=9229
exit /b 0
