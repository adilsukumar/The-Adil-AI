import io
import time
import numpy as np
from PIL import Image, ImageDraw

from screen_manager import ScreenManager


def create_dummy_mcq(question_text: str, options: list[str]):
    """Draws a synthetic MCQ image to simulate a quiz screen."""
    img = Image.new("RGB", (800, 600), color=(245, 247, 250))
    draw = ImageDraw.Draw(img)

    # Question Box
    draw.rectangle([50, 40, 750, 160], fill=(255, 255, 255), outline=(210, 215, 225), width=2)
    draw.text((70, 70), question_text, fill=(30, 41, 59))

    # Options (A, B, C, D)
    for i, opt in enumerate(options):
        y = 200 + (i * 90)
        # Option card
        draw.rectangle([50, y, 750, y + 70], fill=(255, 255, 255), outline=(220, 225, 235), width=2)
        # Radio circle
        draw.ellipse([80, y + 20, 110, y + 50], outline=(100, 116, 139), width=2)
        draw.text((140, y + 25), f"{chr(65+i)}. {opt}", fill=(15, 23, 42))

    return img


def test_image_difference():
    print("[Test 1] Testing Image Difference / Change Detection...")
    img1 = create_dummy_mcq("What is the capital of France?", ["Berlin", "Madrid", "Paris", "Rome"])
    img1_identical = create_dummy_mcq("What is the capital of France?", ["Berlin", "Madrid", "Paris", "Rome"])
    img2 = create_dummy_mcq("Which planet is known as the Red Planet?", ["Jupiter", "Mars", "Venus", "Saturn"])

    diff_id, px_id = ScreenManager.compute_image_difference(img1, img1_identical)
    diff_new, px_new = ScreenManager.compute_image_difference(img1, img2)

    print(f"  Identical Screen: diff={diff_id:.5f}, changed_pixels={px_id}")
    print(f"  New Question:     diff={diff_new:.5f}, changed_pixels={px_new}")

    assert px_id == 0, "Identical screens must have 0 changed pixels"
    assert px_new >= 400, f"New question should have >= 400 changed pixels (got {px_new})"
    print("  [PASSED] Change detection works accurately!\n")


if __name__ == "__main__":
    test_image_difference()
