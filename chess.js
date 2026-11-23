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

let queenOnly = false; // Pip's own moves only ever promote to a queen (that is the piece the click lands on)
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
        if ((to >> 3) === last) for (const pr of (queenOnly ? ['q'] : ['q', 'r', 'b', 'n'])) push(i, to, { promo: pr, cap });
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


// =====================================================================================================
// The search engine: bitless mailbox board with make/unmake, Zobrist hashing, transposition table,
// iterative deepening with aspiration windows, principal variation search, null-move pruning, late move
// reductions, futility pruning, killer and history ordering, quiescence search, repetition handling and a
// tapered evaluation (material, piece-square, mobility, pawn structure, passed pawns, rooks, king safety).
// =====================================================================================================
const MATE = 100000, INF = 1000000, MAXD = 128;
const CH2PC = { P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6, p: 9, n: 10, b: 11, r: 12, q: 13, k: 14 };
const PC2CH = [null, 'P', 'N', 'B', 'R', 'Q', 'K', null, null, 'p', 'n', 'b', 'r', 'q', 'k'];
const MGV = [0, 82, 337, 365, 477, 1025, 0], EGV = [0, 94, 281, 297, 512, 936, 0];
const SEEV = [0, 100, 320, 330, 500, 900, 20000];
const KING_EG = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];
const PSTMG = [null], PSTEG = [null];
['p', 'n', 'b', 'r', 'q', 'k'].forEach((t, i) => { PSTMG[i + 1] = PST[t]; PSTEG[i + 1] = t === 'k' ? KING_EG : PST[t]; });
const MIRROR = new Int8Array(64);
for (let i = 0; i < 64; i++) MIRROR[i] = (7 - (i >> 3)) * 8 + (i & 7);

