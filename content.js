/* WhatsApp Web Time Guard v2 — page agent
 * Reports "in view" + "chat open", presses Esc, paints the blackout, rewrites the
 * favicon and the tab title.
 */
(() => {
  if (window.__waTimeGuardLoaded) return;
  window.__waTimeGuardLoaded = true;

  const OVERLAY_ID = 'wa-time-guard-overlay';
  const FAVICON_ID = 'wa-time-guard-favicon';

  const REQUIRE_WINDOW_FOCUS = true; // another window on top also counts as "not in view"
  const FAVICON_ALWAYS = true;       // false = only replace the favicon while a timer runs

  const SANS = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
  const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", "Source Serif 4", serif';
  const fontStack = (k) => (k === 'serif' ? SERIF : SANS);

  const POLL_MS = 1000;
  const HEARTBEAT_MS = 15000;

  let state = {
    phase: 'IDLE', running: false, bypass: false, remainingMs: null, deadlineAt: null,
    colors: { bg: '#000000', upper: '#FFFFFF', lower: '#FFFFFF' }, fonts: { quote: 'sans', pushup: 'serif' },
    text: null, lowerText: null, blockedLimitMs: 42 * 60 * 1000,
    composeOpen: false, composeMsLeft: 0, replies: []
  };
  let lastStatus = { visible: null, chatOpen: null };
  let lastMinute = null;
  let lastPushups = null;
  let composerBuilt = false;
  let composeExpiredSent = false;
  let sending = false;
  let lastFaviconKey = null;
  let lastTitleWritten = null;
  let baseTitle = document.title;
  let savedIcons = null;
  let deadlineTimer = null;
  let lastDeadlinePing = 0;
  let lastHeartbeat = 0;
  let dead = false;

  /* ---------------- signals ---------------- */
  const CHAT_SELECTORS = [
    '#main',
    '[data-testid="conversation-panel-wrapper"]',
    '[data-testid="conversation-panel-messages"]',
    '[data-testid="conversation-compose-box-input"]'
  ];
  const isChatOpen = () => CHAT_SELECTORS.some((s) => document.querySelector(s));
  const inView = () => {
    if (document.visibilityState !== 'visible') return false;
    if (REQUIRE_WINDOW_FOCUS && typeof document.hasFocus === 'function') return document.hasFocus();
    return true;
  };
  const currentStatus = () => ({ visible: inView(), chatOpen: isChatOpen() });

  function remainingNow() {
    if (state.remainingMs == null) return null;
    if (state.running && state.deadlineAt) return Math.max(0, state.deadlineAt - Date.now());
    return state.remainingMs;
  }
  const timerLive = () => state.phase === 'ACTIVE' || state.phase === 'BLOCKED' || state.phase === 'ESCAPING';

  /* ---------------- messaging ---------------- */
  function send(type, extra) {
    if (dead) return;
    try {
      chrome.runtime.sendMessage(Object.assign({ type, status: currentStatus() }, extra || {}), (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && resp.state) applyState(resp.state);
      });
    } catch (e) { dead = true; }
  }

  /* ---------------- blackout overlay ---------------- */
  function buildOverlay() {
    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    const quote = document.createElement('div');
    quote.id = OVERLAY_ID + '-quote';
    const push = document.createElement('div');
    push.id = OVERLAY_ID + '-push';
    el.appendChild(quote);
    el.appendChild(push);
    return el;
  }

  /* ---------------- one last message ---------------- */

  function findComposerBox() {
    return document.querySelector('footer div[contenteditable="true"][data-tab]')
      || document.querySelector('[data-testid="conversation-compose-box-input"]')
      || document.querySelector('footer div[contenteditable="true"]');
  }

  function dispatchKey(target, key, code) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      const ev = new KeyboardEvent(type, {
        key: key, code: key, bubbles: true, cancelable: true, composed: true, view: window
      });
      try {
        Object.defineProperty(ev, 'keyCode', { get: () => code });
        Object.defineProperty(ev, 'which', { get: () => code });
      } catch (e) {}
      try { target.dispatchEvent(ev); } catch (e) {}
    }
  }

  function sendToChat(text) {
    return new Promise((resolve) => {
      const box = findComposerBox();
      if (!box) return resolve(false);

      box.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      // execCommand drives the same input events WhatsApp's editor listens for
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) {}
      if (!ok) {
        box.textContent = text;
        box.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      }

      setTimeout(() => {
        const btn = document.querySelector('footer [data-icon="send"], footer [data-icon="wds-ic-send-filled"], footer button[aria-label="Send"], [data-testid="send"]');
        if (btn) {
          try { (btn.closest('button') || btn).click(); return resolve(true); } catch (e) {}
        }
        dispatchKey(box, 'Enter', 13);
        resolve(true);
      }, 200);
    });
  }

  function buildComposer(el) {
    const wrap = document.createElement('div');
    wrap.id = OVERLAY_ID + '-compose';

    const label = document.createElement('div');
    label.id = OVERLAY_ID + '-compose-label';

    const presets = document.createElement('div');
    presets.id = OVERLAY_ID + '-presets';

    const row = document.createElement('div');
    row.id = OVERLAY_ID + '-row';
    const input = document.createElement('textarea');
    input.id = OVERLAY_ID + '-input';
    input.rows = 2;
    input.placeholder = 'One last message, then the screen is yours to ignore.';
    const sendBtn = document.createElement('button');
    sendBtn.id = OVERLAY_ID + '-send';
    sendBtn.textContent = 'Send';
    row.appendChild(input);
    row.appendChild(sendBtn);

    wrap.appendChild(label);
    wrap.appendChild(row);
    wrap.appendChild(presets);
    el.appendChild(wrap);

    sendBtn.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text || sending) return;
      sending = true;
      sendBtn.textContent = 'Sending';
      const ok = await sendToChat(text);
      sendBtn.textContent = ok ? 'Sent' : 'Could not send';
      input.disabled = true;
      // Escape follows immediately: the one message has been used.
      send('MESSAGE_SENT');
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
      e.stopPropagation();
    });

    composerBuilt = true;
    return wrap;
  }

  function styleComposer(wrap) {
    const c = state.colors || { bg: '#000000', upper: '#FFFFFF', lower: '#FFFFFF' };
    const fade = (a) => 'color-mix(in srgb, ' + c.upper + ' ' + a + '%, transparent)';

    wrap.style.cssText = [
      'width:min(680px,86vw)', 'margin:1.2vh auto 0', 'display:flex',
      'flex-direction:column', 'gap:10px', 'text-align:left'
    ].join(' !important;') + ' !important;';

    const label = wrap.querySelector('#' + OVERLAY_ID + '-compose-label');
    if (label) {
      label.style.cssText = [
        'color:' + c.upper, 'opacity:0.6', 'font-family:' + SANS, 'font-size:12px',
        'letter-spacing:0.12em', 'text-transform:uppercase', 'margin:0'
      ].join(' !important;') + ' !important;';
    }

    const presets = wrap.querySelector('#' + OVERLAY_ID + '-presets');
    if (presets) {
      presets.style.cssText = 'display:flex !important; gap:8px !important; align-items:stretch !important;';
    }
    wrap.querySelectorAll('#' + OVERLAY_ID + '-presets button').forEach((b) => {
      b.style.cssText = [
        'flex:1 1 0', 'min-width:0', 'text-align:left', 'cursor:pointer',
        'background:' + fade(8), 'color:' + c.upper, 'border:1px solid ' + fade(28),
        'border-radius:10px', 'padding:9px 11px', 'margin:0',
        'font-family:' + SANS, 'font-size:12px', 'line-height:1.35', 'opacity:0.9'
      ].join(' !important;') + ' !important;';
    });

    const row = wrap.querySelector('#' + OVERLAY_ID + '-row');
    if (row) row.style.cssText = 'display:flex !important; gap:8px !important; align-items:stretch !important;';

    const input = wrap.querySelector('#' + OVERLAY_ID + '-input');
    if (input) {
      input.style.cssText = [
        'flex:1', 'resize:none', 'background:' + fade(10), 'color:' + c.upper,
        'border:1px solid ' + fade(35), 'border-radius:10px', 'padding:10px 12px',
        'font-family:' + SANS, 'font-size:14px', 'line-height:1.4', 'outline:none'
      ].join(' !important;') + ' !important;';
    }

    const btn = wrap.querySelector('#' + OVERLAY_ID + '-send');
    if (btn) {
      btn.style.cssText = [
        'cursor:pointer', 'background:' + c.upper, 'color:' + c.bg, 'border:0',
        'border-radius:10px', 'padding:0 22px', 'font-family:' + SANS,
        'font-size:14px', 'font-weight:700'
      ].join(' !important;') + ' !important;';
    }
  }

  function renderComposer(el) {
    let wrap = document.getElementById(OVERLAY_ID + '-compose');

    if (!state.composeOpen || !isChatOpen()) {
      if (wrap) { wrap.remove(); composerBuilt = false; }
      return;
    }

    if (!wrap) wrap = buildComposer(el);

    // presets can be edited from the popup, so rebuild them when they change
    const presets = wrap.querySelector('#' + OVERLAY_ID + '-presets');
    const signature = (state.replies || []).join('\u0000');
    if (presets && presets.dataset.sig !== signature) {
      presets.dataset.sig = signature;
      presets.innerHTML = '';
      (state.replies || []).forEach((text) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.addEventListener('click', () => {
          const input = document.getElementById(OVERLAY_ID + '-input');
          if (input && !input.disabled) { input.value = text; input.focus(); }
        });
        presets.appendChild(b);
      });
    }

    const secs = Math.max(0, Math.ceil((state.composeMsLeft || 0) / 1000));
    const label = wrap.querySelector('#' + OVERLAY_ID + '-compose-label');
    if (label) {
      label.textContent = 'One message \u00b7 ' +
        Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') + ' left';
    }

    styleComposer(wrap);
  }

  function styleOverlay(el) {
    const c = state.colors || { bg: '#000000', upper: '#FFFFFF', lower: '#FFFFFF' };
    el.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
      'width:100vw', 'height:100vh', 'margin:0', 'padding:0 8vw',
      'background:' + c.bg, 'z-index:2147483647',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
      'gap:2.6vh', 'pointer-events:auto', 'user-select:none',
      'opacity:1', 'visibility:visible', 'transform:none', 'filter:none'
    ].join(' !important;') + ' !important;';

    const quote = el.querySelector('#' + OVERLAY_ID + '-quote');
    const push = el.querySelector('#' + OVERLAY_ID + '-push');

    if (quote) {
      quote.style.cssText = [
        'color:' + c.upper, 'text-align:center',
        'font-family:' + fontStack(state.fonts && state.fonts.quote),
        'font-size:clamp(20px,3.2vw,40px)', 'font-weight:400', 'line-height:1.45',
        'letter-spacing:0.01em', 'max-width:26ch', 'margin:0'
      ].join(' !important;') + ' !important;';
    }
    if (push) {
      push.style.cssText = [
        'color:' + c.lower, 'text-align:center',
        'font-family:' + fontStack(state.fonts && state.fonts.pushup),
        'font-size:clamp(15px,1.9vw,24px)', 'font-weight:400', 'font-style:italic',
        'line-height:1.4', 'opacity:0.82', 'margin:0'
      ].join(' !important;') + ' !important;';
    }
  }

  function renderTemplate(text, minutes) {
    try {
      if (window.TimeGuardTemplate) return window.TimeGuardTemplate.render(text, minutes);
    } catch (e) { /* fall through */ }
    // template.js missing (e.g. a tab that predates an update): substitute and move on,
    // because throwing here would leave the blackout as a bare black rectangle.
    return typeof text === 'string' ? text.replace(/<\s*minutas\s*>/gi, String(minutes)) : text;
  }

  function pushupsText() {
    const rem = remainingNow();
    const mins = rem == null ? 0 : Math.max(0, Math.ceil(rem / 60000));
    if (state.lowerText) return renderTemplate(state.lowerText, mins);
    return 'Go do ' + mins + ' pushups.';
  }

  function showOverlay() {
    let el = document.getElementById(OVERLAY_ID);
    if (!el) {
      el = buildOverlay();
      (document.documentElement || document.body).appendChild(el);
      lastPushups = null;
    }
    styleOverlay(el);
    const quote = el.querySelector('#' + OVERLAY_ID + '-quote');
    if (quote && state.text) {
      const rem = remainingNow();
      const mins = rem == null ? 0 : Math.max(0, Math.ceil(rem / 60000));
      const upper = renderTemplate(state.text, mins);
      if (quote.textContent !== upper) quote.textContent = upper;
    }
    const push = el.querySelector('#' + OVERLAY_ID + '-push');
    const t = pushupsText();
    if (push && t !== lastPushups) { push.textContent = t; lastPushups = t; }

    try { renderComposer(el); } catch (e) { /* the quote must survive a composer fault */ }
  }

  function hideOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    lastPushups = null;
  }

  /* ---------------- Esc x3 ---------------- */
  function dispatchEscape() {
    const targets = [document.activeElement, document.body, document.documentElement, document, window].filter(Boolean);
    for (const type of ['keydown', 'keypress', 'keyup']) {
      for (const target of targets) {
        const ev = new KeyboardEvent(type, {
          key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, composed: true, view: window
        });
        try {
          Object.defineProperty(ev, 'keyCode', { get: () => 27 });
          Object.defineProperty(ev, 'which', { get: () => 27 });
        } catch (e) {}
        try { target.dispatchEvent(ev); } catch (e) {}
      }
    }
  }

  function pressEscapeThrice() {
    return new Promise((resolve) => {
      let n = 0;
      const step = () => {
        dispatchEscape();
        n += 1;
        if (n < 3) setTimeout(step, 120);
        else setTimeout(resolve, 60);
      };
      step();
    });
  }

  function fallbackCloseChat() {
    if (!isChatOpen()) return;
    const btn = document.querySelector('header [data-icon="back"]')
      || document.querySelector('button[aria-label="Back"]')
      || document.querySelector('[data-testid="back"]');
    if (btn) { try { btn.click(); } catch (e) {} }
  }

  /* ---------------- favicon: the number itself ---------------- */
  function iconLook() {
    if (state.bypass) return { label: '8', bg: '#8696A0', fg: '#111B21' };
    if (state.phase === 'BLOCKED' || state.phase === 'ESCAPING') {
      const rem = remainingNow();
      return {
        label: String(Math.min(99, Math.max(0, Math.ceil((rem == null ? 0 : rem) / 60000)))),
        bg: state.colors.bg, fg: state.colors.upper
      };
    }
    if (state.phase === 'ACTIVE') {
      const rem = remainingNow();
      return {
        label: String(Math.min(99, Math.max(0, Math.ceil((rem == null ? 0 : rem) / 60000)))),
        bg: '#25D366', fg: '#FFFFFF'
      };
    }
    return { label: '8', bg: '#25D366', fg: '#FFFFFF' };
  }

  function renderFaviconDataUrl(look) {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = look.bg;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(0, 0, size, size, size * 0.22); ctx.fill(); }
    else ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = look.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(size * (look.label.length > 1 ? 0.6 : 0.76)) + 'px Arial, sans-serif';
    ctx.fillText(look.label, size / 2, size / 2 + size * 0.04);
    return c.toDataURL('image/png');
  }

  function applyFavicon() {
    const wanted = FAVICON_ALWAYS || timerLive();
    const head = document.head;
    if (!head) return;

    if (!wanted) { restoreFavicon(); return; }

    const look = iconLook();
    const key = look.label + look.bg + look.fg;

    // Drop WhatsApp's own icon links (remembering the first set so we can put them back).
    const others = Array.from(head.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]'))
      .filter((l) => l.id !== FAVICON_ID);
    if (others.length) {
      if (!savedIcons) {
        savedIcons = others.map((l) => ({ rel: l.getAttribute('rel'), href: l.getAttribute('href'), type: l.getAttribute('type'), sizes: l.getAttribute('sizes') }));
      }
      others.forEach((l) => l.remove());
    }

    let link = document.getElementById(FAVICON_ID);
    if (!link) {
      link = document.createElement('link');
      link.id = FAVICON_ID;
      link.rel = 'icon';
      link.type = 'image/png';
      head.appendChild(link);
      lastFaviconKey = null;
    }
    if (key !== lastFaviconKey) {
      link.href = renderFaviconDataUrl(look);
      lastFaviconKey = key;
    }
  }

  function restoreFavicon() {
    const link = document.getElementById(FAVICON_ID);
    if (link) link.remove();
    lastFaviconKey = null;
    if (savedIcons && document.head && !document.head.querySelector('link[rel~="icon"]')) {
      for (const s of savedIcons) {
        const l = document.createElement('link');
        l.setAttribute('rel', s.rel || 'icon');
        if (s.href) l.setAttribute('href', s.href);
        if (s.type) l.setAttribute('type', s.type);
        if (s.sizes) l.setAttribute('sizes', s.sizes);
        document.head.appendChild(l);
      }
    }
    savedIcons = null;
  }

  /* ---------------- tab title: "(n) WhatsApp Web (ss)" ---------------- */
  const SUFFIX_RE = /\s\(\d{2}\)$/;

  function noteBaseTitle() {
    const t = document.title;
    if (t === lastTitleWritten) return;      // our own write, ignore
    baseTitle = t.replace(SUFFIX_RE, '');    // WhatsApp changed it (unread count etc.)
  }

  function applyTitle() {
    noteBaseTitle();
    const rem = remainingNow();
    if (!timerLive() || !state.running || rem == null) {
      if (lastTitleWritten && document.title === lastTitleWritten) {
        lastTitleWritten = null;
        document.title = baseTitle;
      }
      return;
    }
    const secs = Math.ceil(rem / 1000) % 60;
    const next = baseTitle + ' (' + String(secs).padStart(2, '0') + ')';
    if (document.title !== next) {
      lastTitleWritten = next;
      document.title = next;
    }
  }

  function watchTitle() {
    const el = document.querySelector('title');
    if (!el) return;
    const obs = new MutationObserver(() => { noteBaseTitle(); });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
  }

  /* ---------------- state ---------------- */
  function applyState(next) {
    state = Object.assign({}, state, next);
    if (state.composeOpen) composeExpiredSent = false;

    if (state.phase === 'BLOCKED' || state.phase === 'ESCAPING') showOverlay();
    else hideOverlay();

    lastMinute = null;
    applyFavicon();
    applyTitle();

    if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
    if (state.deadlineAt) {
      deadlineTimer = setTimeout(pingDeadline, Math.max(0, state.deadlineAt - Date.now()) + 60);
    }

    if (state.phase === 'IDLE' && !state.bypass) {
      const s = currentStatus();
      if (s.visible && s.chatOpen) send('STATUS');
    }
  }

  function pingDeadline() {
    const now = Date.now();
    if (now - lastDeadlinePing < 2000) return;
    lastDeadlinePing = now;
    send('DEADLINE');
  }

  /* ---------------- loops ---------------- */
  function poll() {
    if (dead) return;

    const s = currentStatus();
    if (s.visible !== lastStatus.visible || s.chatOpen !== lastStatus.chatOpen) {
      lastStatus = s;
      send('STATUS');
    }

    if ((state.phase === 'BLOCKED' || state.phase === 'ESCAPING') && !state.text) {
      send('HEARTBEAT');   // blacked out with nothing to show: re-ask for the quote
    }

    if (state.phase === 'BLOCKED' || state.phase === 'ESCAPING') {
      if (state.composeOpen) {
        state.composeMsLeft = Math.max(0, state.composeMsLeft - POLL_MS);
        if (state.composeMsLeft <= 0 && !composeExpiredSent) {
          composeExpiredSent = true;
          send('COMPOSE_EXPIRED');
        }
      }
      showOverlay();
    }

    applyTitle();

    const rem = remainingNow();
    const minute = rem == null ? null : Math.ceil(rem / 60000);
    if (minute !== lastMinute) {
      lastMinute = minute;
      applyFavicon();
      if (timerLive() && state.running) send('MINUTE_TICK');
    }

    if (state.deadlineAt && Date.now() >= state.deadlineAt) pingDeadline();

    if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
      lastHeartbeat = Date.now();
      send('HEARTBEAT');
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'CHAT_STATUS') {
      sendResponse({ chatOpen: isChatOpen() });
      return;
    }
    if (msg.type === 'STATE') {
      applyState(msg.state);
      sendResponse({ ok: true });
    } else if (msg.type === 'PRESS_ESCAPE') {
      if (msg.state) state = Object.assign({}, state, msg.state);
      pressEscapeThrice().then(() => {
        fallbackCloseChat();
        if (state.phase !== 'BLOCKED') state.phase = 'ESCAPING';
        state.composeOpen = false;
        showOverlay();
        sendResponse({ ok: true });
      });
      return true;
    }
  });

  const onChange = () => send('STATUS');
  document.addEventListener('visibilitychange', onChange, true);
  window.addEventListener('focus', onChange, true);
  window.addEventListener('blur', onChange, true);
  window.addEventListener('pageshow', onChange, true);

  watchTitle();
  setInterval(poll, POLL_MS);
  send('HELLO');
})();
