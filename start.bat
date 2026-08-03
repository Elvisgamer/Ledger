@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Ledger - Family Spending Tracker
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found on this computer.
    echo Install it from https://nodejs.org - version 22.5 or newer - then run this file again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies - this only happens the first time...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Scroll up to see the error above.
        pause
        exit /b 1
    )
    echo.
)

echo Starting the server...
echo This window must stay open while you use the app. Close it to stop the server.
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:4477"

call npm start

echo.
echo Server stopped.
pause
