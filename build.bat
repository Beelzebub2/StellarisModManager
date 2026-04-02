@echo off
setlocal

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Release"

set "RUNTIME=win-x64"
set "APPNAME=StellarisModManager"
set "OUTDIR=Output\%APPNAME%"

if exist "%OUTDIR%" rmdir /s /q "%OUTDIR%"

dotnet publish "StellarisModManager.csproj" -c "%CONFIG%" -r "%RUNTIME%" --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -p:UseAppHost=true -p:DebugType=None -p:DebugSymbols=false -p:IncludeNativeLibrariesForSelfExtract=true -o "%OUTDIR%"
if errorlevel 1 exit /b %errorlevel%

if exist "%OUTDIR%\%APPNAME%.exe" (
	echo Build succeeded.
	echo Executable: %OUTDIR%\%APPNAME%.exe
	exit /b 0
)

echo Build finished but executable was not found.
exit /b 1
