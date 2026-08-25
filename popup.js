/* Popup: live timers, blackout appearance, quick replies, EMERGENCY. */

const SANS = 'Arial, Helvetica, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const PASS_MARK = 6;

const el = (id) => document.getElementById(id);
const fmt = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
};

let settings = null;
let state = null;

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  el('theme').textContent = theme === 'light' ? '☀' : '☾';
}

/* ---------------- messaging ---------------- */
function ask(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(resp || null);
    });
  });
}

async function refresh(msg) {
  const resp = await ask(msg || { type: 'GET_STATE' });
  if (!resp) return;
  state = resp.state;
  if (resp.settings) settings = resp.settings;
  render();
}

/* ---------------- timers ---------------- */
function render() {
  if (!state) return;

  const active = state.phase === 'ACTIVE';
  const blocked = state.phase === 'BLOCKED' || state.phase === 'ESCAPING';

  el('v8').textContent = active ? fmt(state.remainingMs) : fmt(state.activeLimitMs);
  el('v42').textContent = blocked ? fmt(state.remainingMs) : fmt(state.blockedLimitMs);
  el('t8').className = 'timer' + (active ? ' live-usage' : ' dim');
  el('t42').className = 'timer' + (blocked ? ' live-block' : ' dim');

  el('dot').className = 'dot' + (blocked ? ' blocked' : (state.bypass || !active) ? ' off' : '');

  let status;
  if (state.bypass) status = 'Emergency bypass on — guard disabled';
  else if (blocked) status = 'Blackout running';
  else if (active) status = state.running ? 'Usage running' : 'Usage paused — WhatsApp closed';
  else status = 'Waiting — open WhatsApp and a chat';
  el('status').textContent = status;

  // Two banks, two buttons; while a bypass is running both give way to one enable button.
  if (state.bypass) {
    el('emergencyRow').setAttribute('hidden', '');
    el('enableGuard').removeAttribute('hidden');
  } else {
    el('emergencyRow').removeAttribute('hidden');
    el('enableGuard').setAttribute('hidden', '');
  }
  el('hint').textContent = state.bypass
    ? 'Turning the guard back on resumes the blackout you skipped, not a fresh allowance.'
    : '8 questions in a new tab, either bank. Get ' + PASS_MARK + ' right to switch the guard off.';

  if (settings) renderSettings();
}

/* ---------------- appearance ---------------- */
const entryFor = (s) => (s.activePreset === 'custom' ? s.custom : s.presets[s.activePreset]);

function swatches(entry) {
  const box = document.createElement('span');
  box.className = 'sw-set';
  [entry.bg, entry.upper, entry.lower].forEach((c) => {
    const sq = document.createElement('span');
    sq.className = 'sw';
    sq.style.background = c;
    box.appendChild(sq);
  });
  return box;
}

function ddRow(entry, value, current) {
  const row = document.createElement('button');
  row.className = 'dd-row' + (String(value) === String(current) ? ' on' : '');
  row.dataset.value = value;
  const name = document.createElement('span');
  name.className = 'dd-name';
  name.textContent = entry.name || 'Custom';
  row.append(swatches(entry), name);
  row.addEventListener('click', () => {
    saveSettings({ activePreset: value === 'custom' ? 'custom' : Number(value) });
    closeDropdown();
  });
  return row;
}

function closeDropdown() {
  el('ddList').setAttribute('hidden', '');
  el('ddButton').setAttribute('aria-expanded', 'false');
}

function renderDropdown() {
  const cur = settings.activePreset;
  const entry = entryFor(settings);

  const btn = el('ddCurrent');
  btn.innerHTML = '';
  const name = document.createElement('span');
  name.className = 'dd-name';
  name.textContent = settings.activePreset === 'custom' ? 'Custom' : entry.name;
  btn.append(swatches(entry), name);

  const list = el('ddList');
  list.innerHTML = '';
  settings.presets.forEach((p, i) => list.appendChild(ddRow(p, i, cur)));
  list.appendChild(ddRow({ ...settings.custom, name: 'Custom' }, 'custom', cur));
}

