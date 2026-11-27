'use strict';
/*
 * Runs the chess engine on its own thread, so thinking for a few seconds never freezes the app or the Stop button.
 * Split out of actions.js; behaviour is unchanged.
 */
// the engine runs on its own thread: thinking for a few seconds must not freeze the app or the Stop button
let _cw = null, _cid = 0;
const _cpend = new Map();
function thinkAsync(st, opts) {
  return new Promise((resolve, reject) => {
    let w = _cw;
    if (!w) {
      try {
        const { Worker } = require('worker_threads');
        w = _cw = new Worker(require('path').join(__dirname, 'chess-thread.js'));
        w.on('message', (m) => { const p = _cpend.get(m.id); if (!p) return; _cpend.delete(m.id); if (m.error) p.reject(new Error(m.error)); else p.resolve(m.r); if (!_cpend.size && w.unref) w.unref(); });
        const dead = (e) => { if (_cw === w) _cw = null; for (const p of _cpend.values()) p.reject(e || new Error('engine thread stopped')); _cpend.clear(); };
        w.on('error', dead); w.on('exit', () => dead());
      } catch (e) { _cw = null; return reject(e); }
    }
    const id = ++_cid; _cpend.set(id, { resolve, reject });
    try { if (w.ref) w.ref(); w.postMessage({ id, st, opts }); } catch (e) { _cpend.delete(id); reject(e); }
  });
}

module.exports = { thinkAsync };
