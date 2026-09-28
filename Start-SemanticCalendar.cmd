@echo off
setlocal
cd /d "%~dp0" || exit /b 1

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm are required to launch Semantic Calendar.
  pause
  exit /b 1
)

echo Building the latest frontend...
call npm run build
if errorlevel 1 goto failed

set "SC_DEV_EXE=%CD%\apps\desktop\src-tauri\target\debug\semantic-calendar.exe"
if exist "%SC_DEV_EXE%" (
  powershell -NoProfile -Command "$target = $env:SC_DEV_EXE; if (Get-Process -Name 'semantic-calendar' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target }) { exit 0 }; exit 1"
  if not errorlevel 1 (
    echo Development app is already running. Showing its window...
    start "" "%SC_DEV_EXE%"
    exit /b 0
  )
)

echo Starting the desktop app in development mode...
call npm run tauri -- dev
if errorlevel 1 goto failed
exit /b 0

:failed
echo Build or launch failed. See the error above.
pause
exit /b 1
