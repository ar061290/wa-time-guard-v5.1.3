/* Emergency quiz: full tab, stopwatch, attempt log as CSV, PDF review sheet. */

const PASS_MARK = 6;
const QUIZ_LENGTH = 8;

// Which bank is running. ESAT is multiple choice; IOQM answers are integers 00-99 and are
// typed in, so each keeps its own question file, its own log and its own downloads.
const BANKS = {
  esat: {
    label: 'ESAT — multiple choice',
    file: 'data/questions.json',
    logKey: 'quizLog',
    csv: 'time-guard/quiz-log-esat.csv',
    pdfPrefix: 'time-guard/quiz-esat-',
    typed: false
  },
  ioqm: {
    label: 'IOQM — type the answer',
    file: 'data/questions-ioqm.json',
    logKey: 'quizLogIoqm',
    csv: 'time-guard/quiz-log-ioqm.csv',
    pdfPrefix: 'time-guard/quiz-ioqm-',
    typed: true
  }
};

const BANK = BANKS[new URLSearchParams(location.search).get('bank')] || BANKS.esat;
const LOG_KEY = BANK.logKey;

const el = (id) => document.getElementById(id);
let quiz = null;
let locked = false;
let tick = null;

/* ---------------- time formatting ---------------- */
const clockText = (ms) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return m + ':' + String(s).padStart(2, '0') + '.' + d;
};
const shortTime = (ms) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ask(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(resp || null);
    });
  });
}

/* ---------------- attempt log ---------------- */
async function readLog() {
  const got = await chrome.storage.local.get(LOG_KEY);
  return Array.isArray(got[LOG_KEY]) ? got[LOG_KEY] : [];
}

async function writeLog(entries) {
  await chrome.storage.local.set({ [LOG_KEY]: entries });
}

function toCsv(entries) {
  const head = 'finished_at,questions,correct,accuracy,seconds,passed';
  const rows = entries.map((e) => [
    new Date(e.at).toISOString(),
    e.total,
    e.correct,
    (e.correct / e.total).toFixed(4),
    (e.ms / 1000).toFixed(1),
    e.correct >= PASS_MARK ? 'yes' : 'no'
  ].join(','));
  return [head].concat(rows).join('\n') + '\n';
}

// Best accuracy ever reached; among those attempts, the fastest and the latest.
function records(entries) {
  if (!entries.length) return null;
  const acc = (e) => e.correct / e.total;
  const best = Math.max(...entries.map(acc));
  const atBest = entries.filter((e) => acc(e) === best);
  return {
    bestAccuracy: best,
    bestAtBest: Math.min(...atBest.map((e) => e.ms)),
    bestOverall: Math.min(...entries.map((e) => e.ms)),
    last: entries[entries.length - 1].ms,
    lastAtBest: atBest[atBest.length - 1].ms
  };
}

async function paintRecords() {
  const r = records(await readLog());
  if (!r) return;
  const pct = Math.round(r.bestAccuracy * 100) + '%';
  el('recBestAtBest').textContent = shortTime(r.bestAtBest) + ' @ ' + pct;
  el('recBest').textContent = shortTime(r.bestOverall);
  el('recLast').textContent = shortTime(r.last);
  el('recLastAtBest').textContent = shortTime(r.lastAtBest) + ' @ ' + pct;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'overwrite' }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
}

