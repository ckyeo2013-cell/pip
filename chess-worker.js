// Runs Pip's chess engine off the main thread, so his animation never freezes while he thinks about a move.
importScripts('chess.js');
onmessage = (e) => {
  const { id, st, opts } = e.data;
  try { postMessage({ id, r: self.PipChess.bestMoveState(st, opts) }); } catch (err) { postMessage({ id, error: String(err && err.message || err) }); }
};
