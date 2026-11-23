import json
import os
import re
import sys
import time
import threading
import pyautogui
import keyboard
import winsound
from PIL import Image

from screen_manager import ScreenManager, load_config, save_config
from ai_solver import AISolver

# PyAutoGUI safety configuration
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.02

# Dual Logger: Writes to terminal (if open) and always appends to autopilot.log
LOG_FILE = os.path.join(os.path.dirname(__file__), "autopilot.log")

class AutoPilotLogger:
    def __init__(self, original_stream, log_path):
        self.original_stream = original_stream
        self.log_path = log_path

    def write(self, msg):
        if self.original_stream:
            try:
                self.original_stream.write(msg)
                self.original_stream.flush()
            except Exception:
                pass
        if msg and msg.strip():
            try:
                clean_msg = re.sub(r'\033\[[0-9;]*m', '', msg).strip()
                if clean_msg:
                    timestamp = time.strftime("[%Y-%m-%d %H:%M:%S] ")
                    with open(self.log_path, "a", encoding="utf-8") as f:
                        f.write(timestamp + clean_msg + "\n")
            except Exception:
                pass

    def flush(self):
        if self.original_stream:
            try:
                self.original_stream.flush()
            except Exception:
                pass

sys.stdout = AutoPilotLogger(sys.stdout, LOG_FILE)
sys.stderr = AutoPilotLogger(sys.stderr, LOG_FILE)

# Optional Subtle Audio Chimes (Keeps user informed with zero screen popups)
def play_sound(sound_type="click"):
    if not load_config().get("sound_alerts", True):
        return
    try:
        if sound_type == "click":
            # Quick soft pleasant confirmation chime (1400Hz, 70ms)
            winsound.Beep(1400, 70)
        elif sound_type == "toggle_on":
            winsound.Beep(1000, 50)
            winsound.Beep(1500, 70)
        elif sound_type == "toggle_off":
            winsound.Beep(1500, 50)
            winsound.Beep(900, 70)
        elif sound_type == "error":
            winsound.Beep(600, 120)
    except Exception:
        pass

# Colors for terminal output
COLOR_CYAN = "\033[96m"
COLOR_GREEN = "\033[92m"
COLOR_YELLOW = "\033[93m"
COLOR_RED = "\033[91m"
COLOR_MAGENTA = "\033[95m"
COLOR_RESET = "\033[0m"


