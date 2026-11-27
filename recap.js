'use strict';
/*
 * Daily recap: a small per-day tally of what Pip did (titles only, last 14 days, kept on this computer).
 * Split out of main.js; behaviour is unchanged. createRecap(fileFn) -> { note, text, today, dayKey }
 */
const fs = require('fs');

const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function createRecap(fileFn) {
  let R = null;
  const load = () => { if (!R) { try { R = JSON.parse(fs.readFileSync(fileFn(), 'utf8')); } catch (_) { R = {}; } } return R; };
  function note(title) {
    try {
      const all = load(), day = all[dayKey()] || (all[dayKey()] = { n: 0, t: {} });
      day.n++; day.t[title] = (day.t[title] || 0) + 1;
      const keys = Object.keys(all).sort(); while (keys.length > 14) delete all[keys.shift()];
      fs.writeFileSync(fileFn(), JSON.stringify(all));
    } catch (_) { /* a recap is nice to have, never worth an error */ }
  }
  function text() {
    const all = load(), day = all[dayKey()], yk = dayKey(Date.now() - 86400000);
    if (!day || !day.n) return 'Nothing yet today. I have not done anything for you, so ask me for something!';
    const top = Object.entries(day.t).sort((p, q) => q[1] - p[1]).slice(0, 8).map(([t, n]) => `• ${n > 1 ? n + ' x ' : ''}${t}`);
    return `Today I did ${day.n} thing${day.n === 1 ? '' : 's'} for you:\n${top.join('\n')}${all[yk] ? `\nYesterday it was ${all[yk].n}.` : ''}`;
  }
  return { note, text, today: () => (R && R[dayKey()]) || null, dayKey };
}

module.exports = { createRecap, dayKey };
