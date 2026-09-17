@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo Mindcrafti Soniox launcher setup
echo.

set "SONIOX_EXE="

for %%I in (
  "%LOCALAPPDATA%\Programs\Soniox\Soniox.exe"
  "%LOCALAPPDATA%\Soniox\Soniox.exe"
  "%ProgramFiles%\Soniox\Soniox.exe"
  "%ProgramFiles(x86)%\Soniox\Soniox.exe"
) do (
  if not defined SONIOX_EXE if exist "%%~I" set "SONIOX_EXE=%%~I"
)

if not defined SONIOX_EXE (
  echo Soniox.exe was not found in the usual folders.
  echo Searching in LocalAppData. This can take a little time...
  for /f "delims=" %%I in ('where /r "%LOCALAPPDATA%" Soniox.exe 2^>nul') do (
    if not defined SONIOX_EXE set "SONIOX_EXE=%%I"
  )
)

if not defined SONIOX_EXE (
  echo.
  echo Soniox.exe was not found automatically.
  echo In File Explorer find Soniox.exe, Shift + right-click it, choose Copy as path,
  echo then paste the full path below. Quotes are OK.
  set /p "SONIOX_EXE=Full path to Soniox.exe: "
  set "SONIOX_EXE=!SONIOX_EXE:"=!"
)

if not exist "!SONIOX_EXE!" (
  echo.
  echo ERROR: File not found:
  echo !SONIOX_EXE!
  echo.
  pause
  exit /b 1
)

set "REGFILE=%TEMP%\mindcrafti-soniox-protocol.reg"
set "REGEXE=!SONIOX_EXE:\=\\!"

>"!REGFILE!" echo Windows Registry Editor Version 5.00
>>"!REGFILE!" echo.
>>"!REGFILE!" echo [HKEY_CURRENT_USER\Software\Classes\mindcrafti-soniox]
>>"!REGFILE!" echo @="URL:Mindcrafti Soniox Launcher"
>>"!REGFILE!" echo "URL Protocol"=""
>>"!REGFILE!" echo.
>>"!REGFILE!" echo [HKEY_CURRENT_USER\Software\Classes\mindcrafti-soniox\shell\open\command]
>>"!REGFILE!" echo @="\"!REGEXE!\""

reg import "!REGFILE!" >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERROR: Windows could not register the launcher.
  echo Try right-clicking this BAT file and choosing Run as administrator.
  echo.
  pause
  exit /b 1
)

del "!REGFILE!" >nul 2>&1

echo.
echo SUCCESS: Mindcrafti Soniox launcher is installed.
echo Soniox path:
echo !SONIOX_EXE!
echo.
echo Now reload the Mindcrafti Soniox Reminder extension in chrome://extensions

echo Then click Start lesson in Mindcrafti. Chrome may ask once whether to open the app.
echo Choose Open and allow it to remember your choice if Chrome offers that option.
echo.
pause