// ---- tables
const KNIGHT_T = [], KING_T = [], RAYS = [], PAWN_ATT = [[], []], PAWN_FROM = [[], []];
const DIRS8 = [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
for (let sq = 0; sq < 64; sq++) {
  const r = sq >> 3, f = sq & 7, on = (rr, ff) => rr >= 0 && rr < 8 && ff >= 0 && ff < 8;
  KNIGHT_T[sq] = KN.filter(([a, b]) => on(r + a, f + b)).map(([a, b]) => (r + a) * 8 + f + b);
  KING_T[sq] = KG.filter(([a, b]) => on(r + a, f + b)).map(([a, b]) => (r + a) * 8 + f + b);
  RAYS[sq] = DIRS8.map(([a, b]) => { const out = []; let rr = r + a, ff = f + b; while (on(rr, ff)) { out.push(rr * 8 + ff); rr += a; ff += b; } return out; });
  PAWN_ATT[0][sq] = [-1, 1].filter((d) => on(r - 1, f + d)).map((d) => (r - 1) * 8 + f + d);
  PAWN_ATT[1][sq] = [-1, 1].filter((d) => on(r + 1, f + d)).map((d) => (r + 1) * 8 + f + d);
  PAWN_FROM[0][sq] = [-1, 1].filter((d) => on(r + 1, f + d)).map((d) => (r + 1) * 8 + f + d); // squares a WHITE pawn attacks this square from
  PAWN_FROM[1][sq] = [-1, 1].filter((d) => on(r - 1, f + d)).map((d) => (r - 1) * 8 + f + d);
}
const CMASK = new Int8Array(64).fill(15);
CMASK[60] &= ~3; CMASK[63] &= ~1; CMASK[56] &= ~2; CMASK[4] &= ~12; CMASK[7] &= ~4; CMASK[0] &= ~8;

// ---- zobrist keys
let seed = 0x9e3779b9;
const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
const ZPL = new Int32Array(16 * 64), ZPH = new Int32Array(16 * 64), ZCL = new Int32Array(16), ZCH = new Int32Array(16), ZEL = new Int32Array(8), ZEH = new Int32Array(8);
for (let i = 0; i < 16 * 64; i++) { ZPL[i] = rnd32(); ZPH[i] = rnd32(); }
for (let i = 0; i < 16; i++) { ZCL[i] = rnd32(); ZCH[i] = rnd32(); }
for (let i = 0; i < 8; i++) { ZEL[i] = rnd32(); ZEH[i] = rnd32(); }
const ZSL = rnd32(), ZSH = rnd32();

// ---- position
const bd = new Int8Array(64);
const ksq = [0, 0];
let side = 0, castle = 0, ep = -1, hLo = 0, hHi = 0, hm = 0, sp = 0, qOnly = false;
const uMove = new Int32Array(MAXD + 8), uCap = new Int8Array(MAXD + 8), uCastle = new Int8Array(MAXD + 8), uEp = new Int8Array(MAXD + 8), uLo = new Int32Array(MAXD + 8), uHi = new Int32Array(MAXD + 8), uHm = new Int16Array(MAXD + 8);
const HL = new Int32Array(2048), HH = new Int32Array(2048); // hashes of the positions in the game so far, then the search path
let G = 0; // index of the root position in HL / HH

function computeHash() {
  let lo = 0, hi = 0;
  for (let i = 0; i < 64; i++) if (bd[i]) { lo ^= ZPL[bd[i] * 64 + i]; hi ^= ZPH[bd[i] * 64 + i]; }
  lo ^= ZCL[castle]; hi ^= ZCH[castle];
  if (ep >= 0) { lo ^= ZEL[ep & 7]; hi ^= ZEH[ep & 7]; }
  if (side) { lo ^= ZSL; hi ^= ZSH; }
  hLo = lo; hHi = hi;
}
function setPosition(st) {
  for (let i = 0; i < 64; i++) bd[i] = st.board[i] ? CH2PC[st.board[i]] : 0;
  side = st.white ? 0 : 1;
  castle = (st.K ? 1 : 0) | (st.Q ? 2 : 0) | (st.k ? 4 : 0) | (st.q ? 8 : 0);
  ep = st.ep >= 0 ? st.ep : -1;
  ksq[0] = bd.indexOf(6); ksq[1] = bd.indexOf(14);
  sp = 0; hm = 0;
  computeHash();
}
function hashOf(st) { setPosition(st); return [hLo, hHi]; }

function attackedBy(sq, by) {
  const bb = by << 3;
  let a = PAWN_FROM[by][sq];
  for (let i = 0; i < a.length; i++) if (bd[a[i]] === (1 | bb)) return true;
  a = KNIGHT_T[sq];
  for (let i = 0; i < a.length; i++) if (bd[a[i]] === (2 | bb)) return true;
  a = KING_T[sq];
  for (let i = 0; i < a.length; i++) if (bd[a[i]] === (6 | bb)) return true;
  const rs = RAYS[sq], B = 3 | bb, R = 4 | bb, Q = 5 | bb;
  for (let d = 0; d < 4; d++) { const ray = rs[d]; for (let i = 0; i < ray.length; i++) { const p = bd[ray[i]]; if (p) { if (p === B || p === Q) return true; break; } } }
  for (let d = 4; d < 8; d++) { const ray = rs[d]; for (let i = 0; i < ray.length; i++) { const p = bd[ray[i]]; if (p) { if (p === R || p === Q) return true; break; } } }
  return false;
}
const inCheckNow = () => attackedBy(ksq[side], side ^ 1);

// ---- make / unmake (a move is: from | to << 6 | promoType << 12 | flags << 16; flags 1 capture, 2 en passant, 4 castle, 8 double push)
function make(m) {
  const from = m & 63, to = (m >> 6) & 63, pr = (m >> 12) & 15, fl = m >> 16;
  const pc = bd[from];
  let cap = bd[to];
  uMove[sp] = m; uCastle[sp] = castle; uEp[sp] = ep; uLo[sp] = hLo; uHi[sp] = hHi; uHm[sp] = hm;
  if (ep >= 0) { hLo ^= ZEL[ep & 7]; hHi ^= ZEH[ep & 7]; }
  hLo ^= ZCL[castle]; hHi ^= ZCH[castle];
  hm++;
  if (fl & 2) {
    const cs = to + (side === 0 ? 8 : -8);
    cap = bd[cs]; bd[cs] = 0;
    hLo ^= ZPL[cap * 64 + cs]; hHi ^= ZPH[cap * 64 + cs];
  } else if (cap) { hLo ^= ZPL[cap * 64 + to]; hHi ^= ZPH[cap * 64 + to]; }
  uCap[sp] = cap;
  if (cap || (pc & 7) === 1) hm = 0;
  hLo ^= ZPL[pc * 64 + from]; hHi ^= ZPH[pc * 64 + from];
  bd[from] = 0;
  const np = pr ? (pr | (side << 3)) : pc;
  bd[to] = np;
  hLo ^= ZPL[np * 64 + to]; hHi ^= ZPH[np * 64 + to];
  if (fl & 4) {
    const rf = to > from ? to + 1 : to - 2, rt = to > from ? to - 1 : to + 1, rk = bd[rf];
    bd[rf] = 0; bd[rt] = rk;
    hLo ^= ZPL[rk * 64 + rf] ^ ZPL[rk * 64 + rt]; hHi ^= ZPH[rk * 64 + rf] ^ ZPH[rk * 64 + rt];
  }
  if ((pc & 7) === 6) ksq[side] = to;
  castle &= CMASK[from] & CMASK[to];
  ep = (fl & 8) ? (from + to) >> 1 : -1;
  if (ep >= 0) { hLo ^= ZEL[ep & 7]; hHi ^= ZEH[ep & 7]; }
  hLo ^= ZCL[castle] ^ ZSL; hHi ^= ZCH[castle] ^ ZSH;
  side ^= 1; sp++;
  HL[G + sp] = hLo; HH[G + sp] = hHi;
}
function unmake() {
  sp--;
  const m = uMove[sp], from = m & 63, to = (m >> 6) & 63, pr = (m >> 12) & 15, fl = m >> 16;
  side ^= 1;
  castle = uCastle[sp]; ep = uEp[sp]; hLo = uLo[sp]; hHi = uHi[sp]; hm = uHm[sp];
  let pc = bd[to];
  if (pr) pc = 1 | (side << 3);
  bd[from] = pc;
  if (fl & 2) { bd[to] = 0; bd[to + (side === 0 ? 8 : -8)] = uCap[sp]; } else bd[to] = uCap[sp];
  if (fl & 4) {
    const rf = to > from ? to + 1 : to - 2, rt = to > from ? to - 1 : to + 1;
    bd[rf] = bd[rt]; bd[rt] = 0;
  }
  if ((pc & 7) === 6) ksq[side] = from;
}
function makeNull() {
  uMove[sp] = 0; uEp[sp] = ep; uLo[sp] = hLo; uHi[sp] = hHi; uHm[sp] = hm; uCastle[sp] = castle;
  if (ep >= 0) { hLo ^= ZEL[ep & 7]; hHi ^= ZEH[ep & 7]; }
  ep = -1; hLo ^= ZSL; hHi ^= ZSH; hm++;
  side ^= 1; sp++;
  HL[G + sp] = hLo; HH[G + sp] = hHi;
}
function unmakeNull() { sp--; side ^= 1; ep = uEp[sp]; hLo = uLo[sp]; hHi = uHi[sp]; hm = uHm[sp]; }

// ---- move generation (pseudo-legal; the caller makes the move and rejects it if the king is left in check)
const MB = [], SB = [];
for (let i = 0; i < MAXD + 4; i++) { MB.push(new Int32Array(256)); SB.push(new Int32Array(256)); }
function gen(ply, caps) {
  const mv = MB[ply], us = side, them = us ^ 1;
  let n = 0;
  const addPromo = (from, to, fl) => {
    mv[n++] = from | (to << 6) | (5 << 12) | (fl << 16);
    if (!qOnly && !caps) { mv[n++] = from | (to << 6) | (4 << 12) | (fl << 16); mv[n++] = from | (to << 6) | (3 << 12) | (fl << 16); mv[n++] = from | (to << 6) | (2 << 12) | (fl << 16); }
  };
  for (let sq = 0; sq < 64; sq++) {
    const pc = bd[sq];
    if (!pc || (pc >> 3) !== us) continue;
    const t = pc & 7;
    if (t === 1) {
      const dir = us === 0 ? -8 : 8, r = sq >> 3, promoRow = us === 0 ? 1 : 6, startRow = us === 0 ? 6 : 1, one = sq + dir;
      if (!bd[one]) {
        if (r === promoRow) addPromo(sq, one, 0);
        else if (!caps) { mv[n++] = sq | (one << 6); if (r === startRow && !bd[one + dir]) mv[n++] = sq | ((one + dir) << 6) | (8 << 16); }
      }
      const pa = PAWN_ATT[us][sq];
      for (let i = 0; i < pa.length; i++) {
        const to = pa[i], q = bd[to];
        if (q && (q >> 3) === them) { if (r === promoRow) addPromo(sq, to, 1); else mv[n++] = sq | (to << 6) | (1 << 16); }
        else if (!q && to === ep) mv[n++] = sq | (to << 6) | (3 << 16);
      }
    } else if (t === 2 || t === 6) {
      const tg = t === 2 ? KNIGHT_T[sq] : KING_T[sq];
      for (let i = 0; i < tg.length; i++) {
        const to = tg[i], q = bd[to];
        if (!q) { if (!caps) mv[n++] = sq | (to << 6); } else if ((q >> 3) === them) mv[n++] = sq | (to << 6) | (1 << 16);
      }
      if (t === 6 && !caps) {
        if (us === 0 && sq === 60) {
          if ((castle & 1) && !bd[61] && !bd[62] && bd[63] === 4 && !attackedBy(60, 1) && !attackedBy(61, 1) && !attackedBy(62, 1)) mv[n++] = 60 | (62 << 6) | (4 << 16);
          if ((castle & 2) && !bd[59] && !bd[58] && !bd[57] && bd[56] === 4 && !attackedBy(60, 1) && !attackedBy(59, 1) && !attackedBy(58, 1)) mv[n++] = 60 | (58 << 6) | (4 << 16);
        } else if (us === 1 && sq === 4) {
          if ((castle & 4) && !bd[5] && !bd[6] && bd[7] === 12 && !attackedBy(4, 0) && !attackedBy(5, 0) && !attackedBy(6, 0)) mv[n++] = 4 | (6 << 6) | (4 << 16);
          if ((castle & 8) && !bd[3] && !bd[2] && !bd[1] && bd[0] === 12 && !attackedBy(4, 0) && !attackedBy(3, 0) && !attackedBy(2, 0)) mv[n++] = 4 | (2 << 6) | (4 << 16);
        }
      }
    } else {
      const d0 = t === 4 ? 4 : 0, d1 = t === 3 ? 4 : 8, rs = RAYS[sq];
      for (let d = d0; d < d1; d++) {
        const ray = rs[d];
        for (let i = 0; i < ray.length; i++) {
          const to = ray[i], q = bd[to];
          if (!q) { if (!caps) mv[n++] = sq | (to << 6); }
          else { if ((q >> 3) === them) mv[n++] = sq | (to << 6) | (1 << 16); break; }
        }
      }
    }
  }
  return n;
}

// ---- evaluation (white's point of view inside, returned from the side to move's point of view)
const wMin = new Int8Array(10), wMax = new Int8Array(10), bMin = new Int8Array(10), bMax = new Int8Array(10), wc = new Int8Array(10), bcn = new Int8Array(10);
const PASS_MG = [0, 5, 10, 22, 42, 75], PASS_EG = [0, 12, 24, 48, 90, 150];
const pieceSq = new Int8Array(40), pieceCol = new Int8Array(40), pieceTyp = new Int8Array(40), pawnSq = new Int8Array(20), pawnCol = new Int8Array(20);
function evaluate() {
  let mg = 0, eg = 0, phase = 0, np = 0, nPawns = 0;
  const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // pieces by code
  for (let f = 0; f < 10; f++) { wMin[f] = 9; wMax[f] = -1; bMin[f] = 9; bMax[f] = -1; wc[f] = 0; bcn[f] = 0; }
  for (let sq = 0; sq < 64; sq++) {
    const p = bd[sq];
    if (!p) continue;
    const c = p >> 3, t = p & 7, idx = c === 0 ? sq : MIRROR[sq];
    cnt[p]++;
    const vm = MGV[t] + PSTMG[t][idx], ve = EGV[t] + PSTEG[t][idx];
    if (c === 0) { mg += vm; eg += ve; } else { mg -= vm; eg -= ve; }
    if (t === 1) {
      const f = (sq & 7) + 1, r = sq >> 3;
      pawnSq[nPawns] = sq; pawnCol[nPawns++] = c;
      if (c === 0) { wc[f]++; if (r < wMin[f]) wMin[f] = r; if (r > wMax[f]) wMax[f] = r; }
      else { bcn[f]++; if (r < bMin[f]) bMin[f] = r; if (r > bMax[f]) bMax[f] = r; }
    } else if (t !== 6) { pieceSq[np] = sq; pieceCol[np] = c; pieceTyp[np++] = t; phase += t === 5 ? 4 : t === 4 ? 2 : 1; }
  }
  // no pawns and hardly any pieces: a dead draw
  if (!nPawns && !cnt[4] && !cnt[5] && !cnt[12] && !cnt[13] && cnt[2] + cnt[3] + cnt[10] + cnt[11] <= 1) return 0;
  // pieces: mobility, rook files
  for (let i = 0; i < np; i++) {
    const sq = pieceSq[i], c = pieceCol[i], t = pieceTyp[i], f = (sq & 7) + 1, r = sq >> 3;
    let m = 0, e = 0;
    if (t === 2) {
      const tg = KNIGHT_T[sq]; let k = 0;
      for (let j = 0; j < tg.length; j++) { const q = bd[tg[j]]; if (!q || (q >> 3) !== c) k++; }
      m = e = (k - 4) * 4;
    } else {
      const rs = RAYS[sq], d0 = t === 4 ? 4 : 0, d1 = t === 3 ? 4 : 8; let k = 0;
      for (let d = d0; d < d1; d++) { const ray = rs[d]; for (let j = 0; j < ray.length; j++) { const q = bd[ray[j]]; if (!q) k++; else { if ((q >> 3) !== c) k++; break; } } }
      if (t === 3) { m = (k - 6) * 5; e = (k - 6) * 5; }
      else if (t === 4) {
        m = (k - 7) * 2; e = (k - 7) * 4;
        const own = c === 0 ? wc[f] : bcn[f], opp = c === 0 ? bcn[f] : wc[f];
        if (!own) { const b = opp ? 10 : 20; m += b; e += 8; }
        if ((c === 0 && r === 1) || (c === 1 && r === 6)) { m += 12; e += 18; }
      } else { m = (k - 13); e = (k - 13) * 2; }
    }
    if (c === 0) { mg += m; eg += e; } else { mg -= m; eg -= e; }
  }
  if (cnt[3] >= 2) { mg += 30; eg += 45; }
  if (cnt[11] >= 2) { mg -= 30; eg -= 45; }
  // pawns: doubled, isolated, passed
  for (let i = 0; i < nPawns; i++) {
    const sq = pawnSq[i], c = pawnCol[i], f = (sq & 7) + 1, r = sq >> 3;
    let m = 0, e = 0;
    if (c === 0) {
      if (r > wMin[f]) { m -= 8; e -= 16; }
      if (!wc[f - 1] && !wc[f + 1]) { m -= 12; e -= 18; }
      if (bMin[f - 1] >= r && bMin[f] >= r && bMin[f + 1] >= r) {
        const adv = 6 - r; let pm = PASS_MG[adv] || 0, pe = PASS_EG[adv] || 0;
        if (bd[sq - 8]) { pm >>= 1; pe >>= 1; }
        if ((sq & 7) > 0 && bd[sq + 7] === 1) { pm += 4; pe += 8; }
        if ((sq & 7) < 7 && bd[sq + 9] === 1) { pm += 4; pe += 8; }
        m += pm; e += pe;
      }
      mg += m; eg += e;
    } else {
      if (r < bMax[f]) { m -= 8; e -= 16; }
      if (!bcn[f - 1] && !bcn[f + 1]) { m -= 12; e -= 18; }
      if (wMax[f - 1] <= r && wMax[f] <= r && wMax[f + 1] <= r) {
        const adv = r - 1; let pm = PASS_MG[adv] || 0, pe = PASS_EG[adv] || 0;
        if (bd[sq + 8]) { pm >>= 1; pe >>= 1; }
        if ((sq & 7) > 0 && bd[sq - 9] === 9) { pm += 4; pe += 8; }
        if ((sq & 7) < 7 && bd[sq - 7] === 9) { pm += 4; pe += 8; }
        m += pm; e += pe;
      }
      mg -= m; eg -= e;
    }
  }
  // king safety: pawn shield and open files, only matters while queens are about
  for (let c = 0; c < 2; c++) {
    const k = ksq[c], kr = k >> 3, kf = k & 7;
    if ((c === 0 && kr < 6) || (c === 1 && kr > 1)) continue;
    let s = 0;
    for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) {
      const own = c === 0 ? wc[f + 1] : bcn[f + 1];
      const p1 = bd[(kr + (c === 0 ? -1 : 1)) * 8 + f] === (c === 0 ? 1 : 9), p2 = bd[(kr + (c === 0 ? -2 : 2)) * 8 + f] === (c === 0 ? 1 : 9);
      if (p1) s += 9; else if (p2) s += 4; else s -= 6;
      if (!own) s -= 12;
    }
    if (c === 0) mg += s; else mg -= s;
  }
  if (phase > 24) phase = 24;
  let score = Math.round((mg * phase + eg * (24 - phase)) / 24);
  // mop-up: with a big lead and no enemy pawns, drive the enemy king to the edge and bring our king close
  const matW = cnt[2] * 3 + cnt[3] * 3 + cnt[4] * 5 + cnt[5] * 9, matB = cnt[10] * 3 + cnt[11] * 3 + cnt[12] * 5 + cnt[13] * 9;
  const mop = (win, lose) => {
    const wk = ksq[win], lk = ksq[lose], lr = lk >> 3, lf = lk & 7;
    const cd = Math.max(3 - lr, lr - 4) + Math.max(3 - lf, lf - 4);
    return 10 * cd + 4 * (14 - Math.abs((wk >> 3) - lr) - Math.abs((wk & 7) - lf));
  };
  if (matW - matB >= 4 && !cnt[9]) score += mop(0, 1);
  else if (matB - matW >= 4 && !cnt[1]) score -= mop(1, 0);
  return (side === 0 ? score : -score) + 10;
}

