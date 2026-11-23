@echo off
title Practice MCQ Quiz Simulator
cd /d "%~dp0"
call .venv\Scripts\activate.bat
python quiz_simulator.py
pause

