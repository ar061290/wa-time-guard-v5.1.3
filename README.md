# WhatsApp Web Time Guard — v5.1.3

8 minutes of WhatsApp Web, then a 42 minute blackout carrying one of 8,000 offline quotes.

## Install

1. `chrome://extensions` → **Developer mode** on → **Load unpacked** → select this folder
2. Open or reload `https://web.whatsapp.com`

## What's new in v5.1.3

**Two question banks.** EMERGENCY is now two buttons, ESAT and IOQM.

- **ESAT** — the existing 515 multiple-choice questions from ENGAA and NSAA Section 1.
- **IOQM** — 211 questions from IOQM 2021–2025 and PRMO 2017/2019. IOQM answers are integers
  00–99, so these are **typed into a box**, not picked from options. Enter submits.

Each bank is fully separate: its own question file, its own attempt log
(`quizLog` / `quizLogIoqm`), its own four records, and its own downloads
(`quiz-log-esat.csv` / `quiz-log-ioqm.csv`, and PDFs named `quiz-esat-…` / `quiz-ioqm-…`). Timings
never mix. The quiz tab header and its window title name the bank that is running.

The condensed-version gate on the DONTREADME page always draws from the ESAT bank.

### Where the IOQM questions came from

Eight papers with published answer keys, all cropped from the PDF as images so the notation and
figures survive:

| Paper | Kept |
| --- | --- |
| IOQM 2021-22 Part A | 12 |
| IOQM 2021 (M01) | 30 |
| IOQM 2022 | 24 |
| IOQM 2023 | 30 |
| IOQM 2024 | 30 |
| IOQM 2025 (Set M1) | 30 |
| PRMO 2019 | 29 |
| PRMO 2017 | 26 |

211 of the 212 published answers are covered. The one gap is PRMO 2017 Q8, whose question number
is missing from the PDF's text layer, so its crop could not be bounded; it folds into Q7's image.

Dropped, deliberately: **PRMO 2018, PRMO 2012/2013/2014 and the NBHM papers**, because the file
carries no answer key for any of them and guessing at olympiad answers in a bank that gates your
access is worse than a smaller bank. Also dropped: PRMO 2019 Q20 (key prints "–"), three PRMO 2017
questions marked "Discounted", the Hindi translations of the 2018/2019 papers, and a Cheenta web
printout of PRMO 2016 that is a web page rather than a paper.

## The MCQ bank

`data/questions.json` holds **515 maths and physics questions** from the ENGAA and NSAA Section 1
past papers in your PDF — 2016 to 2023 plus the specimens, 20 papers in all.

**492 of them are page crops, not text.** Each question is rendered straight from the PDF as an
image: stem, diagram, table and options exactly as printed. That fixes both problems in one move —
diagram questions are in (a parachutist force diagram, an I–V graph, circuits, geometry figures),
and the notation the paper's custom font destroys on text extraction (surds, fractions,
exponents) is intact because nothing is re-typed. The answer buttons in the quiz are the option
letters A–H. The remaining 23 are plain-text questions I transcribed and verified by hand.

How the keys were validated: 237 questions appear in two different papers. Every one of those
duplicate pairs agreed on its answer letter, which is a strong check that question numbers and
answer keys are aligned. The single paper that disagreed with its twin — the 2020-format NSAA
specimen, whose key is offset — was dropped entirely rather than guessed at. Chemistry and
biology are excluded, as are the Section 2 written-answer papers.

The scanned *ESAT Syllabus Explained* section (the last ~790 pages) is still not harvested. It is
a raster scan, so it needs OCR, and OCR corrupts exactly the characters that decide an answer — in
testing it read `FeSO4` as `FeSOs`. Say the word and I'll do a supervised pass over its maths and
physics chapters.

To swap in your own set, both shapes work:

```json
[
  { "img": "data/q/name.jpg", "letters": ["A","B","C","D"], "answer": 2, "src": "Paper Q7" },
  { "q": "Question text", "options": ["a", "b", "c", "d"], "answer": 0 }
]
```

`answer` is the zero-based index. Text options are reshuffled at runtime; image questions are not,
since the letters have to match the picture.

## Files

| File | Role |
| --- | --- |
| `background.js` | Service worker: state machine, pause/resume, quote index, bypass, icon painting |
| `content.js` | Page agent: chat detection, Escape ×3, overlay, favicon, tab title |
| `popup.html` / `.css` / `.js` | Popup UI: timers, settings, EMERGENCY |
| `quiz.html` / `.css` / `.js` | The emergency quiz, running as its own tab |
| `data/quotes.json` | 8,000 quotes |
| `data/questions.json` | MCQ bank (515 questions) |
| `data/q/` | 492 question crops rendered from the past papers |
| `dontreadme.html` / `.css` / `.js` | Full documentation: PRD, UI/UX guide, code walkthrough, every quote, every question with its answer |

## Tuning

| Change | Where |
| --- | --- |
| Timer lengths | `ACTIVE_MS` / `BLOCKED_MS` in `background.js` (use 20s / 30s to test) |
| Bypass length | `BYPASS_MS` in `background.js` |
| Pass mark / quiz length | `PASS_MARK` / `QUIZ_LENGTH` in `popup.js` |
| Focus strictness | `REQUIRE_WINDOW_FOCUS` in `content.js` |
| Keep WhatsApp's favicon when idle | `FAVICON_ALWAYS = false` in `content.js` |
| Chat detection | `CHAT_SELECTORS` in `content.js` |

## Caveats

- **Synthetic Escape.** Extensions cannot send OS-level keystrokes without the debugger API. Full
  `keydown`/`keypress`/`keyup` Escape events are dispatched at the focused element, `document` and
  `window`; if a WhatsApp build ever ignores them, a back-button click is the fallback. The blackout
  still lands on time either way.
- **Serif font.** Claude's serif is not redistributable, so the serif option resolves to Georgia →
  Iowan Old Style → Times New Roman. Change the `SERIF` constant in `content.js` to use a licensed
  face you have installed.
- **Favicon takeover.** With `FAVICON_ALWAYS` on, the number replaces WhatsApp's favicon at all
  times, including its unread-count variant. The title's `(n)` prefix is untouched.
- **Not tamper-proof.** Anyone who can open `chrome://extensions` can disable this in seconds.