function renderSettings() {
  applyTheme(settings.theme);
  renderDropdown();

  const setVal = (node, value) => {
    if (node === document.activeElement) return;
    if (node.value !== value) node.value = value;
  };

  const isCustom = settings.activePreset === 'custom';
  const entry = entryFor(settings);

  setVal(el('presetName'), isCustom ? 'Custom' : entry.name);
  el('presetName').disabled = isCustom;
  el('presetDelete').disabled = isCustom || settings.presets.length <= 1;

  setVal(el('bg'), entry.bg);
  setVal(el('fgUpper'), entry.upper);
  setVal(el('fgLower'), entry.lower);
  setVal(el('message'), settings.message || '');
  setVal(el('lowerMessage'), settings.lowerMessage || '');
  setVal(el('quoteFont'), settings.quoteFont);
  setVal(el('pushupFont'), settings.pushupFont);

  renderReplies();

  const preview = el('preview');
  preview.style.background = entry.bg;
  const q = el('previewQuote');
  const p = el('previewPush');
  q.style.color = entry.upper;
  p.style.color = entry.lower;
  q.style.fontFamily = settings.quoteFont === 'serif' ? SERIF : SANS;
  p.style.fontFamily = settings.pushupFont === 'serif' ? SERIF : SANS;

  const sample = (t) => window.TimeGuardTemplate.render(t, 42);
  q.textContent = (settings.message && settings.message.trim())
    ? sample(settings.message.trim())
    : ((state && state.text) || 'One focused hour beats a whole evening of scrolling.');
  p.textContent = (settings.lowerMessage && settings.lowerMessage.trim())
    ? sample(settings.lowerMessage.trim())
    : 'Go do 42 pushups.';
}

function renderReplies() {
  const box = el('replyList');
  const sig = (settings.replies || []).length + ':' + (document.activeElement && document.activeElement.dataset.reply);
  if (box.dataset.count !== String((settings.replies || []).length)) {
    box.dataset.count = String((settings.replies || []).length);
    box.innerHTML = '';
    (settings.replies || []).forEach((text, i) => {
      const row = document.createElement('div');
      row.className = 'reply-row';
      const ta = document.createElement('textarea');
      ta.rows = 2;
      ta.value = text;
      ta.dataset.reply = String(i);
      ta.addEventListener('input', () => {
        const replies = settings.replies.slice();
        replies[i] = ta.value;
        saveSettings({ replies });
      });
      const del = document.createElement('button');
      del.className = 'mini danger';
      del.textContent = '×';
      del.title = 'Delete this reply';
      del.addEventListener('click', () => {
        saveSettings({ replies: settings.replies.filter((_, j) => j !== i) });
      });
      row.append(ta, del);
      box.appendChild(row);
    });
  } else {
    box.querySelectorAll('textarea').forEach((ta) => {
      const i = Number(ta.dataset.reply);
      if (ta !== document.activeElement && ta.value !== settings.replies[i]) ta.value = settings.replies[i];
    });
  }
}

async function saveSettings(patch) {
  settings = Object.assign({}, settings, patch);
  renderSettings();
  await refresh({ type: 'SET_SETTINGS', settings });
}

function writeEntry(patch) {
  if (settings.activePreset === 'custom') {
    saveSettings({ custom: { ...settings.custom, ...patch } });
  } else {
    const presets = settings.presets.slice();
    presets[settings.activePreset] = { ...presets[settings.activePreset], ...patch };
    saveSettings({ presets });
  }
}

/* ---------------- wiring ---------------- */
const panelToggle = (btnId, panelId, chevId) => {
  el(btnId).addEventListener('click', () => {
    const panel = el(panelId);
    const open = panel.hasAttribute('hidden');
    if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
    el(chevId).className = 'chev' + (open ? ' open' : '');
    el(btnId).setAttribute('aria-expanded', String(open));
  });
};
panelToggle('settingsToggle', 'settingsPanel', 'chev');
panelToggle('repliesToggle', 'repliesPanel', 'repliesChev');

