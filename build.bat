@echo off
setlocal

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Release"

set "APP_VERSION=%~2"
if "%APP_VERSION%"=="" set "APP_VERSION=1.0.0"

set "RUNTIME=win-x64"
set "APPNAME=StellarisModManager"
set "UPDATER_PROJECT=Updater\StellarisModManager.Updater.csproj"
set "UPDATER_EXE=StellarisModManager.Updater.exe"
set "OUTDIR=Output\%APPNAME%"
set "PUBLISHDIR=Output\_publish\%APPNAME%"
set "UPDATER_PUBLISHDIR=%PUBLISHDIR%\_updater"

if exist "%PUBLISHDIR%" rmdir /s /q "%PUBLISHDIR%"

dotnet publish "StellarisModManager.csproj" -c "%CONFIG%" -r "%RUNTIME%" --self-contained true -p:PublishSingleFile=false -p:PublishTrimmed=false -p:UseAppHost=true -p:Version=%APP_VERSION% -p:InformationalVersion=%APP_VERSION% -p:DebugType=None -p:DebugSymbols=false -o "%PUBLISHDIR%"
if errorlevel 1 exit /b %errorlevel%

if not exist "%PUBLISHDIR%\%APPNAME%.exe" (
	echo Build finished but executable was not found in publish output.
	exit /b 1
)

dotnet publish "%UPDATER_PROJECT%" -c "%CONFIG%" -r "%RUNTIME%" --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -p:UseAppHost=true -p:Version=%APP_VERSION% -p:InformationalVersion=%APP_VERSION% -p:DebugType=None -p:DebugSymbols=false -o "%UPDATER_PUBLISHDIR%"
if errorlevel 1 exit /b %errorlevel%

if not exist "%UPDATER_PUBLISHDIR%\%UPDATER_EXE%" (
	echo Updater build finished but executable was not found in publish output.
	exit /b 1
)

copy /y "%UPDATER_PUBLISHDIR%\%UPDATER_EXE%" "%PUBLISHDIR%\%UPDATER_EXE%" >nul
if errorlevel 1 (
	echo Failed to place updater executable in publish output.
	exit /b 1
)

rmdir /s /q "%UPDATER_PUBLISHDIR%"

if not exist "%OUTDIR%" mkdir "%OUTDIR%"

for /f "delims=" %%D in ('dir /b /ad "%OUTDIR%" 2^>nul') do rmdir /s /q "%OUTDIR%\%%D"
for /f "delims=" %%F in ('dir /b /a-d "%OUTDIR%" 2^>nul') do del /f /q "%OUTDIR%\%%F"

robocopy "%PUBLISHDIR%" "%OUTDIR%" /E /NFL /NDL /NJH /NJS /NC /NS >nul
if errorlevel 8 (
	echo Failed to copy publish output to %OUTDIR%.
	exit /b 1
)

rmdir /s /q "%PUBLISHDIR%"

if exist "%OUTDIR%\%APPNAME%.exe" (
	echo Build succeeded.
	echo Publish output: %OUTDIR%
	echo Entry executable: %OUTDIR%\%APPNAME%.exe
	exit /b 0
)

echo Build finished but executable was not found.
exit /b 1
