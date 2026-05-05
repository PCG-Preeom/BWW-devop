@echo off
cd /d "%~dp0"
echo Starting map server at http://localhost:3000/
echo.
echo Share one of the Network URL entries if another device needs access.
echo Access attempts are saved in logs\access.log.
echo Keep this window open while using the map.
echo Press Ctrl+C to stop the server.
echo.
node server.js
