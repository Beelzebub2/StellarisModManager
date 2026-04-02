@echo off
setlocal

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Debug"

set "RUNTIME=win-x64"
set "OUTDIR=bin\%CONFIG%\publish\%RUNTIME%"

dotnet publish "StellarisModManager.csproj" -c "%CONFIG%" -r "%RUNTIME%" --self-contained false -p:UseAppHost=true -o "%OUTDIR%"
if errorlevel 1 exit /b %errorlevel%

if exist "%OUTDIR%\StellarisModManager.exe" (
	echo Build succeeded.
	echo Executable: %OUTDIR%\StellarisModManager.exe
	exit /b 0
)

echo Build finished but executable was not found.
exit /b 1