class MCQAutoPilot:
    def __init__(self):
        self.config = load_config()
        self.roi = self.config.get("roi")
        self.screen_mgr = ScreenManager(roi=self.roi)
        self.solver = AISolver(
            provider=self.config.get("api_provider", "gemini"),
            model_name=self.config.get("model_name", "gemini-3.5-flash-lite")
        )

        # Starts automatically in active waiting mode by default
        self.auto_mode = self.config.get("auto_start", True)
        self.is_running = True
        self.is_solving = False

        self.last_solved_image = None
        self.last_solved_signature = ""
        self.last_click_time = 0
        self.last_poll_time = 0

    def print_banner(self):
        print(f"{COLOR_CYAN}===================================================={COLOR_RESET}")
        print(f"{COLOR_GREEN}          ADIL AI - LAPTOP MCQ AUTOPILOT            {COLOR_RESET}")
        print(f"{COLOR_CYAN}===================================================={COLOR_RESET}")
        print(f"  [{COLOR_YELLOW}Ctrl + Alt + A{COLOR_RESET}] : Toggle Auto-Solve Mode (ON / OFF)")
        print(f"  [{COLOR_YELLOW}Ctrl + Alt + S{COLOR_RESET}] : Solve Current Question Once (Manual)")
        print(f"  [{COLOR_YELLOW}Ctrl + Alt + C{COLOR_RESET}] : Calibrate / Snip Quiz Region (ROI)")
        print(f"  [{COLOR_YELLOW}Ctrl + Alt + Q{COLOR_RESET}] : Quit Application")
        print(f"  (Also works with {COLOR_YELLOW}Ctrl+Shift+A / S / C / Q{COLOR_RESET} -- Laptop Safe, no Fn conflicts!)")
        print(f"  [PyAutoGUI Failsafe] : Slam mouse to any screen corner to abort")
        print(f"{COLOR_CYAN}----------------------------------------------------{COLOR_RESET}")
        roi_str = (
            f"({self.roi['left']}, {self.roi['top']}) {self.roi['width']}x{self.roi['height']}"
            if self.roi
            else "Entire Screen (Works in Fullscreen & Windowed)"
        )
        print(f"Target Region: {COLOR_MAGENTA}{roi_str}{COLOR_RESET}")
        print(f"AI Provider:   {COLOR_CYAN}{self.solver.provider.upper()} ({self.solver.model_name}){COLOR_RESET}")
        print(f"Auto-Click:    {COLOR_GREEN if self.config.get('auto_click', True) else COLOR_YELLOW}{'ENABLED' if self.config.get('auto_click', True) else 'DISABLED'}{COLOR_RESET}")
        print(f"Autopilot:     {COLOR_GREEN}ACTIVE (Waiting for questions){COLOR_RESET}" if self.auto_mode else f"Autopilot: {COLOR_YELLOW}PAUSED{COLOR_RESET}")
        print(f"{COLOR_CYAN}====================================================\n{COLOR_RESET}")

    def calibrate_roi(self):
        """Allows user to visually select the quiz region on their screen."""
        print(f"{COLOR_YELLOW}[!] Opening Snip Selector... Drag a box over the question area.{COLOR_RESET}")
        new_roi = self.screen_mgr.select_roi_interactively()
        if new_roi:
            self.roi = new_roi
            self.screen_mgr.roi = new_roi
            self.last_solved_image = None
            print(f"{COLOR_GREEN}[✓] Region of Interest Updated: {new_roi}{COLOR_RESET}")
        else:
            print(f"{COLOR_YELLOW}[!] Region selection unchanged.{COLOR_RESET}")

    def execute_solve(self, force=False):
        """Captures screen, queries AI Vision, and clicks the correct option immediately."""
        if self.is_solving:
            return

        self.is_solving = True
        solve_start = time.time()

        try:
            current_img = self.screen_mgr.capture_image()
            if current_img is None:
                return

            # Query Vision AI
            result = self.solver.solve_mcq(current_img)

            if "error" in result:
                print(f"{COLOR_RED}[✖] AI Error: {result['error']}{COLOR_RESET}")
                return

            # Check if screen is showing already-answered feedback (prevents re-clicking wrong answers!)
            if result.get("is_already_answered"):
                print(f"{COLOR_CYAN}[Standby] Question already answered/showing feedback. Waiting for next question...{COLOR_RESET}")
                return

            # Check if there is actually a question on the screen
            if not result.get("has_mcq_question", True):
                print(f"{COLOR_CYAN}[Standby] No MCQ question on screen yet. Waiting for test to start...{COLOR_RESET}")
                return

            q_summary = result.get("question_summary", "Question detected")
            vis_choices = result.get("visible_choices", []) or []
            signature = f"{q_summary}::{sorted(str(c) for c in vis_choices)}"

            # Prevent double-clicking the same question or re-triggering on animation
            if signature == self.last_solved_signature and not force:
                print(f"{COLOR_CYAN}[Standby] Current question already solved. Waiting for new question to appear...{COLOR_RESET}")
                return

            opt_letter = result.get("selected_option_letter", "?")
            opt_text = result.get("selected_option_text", "")
            confidence = result.get("confidence", 1.0)
            target = result.get("click_target") or {}
            raw_x = target.get("x_ratio", 0.5)
            raw_y = target.get("y_ratio", 0.5)
            ai_latency = result.get("latency_seconds", 0)

            # Determine screen / ROI bounds
            screen_w, screen_h = pyautogui.size()
            if self.roi:
                base_x = self.roi["left"]
                base_y = self.roi["top"]
                w = self.roi["width"]
                h = self.roi["height"]
            else:
                base_x, base_y = 0, 0
                w, h = screen_w, screen_h

            # Normalize ratios (handles 0.0-1.0, 0-100%, 0-1000 Gemini boxes, or raw pixels)
            def normalize_ratio(val, max_dim):
                try:
                    v = float(val)
                except (ValueError, TypeError):
                    return 0.5
                if v > 1.0:
                    if v <= 100.0:
                        v = v / 100.0
                    elif v <= 1000.0:
                        v = v / 1000.0
                    else:
                        v = v / float(max_dim)
                return max(0.04, min(0.96, v))

            norm_x = normalize_ratio(raw_x, w)
            norm_y = normalize_ratio(raw_y, h)

            click_x = int(base_x + (w * norm_x) + self.config.get("click_offset_x", 0))
            click_y = int(base_y + (h * norm_y) + self.config.get("click_offset_y", 0))

            # Safety clamping: strictly prevent cursor from hitting the 4 screen corners (which triggers PyAutoGUI failsafe)
            click_x = max(25, min(screen_w - 25, click_x))
            click_y = max(25, min(screen_h - 25, click_y))

            print(f"\n{COLOR_GREEN}[✓] Question:{COLOR_RESET} {q_summary}")
            vis_choices = result.get("visible_choices", [])
            if vis_choices and isinstance(vis_choices, list) and len(vis_choices) > 0:
                choices_str = " | ".join(str(c) for c in vis_choices[:6])
                print(f"{COLOR_MAGENTA}[👁] Choices Detected:{COLOR_RESET} {choices_str}")
            print(f"{COLOR_GREEN}[✓] Answer:{COLOR_RESET} [{COLOR_YELLOW}{opt_letter}{COLOR_RESET}] {opt_text} (Conf: {int(confidence*100)}%)")
            print(f"{COLOR_CYAN}[⏱] AI Latency:{COLOR_RESET} {ai_latency}s")

            if self.config.get("auto_click", True):
                print(f"{COLOR_YELLOW}[☛] Auto-clicking Option {opt_letter} at ({click_x}, {click_y})...{COLOR_RESET}")
                # Smooth, natural cursor movement (bypasses bot detection on Unstop/proctored platforms)
                pyautogui.moveTo(click_x, click_y, duration=0.12)
                pyautogui.click()
                play_sound("click")

                # Optional: auto-click next button if configured and detected
                if self.config.get("auto_click_next", False):
                    next_target = result.get("next_button_target")
                    if next_target and next_target.get("x_ratio") is not None and next_target.get("y_ratio") is not None:
                        delay = self.config.get("next_click_delay_seconds", 0.5)
                        time.sleep(delay)
                        next_norm_x = normalize_ratio(next_target["x_ratio"], w)
                        next_norm_y = normalize_ratio(next_target["y_ratio"], h)
                        next_x = int(base_x + (w * next_norm_x))
                        next_y = int(base_y + (h * next_norm_y))
                        # Safety clamping
                        next_x = max(25, min(screen_w - 25, next_x))
                        next_y = max(25, min(screen_h - 25, next_y))
                        print(f"{COLOR_YELLOW}[☛] Auto-clicking Next button at ({next_x}, {next_y})...{COLOR_RESET}")
                        pyautogui.moveTo(next_x, next_y, duration=0.10)
                        pyautogui.click()

            total_elapsed = round(time.time() - solve_start, 2)
            print(f"{COLOR_GREEN}[✔] Solved & clicked in {total_elapsed}s! Waiting for next question...{COLOR_RESET}")

            self.last_solved_signature = signature

            # Allow feedback / selection animation to completely finish before capturing baseline
            time.sleep(1.0)
            self.last_solved_image = self.screen_mgr.capture_image()
            self.last_click_time = time.time()

        except pyautogui.FailSafeException:
            play_sound("error")
            print(f"{COLOR_YELLOW}[!] PyAutoGUI FailSafe triggered (cursor reached screen corner). Autopilot paused. Press Ctrl+Alt+A to resume.{COLOR_RESET}")
            self.auto_mode = False
        except Exception as e:
            play_sound("error")
            print(f"{COLOR_RED}[✖] Solve Exception: {e}{COLOR_RESET}")
        finally:
            self.is_solving = False

    def toggle_auto(self):
        self.auto_mode = not self.auto_mode
        play_sound("toggle_on" if self.auto_mode else "toggle_off")
        state = f"{COLOR_GREEN}ACTIVE (Waiting for questions){COLOR_RESET}" if self.auto_mode else f"{COLOR_YELLOW}PAUSED{COLOR_RESET}"
        print(f"\n[Mode Changed] Autopilot is now: {state}")
        if self.auto_mode:
            self.last_solved_image = None
            self.last_solved_signature = ""

    def setup_hotkeys(self):
        hotkeys = self.config.get("hotkeys", {})
        toggle_key = hotkeys.get("toggle_auto", "ctrl+alt+a")
        calib_key = hotkeys.get("calibrate_roi", "ctrl+alt+c")
        solve_key = hotkeys.get("solve_once", "ctrl+alt+s")
        quit_key = hotkeys.get("quit", "ctrl+alt+q")

        def safe_add(key_combo, callback):
            try:
                keyboard.add_hotkey(key_combo, callback)
            except Exception:
                pass

        # Primary laptop-safe hotkeys (Ctrl + Alt) - Won't trigger Fn volume/brightness
        safe_add(toggle_key, self.toggle_auto)
        safe_add(calib_key, self.calibrate_roi)
        safe_add(solve_key, self.execute_solve)
        safe_add(quit_key, self.stop)

        # Secondary laptop-safe hotkeys (Ctrl + Shift)
        safe_add("ctrl+shift+a", self.toggle_auto)
        safe_add("ctrl+shift+c", self.calibrate_roi)
        safe_add("ctrl+shift+s", self.execute_solve)
        safe_add("ctrl+shift+q", self.stop)

    def stop(self):
        print(f"\n{COLOR_RED}[!] Exiting Adil AI Autopilot... Goodbye!{COLOR_RESET}")
        self.is_running = False

    def run(self):
        self.print_banner()
        self.setup_hotkeys()

        check_interval = self.config.get("check_interval_seconds", 0.5)
        diff_threshold = self.config.get("new_question_diff_threshold", 0.002)
        cooldown = self.config.get("post_click_cooldown_seconds", 1.0)

        print("[Status] Background autopilot running. Watching screen for questions...\n")

        try:
            while self.is_running:
                if self.auto_mode and not self.is_solving:
                    now = time.time()
                    if now - self.last_click_time >= cooldown:
                        current_screen = self.screen_mgr.capture_image()
                        if current_screen is None:
                            time.sleep(0.5)
                            continue

                        if self.last_solved_image is None:
                            # Initial check
                            self.last_poll_time = now
                            self.execute_solve()
                        else:
                            # Check if screen content changed
                            diff_fraction, changed_pixels = self.screen_mgr.compute_image_difference(
                                self.last_solved_image, current_screen
                            )
                            min_pixels = self.config.get("min_changed_pixels", 3500)

                            if diff_fraction >= diff_threshold or changed_pixels >= min_pixels:
                                print(f"\n{COLOR_MAGENTA}[➜] Screen transition detected! Analyzing question...{COLOR_RESET}")
                                self.last_poll_time = now
                                time.sleep(0.2)
                                self.execute_solve()
                            elif now - self.last_poll_time >= 2.0:
                                # Periodic heartbeat poll: guarantees no questions are missed or stalled
                                self.last_poll_time = now
                                self.execute_solve()

                time.sleep(check_interval)
        except KeyboardInterrupt:
            self.stop()


if __name__ == "__main__":
    app = MCQAutoPilot()
    app.run()