// ---- search
const TT_BITS = 22, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const TTHi = new Int32Array(TT_SIZE), TTMove = new Int32Array(TT_SIZE), TTScore = new Int32Array(TT_SIZE), TTDepth = new Int8Array(TT_SIZE), TTFlag = new Int8Array(TT_SIZE);
const K1 = new Int32Array(MAXD + 4), K2 = new Int32Array(MAXD + 4), HIST = new Int32Array(2 * 64 * 64);
const LMR = [];
for (let d = 0; d < 64; d++) { LMR[d] = new Int8Array(64); for (let i = 1; i < 64; i++) LMR[d][i] = d > 0 ? Math.floor(0.75 + Math.log(d) * Math.log(i) / 2.2) : 0; }
let nodes = 0, deadline = 0, stopped = false, rootSide = 0, contempt = 0, rootMove = 0, rootMoveScore = 0, rootIsFresh = false;
const drawScore = () => (side === rootSide ? contempt : -contempt);
function isRepeat() {
  const lim = Math.max(0, G + sp - hm);
  for (let i = G + sp - 2; i >= lim; i -= 2) if (HL[i] === hLo && HH[i] === hHi) return true;
  return false;
}
function hasPieces(c) { const b = c << 3; for (let i = 0; i < 64; i++) { const p = bd[i]; if (p && (p >> 3) === c) { const t = p & 7; if (t > 1 && t < 6) return true; } } return false; }
function scoreMoves(ply, n, ttMove) {
  const mv = MB[ply], sc = SB[ply], us = side;
  for (let i = 0; i < n; i++) {
    const m = mv[i];
    if (m === ttMove) { sc[i] = 1e7; continue; }
    const from = m & 63, to = (m >> 6) & 63, fl = m >> 16, pr = (m >> 12) & 15;
    if (fl & 1) {
      const vic = (fl & 2) ? 1 : bd[to] & 7, att = bd[from] & 7;
      let s = 2e6 + vic * 16 - att;
      if (SEEV[vic] < SEEV[att] && attackedBy(to, us ^ 1)) s = 2e5 + vic * 16 - att;
      sc[i] = s + (pr === 5 ? 500 : 0);
    } else if (pr) sc[i] = 1.9e6 + pr;
    else if (m === K1[ply]) sc[i] = 9e5;
    else if (m === K2[ply]) sc[i] = 8e5;
    else sc[i] = HIST[(us * 64 + from) * 64 + to];
  }
}
function pick(ply, n, i) {
  const mv = MB[ply], sc = SB[ply];
  let b = i;
  for (let j = i + 1; j < n; j++) if (sc[j] > sc[b]) b = j;
  if (b !== i) { const m = mv[i], s = sc[i]; mv[i] = mv[b]; sc[i] = sc[b]; mv[b] = m; sc[b] = s; }
  return mv[i];
}
function qsearch(alpha, beta, ply) {
  if ((++nodes & 1023) === 0 && Date.now() > deadline) stopped = true;
  if (stopped) return 0;
  if (ply >= MAXD - 2) return evaluate();
  const chk = inCheckNow();
  let best = -INF;
  if (!chk) {
    best = evaluate();
    if (best >= beta) return best;
    if (best > alpha) alpha = best;
  }
  const n = gen(ply, !chk);
  scoreMoves(ply, n, 0);
  let legalN = 0;
  for (let i = 0; i < n; i++) {
    const m = pick(ply, n, i);
    if (!chk) {
      const fl = m >> 16, to = (m >> 6) & 63, pr = (m >> 12) & 15;
      const vic = (fl & 2) ? 1 : bd[to] & 7;
      if (!pr && best + SEEV[vic] + 200 < alpha) continue; // delta pruning
      if (!pr && SEEV[vic] < SEEV[bd[m & 63] & 7] && attackedBy(to, side ^ 1)) continue; // a losing capture
    }
    make(m);
    if (attackedBy(ksq[side ^ 1], side)) { unmake(); continue; }
    legalN++;
    const v = -qsearch(-beta, -alpha, ply + 1);
    unmake();
    if (stopped) return 0;
    if (v > best) { best = v; if (v > alpha) { alpha = v; if (v >= beta) return v; } }
  }
  if (chk && !legalN) return -MATE + ply;
  return best;
}
function negamax(depth, alpha, beta, ply, nullOk) {
  if ((++nodes & 1023) === 0 && Date.now() > deadline) stopped = true;
  if (stopped) return 0;
  const pv = beta - alpha > 1, root = ply === 0;
  if (!root) {
    if (hm >= 100 || isRepeat()) return drawScore();
    if (alpha < -MATE + ply) alpha = -MATE + ply;
    if (beta > MATE - ply - 1) beta = MATE - ply - 1;
    if (alpha >= beta) return alpha;
  }
  const chk = inCheckNow();
  if (chk && ply < MAXD - 8) depth++;
  if (depth <= 0) return qsearch(alpha, beta, ply);
  if (ply >= MAXD - 4) return evaluate();
  const idx = hLo & TT_MASK;
  let ttMove = 0;
  if (TTHi[idx] === hHi && TTFlag[idx]) {
    ttMove = TTMove[idx];
    if (!pv && !root && TTDepth[idx] >= depth) {
      let s = TTScore[idx];
      if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
      const f = TTFlag[idx];
      if (f === 1 || (f === 2 && s >= beta) || (f === 3 && s <= alpha)) return s;
    }
  }
  let ev = 0;
  if (!pv && !chk) {
    ev = evaluate();
    if (depth <= 5 && ev - 95 * depth >= beta && beta > -MATE + 200) return ev - 95 * depth; // reverse futility
    if (nullOk && depth >= 3 && ev >= beta && hasPieces(side)) {
      const R = 2 + (depth > 6 ? 1 : 0) + (ev - beta > 220 ? 1 : 0);
      makeNull();
      const v = -negamax(depth - 1 - R, -beta, -beta + 1, ply + 1, false);
      unmakeNull();
      if (stopped) return 0;
      if (v >= beta) return v > MATE - 200 ? beta : v;
    }
  }
  const futile = !pv && !chk && depth <= 3 && ev + 90 + 110 * depth <= alpha;
  const n = gen(ply, false);
  scoreMoves(ply, n, ttMove);
  let legalN = 0, best = -INF, bestMove = 0, flag = 3;
  const startAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const m = pick(ply, n, i);
    const fl = m >> 16, pr = (m >> 12) & 15, quiet = !(fl & 1) && !pr;
    if (quiet && !chk && best > -MATE + 200 && legalN > 0) {
      if (futile) continue;
      if (!pv && depth <= 4 && legalN > 3 + depth * depth) continue; // late move pruning
    }
    make(m);
    if (attackedBy(ksq[side ^ 1], side)) { unmake(); continue; }
    legalN++;
    const givesCheck = attackedBy(ksq[side], side ^ 1);
    let v;
    if (legalN === 1) v = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
    else {
      let r = 0;
      if (depth >= 3 && legalN > 3 && quiet && !chk && !givesCheck) {
        r = LMR[Math.min(63, depth)][Math.min(63, legalN)];
        if (pv) r--;
        if (m === K1[ply] || m === K2[ply]) r--;
        if (r < 0) r = 0;
        if (r > depth - 2) r = depth - 2;
      }
      v = -negamax(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
      if (v > alpha && r > 0) v = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
      if (v > alpha && v < beta && pv) v = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
    }
    unmake();
    if (stopped) return 0;
    if (v > best) {
      best = v; bestMove = m;
      if (root) { rootMove = m; rootMoveScore = v; rootIsFresh = true; }
      if (v > alpha) {
        alpha = v; flag = 1;
        if (v >= beta) {
          flag = 2;
          if (quiet) {
            if (K1[ply] !== m) { K2[ply] = K1[ply]; K1[ply] = m; }
            const hi = (side * 64 + (m & 63)) * 64 + ((m >> 6) & 63);
            HIST[hi] += depth * depth;
            if (HIST[hi] > 90000) for (let k = 0; k < HIST.length; k++) HIST[k] >>= 1;
          }
          break;
        }
      }
    }
  }
  if (!legalN) return chk ? -MATE + ply : drawScore();
  let s = best;
  if (s > MATE - 200) s += ply; else if (s < -MATE + 200) s -= ply;
  if (!stopped && (TTHi[idx] !== hHi || TTDepth[idx] <= depth)) {
    TTHi[idx] = hHi; TTMove[idx] = bestMove; TTScore[idx] = s; TTDepth[idx] = depth;
    TTFlag[idx] = flag === 1 && best <= startAlpha ? 3 : flag;
  }
  return best;
}
// flags in the table: 1 exact, 2 lower bound (beta cutoff), 3 upper bound (fail low)

