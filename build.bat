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
call npm run build
if errorlevel 1 (
    echo TypeScript build failed.
    popd
    exit /b %errorlevel%
)
popd

echo Build succeeded. Output: ElectronSpike\dist
exit /b 0

:usage
echo Usage: build.bat
echo Compiles the Electron app TypeScript sources to ElectronSpike\dist.
exit /b 0
