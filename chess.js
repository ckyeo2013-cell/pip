'use strict';
// A small offline chess engine for Pip: reads a FEN, finds a good legal move (alpha-beta search with a time limit).
// No dependencies. Not Stockfish, but it never plays an illegal move and it does not hang pieces.

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};
// board index = rank-from-top * 8 + file; rank 8 is row 0. Pieces are 'P' (white) / 'p' (black), etc.
const isWhite = (c) => c === c.toUpperCase();
const sqName = (i) => 'abcdefgh'[i & 7] + (8 - (i >> 3));
const sqIndex = (s) => (8 - Number(s[1])) * 8 + 'abcdefgh'.indexOf(s[0]);
const KN = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KG = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const DIAG = [[-1,-1],[-1,1],[1,-1],[1,1]], ORTH = [[-1,0],[1,0],[0,-1],[0,1]];

function parseFen(fen) {
  const [pos, side = 'w', cas = '-', ep = '-'] = String(fen || '').trim().split(/\s+/);
  const rows = (pos || '').split('/');
  if (rows.length !== 8) throw new Error('The board needs 8 ranks separated by "/".');
  const board = new Array(64).fill(null);
  let wk = 0, bk = 0;
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) f += Number(ch);
      else if (/[pnbrqkPNBRQK]/.test(ch)) {
        if (f > 7) throw new Error(`Rank ${8 - r} has more than 8 squares.`);
        if (/[pP]/.test(ch) && (r === 0 || r === 7)) throw new Error('A pawn cannot be on the first or last rank.');
        board[r * 8 + f++] = ch;
        if (ch === 'K') wk++; if (ch === 'k') bk++;
      } else throw new Error(`"${ch}" is not a piece letter.`);
    }
    if (f !== 8) throw new Error(`Rank ${8 - r} does not add up to 8 squares.`);
  });
  if (wk !== 1 || bk !== 1) throw new Error('Each side needs exactly one king.');
  const st = { board, white: side !== 'b', K: cas.includes('K'), Q: cas.includes('Q'), k: cas.includes('k'), q: cas.includes('q'), ep: /^[a-h][36]$/.test(ep) ? sqIndex(ep) : -1 };
  // castling rights only make sense with king and rook at home
  if (board[60] !== 'K') st.K = st.Q = false; if (board[4] !== 'k') st.k = st.q = false;
  if (board[63] !== 'R') st.K = false; if (board[56] !== 'R') st.Q = false;
  if (board[7] !== 'r') st.k = false; if (board[0] !== 'r') st.q = false;
  return st;
}

function attacked(b, sq, byWhite) {
  const r = sq >> 3, f = sq & 7;
  const at = (rr, ff) => (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 ? b[rr * 8 + ff] : null);
  const pr = byWhite ? r + 1 : r - 1, pc = byWhite ? 'P' : 'p';
  if (at(pr, f - 1) === pc || at(pr, f + 1) === pc) return true;
  const n = byWhite ? 'N' : 'n', k = byWhite ? 'K' : 'k';
  for (const [dr, df] of KN) if (at(r + dr, f + df) === n) return true;
  for (const [dr, df] of KG) if (at(r + dr, f + df) === k) return true;
  for (const [dirs, a, c] of [[DIAG, byWhite ? 'B' : 'b', byWhite ? 'Q' : 'q'], [ORTH, byWhite ? 'R' : 'r', byWhite ? 'Q' : 'q']]) {
    for (const [dr, df] of dirs) {
      let rr = r + dr, ff = f + df;
      while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
        const p = b[rr * 8 + ff];
        if (p) { if (p === a || p === c) return true; break; }
        rr += dr; ff += df;
      }
    }
  }
  return false;
}

function pseudo(st, capturesOnly) {
  const { board: b, white } = st, out = [];
  const push = (from, to, extra) => out.push({ from, to, ...extra });
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || isWhite(p) !== white) continue;
    const t = p.toLowerCase(), r = i >> 3, f = i & 7;
    if (t === 'p') {
      const dir = white ? -1 : 1, start = white ? 6 : 1, last = white ? 0 : 7;
      const addP = (to, cap) => {
        if ((to >> 3) === last) for (const pr of ['q', 'r', 'b', 'n']) push(i, to, { promo: pr, cap });
        else push(i, to, { cap });
      };
      const one = i + dir * 8;
      if (!b[one] && (!capturesOnly || (one >> 3) === last)) {
        addP(one, false);
        if (r === start && !b[one + dir * 8] && !capturesOnly) push(i, one + dir * 8, { dbl: true });
      }
      for (const df of [-1, 1]) {
        const ff = f + df;
        if (ff < 0 || ff > 7) continue;
        const to = one + df;
        if (b[to] && isWhite(b[to]) !== white) addP(to, true);
        else if (to === st.ep) push(i, to, { ep: true, cap: true });
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, df] of t === 'n' ? KN : KG) {
        const rr = r + dr, ff = f + df;
        if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue;
        const to = rr * 8 + ff, q = b[to];
        if (!q) { if (!capturesOnly) push(i, to, {}); } else if (isWhite(q) !== white) push(i, to, { cap: true });
      }
      if (t === 'k' && !capturesOnly) {
        const home = white ? 60 : 4;
        if (i === home && !attacked(b, home, !white)) {
          if ((white ? st.K : st.k) && !b[home + 1] && !b[home + 2] && !attacked(b, home + 1, !white) && !attacked(b, home + 2, !white)) push(i, home + 2, { castle: 'k' });
          if ((white ? st.Q : st.q) && !b[home - 1] && !b[home - 2] && !b[home - 3] && !attacked(b, home - 1, !white) && !attacked(b, home - 2, !white)) push(i, home - 2, { castle: 'q' });
        }
      }
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : DIAG.concat(ORTH);
      for (const [dr, df] of dirs) {
        let rr = r + dr, ff = f + df;
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
          const to = rr * 8 + ff, q = b[to];
          if (!q) { if (!capturesOnly) push(i, to, {}); } else { if (isWhite(q) !== white) push(i, to, { cap: true }); break; }
          rr += dr; ff += df;
        }
      }
    }
  }
  return out;
}

