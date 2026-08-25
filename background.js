/* WhatsApp Web Time Guard — service worker (authoritative state machine)
 *
 * Phases
 *   IDLE      no timer. Waits for a tab that is BOTH in view AND has a chat open.
 *   ACTIVE    8 minute usage timer.
 *   ESCAPING  transient: Esc pressed 3x before the blackout begins.
 *   BLOCKED   42 minute blackout, overlay shown.
 *
 * The 8 minute allowance accumulates only while at least one web.whatsapp.com tab exists:
 * closing every WhatsApp tab pauses it, reopening resumes it. The 42 minute blackout runs on
 * the wall clock and never pauses, so closing the tab cannot shorten the lockout.
 * Tab/window switching never pauses anything.
 * An EMERGENCY quiz pass suspends everything for 2 hours (wall clock) or until re-enabled.
 */

const WA_MATCH = 'https://web.whatsapp.com/*';

const ACTIVE_MS = 8 * 60 * 1000;
const BLOCKED_MS = 42 * 60 * 1000;
const BYPASS_MS = 2 * 60 * 60 * 1000;
const ESC_GRACE_MS = 500;
// If a chat was open when the allowance ran out, the blackout opens with a compose box for one
// last message. Escape is held back until that message is sent or this window closes.
const COMPOSE_MS = 4 * 60 * 1000;

const QUOTE_COUNT_FALLBACK = 8000;

// Upper and lower text carry their own colour. The shipped presets start with the two the same,
// but nothing enforces that — change either one and they part ways.
const DEFAULT_PRESETS = [
  { name: 'Blackout',   bg: '#000000', upper: '#FFFFFF', lower: '#FFFFFF' },
  { name: 'WhatsApp',   bg: '#111B21', upper: '#25D366', lower: '#25D366' },
  { name: 'Deep teal',  bg: '#075E54', upper: '#DCF8C6', lower: '#DCF8C6' },
  { name: 'Slate',      bg: '#202C33', upper: '#E9EDEF', lower: '#E9EDEF' },
  { name: 'Paper',      bg: '#ECE5DD', upper: '#111B21', lower: '#111B21' },
  { name: 'Ember',      bg: '#1A0E08', upper: '#FF9E5E', lower: '#FF9E5E' },
  { name: 'Midnight',   bg: '#0B1220', upper: '#8AB4F8', lower: '#8AB4F8' },
  { name: 'Forest',     bg: '#04241A', upper: '#9AE6B4', lower: '#9AE6B4' }
];

const DEFAULT_REPLIES = [
  "yo shit i gtg byeeee",
  "Oh no. Can we continue this conversation in a bit? Something extremely urgent just came up with this thing I'm doing at school.",
  "Hold on. I'm getting an urgent call from someone about some school stuff. Can you please give me a bit?"
];

const DEFAULT_SETTINGS = {
  presets: DEFAULT_PRESETS, // any number of entries, all renamable and removable
  replies: DEFAULT_REPLIES, // any number of quick replies
  activePreset: 0,          // index into presets, or 'custom'
  custom: { bg: '#000000', upper: '#FFFFFF', lower: '#FFFFFF' },
  message: '',              // upper line: empty = rotate through the quote file
  lowerMessage: '',         // lower line: empty = "Go do X pushups."
  quoteFont: 'sans',        // upper line font: 'sans' | 'serif'
  pushupFont: 'serif',      // lower line font
  theme: 'dark'             // popup and DONTREADME appearance: 'dark' | 'light'
};

const DEFAULT_STATE = {
  phase: 'IDLE',
  accumulatedMs: 0,
  runningSince: null,
  quoteIndex: 0,
  bypassUntil: 0,
  composeAllowed: false,   // a chat was open when the blackout began
  composeDone: false,      // the one message has been sent, or the window closed
  bypassFromQuiz: false    // set when a quiz pass granted the bypass
};

/* ---------- serial lock ---------- */
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.then(() => {}, () => {});
  return run;
}

/* ---------- storage ---------- */
async function getState() {
  const { state } = await chrome.storage.local.get('state');
  return { ...DEFAULT_STATE, ...(state || {}) };
}
async function putState(s) {
  await chrome.storage.local.set({ state: s });
  return s;
}
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!Array.isArray(s.presets) || !s.presets.length) s.presets = DEFAULT_PRESETS;
  // migrate v2 presets, which had a single `text` colour for both lines
  s.presets = s.presets.map((p) => (p.upper ? p : { name: p.name, bg: p.bg, upper: p.text, lower: p.text }));
  if (s.custom && !s.custom.upper) s.custom = { bg: s.custom.bg, upper: s.custom.text, lower: s.custom.text };
  if (typeof s.activePreset === 'number' && !s.presets[s.activePreset]) s.activePreset = 0;
  if (!Array.isArray(s.replies)) s.replies = DEFAULT_REPLIES;
  return s;
}
async function putSettings(s) {
  await chrome.storage.local.set({ settings: s });
  return s;
}
function activeColors(settings) {
  const p = settings.activePreset === 'custom'
    ? settings.custom
    : (settings.presets[settings.activePreset] || settings.presets[0]);
  return { bg: p.bg, upper: p.upper, lower: p.lower };
}

