@echo off
title Adil AI - 1-Click Autopilot Setup & Runner
color 0B
cd /d "%~dp0"

echo ====================================================================
echo               ADIL AI - MCQ AUTOPILOT 1-CLICK INSTALLER
echo ====================================================================
echo.

:: 1. Check Python
echo [*] Checking for Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Python is not detected on your system.
    echo [*] Attempting automated installation via Windows Package Manager...
    winget install Python.Python.3.11 --silent --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo.
        echo [X] Automated Python install failed.
        echo Opening Python download page in your browser...
        start https://www.python.org/downloads/
        echo.
        echo IMPORTANT: When installing Python, CHECK THE BOX: "Add python.exe to PATH"
        echo After installing, run this file again!
        pause
        exit /b 1
    )
    echo [OK] Python installed! Restarting script...
) else (
    for /f "tokens=*" %%i in ('python --version') do echo [OK] Found %%i
)

:: 2. Check Virtual Environment
if not exist ".venv\Scripts\python.exe" (
    echo.
    echo [*] Creating virtual environment (.venv)...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [X] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created.
)

:: 3. Install Dependencies
echo.
echo [*] Checking dependencies...
.venv\Scripts\python -m pip install --quiet --upgrade pip
.venv\Scripts\python -m pip install --quiet -r requirements.txt
if %errorlevel% neq 0 (
    echo [!] Error installing dependencies. Retrying with verbose output...
    .venv\Scripts\python -m pip install -r requirements.txt
) else (
    echo [OK] Dependencies ready!
)

:: 4. Check API Key
if not exist ".env" (
    copy .env.example .env >nul 2>&1
)

findstr /C:"YOUR_GEMINI_API_KEY_HERE" .env >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo ====================================================================
    echo               GEMINI API KEY SETUP (100%% Free)
    echo ====================================================================
    echo You need a free Gemini API key from https://aistudio.google.com/
    echo.
    set /p USER_KEY="Paste your Gemini API key (or press Enter to set it later): "
    if not "%USER_KEY%"=="" (
        echo GEMINI_API_KEY=%USER_KEY% > .env
        echo [OK] Saved API key to .env!
    )
)

:: 5. Create Desktop Shortcut
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Adil AI Autopilot.lnk'); $s.TargetPath = '%~dp0run.bat'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = 'shell32.dll,43'; $s.Save()" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Desktop shortcut created: "Adil AI Autopilot"
)

echo.
echo ====================================================================
echo               LAUNCHING ADIL AI AUTOPILOT...
echo ====================================================================
echo.
call .venv\Scripts\activate.bat
python main.py
pause

