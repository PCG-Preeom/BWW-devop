@echo off
cd /d "%~dp0"
echo Starting secure map backend at http://127.0.0.1:3000/
echo.
echo Password: PCG2026!
echo.
echo Keep this window open while using the map.
echo Press Ctrl+C to stop the server.
echo.
node server.js
