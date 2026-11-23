import time
import os
import json
from playwright.sync_api import sync_playwright

def run_tests():
    script_path = os.path.abspath(r"d:\TheAdilAI\mcq_groq_userscript.user.js")
    with open(script_path, "r", encoding="utf-8") as f:
        userscript_code = f.read()

    # Polyfill GM functions for browser environment
    gm_shim = """
    (() => {
        window.GM_getValue = function(key, defaultVal) {
            return defaultVal;
        };
        window.GM_setValue = function(key, val) {};
        window.GM_xmlhttpRequest = function(details) {
            if (!details) return;
            var xhr = new XMLHttpRequest();
            xhr.open(details.method || 'GET', details.url, true);
            if (details.headers) {
                for (var h in details.headers) {
                    xhr.setRequestHeader(h, details.headers[h]);
                }
            }
            xhr.timeout = details.timeout || 10000;
            xhr.onload = function() {
                if (details.onload) {
                    details.onload({
                        status: xhr.status,
                        responseText: xhr.responseText
                    });
                }
            };
            xhr.onerror = function() {
                if (details.onerror) details.onerror(new Error('Network error'));
            };
            xhr.ontimeout = function() {
                if (details.ontimeout) details.ontimeout(new Error('Timeout'));
            };
            xhr.send(details.data || null);
        };
    })()
    """

    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()

        # ==========================================
        # TEST 1: KiteRooms Simulator
        # ==========================================
        kiterooms_url = "file:///" + os.path.abspath(r"d:\TheAdilAI\test_kiterooms.html").replace("\\", "/")
        print(f"\n[TEST 1] Loading KiteRooms: {kiterooms_url}")
        page.goto(kiterooms_url)
        page.wait_for_load_state("domcontentloaded")

        # Inject GM shim and Userscript
        page.evaluate(gm_shim)
        page.evaluate(userscript_code)
        time.sleep(1)

        # Check HUD presence
        hud = page.query_selector("#adil-ai-widget-hud")
        assert hud is not None, "KiteRooms: Adil AI HUD was not injected!"
        print("  ✓ Adil AI HUD injected successfully on KiteRooms")

        # Test Q1: Single choice radio
        print("  Testing Question 1 (Single choice: time complexity)...")
        page.click("#adil-btn-solve-now")
        
        # Wait for status to change from solving to answered
        page.wait_for_function("() => !document.querySelector('#adil-status-text').innerText.includes('Solving')", timeout=10000)
        time.sleep(1)
        status_text = page.inner_text("#adil-status-text")
        print(f"  Status after Q1: {status_text}")
        
        checked_radios = page.eval_on_selector_all("#q0 input[type='radio']", "inputs => inputs.map(i => i.checked)")
        print(f"  Q0 Radio checked states: {checked_radios}")
        results.append({
            "page": "KiteRooms",
            "question": "Q1 (Single Choice)",
            "status": status_text,
            "checked": checked_radios,
            "success": any(checked_radios)
        })

        # Switch to Q2 (Multi-select checkbox)
        print("  Switching to Question 2 (Multi-select: mutable data types)...")
        page.evaluate("showQuestion(1)")
        time.sleep(0.8)

        # Solve Q2
        page.click("#adil-btn-solve-now")
        page.wait_for_function("() => !document.querySelector('#adil-status-text').innerText.includes('Solving')", timeout=10000)
        time.sleep(1)
        status_text_q2 = page.inner_text("#adil-status-text")
        print(f"  Status after Q2: {status_text_q2}")

        checked_boxes = page.eval_on_selector_all("#q1 input[type='checkbox']", "inputs => inputs.map(i => i.checked)")
        print(f"  Q1 Checkboxes checked states (List, Tuple, Dict, Str, Set): {checked_boxes}")
        results.append({
            "page": "KiteRooms",
            "question": "Q2 (Multi-Select Checkboxes)",
            "status": status_text_q2,
            "checked": checked_boxes,
            "success": sum(checked_boxes) >= 2
        })

        # ==========================================
        # TEST 2: Google Forms Simulator
        # ==========================================
        gforms_url = "file:///" + os.path.abspath(r"d:\TheAdilAI\test_googleforms.html").replace("\\", "/")
        print(f"\n[TEST 2] Loading Google Forms: {gforms_url}")
        page.goto(gforms_url)
        page.wait_for_load_state("domcontentloaded")

        page.evaluate(gm_shim)
        page.evaluate(userscript_code)
        time.sleep(1)

        # Check HUD
        hud = page.query_selector("#adil-ai-widget-hud")
        assert hud is not None, "Google Forms: Adil AI HUD was not injected!"
        print("  ✓ Adil AI HUD injected successfully on Google Forms")

        # Solve Q1 (Single choice radio)
        print("  Testing Google Forms Q1 (Single choice: powerhouse of cell)...")
        page.click("#adil-btn-solve-now")
        page.wait_for_function("() => !document.querySelector('#adil-status-text').innerText.includes('Solving')", timeout=10000)
        time.sleep(1)
        status_text_gf1 = page.inner_text("#adil-status-text")
        print(f"  Status after GForms Q1: {status_text_gf1}")

        gf1_radios = page.eval_on_selector_all("[data-item-id='q1'] input[type='radio']", "inputs => inputs.map(i => i.checked)")
        print(f"  GForms Q1 Radio checked states: {gf1_radios}")
        results.append({
            "page": "Google Forms",
            "question": "Q1 (Single Choice)",
            "status": status_text_gf1,
            "checked": gf1_radios,
            "success": any(gf1_radios)
        })

        # Answered Q1, now solve Q2 (Google Forms automatically picks Q2)
        print("  Testing Google Forms Q2 (Multi-select: programming languages)...")
        page.eval_on_selector("[data-item-id='q2']", "el => el.scrollIntoView()")
        time.sleep(0.8)

        page.click("#adil-btn-solve-now")
        page.wait_for_function("() => !document.querySelector('#adil-status-text').innerText.includes('Solving')", timeout=10000)
        time.sleep(1)
        status_text_gf2 = page.inner_text("#adil-status-text")
        print(f"  Status after GForms Q2: {status_text_gf2}")

        gf2_boxes = page.eval_on_selector_all("[data-item-id='q2'] input[type='checkbox']", "inputs => inputs.map(i => i.checked)")
        print(f"  GForms Q2 Checkboxes (Python, HTML, Rust, Excel, Go): {gf2_boxes}")
        results.append({
            "page": "Google Forms",
            "question": "Q2 (Multi-Select Checkboxes)",
            "status": status_text_gf2,
            "checked": gf2_boxes,
            "success": sum(gf2_boxes) >= 2
        })

        # Save screenshots
        page.screenshot(path=r"d:\TheAdilAI\test_gforms_result.png")
        page.goto(kiterooms_url)
        page.wait_for_load_state("domcontentloaded")
        page.evaluate(gm_shim)
        page.evaluate(userscript_code)
        page.evaluate("showQuestion(1)")
        page.click("#adil-btn-solve-now")
        time.sleep(3)
        page.screenshot(path=r"d:\TheAdilAI\test_kiterooms_result.png")

        browser.close()

    print("\n" + "="*50)
    print("VERIFICATION SUMMARY:")
    print("="*50)
    for r in results:
        status_icon = "✅" if r['success'] else "❌"
        print(f"{status_icon} [{r['page']}] {r['question']}: {r['status']}")

    return results

if __name__ == "__main__":
    run_tests()
