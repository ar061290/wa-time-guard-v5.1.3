/* Shared <minutas> templating, used by the blackout overlay and the popup preview.
   Extension CSP forbids eval, so arithmetic goes through a small shunting-yard parser. */
(function (root) {
/* ---------------- <minutas> templating ----------------
   "<minutas>" is the minutes left in the blackout. It can sit inside a bracketed sum, so
   "do (<minutas>/2) pushups" counts down at half speed. Evaluated by a tiny shunting-yard
   parser rather than eval, which extension CSP forbids anyway. */

function evalArith(expr) {
  const tokens = expr.match(/\d+(?:\.\d+)?|[+\-*/%^()]/g);
  if (!tokens) return null;
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
  const out = [], ops = [];
  let prev = null;
  for (const t of tokens) {
    if (/^\d/.test(t)) { out.push(parseFloat(t)); }
    else if (t === '(') { ops.push(t); }
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop());
      if (!ops.length) return null;
      ops.pop();
    } else {
      // unary minus
      if (t === '-' && (prev === null || prev === '(' || prec[prev])) out.push(0);
      while (ops.length && prec[ops[ops.length - 1]] >= prec[t] && t !== '^') out.push(ops.pop());
      ops.push(t);
    }
    prev = t;
  }
  while (ops.length) {
    const op = ops.pop();
    if (op === '(') return null;
    out.push(op);
  }
  const st = [];
  for (const t of out) {
    if (typeof t === 'number') { st.push(t); continue; }
    const b = st.pop(), a = st.pop();
    if (a === undefined || b === undefined) return null;
    st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b
          : t === '/' ? a / b : t === '%' ? a % b : Math.pow(a, b));
  }
  const v = st.pop();
  return st.length || !isFinite(v) ? null : v;
}

function tidy(n) {
  const r = Math.round(n * 10) / 10;
  return String(Number.isInteger(r) ? r : r.toFixed(1));
}

function renderTemplate(text, minutes) {
  if (!text || !/<\s*minutas\s*>/i.test(text)) return text;   // leave ordinary brackets alone
  let out = text.replace(/<\s*minutas\s*>/gi, String(minutes));
  // collapse bracketed sums from the inside out
  for (let pass = 0; pass < 6; pass++) {
    const next = out.replace(/\(([\d.+\-*/%^\s]+)\)/g, (whole, inner) => {
      if (!/\d/.test(inner)) return whole;
      const v = evalArith(inner);
      return v == null ? whole : tidy(v);
    });
    if (next === out) break;
    out = next;
  }
  return out;
}


  root.TimeGuardTemplate = { render: renderTemplate, evaluate: evalArith };
})(typeof window !== 'undefined' ? window : globalThis);
