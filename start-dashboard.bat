@echo off
title WX Dashboard
cd /d "%~dp0"

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
)

echo.
echo Starting WX Dashboard (proxy + web)...
echo Your browser will open at http://localhost:5173 in a few seconds.
echo Keep this window open while using the dashboard; close it to stop.
echo.

REM Open the browser after a short delay (gives the dev servers time to boot).
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:5173'"

call npm run dev
