@echo off
rem TABLE21: double-click to host the game for phones on the same Wi-Fi.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-lan-windows.ps1" %*
echo.
pause
