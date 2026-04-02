@echo off
setlocal

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Release"

set "APP_VERSION=%~2"
if "%APP_VERSION%"=="" set "APP_VERSION=1.0.0"

set "RUNTIME=win-x64"
set "APPNAME=StellarisModManager"
set "OUTDIR=Output\%APPNAME%"
set "PUBLISHDIR=Output\_publish\%APPNAME%"

if exist "%PUBLISHDIR%" rmdir /s /q "%PUBLISHDIR%"

dotnet publish "StellarisModManager.csproj" -c "%CONFIG%" -r "%RUNTIME%" --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -p:UseAppHost=true -p:Version=%APP_VERSION% -p:InformationalVersion=%APP_VERSION% -p:DebugType=None -p:DebugSymbols=false -p:IncludeNativeLibrariesForSelfExtract=true -p:IncludeAllContentForSelfExtract=true -p:EnableCompressionInSingleFile=true -o "%PUBLISHDIR%"
if errorlevel 1 exit /b %errorlevel%

if not exist "%PUBLISHDIR%\%APPNAME%.exe" (
	echo Build finished but executable was not found in publish output.
	exit /b 1
)

if not exist "%OUTDIR%" mkdir "%OUTDIR%"

for /f "delims=" %%D in ('dir /b /ad "%OUTDIR%" 2^>nul') do rmdir /s /q "%OUTDIR%\%%D"
for /f "delims=" %%F in ('dir /b /a-d "%OUTDIR%" 2^>nul') do del /f /q "%OUTDIR%\%%F"

copy /y "%PUBLISHDIR%\%APPNAME%.exe" "%OUTDIR%\%APPNAME%.exe" >nul
if errorlevel 1 (
	echo Failed to place executable in %OUTDIR%.
	echo Make sure %APPNAME%.exe is not currently running and try again.
	exit /b 1
)

rmdir /s /q "%PUBLISHDIR%"

if exist "%OUTDIR%\%APPNAME%.exe" (
	echo Build succeeded.
	echo Executable: %OUTDIR%\%APPNAME%.exe
	echo Output folder cleaned. Only %APPNAME%.exe remains.
	exit /b 0
)

echo Build finished but executable was not found.
exit /b 1
