@echo off
setlocal

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Debug"
if not "%~1"=="" shift

dotnet run --project "StellarisModManager.csproj" -c "%CONFIG%" -- %*
exit /b %errorlevel%