/* ---------------- PDF review sheet ---------------- */
async function exportPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = M;

  const stamp = new Date(quiz.finishedAt);
  doc.setFont('helvetica', 'bold').setFontSize(16);
  doc.text((BANK.typed ? 'IOQM' : 'ESAT') + ' emergency quiz — attempt review', M, y); y += 20;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110);
  doc.text(stamp.toLocaleString() + '   ·   ' + quiz.correct + ' of ' + quiz.items.length +
           ' correct   ·   ' + clockText(quiz.ms) + '   ·   ' +
           (quiz.correct >= PASS_MARK ? 'passed' : 'not passed'), M, y);
  y += 22;
  doc.setTextColor(0);

  for (let i = 0; i < quiz.items.length; i++) {
    const item = quiz.items[i];
    const picked = quiz.answers[i];
    const correct = item.typed
      ? { text: String(item.answer) }
      : item.order.find((o) => o.correct);

    if (y > H - 140) { doc.addPage(); y = M; }

    doc.setFont('helvetica', 'bold').setFontSize(11);
    doc.text('Question ' + (i + 1) + '  ·  ' + (item.src || ''), M, y); y += 6;

    if (item.img) {
      const data = await toDataUrl(item.img);
      const ratio = data.h / data.w;
      let w = W - M * 2;
      let h = w * ratio;
      if (h > H - M * 2 - 60) { h = H - M * 2 - 60; w = h / ratio; }
      if (y + h > H - 60) { doc.addPage(); y = M; }
      doc.addImage(data.url, 'JPEG', M, y + 6, w, h);
      y += h + 16;
    } else {
      doc.setFont('helvetica', 'normal').setFontSize(10);
      const lines = doc.splitTextToSize(item.q || '', W - M * 2);
      doc.text(lines, M, y + 14); y += 14 + lines.length * 12;
      (item.order || []).forEach((o, oi) => {
        const label = String.fromCharCode(65 + oi) + '.  ' + o.text;
        const wrapped = doc.splitTextToSize(label, W - M * 2 - 12);
        doc.text(wrapped, M + 12, y + 12); y += wrapped.length * 12 + 2;
      });
      y += 6;
    }

    if (y > H - 60) { doc.addPage(); y = M; }
    doc.setFontSize(10).setFont('helvetica', 'bold');
    doc.setTextColor(20, 120, 70);
    doc.text('Correct answer: ' + (correct ? correct.text : '?'), M, y); y += 14;
    const right = picked && picked.correct;
    doc.setTextColor(right ? 20 : 190, right ? 120 : 40, right ? 70 : 50);
    doc.text('Your answer: ' + (picked ? picked.text : 'not answered') + (right ? '  ✓' : '  ✗'), M, y);
    doc.setTextColor(0); y += 26;
  }

  const name = BANK.pdfPrefix + stamp.toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.pdf';
  download(doc.output('blob'), name);
  return name;
}

function toDataUrl(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve({ url: c.toDataURL('image/jpeg', 0.8), w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = reject;
    img.src = chrome.runtime.getURL(path);
  });
}

/* ---------------- quiz flow ---------------- */
async function start() {
  let bank;
  try {
    bank = await (await fetch(chrome.runtime.getURL(BANK.file))).json();
  } catch (e) {
    el('question').setAttribute('hidden', '');
    el('failure').removeAttribute('hidden');
    el('failureBody').textContent = BANK.file + ' could not be read, so the quiz cannot run.';
    return;
  }

  const picked = shuffle(bank).slice(0, Math.min(QUIZ_LENGTH, bank.length)).map((item) => {
    if (BANK.typed) {
      return { img: item.img, q: item.q, src: item.src, typed: true, answer: String(item.answer) };
    }
    if (item.img) {
      return {
        img: item.img, src: item.src,
        order: item.letters.map((letter, i) => ({ text: letter, correct: i === item.answer }))
      };
    }
    return {
      q: item.q, src: item.src,
      order: shuffle(item.options.map((text, i) => ({ text, correct: i === item.answer })))
    };
  });

  quiz = { items: picked, index: 0, correct: 0, answers: [], startedAt: Date.now() };
  el('bankTag').textContent = BANK.label;
  el('bankTag').className = 'tag' + (BANK.typed ? ' ioqm' : '');
  document.title = (BANK.typed ? 'IOQM' : 'ESAT') + ' emergency quiz — WhatsApp Web Time Guard';
  el('verdict').setAttribute('hidden', '');
  el('question').removeAttribute('hidden');
  el('qTotal').textContent = String(picked.length);

  clearInterval(tick);
  tick = setInterval(() => { el('clock').textContent = clockText(Date.now() - quiz.startedAt); }, 100);

  show();
}