function moveToObj(m) {
  const from = m & 63, to = (m >> 6) & 63, pr = (m >> 12) & 15, fl = m >> 16;
  const o = { from, to };
  if (pr) o.promo = 'qrbn'['5432'.indexOf(String(pr))];
  if (fl & 1) o.cap = true;
  if (fl & 2) o.ep = true;
  if (fl & 4) o.castle = to > from ? 'k' : 'q';
  if (fl & 8) o.dbl = true;
  return o;
}
function legalRoot() {
  const out = [], n = gen(0, false), save = MB[0].slice(0, n);
  for (let i = 0; i < n; i++) { make(save[i]); if (!attackedBy(ksq[side ^ 1], side)) out.push(save[i]); unmake(); }
  return out;
}
function runSearch(st, { ms, maxDepth, hist }) {
  setPosition(st);
  rootSide = side;
  // game history (for repetitions): hash every earlier position of this game, ending at the root
  const past = Array.isArray(hist) ? hist.slice(-200) : [];
  let rootIdx = 0;
  const sig = (s) => s.board.reduce((a, p) => a + (p ? (p === 'P' || p === 'p' ? p : 'x') : '.'), '');
  for (let i = 0; i < past.length - 1 || (i === 0 && past.length === 0); i++) {
    if (!past.length) break;
    const h = hashOf(past[i]); HL[rootIdx] = h[0]; HH[rootIdx++] = h[1];
  }
  G = rootIdx;
  setPosition(st);
  HL[G] = hLo; HH[G] = hHi;
  let hmRoot = 0;
  { const cnt = (s) => s.board.filter(Boolean).length, c0 = cnt(st), s0 = sig(st);
    for (let i = past.length - 2; i >= 0; i--) { if (cnt(past[i]) !== c0 || sig(past[i]) !== s0) break; hmRoot++; } hmRoot = Math.min(hmRoot, G); }
  hm = hmRoot;
  const roots = legalRoot();
  if (!roots.length) return { none: true, check: inCheckNow() };
  if (roots.length === 1) return { move: roots[0], score: 0, depth: 0, nodes: 0, forced: true };
  const staticEv = evaluate();
  contempt = staticEv > 120 ? -30 : staticEv < -200 ? 25 : 0;
  K1.fill(0); K2.fill(0);
  for (let i = 0; i < HIST.length; i++) HIST[i] >>= 2;
  nodes = 0; stopped = false;
  const t0 = Date.now();
  deadline = t0 + ms;
  let bestMove = roots[0], bestScore = 0, depthDone = 0;
  rootMove = roots[0];
  for (let d = 1; d <= maxDepth; d++) {
    let alpha = -INF, beta = INF, delta = 35;
    if (d >= 5) { alpha = bestScore - delta; beta = bestScore + delta; }
    let score;
    rootIsFresh = false;
    for (;;) {
      score = negamax(d, alpha, beta, 0, false);
      if (stopped) break;
      if (score <= alpha) { alpha = Math.max(-INF, alpha - delta * 3); delta *= 2; rootIsFresh = false; }
      else if (score >= beta) { beta = Math.min(INF, beta + delta * 3); delta *= 2; }
      else break;
      if (delta > 1000) { alpha = -INF; beta = INF; }
    }
    if (stopped) { if (rootIsFresh && rootMoveScore > alpha) { bestMove = rootMove; bestScore = rootMoveScore; } break; } // trust a move that already beat the previous best
    bestMove = rootMove; bestScore = score; depthDone = d;
    if (Math.abs(score) > MATE - 100 && d >= 3) break;
    if (Date.now() - t0 > ms * 0.55) break; // the next depth would not finish
  }
  return { move: bestMove, score: bestScore, depth: depthDone, nodes };
}
// Weaker levels: search every legal move to a fixed shallow depth, then pick with a softmax (so the best move is likely but not certain)
// and an occasional real slip, but never a move that throws away a lot (and always a mate in one if there is one).
const SKILL = {
  easy: { depth: 2, temp: 170, slip: 0.18, slipRange: 350 },
  medium: { depth: 4, temp: 65, slip: 0.06, slipRange: 220 },
  hard: { depth: 7, temp: 18, slip: 0, slipRange: 0 },
  human: { depth: 6, temp: 40, slip: 0.04, slipRange: 200 },
};
function runSkill(st, level, ms, hist) {
  const L = SKILL[level];
  const full = runSearch(st, { ms: Math.max(80, Math.min(ms, 400)), maxDepth: 2, hist }); // sets up the position and the history
  if (full.none || full.forced) return full;
  const roots = legalRoot();
  nodes = 0; stopped = false; deadline = Date.now() + Math.max(400, ms * 3);
  const scored = [];
  for (const m of roots) {
    make(m);
    const v = -negamax(L.depth - 1, -INF, INF, 1, true);
    unmake();
    if (stopped) break;
    scored.push({ m, v });
  }
  if (scored.length < roots.length) return full; // ran out of time: just use the shallow result
  scored.sort((a, b) => b.v - a.v);
  const best = scored[0];
  if (best.v > MATE - 100) return { move: best.m, score: best.v, depth: L.depth, nodes };
  let pick = best;
  if (L.slip && Math.random() < L.slip) {
    const pool = scored.slice(1, 6).filter((x) => x.v > best.v - L.slipRange);
    if (pool.length) pick = pool[Math.floor(Math.random() * pool.length)];
  } else {
    const w = scored.filter((x) => x.v > best.v - 4 * L.temp).map((x) => ({ x, w: Math.exp((x.v - best.v) / L.temp) }));
    let r = Math.random() * w.reduce((a, b) => a + b.w, 0);
    for (const e of w) { r -= e.w; if (r <= 0) { pick = e.x; break; } }
  }
  return { move: pick.m, score: best.v, depth: L.depth, nodes };
}
function perftFast(fen, depth) {
  setPosition(parseFen(fen)); G = 0; HL[0] = hLo; HH[0] = hHi; qOnly = false;
  const go = (d, ply) => {
    if (d === 0) return 1;
    const n = gen(ply, false), save = MB[ply].slice(0, n);
    let total = 0;
    for (let i = 0; i < n; i++) { make(save[i]); if (!attackedBy(ksq[side ^ 1], side)) total += go(d - 1, ply + 1); unmake(); }
    return total;
  };
  return go(depth, 0);
}