/* ---------- quotes ---------- */
let quotesCache = null;
async function quotes() {
  if (quotesCache) return quotesCache;
  try {
    const res = await fetch(chrome.runtime.getURL('data/quotes.json'));
    quotesCache = await res.json();
  } catch (e) {
    quotesCache = ['Value connections, don\u2019t overuse them.'];
  }
  return quotesCache;
}
async function quoteAt(i) {
  const list = await quotes();
  const n = list.length || QUOTE_COUNT_FALLBACK;
  return list[((i % n) + n) % n];
}
async function bumpQuote(reason) {
  const s = await getState();
  const list = await quotes();
  await putState({ ...s, quoteIndex: (s.quoteIndex + 1) % (list.length || QUOTE_COUNT_FALLBACK) });
}

/* ---------- derived values ---------- */
function limitFor(phase) {
  if (phase === 'ACTIVE') return ACTIVE_MS;
  if (phase === 'BLOCKED' || phase === 'ESCAPING') return BLOCKED_MS;
  return null;
}
function elapsedMs(s) {
  return s.accumulatedMs + (s.runningSince ? Math.max(0, Date.now() - s.runningSince) : 0);
}
function deadlineOf(s) {
  const limit = limitFor(s.phase);
  if (limit == null || !s.runningSince) return null;
  return s.runningSince + (limit - s.accumulatedMs);
}
function bypassOn(s) {
  return !!s.bypassUntil && s.bypassUntil > Date.now();
}

async function publicState(s, settings) {
  settings = settings || (await getSettings());
  const limit = limitFor(s.phase);
  const colors = activeColors(settings);
  const out = {
    phase: s.phase,
    running: !!s.runningSince,
    bypass: bypassOn(s),
    remainingMs: limit == null ? null : Math.max(0, limit - elapsedMs(s)),
    deadlineAt: deadlineOf(s),
    activeLimitMs: ACTIVE_MS,
    blockedLimitMs: BLOCKED_MS,
    colors: colors,
    fonts: { quote: settings.quoteFont, pushup: settings.pushupFont },
    quoteIndex: s.quoteIndex,
    replies: settings.replies,
    lowerText: (settings.lowerMessage || '').trim() || null,
    composeOpen: false,
    composeMsLeft: 0,
    text: null
  };
  if (s.phase === 'BLOCKED' && s.composeAllowed && !s.composeDone) {
    const used = elapsedMs(s);
    if (used < COMPOSE_MS) {
      out.composeOpen = true;
      out.composeMsLeft = COMPOSE_MS - used;
    }
  }
  if (s.phase === 'BLOCKED' || s.phase === 'ESCAPING') {
    out.text = settings.message && settings.message.trim()
      ? settings.message.trim()
      : await quoteAt(s.quoteIndex);
  }
  return out;
}

async function waTabs() {
  try { return await chrome.tabs.query({ url: WA_MATCH }); } catch (e) { return []; }
}

async function broadcast(s, settings, extra) {
  const tabs = await waTabs();
  const payload = Object.assign(
    { type: 'STATE', state: await publicState(s, settings) },
    extra || {}
  );
  await Promise.all(tabs.map((t) => chrome.tabs.sendMessage(t.id, payload).catch(() => {})));
}

/* ---------- the icon IS the number ---------- */
function iconLook(s, settings) {
  if (bypassOn(s)) return { label: '8', bg: '#8696A0', fg: '#111B21' };
  if (s.phase === 'BLOCKED' || s.phase === 'ESCAPING') {
    const c = activeColors(settings);
    const mins = Math.ceil(Math.max(0, BLOCKED_MS - elapsedMs(s)) / 60000);
    return { label: String(Math.min(99, mins)), bg: c.bg, fg: c.upper };
  }
  if (s.phase === 'ACTIVE') {
    const mins = Math.ceil(Math.max(0, ACTIVE_MS - elapsedMs(s)) / 60000);
    return { label: String(Math.min(99, mins)), bg: '#25D366', fg: '#FFFFFF' };
  }
  // IDLE: show what the next run will be — the 8 minute timer.
  return { label: '8', bg: '#25D366', fg: '#FFFFFF' };
}