function show() {
  const item = quiz.items[quiz.index];
  locked = false;

  el('qNow').textContent = String(quiz.index + 1);
  el('score').textContent = String(quiz.correct);
  el('meterFill').style.width = (quiz.index / quiz.items.length * 100) + '%';
  el('qSrc').textContent = item.src || '';

  const fig = el('figure');
  if (item.img) {
    el('qImage').src = item.img;
    fig.removeAttribute('hidden');
  } else {
    fig.setAttribute('hidden', '');
    el('qImage').removeAttribute('src');
  }
  el('qText').textContent = item.q || '';

  const box = el('choices');
  const entry = el('entry');

  if (item.typed) {
    box.innerHTML = '';
    box.setAttribute('hidden', '');
    entry.removeAttribute('hidden');
    el('answerBox').value = '';
    el('answerBox').focus();
    el('hint').textContent = 'Type the integer answer and press Enter';
  } else {
    entry.setAttribute('hidden', '');
    box.removeAttribute('hidden');
    el('hint').textContent = 'Press A–H or click';
    box.className = 'choices' + (item.img ? '' : ' text-mode');
    box.innerHTML = '';
    item.order.forEach((opt) => {
      const b = document.createElement('button');
      b.textContent = opt.text;
      b.dataset.letter = item.img ? opt.text : '';
      b.addEventListener('click', () => answer(opt));
      box.appendChild(b);
    });
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function answer(opt) {
  if (locked) return;
  locked = true;
  quiz.answers[quiz.index] = opt;
  if (opt.correct) quiz.correct += 1;
  quiz.index += 1;
  if (quiz.index < quiz.items.length) show();
  else finish();
}

async function finish() {
  clearInterval(tick);
  quiz.ms = Date.now() - quiz.startedAt;
  quiz.finishedAt = Date.now();
  el('clock').textContent = clockText(quiz.ms);

  const passed = quiz.correct >= PASS_MARK;
  el('meterFill').style.width = '100%';
  el('score').textContent = String(quiz.correct);
  el('qNow').textContent = String(quiz.items.length);

  el('question').setAttribute('hidden', '');
  const v = el('verdict');
  v.className = passed ? 'pass' : 'fail';
  v.removeAttribute('hidden');

  if (passed) {
    el('verdictTitle').textContent = 'Guard off';
    el('verdictBody').textContent =
      quiz.correct + ' of ' + quiz.items.length + ' in ' + clockText(quiz.ms) +
      '. WhatsApp is unrestricted for now — switching the guard back on resumes the blackout.';
    el('again').setAttribute('hidden', '');
    await ask({ type: 'GRANT_BYPASS' });
  } else {
    el('verdictTitle').textContent = 'Not enough correct';
    el('verdictBody').textContent =
      quiz.correct + ' of ' + quiz.items.length + ' in ' + clockText(quiz.ms) + ', and you need ' +
      PASS_MARK + '. The guard stays on.';
    el('again').removeAttribute('hidden');
  }

  // log the attempt, refresh the records, then write both files
  const entries = await readLog();
  entries.push({ at: quiz.finishedAt, total: quiz.items.length, correct: quiz.correct, ms: quiz.ms });
  await writeLog(entries);
  await paintRecords();

  el('files').textContent = 'Saving the review sheet…';
  try {
    const name = await exportPdf();
    download(new Blob([toCsv(entries)], { type: 'text/csv' }), BANK.csv);
    el('files').textContent = 'Saved ' + name + ' and ' + BANK.csv + ' to your downloads.';
  } catch (e) {
    el('files').textContent = 'The review sheet could not be written: ' + e.message;
  }
}

/* ---------------- controls ---------------- */
document.addEventListener('keydown', (e) => {
  if (locked || !quiz || el('question').hasAttribute('hidden')) return;
  if (quiz.items[quiz.index] && quiz.items[quiz.index].typed) return;
  const key = e.key.toUpperCase();
  if (!/^[A-H]$/.test(key)) return;
  const buttons = Array.from(el('choices').children);
  const item = quiz.items[quiz.index];
  const idx = item.img
    ? buttons.findIndex((b) => b.dataset.letter === key)
    : key.charCodeAt(0) - 65;
  if (idx >= 0 && idx < buttons.length) buttons[idx].click();
});

el('entry').addEventListener('submit', (e) => {
  e.preventDefault();
  if (locked || !quiz) return;
  const item = quiz.items[quiz.index];
  if (!item || !item.typed) return;
  const raw = el('answerBox').value.trim();
  if (raw === '') return;
  const right = Number(raw) === Number(item.answer);
  answer({ text: raw, correct: right, expected: item.answer });
});

el('again').addEventListener('click', start);
el('done').addEventListener('click', () => window.close());
el('csv').addEventListener('click', async () => {
  download(new Blob([toCsv(await readLog())], { type: 'text/csv' }), BANK.csv);
});

paintRecords();
start();
