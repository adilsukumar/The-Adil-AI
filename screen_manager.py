import json
import os
import time
import tkinter as tk
import numpy as np
from PIL import Image, ImageGrab
import mss

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")


def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


class ScreenManager:
    def __init__(self, roi=None):
        self.roi = roi
        self._sct = None

    def _get_sct(self):
        if self._sct is None:
            self._sct = mss.mss()
        return self._sct

    def capture_image(self, roi=None):
        """
        Captures the screen or specified ROI and returns a PIL Image.
        ROI format: {"left": int, "top": int, "width": int, "height": int}
        """
        target_roi = roi or self.roi
        try:
            sct = self._get_sct()
            if target_roi:
                monitor = {
                    "top": int(target_roi["top"]),
                    "left": int(target_roi["left"]),
                    "width": int(target_roi["width"]),
                    "height": int(target_roi["height"]),
                }
            else:
                monitor = sct.monitors[1]  # Primary monitor

            sct_img = sct.grab(monitor)
            img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
            return img
        except Exception:
            # Fallback to PIL ImageGrab if mss fails
            try:
                if target_roi:
                    bbox = (
                        int(target_roi["left"]),
                        int(target_roi["top"]),
                        int(target_roi["left"] + target_roi["width"]),
                        int(target_roi["top"] + target_roi["height"]),
                    )
                    return ImageGrab.grab(bbox=bbox)
                return ImageGrab.grab()
            except Exception:
                # Desktop session locked or display temporarily unavailable
                return None

    @staticmethod
    def compute_image_difference(img1: Image.Image, img2: Image.Image) -> tuple[float, int]:
        """
        Calculates difference between two images.
        Returns:
            diff_fraction: fraction of pixels that changed significantly (0.0 to 1.0)
            changed_pixels: total count of changed pixels
        """
        if img1 is None or img2 is None:
            return 1.0, 999999

        # Ensure same size for comparison
        if img1.size != img2.size:
            img2 = img2.resize(img1.size)

        arr1 = np.array(img1.convert("L"), dtype=np.int16)
        arr2 = np.array(img2.convert("L"), dtype=np.int16)

        # Significant intensity change (> 30 out of 255)
        changed_mask = np.abs(arr1 - arr2) > 30
        changed_pixels = int(np.count_nonzero(changed_mask))
        total_pixels = arr1.size
        diff_fraction = changed_pixels / float(total_pixels) if total_pixels > 0 else 0.0

        return diff_fraction, changed_pixels

    @staticmethod
    def select_roi_interactively():
        """
        Launches a semi-transparent screen snipper tool for the user to select
        the quiz/question region of interest.
        """
        print("\n[Snipper] Select the Quiz Area: Click & drag a rectangle on your screen.")
        print("[Snipper] Press ESC to cancel.")

        root = tk.Tk()
        root.attributes("-alpha", 0.3)
        root.attributes("-fullscreen", True)
        root.attributes("-topmost", True)
        root.config(cursor="cross")

        canvas = tk.Canvas(root, cursor="cross", bg="grey10")
        canvas.pack(fill="both", expand=True)

        rect_id = None
        start_x = 0
        start_y = 0
        selected_roi = None

        def on_mouse_down(event):
            nonlocal start_x, start_y, rect_id
            start_x, start_y = event.x, event.y
            rect_id = canvas.create_rectangle(
                start_x, start_y, start_x, start_y, outline="#00ff66", width=3
            )

        def on_mouse_move(event):
            nonlocal rect_id
            if rect_id:
                canvas.coords(rect_id, start_x, start_y, event.x, event.y)

        def on_mouse_up(event):
            nonlocal selected_roi
            end_x, end_y = event.x, event.y
            x1 = min(start_x, end_x)
            y1 = min(start_y, end_y)
            x2 = max(start_x, end_x)
            y2 = max(start_y, end_y)

            w = x2 - x1
            h = y2 - y1

            if w > 20 and h > 20:
                selected_roi = {"left": x1, "top": y1, "width": w, "height": h}
            root.destroy()

        def on_escape(event):
            root.destroy()

        canvas.bind("<ButtonPress-1>", on_mouse_down)
        canvas.bind("<B1-Motion>", on_mouse_move)
        canvas.bind("<ButtonRelease-1>", on_mouse_up)
        root.bind("<Escape>", on_escape)

        root.mainloop()

        if selected_roi:
            cfg = load_config()
            cfg["roi"] = selected_roi
            save_config(cfg)
            print(f"[Snipper] Saved Region of Interest: {selected_roi}")
            return selected_roi
        else:
            print("[Snipper] ROI selection cancelled or invalid.")
            return None
