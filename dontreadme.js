/* Theme is shared with the popup through extension storage. */
const themeBtn = document.getElementById('theme');

function paintTheme(theme) {
  const light = theme === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  const label = document.getElementById('themeLabel');
  if (label) label.textContent = light ? '\u2600 Light mode' : '\u263E Dark mode';
}

chrome.storage.local.get('settings', ({ settings }) => {
  paintTheme((settings && settings.theme) || 'dark');
});

if (themeBtn) themeBtn.addEventListener('click', () => {
  chrome.storage.local.get('settings', ({ settings }) => {
    const next = ((settings && settings.theme) === 'light') ? 'dark' : 'light';
    paintTheme(next);
    chrome.storage.local.set({ settings: Object.assign({}, settings || {}, { theme: next }) });
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    paintTheme((changes.settings.newValue || {}).theme || 'dark');
  }
});

/* DONTREADME: renders the quote file and the question bank without freezing the tab. */

const PAGE = 250;

let allQuotes = [];
let filtered = [];
let shown = 0;

const list = document.getElementById('quoteList');
const moreBtn = document.getElementById('moreQuotes');
const countEl = document.getElementById('quoteCount');
const searchEl = document.getElementById('quoteSearch');

function renderChunk() {
  const frag = document.createDocumentFragment();
  const end = Math.min(shown + PAGE, filtered.length);
  for (let i = shown; i < end; i++) {
    const { index, text } = filtered[i];
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(index + 1).padStart(4, '0');
    const t = document.createElement('span');
    t.textContent = text;
    li.append(n, t);
    frag.appendChild(li);
  }
  list.appendChild(frag);
  shown = end;
  moreBtn.hidden = shown >= filtered.length;
  countEl.textContent = shown.toLocaleString() + ' of ' + filtered.length.toLocaleString() + ' shown';
}

function resetList() {
  list.innerHTML = '';
  shown = 0;
  renderChunk();
}

moreBtn.addEventListener('click', renderChunk);

let searchTimer = null;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = searchEl.value.trim().toLowerCase();
    filtered = q
      ? allQuotes.filter((item) => item.text.toLowerCase().includes(q))
      : allQuotes;
    resetList();
  }, 150);
});

fetch('data/quotes.json')
  .then((r) => r.json())
  .then((arr) => {
    allQuotes = arr.map((text, index) => ({ text, index }));
    filtered = allQuotes;
    resetList();
  })
  .catch(() => {
    countEl.textContent = 'Could not load quotes.json';
  });

let mcqBank = [];
let mcqShown = 0;
const mcqBox = document.getElementById('mcqList');
const mcqMore = document.getElementById('moreMcq');
const mcqCount = document.getElementById('mcqCount');

function renderMcqChunk() {
  const frag = document.createDocumentFragment();
  const end = Math.min(mcqShown + 40, mcqBank.length);
  for (let i = mcqShown; i < end; i++) {
    const item = mcqBank[i];
    const wrap = document.createElement('div');
    wrap.className = 'mcq';

    const h = document.createElement('h4');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(i + 1).padStart(3, '0');
    h.append(n, document.createTextNode(item.q || item.src));
    if (item.q && item.src) {
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = item.src;
      h.appendChild(src);
    }
    wrap.appendChild(h);

    if (item.img) {
      const fig = document.createElement('div');
      fig.className = 'mcq-fig';
      const im = document.createElement('img');
      im.loading = 'lazy';
      im.src = item.img;
      im.alt = item.src;
      fig.appendChild(im);
      wrap.appendChild(fig);
    }

    const ul = document.createElement('ul');
    (item.options || item.letters).forEach((opt, oi) => {
      const li = document.createElement('li');
      li.textContent = opt;
      if (oi === item.answer) li.className = 'right';
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    frag.appendChild(wrap);
  }
  mcqBox.appendChild(frag);
  mcqShown = end;
  mcqMore.hidden = mcqShown >= mcqBank.length;
  mcqCount.textContent = mcqShown + ' of ' + mcqBank.length + ' shown';
}

mcqMore.addEventListener('click', renderMcqChunk);

fetch('data/questions.json')
  .then((r) => r.json())
  .then((bank) => {
    mcqBank = bank;
    renderMcqChunk();
  })
  .catch(() => { mcqCount.textContent = 'Could not load questions.json'; });

/* nav highlighting */
const links = Array.from(document.querySelectorAll('nav a'));
const sections = links
  .map((a) => document.querySelector(a.getAttribute('href')))
  .filter(Boolean);

const spy = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => {
        a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id);
      });
    });
  },
  { rootMargin: '-100px 0px -70% 0px' }
);
sections.forEach((s) => spy.observe(s));


/* ================= compressed version, behind one question ================= */

const gate = document.getElementById('gate');
const party = document.getElementById('party');
const compressed = document.getElementById('compressed');
let gateBank = null;
let gateItem = null;
let gateLocked = false;

