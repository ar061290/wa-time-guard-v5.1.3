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

## What's new in v4.3.1

The blackout came up as a bare black screen until the tab was reloaded. On install and on update
the service worker injects the content script into tabs that are already open, but it was only
injecting `content.js` and not `template.js`. Without it `window.TimeGuardTemplate` is undefined,
`renderTemplate` throws on the quote line, and `showOverlay` aborts before writing any text —
leaving an empty black div. Reloading the tab ran the declared content scripts, which include both
files, which is why it looked fine afterwards.

Fixed four ways:

- Both files are injected now, in the declared order.
- `renderTemplate` falls back to a plain substitution if the helper is missing, so a fault there
  can never blank the screen again.
- The colours and quote ride along with the Escape command, so the overlay knows what to draw the
  moment it appears instead of flashing empty for half a second.
- The composer render is wrapped, and a blacked-out page with no text re-asks for it on the next
  poll.

## What's new in v4.3

Calculator fixes. Two things were wrong at once:

- **The sandbox CSP was left to Chrome's defaults.** The engine calls `eval` and `new Function`,
  which a normal MV3 extension page can never permit — that is why it is sandboxed. The manifest
  now declares the sandbox CSP explicitly, including `'unsafe-eval'`, `blob:` workers and
  `worker-src`, instead of hoping the default covered it.
- **The iframe was sized in percentages** inside a flex-in-grid-in-flex chain. If any ancestor
  resolved to auto height, 99% of auto is zero and the calculator rendered into nothing. It is now
  absolutely positioned with a 0.5% inset and the panel carries a 480px floor.
- **Fallback:** an *Open in a tab ↗* button sits in the corner of the calculator panel, so the
  calculator is reachable even if the embed misbehaves.

`calculator.html` is still byte-for-byte your upload.

## What's new in v4.2.2

- **A fourth swap, vertical, in the triangle's centre** between add and delete. It collapses both
  text colours onto the background, and sets the background to the channel-wise mean of the two
  text colours: `bg = ((Ru+Rl)/2, (Gu+Gl)/2, (Bu+Bl)/2)`.

## What's new in v3.2

- **Colour triangle** in the popup: background at the apex, upper text bottom-left, lower text
  bottom-right, a ⇌ on each side that exchanges the two corners it joins and sits parallel to that
  side. Add and delete live in the middle; the rename field moved below.
- **Labelled buttons** on the DONTREADME page: *Condensed version*, *Full version*, and a theme
  button that names the mode currently on.
- **Contact section** is now a bordered, green-accented block with pill links.
- **Louder gate heading**, a wrong answer now covers the question *and* the calculator with a panel
  naming both what you chose and what was right.
- **Correct answers** say so explicitly, name the right answer, and hold the confetti for 4 seconds.
- **The calculator is scaled to an exact fit** — laid out at a fixed logical size and transformed to
  the panel, so no scrollbars are possible in either direction.
- **The condensed version is 4× longer**: every section of the full page as 3–6 bullets, plus a
  quote search that shows only what you searched for.

## What was new in v4

- **Quiz stopwatch and records** — every attempt is timed. The quiz tab shows the fastest run at
  your best accuracy, the fastest run overall, your most recent, and your most recent at that best
  accuracy.
- **CSV log and PDF review sheet** — each attempt appends to `time-guard/quiz-log.csv` in your
  downloads and writes a dated PDF with every question, its options, the correct answer and what
  you picked.
- **Re-enabling after a pass resumes the blackout**, not a fresh 8 minute allowance.
- **Unlimited presets** for both blackout colours and quick replies.
- **Separate upper and lower text colours.** The shipped presets start with the two identical;
  change either and they part ways.
- **Swatches in the preset dropdown** — three squares per row (background, upper, lower) with the
  name set in beside them.
- **`<minutas>`** in either line is the minutes left, and works inside a sum:
  `do (<minutas>/2) pushups`.
- **DONTREADME** gains a contact section and a compressed view, unlocked by answering one question
  with a graphing calculator alongside it.
- **The popup's DONTREADME link is pinned** to the bottom; the panels scroll behind it.

## What was new in v2.4

- **Dark / light toggle** — the moon-and-sun button in the popup header. The choice is stored in
  settings and the DONTREADME page follows it, in either direction. The blackout screen keeps its
  own colours and is unaffected.
- **Colour swap (⇌)** — the button between the two pickers flips background and text for the
  selected entry only. No other preset moves.
- **Presets are now editable as a set** — rename any of them, delete down to one, add up to eight.
  Custom is permanent and keeps its name.
- **Two independent blackout lines** — upper and lower text, each with its own text box and font
  choice. Empty upper rotates through the quotes; empty lower gives the pushups line. `{n}` in
  either is replaced with the minutes left.
- **Composer layout** — the text box comes first, with the three quick replies side by side
  beneath it.

- **Popup** in WhatsApp's dark palette: two live timer rectangles (usage left, blackout right),
  an appearance panel, EMERGENCY, and a DONTREADME link.
- **8,000 quotes** in `data/quotes.json`, fully offline. The index advances every time WhatsApp is
  closed and every time a blackout completes.
- **Pushups line** under the quote: *Go do 37 pushups.* — the number is the minutes left in the
  blackout, refreshed on the minute, in a serif face against the sans quote.
- **The icon is the number.** Green `#25D366` with white digits during the 8 minutes, your chosen
  blackout colours during the 42, grey while an emergency bypass is running. The tab favicon
  mirrors it.
- **Tab title** becomes `(3) WhatsApp Web (47)` while a timer runs — the seconds tick every second
  and WhatsApp's own unread count is left alone.
- **One last message.** If a chat was open when the 8 minutes ran out, the blackout appears
  immediately with a compose box for the **first 4 minutes** — one message only, sent into that
  chat. The three Escapes are held back until the message is sent or those 4 minutes pass,
  whichever comes first. With no chat open, Escape fires first exactly as before.
- **Quick replies**: three editable presets shown side by side under the box, one click to load.
  Edit them under *Quick replies* in the popup.
- **EMERGENCY**: opens a full tab with 8 random MCQs. 6 correct switches the guard off for 2 hours
  (never displayed) or until you press ENABLE GUARD. Below 6, nothing unlocks and you can start a
  fresh set from the result screen. Answer by clicking or by pressing the option letter A–H.

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