function drawIcon(size, look) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const r = Math.max(2, size * 0.22);

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = look.bg;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, r);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, size, size);
  }

  const digits = look.label.length;
  const scale = digits > 1 ? 0.62 : 0.78;
  ctx.fillStyle = look.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 ' + Math.round(size * scale) + 'px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(look.label, size / 2, size / 2 + size * 0.04);

  return ctx.getImageData(0, 0, size, size);
}

async function paintIcon(s, settings) {
  try {
    const look = iconLook(s, settings || (await getSettings()));
    const imageData = {};
    for (const size of [16, 32, 48, 128]) imageData[size] = drawIcon(size, look);
    await chrome.action.setIcon({ imageData });
    await chrome.action.setBadgeText({ text: '' });
  } catch (e) { /* canvas or action unavailable */ }
}

/* ---------- alarms ---------- */
async function scheduleAlarms(s) {
  await chrome.alarms.clear('deadline');
  await chrome.alarms.clear('bypass');
  let d = deadlineOf(s);
  if (s.phase === 'BLOCKED' && s.composeAllowed && !s.composeDone && s.runningSince) {
    const composeEnd = s.runningSince + (COMPOSE_MS - s.accumulatedMs);
    if (!d || composeEnd < d) d = composeEnd;
  }
  if (d) chrome.alarms.create('deadline', { when: Math.max(d, Date.now() + 1000) });
  if (bypassOn(s)) chrome.alarms.create('bypass', { when: s.bypassUntil });
  const existing = await chrome.alarms.get('reconcile');
  if (!existing) chrome.alarms.create('reconcile', { periodInMinutes: 1 });
}

/* ---------- transitions ---------- */
async function anyChatOpen() {
  const tabs = await waTabs();
  const answers = await Promise.all(
    tabs.map((t) => chrome.tabs.sendMessage(t.id, { type: 'CHAT_STATUS' }).catch(() => null))
  );
  return answers.some((a) => a && a.chatOpen);
}

async function pressEscapeEverywhere() {
  const tabs = await waTabs();
  const s = await getState();
  const settings = await getSettings();
  const preview = await publicState({ ...s, phase: 'BLOCKED' }, settings);
  await Promise.all(tabs.map((t) =>
    chrome.tabs.sendMessage(t.id, { type: 'PRESS_ESCAPE', state: preview }).catch(() => {})));
  await new Promise((r) => setTimeout(r, ESC_GRACE_MS));
}

async function enterBlocked() {
  const chatOpen = await anyChatOpen();

  if (!chatOpen) {
    // Nothing to reply to: Escape first, exactly as before, then black out.
    await putState({ ...(await getState()), phase: 'ESCAPING', accumulatedMs: 0, runningSince: null });
    await pressEscapeEverywhere();
  }

  const s = await putState({
    ...(await getState()),
    phase: 'BLOCKED',
    accumulatedMs: 0,
    runningSince: Date.now(),
    composeAllowed: chatOpen,
    composeDone: !chatOpen
  });

  const settings = await getSettings();
  await scheduleAlarms(s);
  await broadcast(s, settings);
  await paintIcon(s, settings);
}

// The compose window is over: send the three Escapes that were held back.
async function closeCompose() {
  const s = await getState();
  if (s.composeDone) return;
  await putState({ ...s, composeDone: true });
  await pressEscapeEverywhere();
  const ns = await getState();
  const settings = await getSettings();
  await broadcast(ns, settings);
  await paintIcon(ns, settings);
}

async function evaluate() {
  let s = await getState();
  const settings = await getSettings();
  const open = (await waTabs()).length > 0;

  // Emergency bypass: everything is off.
  if (bypassOn(s)) {
    if (s.phase !== 'IDLE' || s.runningSince || s.accumulatedMs) {
      s = await putState({ ...s, phase: 'IDLE', accumulatedMs: 0, runningSince: null });
    }
    await scheduleAlarms(s);
    await broadcast(s, settings);
    await paintIcon(s, settings);
    return;
  }
  if (s.bypassUntil) s = await putState({ ...s, bypassUntil: 0, bypassFromQuiz: false });

  if (s.phase === 'ESCAPING') { await enterBlocked(); return; }

  if (s.phase === 'IDLE') {
    if (s.runningSince || s.accumulatedMs) {
      s = await putState({ ...s, accumulatedMs: 0, runningSince: null });
    }
  } else if (s.phase === 'BLOCKED') {
    // The blackout runs on the wall clock: closing WhatsApp must not bank lockout time.
    if (!s.runningSince) s = await putState({ ...s, runningSince: Date.now() });
  } else if (open && !s.runningSince) {
    // The 8 minute allowance only counts while WhatsApp is actually open.
    s = await putState({ ...s, runningSince: Date.now() });
  } else if (!open && s.runningSince) {
    s = await putState({ ...s, accumulatedMs: elapsedMs(s), runningSince: null });
  }

  if (s.phase === 'ACTIVE' && elapsedMs(s) >= ACTIVE_MS) { await enterBlocked(); return; }

  if (s.phase === 'BLOCKED' && s.composeAllowed && !s.composeDone && elapsedMs(s) >= COMPOSE_MS) {
    await closeCompose();
    s = await getState();
  }

  if (s.phase === 'BLOCKED' && elapsedMs(s) >= BLOCKED_MS) {
    const list = await quotes();
    s = await putState({
      ...s,
      phase: 'IDLE',
      accumulatedMs: 0,
      runningSince: null,
      quoteIndex: (s.quoteIndex + 1) % (list.length || QUOTE_COUNT_FALLBACK)
    });
  }

  await scheduleAlarms(s);
  await broadcast(s, settings);
  await paintIcon(s, settings);
}

