// Runs Pip's chess engine on a separate thread for the main process, so the app (and the Stop button) never freezes while he thinks.
const { parentPort } = require('worker_threads');
const chess = require('./chess.js');
parentPort.on('message', ({ id, st, opts }) => {
  try { parentPort.postMessage({ id, r: chess.bestMoveState(st, opts) }); } catch (e) { parentPort.postMessage({ id, error: String((e && e.message) || e) }); }
});
