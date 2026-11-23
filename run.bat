@echo off
title Adil AI - Background MCQ Autopilot
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python main.py
pause

