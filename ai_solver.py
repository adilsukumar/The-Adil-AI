import base64
import io
import json
import os
import re
import time
from typing import Optional
from PIL import Image
from dotenv import load_dotenv

load_dotenv()


class AISolver:
    def __init__(self, provider=None, api_key=None, model_name=None):
        cfg_provider = provider or os.getenv("API_PROVIDER", "gemini")
        self.provider = cfg_provider.lower()

        if self.provider == "groq":
            self.api_key = api_key or os.getenv("GROQ_API_KEY")
            self.model_name = model_name or "qwen/qwen3.8-27b"
        else:
            self.provider = "gemini"
            self.api_key = api_key or os.getenv("GEMINI_API_KEY")
            # gemini-3.1-flash-lite provides fast ~2s vision inference
            self.model_name = model_name or "gemini-3.1-flash-lite"

        self._client = None

    def _get_client(self):
        if self._client is None:
            if self.provider == "groq":
                if not self.api_key:
                    raise ValueError(
                        "Missing Groq API Key! Please set GROQ_API_KEY in .env or config.json."
                    )
                try:
                    from groq import Groq
                    self._client = Groq(api_key=self.api_key)
                except Exception as e:
                    raise RuntimeError(f"Failed to initialize Groq Client: {e}")
            else:
                if not self.api_key:
                    raise ValueError(
                        "Missing Gemini API Key! Please set GEMINI_API_KEY in .env or config.json."
                    )
                try:
                    from google import genai
                    self._client = genai.Client(api_key=self.api_key)
                except Exception as e:
                    raise RuntimeError(f"Failed to initialize Gemini Client: {e}")
        return self._client

    def _image_to_base64_jpeg(self, pil_image: Image.Image, quality=85, max_dimension=1920) -> str:
        """
        High-fidelity image compressor. Preserves map boundaries, small country shapes,
        diagram details, and text readability while keeping file size small (~120KB).
        """
        rgb_img = pil_image.convert("RGB")
        w, h = rgb_img.size
        # Maintain high resolution up to 1920px for maps and small text
        if max(w, h) > max_dimension:
            scale = max_dimension / max(w, h)
            new_w, new_h = int(w * scale), int(h * scale)
            rgb_img = rgb_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

        buf = io.BytesIO()
        rgb_img.save(buf, format="JPEG", quality=quality, optimize=True)
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    def _clean_json_response(self, text: str) -> dict:
        """
        Ultra-resilient JSON parser. Never crashes on unescaped internal quotes or formatting quirks.
        """
        if not text:
            return {"has_mcq_question": False}
        text = text.strip()
        text = re.sub(r"^```json\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"^```\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

        parsed = None

        # 1. Direct standard parse attempt
        try:
            parsed = json.loads(text)
        except Exception:
            pass

        # 2. Extract JSON block { ... } and attempt auto-repair
        if not parsed:
            match = re.search(r"\{[\s\S]*\}", text)
            cleaned = match.group(0) if match else text
            
            # Auto-repair truncated JSON (e.g. unclosed string or braces)
            if cleaned.startswith("{"):
                repaired = cleaned
                # Balance quotes
                if repaired.count('"') % 2 != 0:
                    repaired += '"'
                # Balance braces
                open_braces = repaired.count("{") - repaired.count("}")
                if open_braces > 0:
                    repaired += "}" * open_braces
                try:
                    parsed = json.loads(repaired)
                except Exception:
                    pass

            if not parsed and match:
                cleaned = match.group(0)
                try:
                    parsed = json.loads(cleaned)
                except Exception:
                    # Auto-repair missing commas before newlines and keys
                    fixed = re.sub(r'([0-9]|true|false|null|")\s*\n\s*"', r'\1,\n  "', cleaned)
                    fixed = re.sub(r',\s*\}', '}', fixed)
                    try:
                        parsed = json.loads(fixed)
                    except Exception:
                        pass

        # Check for already-answered flag
        if re.search(r'"is_already_answered"\s*:\s*true', text, re.I):
            return {
                "has_mcq_question": False,
                "is_already_answered": True,
                "question_summary": "Question already answered",
                "visible_choices": []
            }

        # 3. Bulletproof Regex Field Extraction if JSON parsing fails
        if not parsed:
            has_q = bool(re.search(r'"has_mcq_question"\s*:\s*true', text, re.I))
            q_sum_match = re.search(r'"question_summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', text)
            letter_match = re.search(r'"selected_option_letter"\s*:\s*"([A-Za-z0-9])"', text)
            opt_text_match = re.search(r'"selected_option_text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', text)
            x_match = re.search(r'"x_ratio"\s*:\s*([0-9.]+)', text)
            y_match = re.search(r'"y_ratio"\s*:\s*([0-9.]+)', text)
            conf_match = re.search(r'"confidence"\s*:\s*([0-9.]+)', text)

            next_x = re.search(r'"next_button_target"[\s\S]*?"x_ratio"\s*:\s*([0-9.]+)', text)
            next_y = re.search(r'"next_button_target"[\s\S]*?"y_ratio"\s*:\s*([0-9.]+)', text)

            if has_q or letter_match or opt_text_match:
                parsed = {
                    "has_mcq_question": True,
                    "question_summary": q_sum_match.group(1) if q_sum_match else "Question detected",
                    "visible_choices": [],
                    "selected_option_letter": letter_match.group(1).upper() if letter_match else None,
                    "selected_option_text": opt_text_match.group(1) if opt_text_match else "",
                    "click_target": {
                        "x_ratio": float(x_match.group(1)) if x_match else 0.5,
                        "y_ratio": float(y_match.group(1)) if y_match else 0.5
                    },
                    "next_button_target": {
                        "x_ratio": float(next_x.group(1)) if next_x else None,
                        "y_ratio": float(next_y.group(1)) if next_y else None
                    } if (next_x and next_y) else None,
                    "confidence": float(conf_match.group(1)) if conf_match else 1.0
                }

        if not parsed:
            return {"has_mcq_question": False, "raw": text[:200]}

        # Post-process letter extraction if missing
        letter = parsed.get("selected_option_letter")
        opt_text = parsed.get("selected_option_text", "") or ""

        if not letter or letter == "None" or letter == "?":
            # Try to extract letter from opt_text (e.g. "B) Kenya" or "[C] Spain")
            m = re.match(r"^\s*\(?([A-Da-d1-6])[\)\.\:\s-]", opt_text)
            if m:
                parsed["selected_option_letter"] = m.group(1).upper()
            else:
                # Check visible choices list if present
                vis = parsed.get("visible_choices", [])
                if isinstance(vis, list):
                    for i, v in enumerate(vis):
                        if opt_text and (opt_text.lower() in v.lower() or v.lower() in opt_text.lower()):
                            parsed["selected_option_letter"] = chr(65 + i)
                            break

        return parsed

    def solve_mcq(self, pil_image: Image.Image) -> dict:
        """
        Captures screenshot and analyzes it using grounded visual reasoning:
        1. Identifies visible option choices.
        2. Inspects question and maps/diagrams for highlighted regions.
        3. Matches and returns exact button coordinates.
        """
        start_time = time.time()
        client = self._get_client()

        prompt = (
            "You are an elite, highly accurate Multiple Choice Question (MCQ) solver for online assessments, tests, and learning slides (such as Unstop, KiteRooms, Canvas, Google Forms, Geography/Map tests, Britannica).\n"
            "Analyze this screenshot with extreme precision.\n\n"
            "QUESTION & CHOICE DETECTION RULES:\n"
            "1. ACTIVE QUESTION: If 2 or more selectable choices, options, or buttons are visible on screen (e.g. country names, statements, terms, numbers, labeled A/B/C/D or plain buttons), `has_mcq_question` MUST BE TRUE!\n"
            "2. MAPS & DIAGRAMS: A highlighted country, territory, or colored region on a map (such as an orange, red, green, or shaded area) IS THE SUBJECT OF THE QUESTION! DO NOT treat map shading as an answered question!\n"
            "3. ALREADY ANSWERED: Only set `is_already_answered: true` if an option button ITSELF shows an explicit submitted feedback border (e.g. green correct outline, red wrong outline) or a submitted score/feedback message. If the choices are plain and unclicked, `is_already_answered` MUST BE FALSE!\n"
            "4. NO QUIZ ON SCREEN: Only set `has_mcq_question: false` if absolutely no question or choices are visible anywhere (e.g. empty desktop, plain login screen, loading screen).\n\n"
            "If an active question with choices IS visible, follow these steps strictly:\n"
            "1. READ CHOICES: List all visible answer choices in `visible_choices`.\n"
            "2. SOLVE ACCURATELY: Identify the highlighted country/territory or correct answer concept with 100% precision.\n"
            "3. ASSIGN LETTER: If choices do not show letters, assign A to 1st choice, B to 2nd, C to 3rd, D to 4th.\n"
            "4. TARGET COORDINATES: Pinpoint the exact center (x_ratio, y_ratio) of the correct choice's button/card.\n"
            "5. NEXT BUTTON: If a 'Next' or 'Continue' button is visible, return its center coordinates in `next_button_target`.\n\n"
            "Return STRICT JSON ONLY without markdown:\n"
            "{\n"
            '  "has_mcq_question": true,\n'
            '  "is_already_answered": false,\n'
            '  "question_summary": "<1-line question or title>",\n'
            '  "visible_choices": ["<choice 1>", "<choice 2>", "<choice 3>", "<choice 4>"],\n'
            '  "selected_option_letter": "<A, B, C, D, etc.>",\n'
            '  "selected_option_text": "<exact text of selected choice>",\n'
            '  "click_target": {\n'
            '    "x_ratio": <float strictly between 0.0 and 1.0 representing horizontal center of that choice button>,\n'
            '    "y_ratio": <float strictly between 0.0 and 1.0 representing vertical center of that choice button>\n'
            '  },\n'
            '  "next_button_target": {\n'
            '    "x_ratio": <float strictly between 0.0 and 1.0 or null>,\n'
            '    "y_ratio": <float strictly between 0.0 and 1.0 or null>\n'
            '  },\n'
            '  "confidence": 1.0\n'
            "}\n"
            "Coordinates rule: Must be normalized float ratios between 0.0 and 1.0 (e.g. 0.38, 0.59). Do NOT output raw pixels or 0-1000 integers."
        )

        try:
            if self.provider == "groq":
                b64_img = self._image_to_base64_jpeg(pil_image)
                chat_completion = client.chat.completions.create(
                    model=self.model_name,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{b64_img}"
                                    },
                                },
                            ],
                        }
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.0,
                )
                raw_text = chat_completion.choices[0].message.content
            else:
                from google.genai import types
                img_bytes = base64.b64decode(self._image_to_base64_jpeg(pil_image))

                gemini_models = [
                    self.model_name,
                    "gemini-3.1-flash-lite",
                    "gemini-3.5-flash-lite",
                    "gemini-3.8-flash",
                ]
                seen = set()
                gemini_models = [m for m in gemini_models if m and not (m in seen or seen.add(m))]

                raw_text = None
                last_err = None

                for g_model in gemini_models:
                    try:
                        response = client.models.generate_content(
                            model=g_model,
                            contents=[
                                types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                                prompt,
                            ],
                            config=types.GenerateContentConfig(
                                temperature=0.0,
                                max_output_tokens=1024,
                                response_mime_type="application/json",
                            ),
                        )
                        raw_text = response.text
                        self.model_name = g_model
                        break
                    except Exception as ge:
                        last_err = ge
                        err_str = str(ge).lower()
                        if any(k in err_str for k in ["404", "not_found", "not found", "503", "unavailable", "high demand", "429", "resource_exhausted", "timeout"]):
                            continue
                        else:
                            raise ge

                if raw_text is None:
                    raise last_err or RuntimeError("Failed to generate content with Gemini models.")

            elapsed = time.time() - start_time
            result = self._clean_json_response(raw_text)
            result["latency_seconds"] = round(elapsed, 2)
            return result

        except Exception as e:
            return {
                "error": str(e),
                "latency_seconds": round(time.time() - start_time, 2),
            }
