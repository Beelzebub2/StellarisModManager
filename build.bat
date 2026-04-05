@echo off
setlocal

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Release"

set "APP_VERSION=%~2"
if "%APP_VERSION%"=="" set "APP_VERSION=1.0.0"

set "RUNTIME=win-x64"
set "APPNAME=StellarisModManager"
set "UPDATER_NAME=StellarisModManager.Updater"
set "UPDATER_PROJECT=Updater\StellarisModManager.Updater.csproj"
set "OUTDIR=Output\%APPNAME%"
set "PUBLISHDIR=Output\_publish\%APPNAME%"
set "UPDATER_PUBLISHDIR=Output\_publish\%UPDATER_NAME%"
set "PYTHON_UPDATER_SOURCE=Updater\python_updater.py"
set "PYTHON_UPDATER_DESTDIR=%PUBLISHDIR%\Updater"
set "NATIVE_UPDATER_DEST=%PYTHON_UPDATER_DESTDIR%\%UPDATER_NAME%.exe"
set "PYTHON_UPDATER_EXE_DEST=%PYTHON_UPDATER_DESTDIR%\python_updater.exe"
set "PYTHON_UPDATER_BUILDROOT=Output\_publish\python_updater_build"

if exist "%PUBLISHDIR%" rmdir /s /q "%PUBLISHDIR%"
if exist "%UPDATER_PUBLISHDIR%" rmdir /s /q "%UPDATER_PUBLISHDIR%"

dotnet publish "StellarisModManager.csproj" -c "%CONFIG%" -r "%RUNTIME%" --self-contained true -p:PublishSingleFile=false -p:PublishTrimmed=false -p:UseAppHost=true -p:Version=%APP_VERSION% -p:InformationalVersion=%APP_VERSION% -p:DebugType=None -p:DebugSymbols=false -o "%PUBLISHDIR%"
if errorlevel 1 exit /b %errorlevel%

if not exist "%PUBLISHDIR%\%APPNAME%.exe" (
	echo Build finished but executable was not found in publish output.
	exit /b 1
)

if not exist "%UPDATER_PROJECT%" (
	echo Updater project not found at %UPDATER_PROJECT%.
	exit /b 1
)

dotnet publish "%UPDATER_PROJECT%" -c "%CONFIG%" -r "%RUNTIME%" --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -p:UseAppHost=true -p:Version=%APP_VERSION% -p:InformationalVersion=%APP_VERSION% -p:DebugType=None -p:DebugSymbols=false -o "%UPDATER_PUBLISHDIR%"
if errorlevel 1 exit /b %errorlevel%

if not exist "%UPDATER_PUBLISHDIR%\%UPDATER_NAME%.exe" (
	echo Updater build finished but executable was not found in publish output.
	exit /b 1
)

if not exist "%PYTHON_UPDATER_SOURCE%" (
	echo Python updater script not found at %PYTHON_UPDATER_SOURCE%.
	exit /b 1
)

if not exist "%PYTHON_UPDATER_DESTDIR%" mkdir "%PYTHON_UPDATER_DESTDIR%"

copy /y "%UPDATER_PUBLISHDIR%\%UPDATER_NAME%.exe" "%NATIVE_UPDATER_DEST%" >nul
if errorlevel 1 (
	echo Failed to place native updater executable in publish output.
	exit /b 1
)

if /I "%SMM_SKIP_PY_UPDATER_EXE%"=="1" goto :skip_py_updater_exe

set "PYINSTALLER_CMD="
py -3 -m PyInstaller --version >nul 2>nul
if not errorlevel 1 set "PYINSTALLER_CMD=py -3 -m PyInstaller"
if not defined PYINSTALLER_CMD (
	python -m PyInstaller --version >nul 2>nul
	if not errorlevel 1 set "PYINSTALLER_CMD=python -m PyInstaller"
)

if not defined PYINSTALLER_CMD (
	echo PyInstaller was not found.
	echo Install it with: py -3 -m pip install pyinstaller
	echo Or set SMM_SKIP_PY_UPDATER_EXE=1 to skip python updater exe generation.
	exit /b 1
)

if exist "%PYTHON_UPDATER_BUILDROOT%" rmdir /s /q "%PYTHON_UPDATER_BUILDROOT%"
mkdir "%PYTHON_UPDATER_BUILDROOT%"

call %PYINSTALLER_CMD% --noconfirm --clean --onefile --windowed --name "python_updater" --distpath "%PYTHON_UPDATER_BUILDROOT%\dist" --workpath "%PYTHON_UPDATER_BUILDROOT%\work" --specpath "%PYTHON_UPDATER_BUILDROOT%" "%PYTHON_UPDATER_SOURCE%"
if errorlevel 1 (
	echo Failed to compile python updater executable with PyInstaller.
	exit /b 1
)

if not exist "%PYTHON_UPDATER_BUILDROOT%\dist\python_updater.exe" (
	echo PyInstaller finished but python_updater.exe was not produced.
	exit /b 1
)

copy /y "%PYTHON_UPDATER_BUILDROOT%\dist\python_updater.exe" "%PYTHON_UPDATER_EXE_DEST%" >nul
if errorlevel 1 (
	echo Failed to place python updater executable in publish output.
	exit /b 1
)

:skip_py_updater_exe

copy /y "%PYTHON_UPDATER_SOURCE%" "%PYTHON_UPDATER_DESTDIR%\python_updater.py" >nul
if errorlevel 1 (
	echo Failed to place python updater script in publish output.
	exit /b 1
)

if not exist "%OUTDIR%" mkdir "%OUTDIR%"

for /f "delims=" %%D in ('dir /b /ad "%OUTDIR%" 2^>nul') do rmdir /s /q "%OUTDIR%\%%D"
for /f "delims=" %%F in ('dir /b /a-d "%OUTDIR%" 2^>nul') do del /f /q "%OUTDIR%\%%F"

robocopy "%PUBLISHDIR%" "%OUTDIR%" /E /NFL /NDL /NJH /NJS /NC /NS >nul
if errorlevel 8 (
	echo Failed to copy publish output to %OUTDIR%.
	exit /b 1
)

rmdir /s /q "%PUBLISHDIR%"
if exist "%UPDATER_PUBLISHDIR%" rmdir /s /q "%UPDATER_PUBLISHDIR%"
if exist "%PYTHON_UPDATER_BUILDROOT%" rmdir /s /q "%PYTHON_UPDATER_BUILDROOT%"

if exist "%OUTDIR%\%APPNAME%.exe" (
	echo Build succeeded.
	echo Publish output: %OUTDIR%
	echo Entry executable: %OUTDIR%\%APPNAME%.exe
	exit /b 0
)

echo Build finished but executable was not found.
exit /b 1
