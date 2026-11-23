import os
import zipfile

def create_shareable_zip():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    zip_path = os.path.join(base_dir, "AdilAI_MCQ_Autopilot_Shareable.zip")

    include_files = [
        "main.py",
        "ai_solver.py",
        "screen_manager.py",
        "quiz_simulator.py",
        "config.json",
        "requirements.txt",
        ".env.example",
        "INSTALL_AND_RUN.bat",
        "run.bat",
        "run_silent.vbs",
        "stop_autopilot.bat",
        "run_practice_quiz.bat",
        "mcq_groq_userscript.user.js",
        "test_browser_quiz.html",
        "FRIEND_SETUP_GUIDE.txt",
        "README.md",
    ]

    print("[*] Creating lightweight shareable zip package...")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for fname in include_files:
            fpath = os.path.join(base_dir, fname)
            if os.path.exists(fpath):
                # Put inside a clean root folder within the zip
                arcname = os.path.join("AdilAI_Autopilot", fname)
                zipf.write(fpath, arcname=arcname)
                print(f"  + Added: {fname}")
            else:
                print(f"  - Missing: {fname}")

    size_kb = round(os.path.getsize(zip_path) / 1024, 1)
    print(f"\n[OK] Package created successfully!")
    print(f"Location: {zip_path}")
    print(f"File Size: {size_kb} KB (Super small, ready to send via WhatsApp/Drive/Telegram!)")

if __name__ == "__main__":
    create_shareable_zip()