el('ddButton').addEventListener('click', () => {
  const list = el('ddList');
  const open = list.hasAttribute('hidden');
  if (open) list.removeAttribute('hidden'); else list.setAttribute('hidden', '');
  el('ddButton').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (!el('dropdown').contains(e.target)) closeDropdown();
});

el('bg').addEventListener('input', (e) => writeEntry({ bg: e.target.value }));
el('fgUpper').addEventListener('input', (e) => writeEntry({ upper: e.target.value }));
el('fgLower').addEventListener('input', (e) => writeEntry({ lower: e.target.value }));

// Each swap sits on one side of the triangle and exchanges the two corners it joins,
// for the selected entry only.
el('swapUpper').addEventListener('click', () => {
  const e = entryFor(settings);
  writeEntry({ bg: e.upper, upper: e.bg });
});
el('swapLower').addEventListener('click', () => {
  const e = entryFor(settings);
  writeEntry({ bg: e.lower, lower: e.bg });
});
el('swapText').addEventListener('click', () => {
  const e = entryFor(settings);
  writeEntry({ upper: e.lower, lower: e.upper });
});

// Vertical swap in the centre: both text colours collapse onto the background, and the
// background becomes the mean, channel by channel, of the two text colours they came from.
const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = ([r, g, b]) => '#' + [r, g, b]
  .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0'))
  .join('');

el('swapAll').addEventListener('click', () => {
  const e = entryFor(settings);
  const [ru, gu, bu] = hexToRgb(e.upper);
  const [rl, gl, bl] = hexToRgb(e.lower);
  const mean = rgbToHex([(ru + rl) / 2, (gu + gl) / 2, (bu + bl) / 2]);
  writeEntry({ bg: mean, upper: e.bg, lower: e.bg });
});

el('message').addEventListener('input', (e) => saveSettings({ message: e.target.value }));
el('lowerMessage').addEventListener('input', (e) => saveSettings({ lowerMessage: e.target.value }));
el('quoteFont').addEventListener('change', (e) => saveSettings({ quoteFont: e.target.value }));
el('pushupFont').addEventListener('change', (e) => saveSettings({ pushupFont: e.target.value }));

el('theme').addEventListener('click', () => {
  saveSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' });
});

el('presetName').addEventListener('input', (e) => {
  if (settings.activePreset === 'custom') return;
  writeEntry({ name: e.target.value });
});
el('presetAdd').addEventListener('click', () => {
  const from = entryFor(settings);
  const presets = settings.presets.concat([{
    name: 'Preset ' + (settings.presets.length + 1), bg: from.bg, upper: from.upper, lower: from.lower
  }]);
  saveSettings({ presets, activePreset: presets.length - 1 });
});
el('presetDelete').addEventListener('click', () => {
  if (settings.activePreset === 'custom' || settings.presets.length <= 1) return;
  const idx = settings.activePreset;
  const presets = settings.presets.filter((_, i) => i !== idx);
  saveSettings({ presets, activePreset: Math.min(idx, presets.length - 1) });
});

el('replyAdd').addEventListener('click', () => {
  saveSettings({ replies: (settings.replies || []).concat(['']) });
});

el('dontreadme').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('dontreadme.html') });
});

const openQuiz = (bank) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('quiz.html?bank=' + bank) });
  window.close();
};
el('emergencyEsat').addEventListener('click', () => openQuiz('esat'));
el('emergencyIoqm').addEventListener('click', () => openQuiz('ioqm'));
el('enableGuard').addEventListener('click', () => refresh({ type: 'END_BYPASS' }));

/* ---------------- boot ---------------- */
refresh();
setInterval(refresh, 1000);
