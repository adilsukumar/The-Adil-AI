// ==UserScript==
// @name         Adil AI - Universal MCQ Solver (200ms Turbo & Smart Floating HUD)
// @namespace    https://theadilai.local
// @version      18.0
// @description  Universal AI MCQ solver with 95%+ Precision (Chain-of-Thought + Multimodal Vision). 200ms Groq Turbo & Gemini Vision. Works on all websites, Google Forms, Canvas, Moodle, KiteRooms, Unstop, Quizizz, and any MCQ/checkbox platform.
// @author       Adil
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ----------------------------------------------------
    // API Keys Configuration (Enter keys below or via HUD ⚙️)
    // ----------------------------------------------------
    const DEFAULT_GROQ_KEY = ""; // Groq API Key (Free: https://console.groq.com/)
    const DEFAULT_GEMINI_KEY = ""; // Gemini API Key (Free: https://aistudio.google.com/)

    // Engine: Default to GROQ for ultra-fast 200ms response
    let currentProvider = GM_getValue('SELECTED_PROVIDER', 'GROQ');
    if (currentProvider !== 'GROQ' && currentProvider !== 'GEMINI') {
        currentProvider = 'GROQ';
    }
    let customGroqKey = GM_getValue('GROQ_KEY', '') || DEFAULT_GROQ_KEY;
    let customGeminiKey = GM_getValue('GEMINI_KEY', '') || DEFAULT_GEMINI_KEY;

    // Execution States - STRICTLY FALSE BY DEFAULT
    // Autopilot NEVER runs while user is navigating, logging in, or browsing courses!
    let isRunning = false;
    let solveMode = GM_getValue('ADIL_SOLVE_MODE', 'AUTO'); // 'AUTO' or 'MANUAL'
    let autoNext = GM_getValue('ADIL_AUTO_NEXT', false); // False by default: waits for user to press next!
    let enableToasts = GM_getValue('ADIL_ENABLE_TOASTS', false); // False by default: NO bottom popup banner!
    let isMinimized = GM_getValue('ADIL_MINIMIZED', false);
    let isSettingsOpen = false;

    let isSolving = false;
    let isTargeting = false;
    let isWaitingForNext = false;
    let lastSolvedQuestionText = "";
    let lastSolvedSignature = "";
    let lockedTargetContainer = null;
    let lastStatusMsg = "Standby (Click START on Quiz)";
    let lastStatusColor = "#94A3B8";

    // DOM Elements
    let widgetHud = null;
    let toastContainer = null;

    function getActiveKey() {
        return (currentProvider === 'GROQ') ? customGroqKey : customGeminiKey;
    }

    // ----------------------------------------------------
    // Strict Anti-Navigation Protection
    // ----------------------------------------------------
    const BANNED_BUTTON_EXACT = new Set([
        'home', 'back', 'go back', 'exit', 'leave', 'leave room', 'dashboard', 'menu', 
        'next', 'next question', 'previous', 'prev', 'skip', 'submit', 'finish', 'end test', 
        'end exam', 'clear response', 'save', 'save & next', 'save and next', 
        'mark for review', 'review later', 'flag', 'unflag', 'calculator', 'notes', 
        'close', 'cancel', 'help', 'support', 'chat', 'participants', 'raise hand', 
        'mic', 'camera', 'mute', 'unmute', 'instructions', 'rules', 'logout', 'sign in',
        'learning', 'rooms', 'return', 'courses', 'course', 'module', 'lesson', 'overview',
        'start', 'join', 'join room', 'retry', 'restart', 'syllabus', 'profile'
    ]);

    function isDirectNavButton(el) {
        if (!el || el === document.body || el === document.documentElement) return false;
        if (el.id && el.id.startsWith('adil-ai')) return true;
        if (el.closest && el.closest('[id^="adil-ai"]')) return true;

        // Hyperlinks: only block if it is a real navigation URL leaving the page
        const anchor = el.tagName === 'A' ? el : (el.closest ? el.closest('a') : null);
        if (anchor) {
            const role = (anchor.getAttribute('role') || '').toLowerCase();
            const href = (anchor.getAttribute('href') || '').trim();
            // If it acts as a button/choice/radio, it is NOT navigation
            if (role === 'button' || role === 'radio' || role === 'option' || anchor.classList.contains('choice') || anchor.classList.contains('option')) {
                // Legitimate choice
            } else if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                // Real external link
                return true;
            }
        }

        // Structural landmarks
        if (['NAV', 'FOOTER', 'HEADER'].includes(el.tagName)) return true;
        if (el.closest && el.closest('nav, footer, header:not([class*="card"]), [class*="navbar"], [class*="breadcrumb"]')) return true;

        const role = el.getAttribute ? el.getAttribute('role') : null;
        if (['navigation', 'menubar', 'toolbar'].includes(role)) return true;

        // Button text checks - ONLY exact matches against banned navigation buttons
        const rawTxt = el.innerText ? el.innerText.trim() : (el.textContent ? el.textContent.trim() : '');
        const cleanTxt = rawTxt.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

        if (cleanTxt.length > 0 && cleanTxt.length < 30) {
            if (BANNED_BUTTON_EXACT.has(cleanTxt)) return true;
        }

        const aria = (el.getAttribute && el.getAttribute('aria-label') ? el.getAttribute('aria-label') : '').toLowerCase().trim();
        const title = (el.getAttribute && el.getAttribute('title') ? el.getAttribute('title') : '').toLowerCase().trim();
        if (BANNED_BUTTON_EXACT.has(aria) || BANNED_BUTTON_EXACT.has(title)) return true;

        return false;
    }

    function extractOptionText(el) {
        if (!el) return "";

        // Check attributes first (crucial for Google Forms, ARIA radios, and modern web apps)
        const ariaLabel = (el.getAttribute('aria-label') || '').trim();
        const dataValue = (el.getAttribute('data-value') || '').trim();
        const title = (el.getAttribute('title') || '').trim();

        if (el.tagName === 'INPUT') {
            if (el.id) {
                const label = document.querySelector(`label[for="${el.id}"]`);
                if (label && label.innerText.trim()) return label.innerText.trim();
            }
            const parentLabel = el.closest('label');
            if (parentLabel && parentLabel.innerText.trim()) return parentLabel.innerText.trim();

            const parent = el.parentElement;
            if (parent && parent.innerText.trim()) return parent.innerText.trim();

            if (el.value && el.value.length > 0 && isNaN(el.value)) return el.value.trim();
        }

        // In Google Forms and ARIA widgets, text might be in span or attribute
        let raw = el.innerText ? el.innerText.trim() : (el.textContent ? el.textContent.trim() : '');
        if (!raw || raw.length === 0) {
            raw = ariaLabel || dataValue || title || "";
        }
        if (!raw || raw.length === 0) {
            const innerImg = el.querySelector('img, svg');
            if (innerImg) {
                raw = innerImg.getAttribute('alt') || innerImg.getAttribute('title') || innerImg.getAttribute('aria-label') || "";
            }
        }

        const cleaned = raw.replace(/^\s*(\([A-Da-d1-6]\)|[A-Da-d1-6][\.\:\)\s-])\s*/, '').trim();
        return cleaned || raw;
    }

    // ----------------------------------------------------
    // ----------------------------------------------------
    // Multimodal Image & Diagram Vision Processor
    // ----------------------------------------------------
    function findImageInContainer(container) {
        if (!container) return null;
        let img = container.querySelector('img, picture img, svg, canvas');
        if (!img && container.previousElementSibling) {
            img = container.previousElementSibling.querySelector('img, picture img, svg, canvas') || 
                  (container.previousElementSibling.tagName === 'IMG' ? container.previousElementSibling : null);
        }
        if (!img && container.parentElement) {
            img = container.parentElement.querySelector('img, picture img, svg, canvas');
        }
        if (!img && container.parentElement && container.parentElement.parentElement) {
            img = container.parentElement.parentElement.querySelector('img, picture img, svg, canvas');
        }

        if (img && img.tagName === 'IMG') {
            const rect = img.getBoundingClientRect();
            if (rect.width < 40 || rect.height < 40) return null;
            const src = (img.src || img.getAttribute('data-src') || '').trim();
            if (/avatar|icon|logo|badge|thumb|user/i.test(src) && !/quiz|map|question|exam|problem/i.test(src)) {
                return null;
            }
            return img;
        }
        return img;
    }

    function extractImageBase64(imgEl) {
        return new Promise((resolve) => {
            if (!imgEl) return resolve(null);

            // 1. If already inline base64 data URL
            const currentSrc = imgEl.src || imgEl.getAttribute('data-src') || '';
            if (currentSrc.startsWith('data:image')) {
                const parts = currentSrc.split(',');
                return resolve(parts[1] || null);
            }

            // 2. Direct HTML5 Canvas drawing (instant)
            try {
                const canvas = document.createElement('canvas');
                canvas.width = Math.min(imgEl.naturalWidth || imgEl.width || 800, 1280);
                canvas.height = Math.min(imgEl.naturalHeight || imgEl.height || 600, 960);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                if (dataUrl && dataUrl.length > 200) {
                    return resolve(dataUrl.split(',')[1]);
                }
            } catch (e) {
                // Cross-origin tainted canvas, fallback to GM_xmlhttpRequest below
            }

            // 3. GM_xmlhttpRequest download with arraybuffer/blob (bypasses CORS restrictions)
            if (!currentSrc || !currentSrc.startsWith('http')) {
                return resolve(null);
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url: currentSrc,
                responseType: 'blob',
                timeout: 3000,
                onload: (res) => {
                    if (res.response) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const result = reader.result;
                            if (result && typeof result === 'string') {
                                resolve(result.split(',')[1] || null);
                            } else {
                                resolve(null);
                            }
                        };
                        reader.readAsDataURL(res.response);
                    } else {
                        resolve(null);
                    }
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null)
            });
        });
    }

    function extractImageContext(container) {
        const img = findImageInContainer(container);
        if (!img) return "";
        const alt = (img.getAttribute('alt') || '').trim();
        const title = (img.getAttribute('title') || '').trim();
        const aria = (img.getAttribute('aria-label') || '').trim();
        const src = (img.getAttribute('src') || img.getAttribute('data-src') || '').trim();

        let fileHint = "";
        if (src && !alt) {
            const parts = src.split('/').pop().split('?')[0].replace(/[-_]/g, ' ');
            if (parts.length > 3 && !/^\d+\./.test(parts)) {
                fileHint = parts.replace(/\.[a-zA-Z0-9]+$/, '');
            }
        }

        const text = alt || title || aria || fileHint;
        if (text && text.length > 2 && !/^(image|photo|icon|logo|graphic|thumbnail)$/i.test(text)) {
            return text;
        }
        return "";
    }

    // ----------------------------------------------------
    // Strict Choice & Question Detectors (Universal)
    // ----------------------------------------------------
    function findChoicesInContainer(container) {
        if (!container || isDirectNavButton(container)) return [];

        // Strategy 1: Explicit radios or role="radio"
        const radios = Array.from(container.querySelectorAll('input[type="radio"], [role="radio"]'))
            .filter(r => !isDirectNavButton(r));
        if (radios.length >= 2 && radios.length <= 8) {
            return radios.map(r => r.closest('label') || r.parentElement || r);
        }

        // Strategy 2: Checkboxes in a quiz container
        const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'))
            .filter(c => !isDirectNavButton(c));
        if (checkboxes.length >= 2 && checkboxes.length <= 8) {
            return checkboxes.map(c => c.closest('label') || c.parentElement || c);
        }

        // Strategy 3: Dedicated option cards / choice elements
        const styledChoices = Array.from(container.querySelectorAll(
            '[class*="choice"], [class*="option"], [class*="answer"], [class*="option-item"], [class*="choice-card"], [class*="option-card"], [class*="choice_item"], [class*="quiz-opt"], [data-testid*="option"], [data-testid*="answer"], [role="option"]'
        )).filter(el => {
            if (isDirectNavButton(el)) return false;
            const txt = extractOptionText(el);
            return txt.length > 0 && txt.length < 350;
        });

        const filteredStyled = styledChoices.filter(el => 
            !styledChoices.some(other => other !== el && other.contains(el))
        );
        if (filteredStyled.length >= 2 && filteredStyled.length <= 8) {
            return filteredStyled;
        }

        // Strategy 4: Elements with clear option letters (A, B, C, D)
        const letterItems = Array.from(container.querySelectorAll('div, li, p, span, button'))
            .filter(el => {
                if (isDirectNavButton(el)) return false;
                const txt = el.innerText ? el.innerText.trim() : '';
                return /^\s*(\([A-Da-d1-6]\)|[A-Da-d1-6][\.\:\)\s-])\s+\S+/i.test(txt) && txt.length < 350;
            });
        const filteredLetters = letterItems.filter(el => 
            !letterItems.some(other => other !== el && other.contains(el))
        );
        if (filteredLetters.length >= 2 && filteredLetters.length <= 8) {
            return filteredLetters;
        }

        // Strategy 5: Labels inside form/fieldset
        const labels = Array.from(container.querySelectorAll('label'))
            .filter(l => {
                if (isDirectNavButton(l)) return false;
                const txt = extractOptionText(l);
                return txt.length > 0 && txt.length < 350;
            });
        if (labels.length >= 2 && labels.length <= 8) {
            return labels;
        }

        // Strategy 6: Group of 2 to 8 buttons or role="button"
        const allButtons = Array.from(container.querySelectorAll('button, [role="button"], a[role="button"], a[class*="btn"], a[class*="option"]'))
            .filter(b => {
                if (isDirectNavButton(b)) return false;
                if (b.type === 'submit' && b.closest('form:not([class*="quiz"]):not([class*="test"])')) return false;
                const txt = extractOptionText(b);
                return txt.length >= 1 && txt.length <= 150 && !/^(sign up|subscribe|search|submit email|close|accept|agree|next|next\s*->)$/i.test(txt);
            });

        if (allButtons.length >= 2 && allButtons.length <= 8) {
            const texts = new Set(allButtons.map(b => extractOptionText(b).toLowerCase()));
            if (texts.size >= 2) {
                return allButtons;
            }
        }

        // Strategy 7: List Items (ul > li, ol > li) - Common on Quizlet, Moodle, GfG, Sanfoundry
        const listItems = Array.from(container.querySelectorAll('li'))
            .filter(li => {
                if (isDirectNavButton(li)) return false;
                const txt = extractOptionText(li);
                return txt.length >= 1 && txt.length <= 350;
            });
        const filteredList = listItems.filter(li => !listItems.some(other => other !== li && other.contains(li)));
        if (filteredList.length >= 2 && filteredList.length <= 8) {
            return filteredList;
        }

        // Strategy 8: Direct sibling children (card blocks / div options)
        const directChildren = Array.from(container.children).filter(child => {
            if (isDirectNavButton(child)) return false;
            if (['H1', 'H2', 'H3', 'H4', 'H5', 'IMG', 'NAV', 'HEADER', 'FOOTER', 'SCRIPT', 'STYLE'].includes(child.tagName)) return false;
            const txt = extractOptionText(child);
            return txt.length >= 1 && txt.length <= 350;
        });
        if (directChildren.length >= 2 && directChildren.length <= 8) {
            const texts = new Set(directChildren.map(c => extractOptionText(c).toLowerCase()));
            if (texts.size >= 2) {
                return directChildren;
            }
        }

        // Strategy 9: Table rows / cells (tr, td)
        const tableRows = Array.from(container.querySelectorAll('table tr, tr'))
            .filter(tr => {
                if (isDirectNavButton(tr)) return false;
                const txt = extractOptionText(tr);
                return txt.length >= 1 && txt.length <= 350;
            });
        if (tableRows.length >= 2 && tableRows.length <= 8) {
            return tableRows;
        }

        return [];
    }

    function findQuestionInContainer(container, choices) {
        if (!container) return null;

        const imgContext = extractImageContext(container);
        const BANNED_HEADERS = ['learning', 'courses', 'course', 'room', 'rooms', 'kiterooms', 'dashboard', 'menu', 'overview', 'syllabus', 'modules', 'profile', 'settings'];
        const METADATA_REGEX = /^(question\s*\d+|q\s*[\.\:\-]?\s*\d+|\d+\s*of\s*\d+|score\b|points?\b|marks?\b|time\s*left|timer\b|multiple\s*choice|single\s*choice|\d+\s*pts?|required|mandatory)$/i;

        const isValidQuestionText = (txt) => {
            if (!txt || txt.length < 3) return false;
            const clean = txt.toLowerCase().trim();
            if (BANNED_HEADERS.some(b => clean === b || clean.startsWith(b + ' ') || clean.startsWith(b + ':'))) return false;
            return true;
        };

        // 1. Look inside container for heading or question class
        const allCandidates = Array.from(container.querySelectorAll(
            '[class*="question-text"], [class*="question_text"], [class*="question-title"], [class*="question-statement"], [class*="question-body"], [class*="prompt"], [class*="problem"], .M7eMe, [role="heading"], legend, h1, h2, h3, h4, h5, div[dir="auto"], pre, code, p, .font-bold, strong, b'
        )).filter(el => {
            if (choices.some(ch => ch === el || ch.contains(el))) return false;
            if (isDirectNavButton(el)) return false;
            const txt = el.innerText ? el.innerText.trim() : '';
            return isValidQuestionText(txt);
        });

        // Separate pure metadata counters from substantive question text
        const substantiveCandidates = allCandidates.filter(el => {
            const txt = el.innerText ? el.innerText.trim() : '';
            return !METADATA_REGEX.test(txt);
        });

        let baseTitle = "";
        if (substantiveCandidates.length > 0) {
            // Prioritize dedicated question classes
            const dedicated = substantiveCandidates.find(el => {
                const cls = (el.className || '').toLowerCase();
                return cls.includes('question') || cls.includes('statement') || cls.includes('prompt') || cls.includes('m7eme') || el.tagName === 'LEGEND';
            });
            if (dedicated) {
                baseTitle = dedicated.innerText.trim();
            } else {
                // Find candidate with longest descriptive text (avoids 3-word labels)
                substantiveCandidates.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);
                baseTitle = substantiveCandidates[0].innerText.trim();
            }
        } else {
            // Check previous sibling
            let sib = container.previousElementSibling;
            while (sib) {
                if (!isDirectNavButton(sib)) {
                    const txt = sib.innerText ? sib.innerText.trim() : '';
                    if (isValidQuestionText(txt) && !METADATA_REGEX.test(txt)) { baseTitle = txt; break; }
                }
                sib = sib.previousElementSibling;
            }

            // Check parent header up to 4 levels
            if (!baseTitle) {
                let p = container.parentElement;
                for (let lvl = 0; lvl < 4 && p && p !== document.body && p !== document.documentElement; lvl++) {
                    const ph = p.querySelector('[class*="question"], [class*="statement"], [class*="title"], [class*="heading"], h1, h2, h3, h4, .font-bold, strong, b, p');
                    if (ph && !choices.some(ch => ch === ph || ch.contains(ph)) && !isDirectNavButton(ph)) {
                        const txt = ph.innerText ? ph.innerText.trim() : '';
                        if (isValidQuestionText(txt) && !METADATA_REGEX.test(txt)) {
                            baseTitle = txt;
                            break;
                        }
                    }
                    p = p.parentElement;
                }
            }
        }

        // If card has an image with context (e.g. locator map alt text), append it!
        if (imgContext) {
            return (baseTitle ? baseTitle + " " : "Identify the item: ") + `[Image Details: ${imgContext}]`;
        }

        if (baseTitle && baseTitle.length >= 4) {
            return baseTitle;
        }

        // Fallback: document title or generic prompt if choices are present
        const pageTitle = (document.title || '').replace(/\s*\|.*$/, '').replace(/quiz/i, 'Quiz').trim();
        if (pageTitle && pageTitle.length > 3) {
            return `[Quiz: ${pageTitle}] Select the correct answer:`;
        }

        return "Select the correct answer:";
    }

    // ------------------------------------------------
    // Detect if a question is multi-select (checkbox)
    // ------------------------------------------------
    function isMultiSelectQuestion(container, choices) {
        // 1. Any real checkbox inputs?
        const checkboxInputs = container ? container.querySelectorAll('input[type="checkbox"]') : [];
        if (checkboxInputs.length >= 2) return true;

        // 2. ARIA checkboxes
        const ariaCheckboxes = container ? container.querySelectorAll('[role="checkbox"]') : [];
        if (ariaCheckboxes.length >= 2) return true;

        // 3. Question text hints
        const qText = (container ? container.innerText || '' : '').toLowerCase();
        if (/select all|choose all|mark all|all that apply|multiple correct|more than one|pick all/i.test(qText)) return true;

        // 4. Google Forms checkbox type (div[role="checkbox"])
        if (choices && choices.length >= 2) {
            const anyCheckbox = choices.some(ch => {
                const inp = ch.tagName === 'INPUT' ? ch : ch.querySelector('input');
                if (inp && inp.type === 'checkbox') return true;
                if (ch.getAttribute && (ch.getAttribute('role') === 'checkbox')) return true;
                // Google Forms: .docssharedWizToggleLabeledContainer with checkbox
                if (ch.className && /checkbox|multiselect|multi.select/i.test(ch.className)) return true;
                return false;
            });
            if (anyCheckbox) return true;
        }
        return false;
    }

    function buildMCQResult(qText, rawElements, container) {
        if (!qText || qText.length < 3) return null;

        // Filter out any navigation buttons instead of rejecting the whole quiz
        const validElements = rawElements.filter(el => !isDirectNavButton(el));
        if (validElements.length < 2 || validElements.length > 8) return null;

        const options = validElements.map((el, i) => {
            const raw = el.innerText ? el.innerText.trim() : (el.textContent ? el.textContent.trim() : '');
            const clean = extractOptionText(el);
            return {
                text: clean || `Option ${i + 1}`,
                rawText: raw,
                element: el
            };
        });

        const validCount = options.filter(opt => opt.text && opt.text.trim().length > 0).length;
        if (validCount < 2) return null;

        // Locate any diagram / map / question image
        const imgEl = findImageInContainer(container);

        // Detect if this is a multi-select (checkbox) question
        const isMulti = isMultiSelectQuestion(container, validElements);

        return {
            questionText: qText,
            options: options,
            container: container,
            imageElement: imgEl,
            isMultiSelect: isMulti
        };
    }

    function findQuizCardFromElement(startEl) {
        if (!startEl) return null;

        // Step 1: If user clicked an individual option button or text, its siblings are the other options!
        let parent = startEl.parentElement;
        for (let pLevel = 0; pLevel < 3 && parent && parent !== document.body; pLevel++) {
            const siblings = Array.from(parent.children).filter(c => {
                if (isDirectNavButton(c)) return false;
                const txt = extractOptionText(c);
                return txt.length >= 1 && txt.length <= 350;
            });
            if (siblings.length >= 2 && siblings.length <= 8) {
                const enclosingCard = parent.closest('fieldset, form, [class*="card"], [class*="slide"], [class*="quiz"], [class*="question"], section, article, main') || parent.parentElement || parent;
                const qText = findQuestionInContainer(enclosingCard, siblings);
                if (qText) {
                    const res = buildMCQResult(qText, siblings, enclosingCard);
                    if (res) return res;
                }
            }
            parent = parent.parentElement;
        }

        // Step 2: Traverse up ancestors
        let curr = startEl;
        for (let i = 0; i < 8 && curr && curr !== document.body && curr !== document.documentElement; i++) {
            const choices = findChoicesInContainer(curr);
            if (choices.length >= 2 && choices.length <= 8) {
                const card = curr.closest('fieldset, form, [class*="card"], [class*="slide"], [class*="quiz"], [class*="question"], section, article, main') || curr.parentElement || curr;
                const qText = findQuestionInContainer(card, choices);
                if (qText) {
                    const res = buildMCQResult(qText, choices, card);
                    if (res) return res;
                }
            }
            curr = curr.parentElement;
        }
        return null;
    }

    function findMostProminentMCQInViewport() {
        const candidates = Array.from(document.querySelectorAll(
            'fieldset, form, [role="listitem"], [role="radiogroup"], [role="group"], [data-item-id], [class*="card"], [class*="slide"], [class*="quiz"], [class*="question"], [class*="assessment"], [class*="test"], [class*="exam"], [class*="problem"], [data-testid*="quiz"], [data-testid*="question"], [id*="quiz"], [id*="question"], [class*="interactive"], [class*="game"], section, article, main'
        )).filter(el => {
            if (isDirectNavButton(el)) return false;
            const rect = el.getBoundingClientRect();
            // Visible in viewport check (no brittle bottom clamp)
            return rect.width > 120 && rect.height > 60 && rect.top < window.innerHeight && rect.bottom > 0;
        });

        for (const c of candidates) {
            const choices = findChoicesInContainer(c);
            if (choices.length >= 2 && choices.length <= 8) {
                const qText = findQuestionInContainer(c, choices);
                if (qText) {
                    const res = buildMCQResult(qText, choices, c);
                    if (res) return res;
                }
            }
        }
        return null;
    }

    // ----------------------------------------------------
    // Platform-Specific & Cluster Detectors
    // ----------------------------------------------------

    // 1. Dedicated Google Forms Detector (supports both radio AND checkbox questions)
    function detectGoogleForms() {
        const isForms = (window.location.hostname.includes('docs.google.com') && window.location.pathname.includes('/forms/')) ||
                        document.querySelector('div[role="listitem"], div[data-item-id], div[jsmodel], .freebirdFormviewerViewItemList');
        if (!isForms) return null;

        const formItems = Array.from(document.querySelectorAll('div[role="listitem"], div[data-item-id], div[jsmodel]'));
        if (formItems.length === 0) return null;

        // Find question cards currently visible on screen
        const visibleItems = formItems.filter(item => {
            const rect = item.getBoundingClientRect();
            return rect.top < window.innerHeight - 20 && rect.bottom > 20 && rect.width > 150;
        });

        if (visibleItems.length === 0) return null;

        // Filter out items that are already answered (has aria-checked="true" or checked input)
        const unansweredItems = visibleItems.filter(item => {
            const hasChecked = item.querySelector('[aria-checked="true"], input:checked, [class*="isChecked"]');
            return !hasChecked;
        });

        // Pick the first visible unanswered question card: in natural top-to-bottom reading order!
        const targetList = unansweredItems.length > 0 ? unansweredItems : visibleItems;
        targetList.sort((a, b) => {
            const aTop = a.getBoundingClientRect().top;
            const bTop = b.getBoundingClientRect().top;
            return aTop - bTop;
        });

        const activeCard = targetList[0];

        // 1. Find question text
        const titleEl = activeCard.querySelector('[role="heading"], span.M7eMe, div[dir="auto"], h2, h3');
        let qText = titleEl ? titleEl.innerText.trim() : "";
        if (!qText) {
            qText = findQuestionInContainer(activeCard, []) || "Answer this question:";
        }

        // 2. Find options — support both radio AND checkbox (Google Forms MSQ)
        //    Radio: div[role="radio"], Checkbox: div[role="checkbox"]
        const radioEls = Array.from(activeCard.querySelectorAll('div[role="radio"], div.docssharedWizToggleLabeledContainer.isRadio, div.nWQGrd'))
            .filter(r => { if (isDirectNavButton(r)) return false; const txt = extractOptionText(r); return txt.length >= 1 && txt.length <= 350; });

        const checkboxEls = Array.from(activeCard.querySelectorAll('div[role="checkbox"], div.docssharedWizToggleLabeledContainer:not(.isRadio), input[type="checkbox"]'))
            .filter(c => { if (isDirectNavButton(c)) return false; const txt = extractOptionText(c); return txt.length >= 1 && txt.length <= 350; });

        // Choose whichever type is present
        const rawChoices = checkboxEls.length >= 2 ? checkboxEls : radioEls;

        // Fallback: label elements
        const labelChoices = rawChoices.length < 2
            ? Array.from(activeCard.querySelectorAll('label')).filter(l => { if (isDirectNavButton(l)) return false; const txt = extractOptionText(l); return txt.length >= 1 && txt.length <= 350; })
            : [];

        const allChoices = rawChoices.length >= 2 ? rawChoices : labelChoices;

        // Deduplicate nested items
        const filteredChoices = allChoices.filter(r => !allChoices.some(other => other !== r && other.contains(r)));
        if (filteredChoices.length >= 2 && filteredChoices.length <= 8) {
            return buildMCQResult(qText, filteredChoices, activeCard);
        }

        return null;
    }

    // 2. Dedicated Britannica Quiz Detector
    function detectBritannica() {
        const isBritannica = window.location.hostname.includes('britannica.com') ||
                             document.querySelector('[data-quiz-slug], #quiz-question-container, [class*="border-top-card"]');
        if (!isBritannica) return null;

        const card = document.querySelector('#quiz-question-container, .border-top-card-1, [class*="border-top-card"]') ||
                     document.querySelector('main');
        if (!card) return null;

        // Find the 4 choice buttons in the grid
        const allButtons = Array.from(card.querySelectorAll('button'))
            .filter(b => {
                if (isDirectNavButton(b)) return false;
                const txt = extractOptionText(b);
                if (!txt || txt.length < 1 || txt.length > 80) return false;
                if (/^(next|next\s*->|next\s*→|sign up|subscribe|close|start|retry)$/i.test(txt)) return false;
                return true;
            });

        if (allButtons.length >= 2 && allButtons.length <= 8) {
            const qText = findQuestionInContainer(card, allButtons);
            return buildMCQResult(qText, allButtons, card);
        }
        return null;
    }

    // 2. Dedicated Unstop Assessment Detector (supports single + multi-select)
    function detectUnstop() {
        const qContainer = document.querySelector(
            '[class*="question-statement"], [class*="question_title"], [class*="question-details"], ' +
            '[class*="assessment-question"], .ck-content, [class*="question-section"], ' +
            '[class*="question-text"], [class*="questionText"], [class*="question-body"]'
        );
        if (!qContainer) return null;

        const mainCard = qContainer.closest('section, div.assessment-content, div.test-container, main, [class*="question-card"], [class*="question-wrapper"]') || qContainer.parentElement;

        // Single-choice options
        const singleOpts = Array.from(mainCard.querySelectorAll(
            '[class*="option-item"], [class*="option_item"], [class*="option-tile"], [class*="option_tile"], ' +
            '[class*="option-card"], [class*="single-choice"], .ans-option, [class*="answer-option"]'
        )).filter(el => !isDirectNavButton(el));

        // Multi-select (checkbox) options
        const multiOpts = Array.from(mainCard.querySelectorAll(
            '[class*="multi-choice"], [class*="multi_choice"], [class*="checkbox-option"], ' +
            'input[type="checkbox"], [role="checkbox"]'
        )).filter(el => !isDirectNavButton(el))
          .map(el => el.closest('label, [class*="option"], [class*="answer"]') || el.parentElement || el);

        // Prefer multi if found (deduplicate)
        const rawOpts = multiOpts.length >= 2 ? multiOpts : singleOpts;
        const optionEls = rawOpts.filter((el, i, arr) => !arr.some((other, j) => j !== i && other.contains(el)));

        if (optionEls.length >= 2 && optionEls.length <= 8) {
            return buildMCQResult(qContainer.innerText.trim(), optionEls, mainCard);
        }

        // Fallback: universal detection inside the question card
        const choices = findChoicesInContainer(mainCard);
        if (choices.length >= 2 && choices.length <= 8) {
            return buildMCQResult(qContainer.innerText.trim(), choices, mainCard);
        }
        return null;
    }

    // 3. Dedicated KiteRooms Learning Slide Detector (enhanced)
    function detectKiteRooms() {
        // Individual active slide containers (most specific first, must be visible)
        const slideSelectors = [
            '.quiz-slide', '[class*="quiz-slide"]', '[class*="quiz_slide"]',
            '.question-slide', '[class*="question-slide"]', '[class*="question_slide"]',
            '[class*="quiz-container"]:not(body):not(html):not([class*="slide-content"])',
            '[class*="question-container"]:not(body):not(html):not([class*="slide-content"])',
            '[class*="slide-wrapper"]:not([class*="content"])',
            'main [class*="slide"]'
        ];

        let activeSlide = null;
        for (const sel of slideSelectors) {
            try {
                const candidates = Array.from(document.querySelectorAll(sel)).filter(el => {
                    if (isDirectNavButton(el)) return false;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 100 && rect.height > 50;
                });
                if (candidates.length > 0) {
                    activeSlide = candidates[0];
                    break;
                }
            } catch (e) {}
        }

        // Fallback: check children inside slide-content or main
        if (!activeSlide) {
            const container = document.querySelector('.slide-content, main, [class*="learning"]');
            if (container) {
                const childCards = Array.from(container.children).filter(el => {
                    if (isDirectNavButton(el)) return false;
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && el.getBoundingClientRect().height > 50;
                });
                if (childCards.length > 0) activeSlide = childCards[0];
            }
        }

        if (!activeSlide) return null;

        // Find choices inside this specific active slide
        const choices = findChoicesInContainer(activeSlide);
        if (choices.length >= 2 && choices.length <= 8) {
            const qText = findQuestionInContainer(activeSlide, choices);
            if (qText) {
                return buildMCQResult(qText, choices, activeSlide);
            }
        }
        return findQuizCardFromElement(activeSlide);
    }

    // 4. Dedicated Quizizz Detector (Supports Quizizz SPA, KaTeX math & rich choices)
    function detectQuizizz() {
        const isQuizizz = window.location.hostname.includes('quizizz.com') ||
                          document.querySelector('[data-testid="question-container"], [data-testid="question-text"], .game-question-container');
        if (!isQuizizz) return null;

        const qContainer = document.querySelector('[data-testid="question-container"], .game-question-container, .main-screen-container, main') || document.body;

        const promptEl = qContainer.querySelector('[data-testid="question-text"], .question-text-color, .resizeable-text, [class*="question-text"], p');
        const qText = promptEl ? promptEl.innerText.trim() : findQuestionInContainer(qContainer, []);
        if (!qText || qText.length < 2) return null;

        const optionsGrid = qContainer.querySelector('[data-testid="options-grid"], .options-grid, [class*="options-grid"]') || qContainer;
        let choiceElements = Array.from(optionsGrid.querySelectorAll(
            '[data-testid^="option"], [class*="option-container"], [class*="option-inner"], button[class*="option"]'
        )).filter(el => !isDirectNavButton(el));

        // Deduplicate nested elements
        choiceElements = choiceElements.filter(el => !choiceElements.some(other => other !== el && other.contains(el)));

        if (choiceElements.length >= 2 && choiceElements.length <= 8) {
            return buildMCQResult(qText, choiceElements, qContainer);
        }
        return null;
    }

    // 4. Universal Choice Cluster Detector (True-LCA Algorithm)
    // Works across ANY website, ANY framework (React, Vue, Tailwind, Angular, Bootstrap, custom portals)
    function detectUniversalClusters() {
        const visibleChoices = Array.from(document.querySelectorAll(
            'button, [role="button"], [role="radio"], [role="option"], [role="checkbox"], label, li, ' +
            'a[class*="btn"], a[class*="choice"], a[class*="option"], ' +
            'div[class*="choice"], div[class*="option"], div[class*="answer"], div[class*="item"], div[class*="card"], ' +
            'div[role="listitem"] div[role="radio"], div[onclick], div[cursor*="pointer"], div[tabindex]'
        )).filter(el => {
            if (isDirectNavButton(el)) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 25 || rect.height < 14) return false;
            if (rect.top < -100 || rect.bottom > window.innerHeight + 100) return false;
            const txt = extractOptionText(el);
            if (!txt || txt.length < 1 || txt.length > 300) return false;
            if (/^(sign up|subscribe|search|submit email|close|accept|agree|next|previous|prev|skip|clear)$/i.test(txt)) return false;
            return true;
        });

        if (visibleChoices.length < 2) return null;

        // Multi-level ancestor clustering (LCA):
        // Each candidate registers itself with ancestors at levels 1 through 5
        const ancestorMap = new Map();
        for (const el of visibleChoices) {
            let p = el.parentElement;
            for (let lvl = 1; lvl <= 5 && p && p !== document.body && p !== document.documentElement; lvl++) {
                if (['NAV', 'HEADER', 'FOOTER'].includes(p.tagName)) break;
                if (!ancestorMap.has(p)) {
                    ancestorMap.set(p, []);
                }
                ancestorMap.get(p).push(el);
                p = p.parentElement;
            }
        }

        // Find candidate clusters with 2 to 8 items
        const validClusters = [];
        for (const [ancestor, items] of ancestorMap.entries()) {
            const uniqueItems = items.filter(it => !items.some(other => other !== it && other.contains(it)));
            if (uniqueItems.length >= 2 && uniqueItems.length <= 8) {
                const texts = new Set(uniqueItems.map(it => extractOptionText(it).toLowerCase()));
                if (texts.size >= 2) {
                    let depth = 0;
                    let curr = ancestor;
                    while (curr && curr !== document.body) { depth++; curr = curr.parentElement; }

                    const rect = ancestor.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    const distFromCenter = Math.abs(midY - window.innerHeight / 2);

                    validClusters.push({
                        ancestor: ancestor,
                        items: uniqueItems,
                        depth: depth,
                        distFromCenter: distFromCenter
                    });
                }
            }
        }

        if (validClusters.length === 0) return null;

        // Sort: deepest container first (most specific choice cluster), then closest to center of viewport
        validClusters.sort((a, b) => {
            if (b.depth !== a.depth) return b.depth - a.depth;
            return a.distFromCenter - b.distFromCenter;
        });

        for (const cluster of validClusters) {
            const card = cluster.ancestor.closest(
                'fieldset, form, [role="listitem"], [class*="card"], [class*="slide"], [class*="quiz"], [class*="question"], [class*="assessment"], [class*="test"], [class*="exam"], section, article, main'
            ) || cluster.ancestor.parentElement || cluster.ancestor;

            const qText = findQuestionInContainer(card, cluster.items);
            if (qText) {
                const res = buildMCQResult(qText, cluster.items, card);
                if (res) return res;
            }
        }
        return null;
    }

    function detectMCQ() {
        try {
            // Priority 0: Locked target container from "🎯 Target Quiz Card"
            if (lockedTargetContainer && document.body.contains(lockedTargetContainer)) {
                const choices = findChoicesInContainer(lockedTargetContainer);
                if (choices.length >= 2 && choices.length <= 8) {
                    const qText = findQuestionInContainer(lockedTargetContainer, choices);
                    if (qText) {
                        return buildMCQResult(qText, choices, lockedTargetContainer);
                    }
                }
                const found = findQuizCardFromElement(lockedTargetContainer);
                if (found) return found;
            }

            // Priority 1: High-accuracy universal detectors
            return detectGoogleForms()
                || detectQuizizz()
                || detectUniversalClusters()
                || detectBritannica()
                || detectUnstop() 
                || detectKiteRooms() 
                || findMostProminentMCQInViewport();
        } catch (e) {
            console.error("[Adil AI] Detection exception:", e);
            return null;
        }
    }

    // ----------------------------------------------------
    // ----------------------------------------------------
    // Ultra-Fast & 95%+ Precision AI Engine (Groq Turbo & Gemini Vision)
    // ----------------------------------------------------
    function queryAI(questionText, options, imageBase64 = null, isMultiSelect = false) {
        return new Promise((resolve, reject) => {
            const key = getActiveKey();
            if (!key) {
                reject(new Error("API key missing. Click ⚙️ to enter your key."));
                return;
            }

            const formattedOptions = options.map((opt, i) => `${i} (${String.fromCharCode(65 + i)}): "${opt.text}"`).join('\n');
            const startTime = performance.now();

            // Multi-select JSON schema differs from single-answer
            const singleSchema = '{"thought": "<1-sentence verification proving why the chosen answer is correct>", "correct_index": <0-based integer>, "correct_letter": "<A/B/C/D>"}';
            const multiSchema  = '{"thought": "<1-sentence verification proving which answers are correct>", "correct_indices": [<0-based integers>], "correct_letters": ["<A>","<B>"]}';
            const jsonSchema = isMultiSelect ? multiSchema : singleSchema;
            const multiInstruction = isMultiSelect
                ? 'This is a MULTI-SELECT question (select ALL correct answers). Output ALL correct option indices as an array in correct_indices.'
                : 'This is a SINGLE-ANSWER question. Output only one correct_index.';

            // Automatic Vision Routing: Use Gemini Vision whenever an image/map/diagram is present
            const useGeminiVision = Boolean(imageBase64) || currentProvider === "GEMINI";

            if (useGeminiVision) {
                const geminiKey = customGeminiKey || DEFAULT_GEMINI_KEY;
                const geminiPrompt = (
                    "You are a master academic examination solver with 100% precision.\n" +
                    (imageBase64 ? "Examine the provided image (map, diagram, chart, or visual question) with extreme care.\n" : "") +
                    `Question: ${questionText}\n` +
                    `Choices:\n${formattedOptions}\n\n` +
                    `${multiInstruction}\n` +
                    "Instructions:\n" +
                    "1. Step-by-step verification: verify key visual details, country locations, scientific facts, or logic.\n" +
                    "2. Output strictly JSON:\n" +
                    jsonSchema
                );

                const geminiModels = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
                const tryGemini = (modelIndex) => {
                    if (modelIndex >= geminiModels.length) {
                        // Fallback to Groq if Gemini key fails and no image is required
                        if (!imageBase64 && currentProvider !== "GEMINI") {
                            callGroq();
                            return;
                        }
                        reject(new Error("Gemini Vision failed. Please check Gemini API Key in ⚙️."));
                        return;
                    }
                    const modelName = geminiModels[modelIndex];
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey.trim()}`;
                    
                    const parts = [];
                    if (imageBase64) {
                        parts.push({
                            inline_data: {
                                mime_type: "image/jpeg",
                                data: imageBase64
                            }
                        });
                    }
                    parts.push({ text: geminiPrompt });

                    const payload = {
                        contents: [{ parts: parts }],
                        generationConfig: {
                            responseMimeType: "application/json",
                            temperature: 0.0,
                            maxOutputTokens: 300
                        }
                    };

                    GM_xmlhttpRequest({
                        method: "POST",
                        url: url,
                        headers: { "Content-Type": "application/json" },
                        data: JSON.stringify(payload),
                        timeout: 5500,
                        onload: (res) => {
                            if (res.status === 200) {
                                const latency = Math.round(performance.now() - startTime);
                                try {
                                    const data = JSON.parse(res.responseText);
                                    const rawText = data.candidates[0].content.parts[0].text;
                                    const match = rawText.match(/\{[\s\S]*?\}/);
                                    const parsed = JSON.parse(match ? match[0] : rawText);
                                    parsed.latency = latency;
                                    parsed.model = modelName;
                                    resolve(parsed);
                                } catch (err) {
                                    tryGemini(modelIndex + 1);
                                }
                            } else {
                                tryGemini(modelIndex + 1);
                            }
                        },
                        onerror: () => tryGemini(modelIndex + 1),
                        ontimeout: () => tryGemini(modelIndex + 1)
                    });
                };
                tryGemini(0);

            } else {
                callGroq();
            }

            function callGroq() {
                const groqPrompt = (
                    "You are a master academic examination solver with 100% accuracy.\n" +
                    `Question: ${questionText}\n` +
                    `Choices:\n${formattedOptions}\n\n` +
                    `${multiInstruction}\n` +
                    "Solve this MCQ. Reason step-by-step, eliminate distractors, and output JSON strictly:\n" +
                    jsonSchema
                );

                const payload = {
                    model: "qwen/qwen3.8-27b",
                    messages: [
                        { role: "system", content: "You are a master examination solver with 100% accuracy. Always verify your reasoning before outputting the index." },
                        { role: "user", content: groqPrompt }
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0.0,
                    max_tokens: 200
                };

                const groqKey = customGroqKey || DEFAULT_GROQ_KEY;
                GM_xmlhttpRequest({
                    method: "POST",
                    url: "https://api.groq.com/openai/v1/chat/completions",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${groqKey.trim()}`
                    },
                    data: JSON.stringify(payload),
                    timeout: 4000,
                    onload: (res) => {
                        const latency = Math.round(performance.now() - startTime);
                        if (res.status === 200) {
                            try {
                                const data = JSON.parse(res.responseText);
                                const rawContent = data.choices[0].message.content;
                                const match = rawContent.match(/\{[\s\S]*?\}/);
                                const parsed = JSON.parse(match ? match[0] : rawContent);
                                parsed.latency = latency;
                                parsed.model = "qwen/qwen3.8-27b";
                                resolve(parsed);
                            } catch (err) {
                                const idxMatch = res.responseText.match(/"correct_index"\s*:\s*(\d+)/);
                                if (idxMatch) {
                                    resolve({ correct_index: parseInt(idxMatch[1]), latency: latency });
                                } else {
                                    reject(new Error("Failed to parse Groq response"));
                                }
                            }
                        } else {
                            // Fallback to Gemini if Groq returns error
                            const geminiKey = customGeminiKey || DEFAULT_GEMINI_KEY;
                            if (geminiKey) {
                                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiKey.trim()}`;
                                const pld = {
                                    contents: [{ parts: [{ text: groqPrompt }] }],
                                    generationConfig: { responseMimeType: "application/json", temperature: 0.0, maxOutputTokens: 300 }
                                };
                                GM_xmlhttpRequest({
                                    method: "POST",
                                    url: url,
                                    headers: { "Content-Type": "application/json" },
                                    data: JSON.stringify(pld),
                                    timeout: 4500,
                                    onload: (gres) => {
                                        if (gres.status === 200) {
                                            try {
                                                const gd = JSON.parse(gres.responseText);
                                                const gtxt = gd.candidates[0].content.parts[0].text;
                                                const gm = gtxt.match(/\{[\s\S]*?\}/);
                                                const gp = JSON.parse(gm ? gm[0] : gtxt);
                                                gp.latency = Math.round(performance.now() - startTime);
                                                resolve(gp);
                                                return;
                                            } catch (e) {}
                                        }
                                        reject(new Error(`Groq HTTP ${res.status}: check API Key`));
                                    },
                                    onerror: () => reject(new Error(`Groq HTTP ${res.status}`)),
                                    ontimeout: () => reject(new Error(`Groq HTTP ${res.status}`))
                                });
                            } else {
                                reject(new Error(`Groq HTTP ${res.status}: check API Key in ⚙️ Settings`));
                            }
                        }
                    },
                    onerror: () => reject(new Error("Groq network request failed")),
                    ontimeout: () => reject(new Error("Groq request timed out"))
                });
            }
        });
    }

    // ----------------------------------------------------
    // Safe Clicker (Strictly Prevents Page Reloads / Navigation)
    // ----------------------------------------------------
    function clickOptionElement(targetOption, isCheckboxMode = false) {
        if (!targetOption || !targetOption.element) return;
        const el = targetOption.element;

        if (isDirectNavButton(el)) {
            console.warn("[Adil AI] Blocked click on navigation element:", el);
            updateStatus("Blocked navigation click!", "#EF4444");
            return;
        }

        // If option is or contains an <a> tag, prevent full page navigation
        const anchor = el.tagName === 'A' ? el : (el.closest ? el.closest('a') : null);
        if (anchor) {
            const href = (anchor.getAttribute('href') || '').trim();
            if (href.startsWith('http') || (href.startsWith('/') && !href.startsWith('/#'))) {
                console.warn("[Adil AI] Blocked click on external link:", el);
                return;
            }
            anchor.onclick = (e) => { e.preventDefault(); };
        }

        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {}

        const radio = el.tagName === 'INPUT' ? el : el.querySelector('input[type="radio"], input[type="checkbox"]');
        const roleEl = el.getAttribute && (el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox')
            ? el
            : el.querySelector ? (el.querySelector('[role="radio"], [role="checkbox"]') || null) : null;

        const firePointerAndMouse = (target, eventType) => {
            if (!target) return;
            try {
                target.dispatchEvent(new PointerEvent(eventType, { bubbles: true, cancelable: true, view: window }));
            } catch (err) {
                try {
                    target.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true }));
                } catch (e2) {
                    try {
                        const evt = document.createEvent('MouseEvents');
                        evt.initEvent(eventType, true, true);
                        target.dispatchEvent(evt);
                    } catch (e3) {}
                }
            }
        };

        const clickTarget = roleEl || radio || el;

        if (radio) {
            // For checkboxes: only trigger click if not already checked (avoid toggling off!)
            if (radio.type === 'checkbox') {
                if (!radio.checked) {
                    firePointerAndMouse(radio, 'pointerdown');
                    firePointerAndMouse(radio, 'mousedown');
                    firePointerAndMouse(radio, 'pointerup');
                    firePointerAndMouse(radio, 'mouseup');
                    try { radio.click(); } catch (e) {}
                    if (!radio.checked) radio.checked = true;
                    try { radio.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
                    try { radio.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
                }
            } else {
                radio.checked = true;
                firePointerAndMouse(radio, 'pointerdown');
                firePointerAndMouse(radio, 'mousedown');
                firePointerAndMouse(radio, 'pointerup');
                firePointerAndMouse(radio, 'mouseup');
                try { radio.click(); } catch (e) {}
                try { radio.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
                try { radio.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
            }
        } else {
            // Button, Google Forms div[role="radio"/"checkbox"], or custom card choice
            const btn = el.tagName === 'BUTTON' ? el : (el.closest ? el.closest('button') : null);
            if (btn) {
                btn.type = 'button';
            }

            // For ARIA checkboxes: don't re-click if already checked
            if (clickTarget.getAttribute && clickTarget.getAttribute('aria-checked') === 'true' && isCheckboxMode) {
                // Skip — already selected
            } else {
                firePointerAndMouse(clickTarget, 'pointerdown');
                firePointerAndMouse(clickTarget, 'mousedown');
                firePointerAndMouse(clickTarget, 'pointerup');
                firePointerAndMouse(clickTarget, 'mouseup');
                try { clickTarget.click(); } catch (e) {}
                try { el.click(); } catch (e) {}

                // Also click parent container if Google Forms wrapper
                if (clickTarget.parentElement && clickTarget.parentElement !== document.body) {
                    try { clickTarget.parentElement.click(); } catch (e) {}
                }
            }
        }

        // Emerald Glow Visual Feedback
        const prevOutline = el.style.outline;
        const prevShadow = el.style.boxShadow;
        el.style.outline = '3px solid #10B981';
        el.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.9)';
        setTimeout(() => {
            el.style.outline = prevOutline;
            el.style.boxShadow = prevShadow;
        }, 2500);
    }

    function tryClickNextButton() {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const btn of buttons) {
            if (btn.id && btn.id.startsWith('adil-ai')) continue;
            if (btn.closest && btn.closest('[id^="adil-ai"]')) continue;
            if (btn.offsetParent === null) continue; // Must be visible

            const raw = (btn.innerText || btn.textContent || '').trim();
            const clean = raw.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
            if (['next', 'next question', 'continue', 'save next', 'save and next'].includes(clean)) {
                showToast("⏩ Auto-advancing to Next...", "#38BDF8", 1200);
                setTimeout(() => { 
                    try { btn.click(); } catch (e) {} 
                }, 400);
                return true;
            }
        }
        return false;
    }

    // ----------------------------------------------------
    // Solver Execution
    // ----------------------------------------------------
    async function solveTargetedMCQ(mcq) {
        if (!mcq || !mcq.options || mcq.options.length < 2) return;
        isSolving = true;

        try {
            let imageBase64 = null;
            if (mcq.imageElement) {
                updateStatus("📷 Capturing visual question...", "#A855F7");
                imageBase64 = await extractImageBase64(mcq.imageElement);
            }

            const activeEngine = imageBase64 ? "Gemini Vision" : currentProvider;
            const multiLabel = mcq.isMultiSelect ? " [MULTI-SELECT]" : "";
            updateStatus(`⚡ Solving with ${activeEngine}${multiLabel}...`, "#38BDF8");

            const result = await queryAI(mcq.questionText, mcq.options, imageBase64, mcq.isMultiSelect);
            const latencyStr = result.latency ? ` (${result.latency}ms)` : '';

            // ── MULTI-SELECT branch ──────────────────────────────────────
            if (mcq.isMultiSelect) {
                // Resolve correct_indices array
                let indices = [];
                if (Array.isArray(result.correct_indices) && result.correct_indices.length > 0) {
                    indices = result.correct_indices.filter(i => typeof i === 'number' && i >= 0 && i < mcq.options.length);
                }
                // Fallback: parse correct_letters array
                if (indices.length === 0 && Array.isArray(result.correct_letters)) {
                    indices = result.correct_letters
                        .map(l => l.toUpperCase().charCodeAt(0) - 65)
                        .filter(i => i >= 0 && i < mcq.options.length);
                }
                // Fallback: single index if model returned single answer anyway
                if (indices.length === 0 && typeof result.correct_index === 'number' && result.correct_index >= 0) {
                    indices = [result.correct_index];
                }

                if (indices.length > 0) {
                    lastSolvedSignature = mcq.questionText + "::" + mcq.options.map(o => o.text).join("|");
                    lastSolvedQuestionText = mcq.questionText;
                    isWaitingForNext = true;

                    // Click all correct options with small stagger (50ms) so React/Vue state catches each
                    for (let k = 0; k < indices.length; k++) {
                        const opt = mcq.options[indices[k]];
                        setTimeout(() => clickOptionElement(opt, true), k * 60);
                    }

                    const letters = indices.map(i => String.fromCharCode(65 + i)).join(', ');
                    const reasonSnippet = result.thought ? ` • "${result.thought.slice(0, 35)}..."` : '';
                    if (autoNext) {
                        updateStatus(`✔ [${letters}] MULTI${latencyStr} • Next in 1s`, "#10B981");
                        setTimeout(() => { tryClickNextButton(); }, 1000 + indices.length * 60);
                    } else {
                        updateStatus(`✔ Multi-select: [${letters}]${latencyStr}${reasonSnippet}`, "#10B981");
                    }
                } else {
                    updateStatus(`⚠ AI returned no valid indices for multi-select`, "#F59E0B");
                }

            // ── SINGLE-SELECT branch ─────────────────────────────────────
            } else {
                let idx = result.correct_index;

                // Robust index resolution (handles both 0-based index and letter output)
                if (typeof idx !== 'number' || idx < 0 || idx >= mcq.options.length) {
                    if (result.correct_letter) {
                        const charCode = result.correct_letter.toUpperCase().charCodeAt(0);
                        const letterIdx = charCode - 65;
                        if (letterIdx >= 0 && letterIdx < mcq.options.length) {
                            idx = letterIdx;
                        }
                    }
                }

                if (idx >= 0 && idx < mcq.options.length) {
                    const targetOption = mcq.options[idx];
                    lastSolvedSignature = mcq.questionText + "::" + mcq.options.map(o => o.text).join("|");
                    lastSolvedQuestionText = mcq.questionText;
                    isWaitingForNext = true;

                    clickOptionElement(targetOption);

                    const letter = String.fromCharCode(65 + idx);
                    const optTextShort = targetOption.text.length > 22 ? targetOption.text.slice(0, 22) + '...' : targetOption.text;
                    const reasonSnippet = result.thought ? ` • "${result.thought.slice(0, 35)}..."` : '';

                    if (autoNext) {
                        updateStatus(`✔ [${letter}] ${optTextShort}${latencyStr} • Next in 1s`, "#10B981");
                        showToast(`✔ [${letter}] ${optTextShort}${latencyStr}\n💡 ${result.thought || ''}`, "#10B981", 2000);
                        setTimeout(() => { tryClickNextButton(); }, 1000);
                    } else {
                        updateStatus(`✔ [${letter}] ${optTextShort}${latencyStr}${reasonSnippet}`, "#10B981");
                        showToast(`✔ [${letter}] ${optTextShort}${latencyStr}\n💡 ${result.thought || ''}`, "#10B981", 4000);
                    }
                } else {
                    updateStatus(`⚠ Invalid Choice Index (${idx})`, "#F59E0B");
                }
            }
        } catch (err) {
            console.error("[Adil AI] Solve error:", err);
            updateStatus(`✖ ${err.message}`, "#EF4444");
            showToast(`✖ ${err.message}`, "#EF4444", 4000);
        } finally {
            isSolving = false;
        }
    }

    function isMCQAlreadyAnswered(mcq) {
        if (!mcq || !mcq.options) return false;

        // Check if "Time's Up" is present on the card
        if (mcq.container) {
            const cardText = (mcq.container.innerText || '').toLowerCase();
            if (cardText.includes("time's up") || cardText.includes("times up")) {
                return true;
            }
        }

        for (const opt of mcq.options) {
            const el = opt.element;
            if (!el) continue;
            const input = el.tagName === 'INPUT' ? el : el.querySelector('input[type="radio"], input[type="checkbox"]');
            if (input && input.checked) return true;

            const cls = (el.className || '').toLowerCase();
            const parentCls = (el.parentElement ? el.parentElement.className || '' : '').toLowerCase();
            const fullCls = cls + ' ' + parentCls;

            if (/\b(selected|active|correct|incorrect|wrong|checked|is-selected|disabled)\b|bg-green|border-green|bg-red|border-red|text-green|text-red/.test(fullCls)) {
                return true;
            }
            if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true') {
                return true;
            }
        }
        return false;
    }

    async function solveCurrentMCQ(force = false) {
        if (isSolving) return;

        const mcq = detectMCQ();
        if (!mcq) {
            if (force) {
                updateStatus("⚠ No quiz in view. Open quiz or use 🎯 Target", "#F59E0B");
                showToast("⚠ No quiz found on screen. Open question or use 🎯 Target Quiz Card", "#F59E0B", 3500);
            }
            return;
        }

        // Prevent answering already submitted / feedback questions
        if (isMCQAlreadyAnswered(mcq) && !force) {
            updateStatus("● Waiting for Next Question...", "#10B981");
            return;
        }

        const signature = mcq.questionText + "::" + mcq.options.map(o => o.text).join("|");
        if (!force && signature === lastSolvedSignature) {
            return;
        }

        solveTargetedMCQ(mcq);
    }

    // ----------------------------------------------------
    // Visual Target Locker (1-Click Quiz Card Selector)
    // ----------------------------------------------------
    function startTargetingMode() {
        if (isTargeting) return;
        isTargeting = true;
        closeSettingsDrawer();
        showToast("🎯 Click ANY element inside the quiz card...", "#F59E0B", 6000);
        updateStatus("🎯 Click on the Question or Choice...", "#F59E0B");

        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed',
            pointerEvents: 'none',
            border: '3px solid #38BDF8',
            background: 'rgba(56, 189, 248, 0.15)',
            zIndex: '2147483646',
            borderRadius: '8px',
            transition: 'all 0.05s ease'
        });
        document.body.appendChild(overlay);

        let currentHovered = null;

        const onMouseMove = (e) => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el || (el.id && el.id.startsWith('adil-ai')) || (el.closest && el.closest('[id^="adil-ai"]')) || el === overlay) return;
            currentHovered = el;
            
            const card = el.closest('fieldset, form, [class*="card"], [class*="slide"], [class*="question"], section, main') || el;
            const rect = card.getBoundingClientRect();
            Object.assign(overlay.style, {
                top: `${rect.top}px`,
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`
            });
        };

        const onClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            isTargeting = false;
            window.removeEventListener('mousemove', onMouseMove, true);
            window.removeEventListener('click', onClick, true);
            if (overlay.parentElement) overlay.remove();

            if (currentHovered) {
                const foundMCQ = findQuizCardFromElement(currentHovered);
                if (foundMCQ) {
                    lockedTargetContainer = foundMCQ.container;
                    updateStatus("🎯 Quiz Card Locked! Ready.", "#10B981");
                    showToast("🎯 Quiz Card Locked! Ready to Solve.", "#10B981", 3000);
                    solveTargetedMCQ(foundMCQ);
                } else {
                    updateStatus("⚠ No choices in selected element", "#F59E0B");
                    showToast("⚠ Could not detect 2+ choices in that area.", "#F59E0B", 3500);
                }
            }
        };

        window.addEventListener('mousemove', onMouseMove, true);
        window.addEventListener('click', onClick, true);
    }

    // ----------------------------------------------------
    // User Interface: Sleek Floating HUD
    // ----------------------------------------------------
    function updateStatus(text, color = "#94A3B8") {
        lastStatusMsg = text;
        lastStatusColor = color;
        if (!widgetHud) return;

        const statusEl = widgetHud.querySelector('#adil-status-text');
        const dotEl = widgetHud.querySelector('#adil-status-dot');
        if (statusEl) {
            statusEl.innerText = text;
            statusEl.style.color = color;
        }
        if (dotEl) {
            dotEl.style.background = color;
            dotEl.style.boxShadow = `0 0 8px ${color}`;
        }
    }

    function toggleRunning() {
        isRunning = !isRunning;

        if (isRunning) {
            isWaitingForNext = false;
            lastSolvedSignature = "";
            updateStatus("● Active: Scanning for question...", "#10B981");
            showToast("▶ Adil AI Started (Running)", "#10B981");
            if (solveMode === 'AUTO') {
                solveCurrentMCQ(false);
            }
        } else {
            updateStatus("● Standby (Paused)", "#94A3B8");
            showToast("⏸ Adil AI Stopped (Idle)", "#94A3B8");
        }
        renderWidget();
    }

    function toggleMinimize() {
        isMinimized = !isMinimized;
        GM_setValue('ADIL_MINIMIZED', isMinimized);
        renderWidget();
    }

    function toggleSettingsDrawer() {
        isSettingsOpen = !isSettingsOpen;
        renderWidget();
    }

    function closeSettingsDrawer() {
        isSettingsOpen = false;
        renderWidget();
    }

    function renderWidget() {
        if (!widgetHud) return;

        if (isMinimized) {
            widgetHud.style.width = 'auto';
            widgetHud.style.padding = '6px 12px';
            widgetHud.style.borderRadius = '20px';
            widgetHud.style.cursor = 'pointer';
            widgetHud.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px; font-weight:700; font-size:12px; color:#F8FAFC;">
                    <span style="color:#38BDF8; font-size:14px;">⚡</span>
                    <span>Adil AI</span>
                    <span style="font-size:10px; padding:2px 6px; border-radius:10px; background:${isRunning ? '#10B981' : '#475569'}; color:white;">
                        ${isRunning ? 'ACTIVE' : 'IDLE'}
                    </span>
                    <span id="adil-expand-btn" style="color:#94A3B8; font-size:14px; margin-left:4px;" title="Expand HUD">⤢</span>
                </div>
            `;
            widgetHud.onclick = (e) => {
                e.stopPropagation();
                toggleMinimize();
            };
            return;
        }

        widgetHud.style.width = '275px';
        widgetHud.style.padding = '12px 14px';
        widgetHud.style.borderRadius = '12px';
        widgetHud.style.cursor = 'default';
        widgetHud.onclick = null;

        const isGroq = (currentProvider === 'GROQ');

        widgetHud.innerHTML = `
            <!-- Header Bar -->
            <div id="adil-drag-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; cursor:move; user-select:none; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.08);">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="color:#38BDF8; font-size:15px; font-weight:900;">⚡</span>
                    <span style="font-weight:800; font-size:13px; color:#FFFFFF; letter-spacing:0.3px;">ADIL AI</span>
                    <span style="font-size:9px; font-weight:700; padding:2px 5px; border-radius:4px; background:${isGroq ? 'rgba(56, 189, 248, 0.2)' : 'rgba(168, 85, 247, 0.2)'}; color:${isGroq ? '#38BDF8' : '#C084FC'}; border:1px solid ${isGroq ? '#38BDF8' : '#C084FC'};">
                        ${isGroq ? '⚡ GROQ 200ms' : '✨ GEMINI'}
                    </span>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                    <span id="adil-btn-minimize" style="cursor:pointer; color:#94A3B8; font-size:13px; padding:2px 6px; border-radius:4px;" title="Minimize to pill">─</span>
                </div>
            </div>

            <!-- Live Status Indicator -->
            <div style="background:#1E293B; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:7px 10px; margin-bottom:10px; display:flex; align-items:center; gap:7px;">
                <span id="adil-status-dot" style="width:8px; height:8px; border-radius:50%; background:${lastStatusColor}; box-shadow:0 0 8px ${lastStatusColor}; flex-shrink:0;"></span>
                <span id="adil-status-text" style="font-size:11px; font-weight:600; color:${lastStatusColor}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    ${lastStatusMsg}
                </span>
            </div>

            <!-- Big Primary Power Button -->
            <button id="adil-btn-power" style="width:100%; padding:9px 0; border:none; border-radius:8px; font-weight:800; font-size:12px; cursor:pointer; margin-bottom:8px; letter-spacing:0.3px; transition:all 0.15s; background:${isRunning ? 'linear-gradient(135deg, #10B981, #059669)' : 'linear-gradient(135deg, #0284C7, #2563EB)'}; color:#FFFFFF; box-shadow:${isRunning ? '0 4px 14px rgba(16, 185, 129, 0.4)' : '0 4px 14px rgba(2, 132, 199, 0.35)'};">
                ${isRunning ? '⏸ STOP AUTOPILOT' : '▶ START AUTOPILOT'}
            </button>

            <!-- Secondary Actions -->
            <div style="display:flex; gap:6px; margin-bottom:${isSettingsOpen ? '10px' : '0'};">
                <button id="adil-btn-solve-now" style="flex:1.4; background:#334155; border:1px solid #475569; color:#FFFFFF; padding:6px 0; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;" title="Solve currently visible question once (Ctrl+Shift+S)">
                    ⚡ Solve Now
                </button>
                <button id="adil-btn-options-toggle" style="flex:1; background:${isSettingsOpen ? '#475569' : '#1E293B'}; border:1px solid #475569; color:#94A3B8; padding:6px 0; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;">
                    ⚙ Options ${isSettingsOpen ? '▴' : '▾'}
                </button>
            </div>

            <!-- Expandable Options Tray -->
            <div id="adil-options-drawer" style="display:${isSettingsOpen ? 'block' : 'none'}; border-top:1px solid rgba(255,255,255,0.08); padding-top:10px; margin-top:8px;">
                <!-- Mode: Auto vs Manual -->
                <div style="margin-bottom:8px;">
                    <div style="font-size:9px; font-weight:700; color:#94A3B8; text-transform:uppercase; margin-bottom:4px;">Mode</div>
                    <div style="display:flex; gap:5px;">
                        <button id="adil-opt-auto" style="flex:1; padding:5px 0; border-radius:5px; font-size:10px; font-weight:700; cursor:pointer; border:1px solid ${solveMode === 'AUTO' ? '#10B981' : '#475569'}; background:${solveMode === 'AUTO' ? 'rgba(16, 185, 129, 0.25)' : '#1E293B'}; color:${solveMode === 'AUTO' ? '#10B981' : '#94A3B8'};">
                            🤖 Auto-Solve
                        </button>
                        <button id="adil-opt-manual" style="flex:1; padding:5px 0; border-radius:5px; font-size:10px; font-weight:700; cursor:pointer; border:1px solid ${solveMode === 'MANUAL' ? '#38BDF8' : '#475569'}; background:${solveMode === 'MANUAL' ? 'rgba(56, 189, 248, 0.25)' : '#1E293B'}; color:${solveMode === 'MANUAL' ? '#38BDF8' : '#94A3B8'};">
                            👆 Manual Only
                        </button>
                    </div>
                </div>

                <!-- Auto-Next Option -->
                <div style="display:flex; justify-content:space-between; align-items:center; background:#1E293B; border:1px solid #334155; border-radius:6px; padding:6px 8px; margin-bottom:8px;">
                    <div>
                        <div style="font-size:10px; font-weight:700; color:#E2E8F0;">Auto-Click Next</div>
                        <div style="font-size:8px; color:#94A3B8;">${autoNext ? 'Advances to next question' : 'Waits for you to press Next'}</div>
                    </div>
                    <button id="adil-opt-autonext" style="background:${autoNext ? '#10B981' : '#475569'}; border:none; color:white; padding:3px 8px; border-radius:10px; font-size:9px; font-weight:700; cursor:pointer;">
                        ${autoNext ? 'ON' : 'OFF'}
                    </button>
                </div>

                <!-- AI Engine Selector -->
                <div style="margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <span style="font-size:9px; font-weight:700; color:#94A3B8; text-transform:uppercase;">AI Precision Engine</span>
                        <span style="font-size:8px; color:#10B981; font-weight:600;">● Auto-Vision ON</span>
                    </div>
                    <div style="display:flex; gap:5px;">
                        <button id="adil-opt-groq" style="flex:1; padding:5px 0; border-radius:5px; font-size:10px; font-weight:700; cursor:pointer; border:1px solid ${isGroq ? '#38BDF8' : '#475569'}; background:${isGroq ? 'rgba(56, 189, 248, 0.25)' : '#1E293B'}; color:${isGroq ? '#38BDF8' : '#94A3B8'};" title="Sub-second (250ms) Groq LPU reasoning with 95%+ Chain-of-Thought precision">
                            ⚡ Groq CoT (250ms)
                        </button>
                        <button id="adil-opt-gemini" style="flex:1; padding:5px 0; border-radius:5px; font-size:10px; font-weight:700; cursor:pointer; border:1px solid ${!isGroq ? '#C084FC' : '#475569'}; background:${!isGroq ? 'rgba(192, 132, 252, 0.25)' : '#1E293B'}; color:${!isGroq ? '#C084FC' : '#94A3B8'};" title="Multimodal Vision & deep academic reasoning for 99%+ accuracy">
                            🧠 Gemini Vision
                        </button>
                    </div>
                </div>

                <!-- Action Tools -->
                <div style="display:flex; gap:5px; margin-bottom:8px;">
                    <button id="adil-opt-target" style="flex:1; background:#1E293B; border:1px solid #F59E0B; color:#F59E0B; padding:5px 0; border-radius:5px; font-size:10px; font-weight:700; cursor:pointer;" title="Click any question to lock onto custom website layout">
                        🎯 Target Quiz Card
                    </button>
                    <button id="adil-opt-keys" style="flex:1; background:#1E293B; border:1px solid #475569; color:#94A3B8; padding:5px 0; border-radius:5px; font-size:10px; font-weight:600; cursor:pointer;">
                        🔑 API Key
                    </button>
                </div>

                <!-- Shortcuts Cheatsheet -->
                <div style="background:#0B1120; border-radius:6px; padding:6px 8px; font-size:9px; color:#94A3B8;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
                        <span>Start / Stop</span>
                        <span style="color:#38BDF8; font-weight:700;">Ctrl + Shift + A</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
                        <span>Solve Current</span>
                        <span style="color:#38BDF8; font-weight:700;">Ctrl + Shift + S</span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span>Minimize / Show</span>
                        <span style="color:#38BDF8; font-weight:700;">Ctrl + Shift + H</span>
                    </div>
                </div>
            </div>
        `;

        // Wire Event Listeners
        widgetHud.querySelector('#adil-btn-minimize').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMinimize();
        });

        widgetHud.querySelector('#adil-btn-power').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleRunning();
        });

        widgetHud.querySelector('#adil-btn-solve-now').addEventListener('click', (e) => {
            e.stopPropagation();
            isWaitingForNext = false;
            solveCurrentMCQ(true);
        });

        widgetHud.querySelector('#adil-btn-options-toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSettingsDrawer();
        });

        if (isSettingsOpen) {
            widgetHud.querySelector('#adil-opt-auto').addEventListener('click', (e) => {
                e.stopPropagation();
                solveMode = 'AUTO';
                GM_setValue('ADIL_SOLVE_MODE', solveMode);
                renderWidget();
                showToast("Mode: Auto-Solve enabled", "#10B981");
            });

            widgetHud.querySelector('#adil-opt-manual').addEventListener('click', (e) => {
                e.stopPropagation();
                solveMode = 'MANUAL';
                GM_setValue('ADIL_SOLVE_MODE', solveMode);
                renderWidget();
                showToast("Mode: Manual Only (Press Solve or Ctrl+Shift+S)", "#38BDF8");
            });

            widgetHud.querySelector('#adil-opt-autonext').addEventListener('click', (e) => {
                e.stopPropagation();
                autoNext = !autoNext;
                GM_setValue('ADIL_AUTO_NEXT', autoNext);
                renderWidget();
                showToast(autoNext ? "Auto-Next: Enabled (advances after answering)" : "Auto-Next: Disabled (waits for you)", "#38BDF8");
            });

            widgetHud.querySelector('#adil-opt-groq').addEventListener('click', (e) => {
                e.stopPropagation();
                currentProvider = 'GROQ';
                GM_setValue('SELECTED_PROVIDER', currentProvider);
                renderWidget();
                updateStatus("Engine: Groq CoT (250ms, 95%+ Precision)", "#38BDF8");
                showToast("Engine: Switched to Groq (CoT Reasoning Turbo)", "#38BDF8");
            });

            widgetHud.querySelector('#adil-opt-gemini').addEventListener('click', (e) => {
                e.stopPropagation();
                currentProvider = 'GEMINI';
                GM_setValue('SELECTED_PROVIDER', currentProvider);
                renderWidget();
                updateStatus("Engine: Gemini Multimodal Vision Active", "#C084FC");
                showToast("Engine: Switched to Gemini (Vision & Deep Reasoning)", "#C084FC");
            });

            widgetHud.querySelector('#adil-opt-target').addEventListener('click', (e) => {
                e.stopPropagation();
                startTargetingMode();
            });

            widgetHud.querySelector('#adil-opt-keys').addEventListener('click', (e) => {
                e.stopPropagation();
                const curKey = getActiveKey();
                const input = prompt(`Enter API Key for ${currentProvider}:`, curKey);
                if (input !== null) {
                    if (currentProvider === 'GROQ') {
                        customGroqKey = input.trim();
                        GM_setValue('GROQ_KEY', customGroqKey);
                    } else {
                        customGeminiKey = input.trim();
                        GM_setValue('GEMINI_KEY', customGeminiKey);
                    }
                    showToast(`Saved ${currentProvider} API Key!`, "#10B981");
                }
            });
        }

        // Draggable Functionality
        const dragHandle = widgetHud.querySelector('#adil-drag-header');
        if (dragHandle) {
            let isDragging = false, offX = 0, offY = 0;
            dragHandle.addEventListener('mousedown', (e) => {
                if (['BUTTON', 'SPAN'].includes(e.target.tagName)) return;
                isDragging = true;
                offX = e.clientX - widgetHud.getBoundingClientRect().left;
                offY = e.clientY - widgetHud.getBoundingClientRect().top;
            });
            document.addEventListener('mousemove', (e) => {
                if (isDragging) {
                    widgetHud.style.left = `${Math.max(10, Math.min(window.innerWidth - 300, e.clientX - offX))}px`;
                    widgetHud.style.top = `${Math.max(10, Math.min(window.innerHeight - 80, e.clientY - offY))}px`;
                    widgetHud.style.right = 'auto';
                }
            });
            document.addEventListener('mouseup', () => { isDragging = false; });
        }
    }

    function buildUI(parent) {
        if (document.getElementById('adil-ai-widget-hud')) return;

        // Toast Container
        toastContainer = document.createElement('div');
        toastContainer.id = 'adil-ai-toast';
        Object.assign(toastContainer.style, {
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: '2147483647',
            background: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(10px)',
            color: '#F8FAFC',
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
            fontSize: '12px',
            fontWeight: '600',
            padding: '10px 16px',
            borderRadius: '8px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)',
            transition: 'opacity 0.25s ease, transform 0.25s ease',
            opacity: '0',
            pointerEvents: 'none',
            transform: 'translateY(10px)',
            display: enableToasts ? 'block' : 'none'
        });
        parent.appendChild(toastContainer);

        // Main Floating HUD Widget
        widgetHud = document.createElement('div');
        widgetHud.id = 'adil-ai-widget-hud';
        Object.assign(widgetHud.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: '2147483647',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            borderRadius: '12px',
            boxShadow: '0 16px 36px rgba(0,0,0,0.65), 0 0 15px rgba(56, 189, 248, 0.2)',
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
            color: '#F8FAFC',
            userSelect: 'none',
            boxSizing: 'border-box'
        });

        parent.appendChild(widgetHud);
        renderWidget();
    }

    function ensureUIAttached() {
        const targetParent = document.fullscreenElement 
                          || document.webkitFullscreenElement 
                          || document.body 
                          || document.documentElement;

        if (!targetParent) return;

        if (!document.getElementById('adil-ai-widget-hud')) {
            buildUI(targetParent);
        } else if (widgetHud && widgetHud.parentElement !== targetParent) {
            targetParent.appendChild(widgetHud);
            if (toastContainer) targetParent.appendChild(toastContainer);
        }
    }

    let toastTimer = null;
    function showToast(message, color = '#38BDF8', durationMs = 2600) {
        if (!enableToasts || !toastContainer) return;
        toastContainer.innerText = message;
        toastContainer.style.borderLeft = `4px solid ${color}`;
        toastContainer.style.opacity = '1';
        toastContainer.style.transform = 'translateY(0px)';

        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastContainer.style.opacity = '0';
            toastContainer.style.transform = 'translateY(10px)';
        }, durationMs);
    }

    // ----------------------------------------------------
    // Keyboard Shortcuts
    // ----------------------------------------------------
    window.addEventListener('keydown', (e) => {
        const isKeyS = (e.key === 's' || e.key === 'S' || e.code === 'KeyS');
        const isKeyA = (e.key === 'a' || e.key === 'A' || e.code === 'KeyA');
        const isKeyH = (e.key === 'h' || e.key === 'H' || e.code === 'KeyH');

        if (isKeyS && ((e.ctrlKey && e.shiftKey) || e.altKey || (e.ctrlKey && e.altKey))) {
            e.preventDefault();
            e.stopPropagation();
            isWaitingForNext = false;
            solveCurrentMCQ(true);
        }

        if (isKeyA && ((e.ctrlKey && e.shiftKey) || e.altKey || (e.ctrlKey && e.altKey))) {
            e.preventDefault();
            e.stopPropagation();
            toggleRunning();
        }

        if (isKeyH && ((e.ctrlKey && e.shiftKey) || e.altKey)) {
            e.preventDefault();
            e.stopPropagation();
            toggleMinimize();
            showToast(isMinimized ? "Widget Minimized (Click ⚡ to restore)" : "Widget Restored", "#38BDF8", 2000);
        }
    }, true);

    // Fullscreen Listeners
    document.addEventListener('fullscreenchange', ensureUIAttached);
    document.addEventListener('webkitfullscreenchange', ensureUIAttached);
    document.addEventListener('mozfullscreenchange', ensureUIAttached);
    document.addEventListener('MSFullscreenChange', ensureUIAttached);

    // ----------------------------------------------------
    // Autopilot Heartbeat Loop (Runs ONLY when isRunning is true)
    // ----------------------------------------------------
    setInterval(() => {
        ensureUIAttached();
        if (!isRunning || solveMode !== 'AUTO' || isSolving || isTargeting) {
            return;
        }

        if (isWaitingForNext) {
            const mcq = detectMCQ();
            if (mcq && mcq.options && mcq.options.length >= 2) {
                const currentSig = mcq.questionText + "::" + mcq.options.map(o => o.text).join("|");
                // Unlocks when choices/signature changes AND the new question is not already answered
                if (currentSig !== lastSolvedSignature && !isMCQAlreadyAnswered(mcq)) {
                    isWaitingForNext = false;
                    updateStatus("● New question detected! Solving...", "#38BDF8");
                } else {
                    return;
                }
            } else {
                return;
            }
        }

        solveCurrentMCQ(false);
    }, 350);

    // Initial mount
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureUIAttached);
    } else {
        ensureUIAttached();
    }

})();
