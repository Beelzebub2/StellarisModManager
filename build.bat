@echo off
setlocal

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Debug"

dotnet build "StellarisModManager.csproj" -c "%CONFIG%"
exit /b %errorlevel%