function openGate() {
  gate.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
  nextGateQuestion();
}

function closeGate() {
  gate.setAttribute('hidden', '');
  document.body.style.overflow = '';
}

function showCompressed() {
  closeGate();
  compressed.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
  window.scrollTo(0, 0);
}

function hideCompressed() {
  compressed.setAttribute('hidden', '');
  document.body.style.overflow = '';
}

async function nextGateQuestion() {
  document.getElementById('gateWrong').setAttribute('hidden', '');
  gateLocked = false;

  if (!gateBank) {
    try {
      gateBank = await (await fetch('data/questions.json')).json();
    } catch (e) {
      document.getElementById('gateText').textContent = 'The question bank could not be read.';
      return;
    }
  }

  const raw = gateBank[Math.floor(Math.random() * gateBank.length)];
  gateItem = raw.img
    ? { img: raw.img, src: raw.src,
        order: raw.letters.map((l, i) => ({ text: l, correct: i === raw.answer })) }
    : { q: raw.q, src: raw.src,
        order: raw.options.map((t, i) => ({ text: t, correct: i === raw.answer })) };

  const fig = document.getElementById('gateFigure');
  if (gateItem.img) {
    document.getElementById('gateImage').src = gateItem.img;
    fig.removeAttribute('hidden');
    document.getElementById('gateText').textContent = '';
  } else {
    fig.setAttribute('hidden', '');
    document.getElementById('gateText').textContent = gateItem.q;
  }

  const box = document.getElementById('gateChoices');
  box.className = 'gate-choices' + (gateItem.img ? '' : ' text-mode');
  box.innerHTML = '';
  gateItem.order.forEach((opt) => {
    const b = document.createElement('button');
    b.textContent = opt.text;
    b.addEventListener('click', () => answerGate(opt));
    box.appendChild(b);
  });
}

function answerGate(opt) {
  if (gateLocked) return;
  gateLocked = true;

  const right = gateItem.order.find((o) => o.correct);

  if (opt.correct) {
    celebrate(right ? right.text : '?');
    return;
  }

  document.getElementById('gateChose').textContent = opt.text;
  document.getElementById('gateRight').textContent = right ? right.text : '?';
  document.getElementById('gateWrong').removeAttribute('hidden');
}

function celebrate(rightText) {
  closeGate();
  document.getElementById('partyLine').textContent =
    'Correct — the answer was ' + rightText + '.';
  party.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
  runConfetti();
  setTimeout(() => {
    party.setAttribute('hidden', '');
    showCompressed();
  }, 4000);
}

function runConfetti() {
  const canvas = document.getElementById('confetti');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colours = ['#25d366', '#ffffff', '#8ab4f8', '#ff9e5e', '#9ae6b4'];
  const bits = Array.from({ length: 160 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    vy: 2 + Math.random() * 4,
    vx: -1.5 + Math.random() * 3,
    spin: -0.2 + Math.random() * 0.4,
    a: Math.random() * Math.PI,
    c: colours[Math.floor(Math.random() * colours.length)]
  }));

  const started = Date.now();
  (function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    bits.forEach((b) => {
      b.x += b.vx; b.y += b.vy; b.a += b.spin;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    });
    if (Date.now() - started < 4100) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })();
}

document.getElementById('compress').addEventListener('click', openGate);
document.getElementById('gateClose').addEventListener('click', closeGate);
document.getElementById('gateRetry').addEventListener('click', nextGateQuestion);

document.getElementById('calcTab').addEventListener('click', () => {
  window.open('calculator.html', '_blank');
});

/* ---------------- quote search in the condensed version ---------------- */
const cSearch = document.getElementById('cSearch');
let cTimer = null;
cSearch.addEventListener('input', () => {
  clearTimeout(cTimer);
  cTimer = setTimeout(() => {
    const q = cSearch.value.trim().toLowerCase();
    const out = document.getElementById('cSearchOut');
    if (!q) { out.textContent = 'Type to find a quote.'; return; }
    if (!allQuotes.length) { out.textContent = 'Quotes are still loading.'; return; }
    const hits = allQuotes.filter((item) => item.text.toLowerCase().includes(q));
    if (!hits.length) { out.textContent = 'No quote matches that.'; return; }
    out.innerHTML = '';
    hits.slice(0, 12).forEach((h) => {
      const line = document.createElement('span');
      line.className = 'qhit';
      line.textContent = String(h.index + 1).padStart(4, '0') + '  ' + h.text;
      out.appendChild(line);
    });
    if (hits.length > 12) {
      const more = document.createElement('span');
      more.className = 'qmore';
      more.textContent = '+ ' + (hits.length - 12) + ' more';
      out.appendChild(more);
    }
  }, 150);
});
document.getElementById('expand').addEventListener('click', hideCompressed);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!gate.hasAttribute('hidden')) closeGate();
  else if (!compressed.hasAttribute('hidden')) hideCompressed();
});