// ---- opening book: mainlines in UCI. A line is only used when the game so far matches it exactly and the move is legal.
const BOOK_LINES = [
  'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 c2c3 d7d6 b2b4 c5b6 a2a4 a7a6',
  'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8 h2h3',
  'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6 e4e5 d8e7 d1e2 f6d5 c2c4 c8a6',
  'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5 f1d3 f8e7 e1g1 b8c6 c2c4',
  'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5 d4b3 c8e6 f2f3',
  'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 d7d6 c1g5 e7e6 d1d2 a7a6 e1c1',
  'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7 g5e7 d8e7 f2f4 e8g8',
  'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 h2h4 h7h6 g1f3 b8d7 h4h5 g6h7 f1d3',
  'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c7c6 f1c4 c8f5',
  'e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 g1f3 f8g7 f1e2 e8g8 e1g1 c7c6',
  'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 h7h6 g5h4 b7b6 c4d5 e6d5',
  'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5 e2e3 e7e6 f1c4 f8b4 e1g1',
  'd2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6 d1e2 b7b5',
  'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6 d4d5',
  'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5 g1f3 c7c5 e1g1 b8c6 a2a3 b4c3 b2c3',
  'd2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 c7c5 c2c3 b8c6 b1d2 f8d6 f4g3 e8g8 f1d3',
  'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5 f1g2 d5b6 e1g1 f8e7 a2a3',
  'c2c4 g8f6 b1c3 e7e6 g1f3 d7d5 d2d4 f8e7 c1g5 e8g8 e2e3 h7h6 g5h4 b7b6',
  'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 d2d4 e8g8 c2c4 d5c4 d1c2',
  'g1f3 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 d2d4 e8g8 f1e2 e7e5',
];
const BOOK = BOOK_LINES.map((l) => l.split(' '));
function bookMove(movesUci, st) {
  const n = movesUci.length;
  if (n > 24) return null;
  const options = [];
  for (const line of BOOK) {
    if (line.length <= n) continue;
    let ok = true;
    for (let i = 0; i < n; i++) if (line[i] !== movesUci[i]) { ok = false; break; }
    if (ok) options.push(line[n]);
  }
  if (!options.length) return null;
  const pick = options[Math.floor(Math.random() * options.length)];
  const from = sqIndex(pick.slice(0, 2)), to = sqIndex(pick.slice(2, 4)), promo = pick[4] || null;
  const m = legal(st).find((x) => x.from === from && x.to === to && (x.promo || null) === promo);
  return m || null;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const startState = () => parseFen(START_FEN);
// 'checkmate', 'stalemate' or null for the side to move
function status(st) { return legal(st).length ? null : (inCheck(st) ? 'checkmate' : 'stalemate'); }

function bestMove(fen, opts) { return bestMoveState(parseFen(fen), opts); }
// opts: ms (thinking time), maxDepth, queen (only ever promote to a queen), hist (earlier states of this game, for repetitions),
//       moves (UCI list since the standard start position, enables the opening book)
function bestMoveState(st, { ms = 1500, maxDepth = 64, queen = false, hist = null, moves = null, level = 'max' } = {}) {
  queenOnly = qOnly = !!queen;
  try { return bestMoveInner(st, { ms, maxDepth, hist, moves, level }); } finally { queenOnly = qOnly = false; }
}
function bestMoveInner(st, { ms, maxDepth, hist, moves, level }) {
  // the side that is NOT to move must not be in check (a misread board)
  if (attacked(st.board, kingSq(st.board, !st.white), st.white)) throw new Error('That position is not legal: the side that just moved is still in check. The board was probably misread.');
  const info = (m, extra) => {
    const uci = sqName(m.from) + sqName(m.to) + (m.promo || '');
    return { uci, from: sqName(m.from), to: sqName(m.to), promo: m.promo || null, piece: st.board[m.from].toLowerCase(), capture: !!m.cap, castle: m.castle || null, enPassant: !!m.ep, ...extra };
  };
  if (Array.isArray(moves)) {
    const bm = bookMove(moves, st);
    if (bm) return info(bm, { depth: 0, evalPawns: null, mateIn: null, book: true });
  }
  const r = SKILL[level] ? runSkill(st, level, ms, hist) : runSearch(st, { ms: Math.max(100, Math.min(20000, ms)), maxDepth: Math.min(MAXD - 10, maxDepth), hist });
  if (r.none) return { over: true, status: r.check ? 'checkmate' : 'stalemate', side: st.white ? 'white' : 'black' };
  const m = moveToObj(r.move);
  // hand back the same move object the move generator would (so callers compare apples with apples)
  const lm = legal(st).find((x) => x.from === m.from && x.to === m.to && (x.promo || null) === (m.promo || null));
  if (!lm) throw new Error('internal: the engine produced a move the rules do not allow');
  const mate = Math.abs(r.score) > MATE - 100;
  return info(lm, { depth: r.depth, nodes: r.nodes, evalPawns: mate ? null : Math.round(r.score) / 100, mateIn: mate ? Math.ceil((MATE - Math.abs(r.score)) / 2) * (r.score > 0 ? 1 : -1) : null });
}

function perft(fen, depth) { return perftFast(fen, depth); }
const key = (st) => st.board.map((p) => p || '.').join('') + (st.white ? 'w' : 'b') + (st.K ? 'K' : '') + (st.Q ? 'Q' : '') + (st.k ? 'k' : '') + (st.q ? 'q' : '') + st.ep;

const api = { bestMove, bestMoveState, perft, parseFen, legal, apply, status, startState, sqName, sqIndex, START_FEN, key, inCheck, LEVELS: ['easy', 'medium', 'hard', 'human', 'max'] };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else globalThis.PipChess = api;
