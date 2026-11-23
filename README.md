# ⚡ Adil AI - Ultra-Fast MCQ Autopilot (Groq + Browser DOM)

An autonomous, sub-second AI assistant that reads multiple-choice questions (MCQs), answers them using **Groq (Llama 3.3 70B)** at blazing speeds, automatically selects the correct answer, and transitions to the next question.

You can use it in **two different ways**:
1. **🌐 Browser Script / DOM (Recommended - Sub-second ~0.3s):** Runs directly inside Chrome/Edge via Tampermonkey. Zero OCR overhead, zero coordinate math, 100% accurate DOM clicks.
2. **🖥️ Python Background Autopilot (~1.2s):** Monitors desktop screens via `mss` screen-grab and Vision AI for desktop/proctored applications.

---

## ⚡ Method 1: Browser Script / DOM (Instant 0.3s)

### Why this is the fastest setup:
- Reads the question text directly from the webpage HTML in **5ms**.
- Calls **Groq Llama 3.3 70B** via LPU inference in **~200ms**.
- Directly triggers `.click()` on the correct DOM element in **2ms**.
- Total latency: **~0.3 seconds!** No GPU required.

### Setup Instructions:
1. Install the free **[Tampermonkey extension](https://www.tampermonkey.net/)** in your browser (Chrome, Edge, Brave, or Firefox).
2. Click the Tampermonkey icon -> **Create a new script**.
3. Open [`d:\TheAdilAI\mcq_groq_userscript.user.js`](file:///d:/TheAdilAI/mcq_groq_userscript.user.js), copy the entire code, and paste it into Tampermonkey. Click **File -> Save** (`Ctrl+S`).
4. Get your free API key at **[console.groq.com](https://console.groq.com/)**.
5. Open your quiz page (or practice with [`d:\TheAdilAI\test_browser_quiz.html`](file:///d:/TheAdilAI/test_browser_quiz.html)).
6. A sleek **⚡ ADIL AI (GROQ)** widget will float on the top-right:
   - Click **🔑 Set Key** and paste your `gsk_...` Groq key once.
   - Click **Auto: ON** (or press `Alt + A`).
   - Watch it instantly answer questions within ~300ms!

### In-Browser Hotkeys:
- **`Alt + S`**: Solve current question once.
- **`Alt + A`**: Toggle Auto-Pilot ON / OFF.
- **`Alt + H`**: Show / Hide the floating control widget.

---

## 🖥️ Method 2: Python Screen Autopilot (Groq Vision)

If your quiz is running inside a desktop app or locked window where you cannot run browser extensions:

1. Add your Groq API key to [`d:\TheAdilAI\.env`](file:///d:/TheAdilAI/.env):
   ```env
   GROQ_API_KEY=gsk_...YourKeyHere...
   ```
2. Double click [`run.bat`](file:///d:/TheAdilAI/run.bat) (or run `python main.py`).
3. Press **`F7`** to drag-select your quiz window (ROI).
4. Press **`F6`** to engage auto-solving.

---

## 🛠️ Project Structure

```text
d:\TheAdilAI\
├── .env                  # Stores your GEMINI_API_KEY
├── config.json           # All settings: hotkeys, auto-click toggles, delays
├── main.py               # Main background autopilot engine
├── ai_solver.py          # Gemini 2.0 Flash multimodal solver & coordinate parser
├── screen_manager.py     # High-speed screen grabber, diff detector, & ROI snip tool
├── quiz_simulator.py     # Desktop practice app for offline testing
├── test_suite.py         # Unit tests for screen diff and perception
└── requirements.txt      # Python dependencies
```

---

## ⚡ Quickstart Guide

### 1. Get your Free Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Click **Get API key** and create a free key.
3. Open `d:\TheAdilAI\.env` and paste your key:
   ```env
   GEMINI_API_KEY=AIzaSy...YourKeyHere...
   ```

### 2. Run the App
Open PowerShell or Command Prompt in `d:\TheAdilAI`:
```powershell
# Activate the existing virtual environment:
.\.venv\Scripts\activate

# Launch the Autopilot:
python main.py
```

---

### ⌨️ Global Hotkeys (Laptop-Safe — No Fn Key Conflicts!)

| Hotkey | Alternative | Action | Description |
| :--- | :--- | :--- | :--- |
| **`Ctrl + Alt + A`** | `Ctrl + Shift + A` | **Toggle Auto-Solve** | Turns background auto-solving **ON** or **OFF**. |
| **`Ctrl + Alt + S`** | `Ctrl + Shift + S` | **Solve Once** | Manually solves and clicks the currently visible question one time. |
| **`Ctrl + Alt + C`** | `Ctrl + Shift + C` | **Calibrate Region (ROI)** | Opens snip tool to drag-select only your quiz window. |
| **`Ctrl + Alt + Q`** | `Ctrl + Shift + Q` | **Quit** | Closes and terminates the autopilot. |
| *Mouse to corner* | *Any screen corner* | *Emergency Abort* | Slam your mouse cursor to the top-left screen corner to immediately abort mouse movement. |

---

## 🧪 Try it with the Built-in Practice Simulator

Want to see it work immediately without opening a browser?

1. Open a new terminal and run the mock quiz:
   ```powershell
   python quiz_simulator.py
   ```
2. Position the quiz window on your screen.
3. In your main terminal, start the autopilot:
   ```powershell
   python main.py
   ```
4. Press **`F7`** and drag a rectangle over the quiz window.
5. Press **`F6`** to engage Auto-Solve.
6. Watch Adil AI identify the question, click the correct option in ~1.5s, and wait for you (or auto-advance) to the next question!

---

## ⚙️ Configuration (`config.json`)

```json
{
  "api_provider": "gemini",
  "model_name": "gemini-2.0-flash",
  "auto_click": true,
  "auto_click_next": false,
  "next_click_delay_seconds": 0.6,
  "click_offset_x": 0,
  "click_offset_y": 0,
  "check_interval_seconds": 0.5,
  "new_question_diff_threshold": 0.002,
  "min_changed_pixels": 400,
  "post_click_cooldown_seconds": 1.2,
  "hotkeys": {
    "toggle_auto": "F6",
    "calibrate_roi": "F7",
    "solve_once": "F8",
    "quit": "F9"
  }
}
```

- **`auto_click_next`**: Set to `true` if your quiz has a "Next" button and you want the AI to click it automatically after choosing the answer.
- **`auto_click`**: Set to `false` if you only want the AI to output the answer in your terminal without moving your mouse cursor.

