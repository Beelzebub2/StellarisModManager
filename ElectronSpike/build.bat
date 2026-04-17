@echo off
setlocal

if /I "%~1"=="/?" goto :usage
if /I "%~1"=="-h" goto :usage
if /I "%~1"=="--help" goto :usage

set "ROOT=%~dp0"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=build"
set "SKIP_INSTALL=0"

if /I "%MODE%"=="--skip-install" (
    set "MODE=build"
    set "SKIP_INSTALL=1"
)

if /I "%~2"=="--skip-install" set "SKIP_INSTALL=1"

if /I not "%MODE%"=="build" if /I not "%MODE%"=="check" (
    echo Invalid mode: %MODE%
    goto :usage_error
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

call npm run %MODE%
set "RC=%errorlevel%"
popd >nul
exit /b %RC%

:usage
echo Usage: build.bat [build^|check] [--skip-install]
echo Example: build.bat check
echo Example: build.bat build --skip-install
exit /b 0

:usage_error
echo.
goto :usage