function apply(st, m) {
  const b = st.board.slice(), p = b[m.from];
  b[m.to] = m.promo ? (isWhite(p) ? m.promo.toUpperCase() : m.promo) : p;
  b[m.from] = null;
  if (m.ep) b[m.to + (isWhite(p) ? 8 : -8)] = null;
  if (m.castle === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
  if (m.castle === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
  const n = { board: b, white: !st.white, K: st.K, Q: st.Q, k: st.k, q: st.q, ep: m.dbl ? (m.from + m.to) / 2 : -1 };
  if (p === 'K') n.K = n.Q = false; if (p === 'k') n.k = n.q = false;
  for (const s of [m.from, m.to]) { if (s === 63) n.K = false; if (s === 56) n.Q = false; if (s === 7) n.k = false; if (s === 0) n.q = false; }
  return n;
}
const kingSq = (b, white) => b.indexOf(white ? 'K' : 'k');
const inCheck = (st) => attacked(st.board, kingSq(st.board, st.white), !st.white);
function legal(st) {
  const out = [];
  for (const m of pseudo(st)) { const n = apply(st, m); if (!attacked(n.board, kingSq(n.board, st.white), !st.white)) out.push(m); }
  return out;
}

function evaluate(st) { // from the point of view of the side to move
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = st.board[i];
    if (!p) continue;
    const t = p.toLowerCase(), w = isWhite(p);
    const v = VAL[t] + PST[t][w ? i : (7 - (i >> 3)) * 8 + (i & 7)];
    s += w ? v : -v;
  }
  return st.white ? s : -s;
}

const MATE = 100000;
function search(st, opts) {
  let nodes = 0, stop = false;
  const deadline = Date.now() + opts.ms;
  const order = (ms, b) => ms.map((m) => ({ m, k: (m.cap ? 10 * (VAL[(b[m.to] || 'p').toLowerCase()] || 100) - VAL[b[m.from].toLowerCase()] / 10 : 0) + (m.promo === 'q' ? 800 : 0) }))
    .sort((a, c) => c.k - a.k).map((x) => x.m);
  const q = (s, alpha, beta) => {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) stop = true;
    const stand = evaluate(s);
    if (stop || stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of order(pseudo(s, true), s.board)) {
      const n = apply(s, m);
      if (attacked(n.board, kingSq(n.board, s.white), !s.white)) continue;
      const v = -q(n, -beta, -alpha);
      if (stop) return alpha;
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  };
  const ab = (s, depth, alpha, beta, ply) => {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) stop = true;
    if (stop) return 0;
    if (depth <= 0) return q(s, alpha, beta);
    const ms = legal(s);
    if (!ms.length) return inCheck(s) ? -MATE + ply : 0;
    for (const m of order(ms, s.board)) {
      const v = -ab(apply(s, m), depth - 1, -beta, -alpha, ply + 1);
      if (stop) return 0;
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  };
  const root = order(legal(st), st.board);
  if (!root.length) return { none: true, check: inCheck(st) };
  let best = root[0], bestScore = -Infinity, depthDone = 0;
  for (let d = 1; d <= opts.maxDepth; d++) {
    let alpha = -Infinity, cur = null, curScore = -Infinity;
    for (const m of root) {
      const v = -ab(apply(st, m), d - 1, -Infinity, -alpha, 1);
      if (stop) break;
      if (v > curScore) { curScore = v; cur = m; }
      if (v > alpha) alpha = v;
    }
    if (stop) break; // an unfinished depth is thrown away
    best = cur; bestScore = curScore; depthDone = d;
    root.splice(root.indexOf(cur), 1); root.unshift(cur); // try the best move first next time
    if (Math.abs(curScore) > MATE - 100) break; // found a forced mate
  }
  return { move: best, score: bestScore, depth: depthDone };
}

function bestMove(fen, { ms = 1500, maxDepth = 8 } = {}) {
  const st = parseFen(fen);
  // the side that is NOT to move must not be in check (a misread board)
  if (attacked(st.board, kingSq(st.board, !st.white), st.white)) throw new Error('That position is not legal: the side that just moved is still in check. The board was probably misread.');
  const r = search(st, { ms: Math.max(100, Math.min(10000, ms)), maxDepth });
  if (r.none) return { over: true, status: r.check ? 'checkmate' : 'stalemate', side: st.white ? 'white' : 'black' };
  const m = r.move;
  const uci = sqName(m.from) + sqName(m.to) + (m.promo || '');
  const mate = Math.abs(r.score) > MATE - 100;
  return { uci, from: sqName(m.from), to: sqName(m.to), promo: m.promo || null, piece: st.board[m.from].toLowerCase(), capture: !!m.cap, castle: m.castle || null, enPassant: !!m.ep,
    depth: r.depth, evalPawns: mate ? null : Math.round(r.score) / 100, mateIn: mate ? Math.ceil((MATE - Math.abs(r.score)) / 2) * (r.score > 0 ? 1 : -1) : null };
}

function perft(fen, depth) {
  const go = (s, d) => { if (d === 0) return 1; let n = 0; for (const m of legal(s)) n += go(apply(s, m), d - 1); return n; };
  return go(parseFen(fen), depth);
}

module.exports = { bestMove, perft, parseFen };
