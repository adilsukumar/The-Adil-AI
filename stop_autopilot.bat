@echo off
title Stop Adil AI Autopilot
echo Stopping Adil AI background processes...
taskkill /F /IM pythonw.exe >nul 2>&1
echo [OK] Adil AI Background Autopilot has been stopped.
timeout /t 2 >nul
exit