// Start conditions: tab in view AND a chat open, at the same moment.
async function considerStart(status) {
  if (!status || !status.visible || !status.chatOpen) return;
  await withLock(async () => {
    const s = await getState();
    if (bypassOn(s) || s.phase !== 'IDLE') return;
    const ns = await putState({
      ...s, phase: 'ACTIVE', accumulatedMs: 0, runningSince: Date.now(),
      composeAllowed: false, composeDone: false
    });
    const settings = await getSettings();
    await scheduleAlarms(ns);
    await broadcast(ns, settings);
    await paintIcon(ns, settings);
  });
}

/* ---------- tab bookkeeping ---------- */
async function onTabsChanged() {
  const open = (await waTabs()).length > 0;
  const { lastOpen } = await chrome.storage.local.get('lastOpen');
  if (lastOpen && !open) await bumpQuote('whatsapp-closed'); // WhatsApp was closed
  await chrome.storage.local.set({ lastOpen: open });
  await evaluate();
}

/* ---------- wiring ---------- */
chrome.alarms.onAlarm.addListener(() => withLock(evaluate));
chrome.tabs.onRemoved.addListener(() => withLock(onTabsChanged));
chrome.tabs.onCreated.addListener(() => withLock(onTabsChanged));
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.url || info.status === 'complete') withLock(onTabsChanged);
});
chrome.windows.onRemoved.addListener(() => withLock(onTabsChanged));
chrome.runtime.onStartup.addListener(() => withLock(evaluate));

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await waTabs();
  for (const t of tabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['template.js', 'content.js'] });
    }
    catch (e) { /* not injectable */ }
  }
  await withLock(evaluate);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg) { sendResponse({}); return; }

    if (msg.type === 'SET_SETTINGS') {
      const merged = { ...(await getSettings()), ...(msg.settings || {}) };
      await putSettings(merged);
      const s = await getState();
      await broadcast(s, merged);
      await paintIcon(s, merged);
      sendResponse({ settings: merged, state: await publicState(s, merged) });
      return;
    }

    if (msg.type === 'MESSAGE_SENT' || msg.type === 'COMPOSE_EXPIRED') {
      await withLock(closeCompose);
      const st = await getState();
      sendResponse({ state: await publicState(st), settings: await getSettings() });
      return;
    }

    if (msg.type === 'GRANT_BYPASS') {
      await withLock(async () => {
        const s = await getState();
        await putState({
          ...s, phase: 'IDLE', accumulatedMs: 0, runningSince: null,
          bypassUntil: Date.now() + BYPASS_MS, bypassFromQuiz: true
        });
      });
      await withLock(evaluate);
      const s = await getState();
      sendResponse({ state: await publicState(s), settings: await getSettings() });
      return;
    }

    if (msg.type === 'END_BYPASS') {
      await withLock(async () => {
        const s = await getState();
        if (s.bypassFromQuiz) {
          // The quiz bought time out of a blackout, so switching the guard back on owes the
          // blackout, not a fresh 8 minute allowance.
          await putState({
            ...s, bypassUntil: 0, bypassFromQuiz: false,
            phase: 'BLOCKED', accumulatedMs: 0, runningSince: Date.now(),
            composeAllowed: false, composeDone: true
          });
        } else {
          await putState({ ...s, bypassUntil: 0 });
        }
      });
      await withLock(evaluate);
      const s = await getState();
      sendResponse({ state: await publicState(s), settings: await getSettings() });
      return;
    }

    if (msg.status) await considerStart(msg.status);
    if (msg.type !== 'GET_STATE') await withLock(evaluate);

    const s = await getState();
    sendResponse({ state: await publicState(s), settings: await getSettings() });
  })();
  return true;
});
