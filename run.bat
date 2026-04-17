@echo off
setlocal

if /I "%~1"=="/?" goto :usage
if /I "%~1"=="-h" goto :usage
if /I "%~1"=="--help" goto :usage

set "ROOT=%~dp0"
set "APP_DIR=%ROOT%ElectronSpike"

if not exist "%APP_DIR%\package.json" (
    echo ERROR: ElectronSpike\package.json not found.
    echo Make sure you are running this from the repository root.
    exit /b 1
)

if not exist "%APP_DIR%\node_modules" (
    echo node_modules not found. Running npm install...
    pushd "%APP_DIR%"
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        popd
        exit /b %errorlevel%
    )
    popd
)

pushd "%APP_DIR%"
call npm start
popd
exit /b %errorlevel%

:usage
echo Usage: run.bat
echo Builds and launches the Stellaris Mod Manager Electron app.
exit /b 0
