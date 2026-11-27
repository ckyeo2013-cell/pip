'use strict';
/*
 * Reading a chess board from screenshots, with no AI: which squares changed between two pictures, which piece sits where
 * (learned from known positions), and which legal move explains a change. Pure functions on 128x128 BGRA snapshots.
 * Split out of actions.js; behaviour is unchanged.
 */
const chess = require('./chess');

// ---- chess: see which squares changed between two board snapshots (128x128 BGRA bitmaps), and turn that into a move
function cellDiffs(a, b) {
  const out = new Array(64).fill(0), W = a.width, CELL = W / 8;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      let sum = 0, n = 0;
      for (let y = Math.floor(r * CELL + 2); y < (r + 1) * CELL - 2; y += 2) {
        for (let x = Math.floor(c * CELL + 2); x < (c + 1) * CELL - 2; x += 2) {
          const i = (y * W + x) * 4;
          sum += Math.abs(a.bitmap[i] - b.bitmap[i]) + Math.abs(a.bitmap[i + 1] - b.bitmap[i + 1]) + Math.abs(a.bitmap[i + 2] - b.bitmap[i + 2]);
          n += 3;
        }
      }
      out[r * 8 + c] = sum / n;
    }
  }
  return out;
}
// At the start of a game, which colour is at the bottom of the board? Both halves have the same square colours, so the
// difference in brightness between the bottom two ranks and the top two ranks is the pieces: the brighter side is white.
function startOrientation(snap) {
  const W = snap.width, CELL = W / 8;
  const lum = (r0) => {
    let sum = 0, n = 0;
    for (let y = Math.floor(r0 * CELL); y < (r0 + 2) * CELL; y += 2) for (let x = 0; x < W; x += 2) { const i = (y * W + x) * 4; sum += 0.114 * snap.bitmap[i] + 0.587 * snap.bitmap[i + 1] + 0.299 * snap.bitmap[i + 2]; n++; }
    return sum / n;
  };
  const diff = lum(6) - lum(0); // bottom minus top
  return Math.abs(diff) < 5 ? null : diff > 0; // true: white is at the bottom; null: cannot tell
}
// Which cells hold a piece? A piece makes the middle of a cell busy (high spread of brightness); an empty square, even one
// tinted by a move highlight, is flat. Cells are numbered top-left first, whichever way the board faces.
function occupancy(snap) {
  const W = snap.width, CELL = W / 8, out = new Array(64).fill(false), m = CELL * 0.22;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    let n = 0, s = 0, s2 = 0;
    for (let y = Math.floor(r * CELL + m); y < (r + 1) * CELL - m; y++) for (let x = Math.floor(c * CELL + m); x < (c + 1) * CELL - m; x++) {
      const i = (y * W + x) * 4, v = 0.114 * snap.bitmap[i] + 0.587 * snap.bitmap[i + 1] + 0.299 * snap.bitmap[i + 2];
      n++; s += v; s2 += v * v;
    }
    out[r * 8 + c] = Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n))) > 10;
  }
  return out;
}
// How many squares differ clearly between two snapshots. A move (castling and en passant included, plus the last-move highlights
// going and coming) never changes more than about seven squares, so a lot more than that means something is drawn over the board:
// a "game over" pop-up (the opponent resigned, a flag fell, a draw was agreed) or a menu.
const COVER_CELLS = 10;
function coverCount(a, b, thr) { return cellDiffs(a, b).filter((v) => v > thr).length; }
// ---- local piece recognition (no AI): learn what each piece looks like from positions we know for sure (the start position, or a
// position the AI read and the board confirmed), then recognise pieces on a board we have not seen before, even mid-game.
// A piece is described by its shape (which pixels differ from the square's own background colour) and its brightness.
const PIECES = 'PNBRQKpnbrqk';
function cellFeatures(snap, r, c) {
  const W = snap.width, CELL = W / 8, S = Math.floor(CELL), x0 = Math.floor(c * CELL), y0 = Math.floor(r * CELL);
  const px = (x, y) => { const i = ((y0 + y) * W + x0 + x) * 4; return [snap.bitmap[i + 2], snap.bitmap[i + 1], snap.bitmap[i]]; };
  const counts = new Map();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { // the background is the commonest colour on the cell's outer ring (also right on a highlighted square)
    if (x > 1 && x < S - 2 && y > 1 && y < S - 2) continue;
    const p = px(x, y), k = (p[0] >> 3) * 1024 + (p[1] >> 3) * 32 + (p[2] >> 3);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let bk = 0, bn = -1; for (const [k, n] of counts) if (n > bn) { bn = n; bk = k; }
  const bg = [(bk >> 10) * 8 + 4, ((bk >> 5) & 31) * 8 + 4, (bk & 31) * 8 + 4];
  const mask = new Uint8Array(S * S); let lum = 0, area = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const p = px(x, y);
    if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 60) { mask[y * S + x] = 1; lum += 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]; area++; }
  }
  return { mask, S, lum: area ? lum / area : 0, area };
}
const maskStr = (m) => Array.from(m).join('');
function maskScore(a, bStr, S) { // best overlap (intersection over union) allowing the picture to be off by one pixel
  let best = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    let inter = 0, uni = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const yb = y + dy, xb = x + dx, va = a[y * S + x], vb = yb >= 0 && yb < S && xb >= 0 && xb < S && bStr.charCodeAt(yb * S + xb) === 49 ? 1 : 0;
      if (va || vb) { uni++; if (va && vb) inter++; }
    }
    if (uni && inter / uni > best) best = inter / uni;
  }
  return best;
}
function classifyCell(f, lib) {
  const per = {};
  for (const ch of PIECES) for (const s of lib[ch] || []) {
    const sc = maskScore(f.mask, s.m, f.S) - Math.min(0.3, Math.abs(f.lum - s.lum) / 255);
    if (per[ch] === undefined || sc > per[ch]) per[ch] = sc;
  }
  const r = Object.entries(per).sort((a, b) => b[1] - a[1]);
  return r.length ? { ch: r[0][0], score: r[0][1], gap: r.length > 1 ? r[0][1] - r[1][1] : 1 } : null;
}
// cells: index (top-left first) -> piece letter for squares we are SURE about. Returns true when something new was learned.
function learnPieces(lib, snap, cells) {
  let changed = false;
  for (const [i, ch] of Object.entries(cells)) {
    const f = cellFeatures(snap, i >> 3, i & 7);
    if (f.area < 8 || f.area > f.S * f.S * 0.8) continue;
    const arr = lib[ch] = lib[ch] || [];
    if (arr.some((s) => maskScore(f.mask, s.m, f.S) > 0.9 && Math.abs(s.lum - f.lum) < 25)) continue; // already known
    if (arr.length >= 6) arr.shift();
    arr.push({ m: maskStr(f.mask), lum: Math.round(f.lum) });
    changed = true;
  }
  return changed;
}
// Read a whole board. Returns { board (FEN piece placement), flipped, weak } or null when the pieces are not clear enough (then the AI has to read it).
function recognizeBoard(snap, lib, flippedHint) {
  if (!Object.keys(lib).length) return bootstrapBoard(snap, flippedHint);
  const occ = occupancy(snap), cells = new Array(64).fill('');
  let weak = 0;
  for (let i = 0; i < 64; i++) {
    if (!occ[i]) continue;
    const r = classifyCell(cellFeatures(snap, i >> 3, i & 7), lib);
    if (!r || r.score < 0.5 || r.gap < 0.03) weak++;
    cells[i] = r ? r.ch : '';
  }
  if (weak > 2 || cells.some((c, i) => occ[i] && !c)) return bootstrapBoard(snap, flippedHint); // learned shapes did not fit this site: read from scratch
  let wr = 0, wn = 0, br = 0, bn = 0;
  cells.forEach((c, i) => { if (c === 'P') { wr += i >> 3; wn++; } else if (c === 'p') { br += i >> 3; bn++; } });
  let flipped = !!flippedHint; // white pawns sit lower on the screen than black ones when white is at the bottom
  if (wn && bn && Math.abs(wr / wn - br / bn) > 0.5) flipped = !(wr / wn > br / bn);
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let s = '', e = 0;
    for (let f = 0; f < 8; f++) { const p = cells[cellOf(r * 8 + f, flipped)]; if (p) { if (e) { s += e; e = 0; } s += p; } else e++; }
    rows.push(s + (e || ''));
  }
  return { board: rows.join('/'), flipped, weak };
}
// ---- no-AI fallback: read a board with NO learned pieces (mid-game join, new site). Group the pieces by silhouette, then name each
// group from its shape (pawn smallest, king tallest, knight lopsided, rook blocky, bishop and queen the rest), and split colours by brightness.
function bootstrapBoard(snap, flippedHint) {
  const occ = occupancy(snap), cells = [];
  for (let i = 0; i < 64; i++) if (occ[i]) { const f = cellFeatures(snap, i >> 3, i & 7); if (f.area < 8) return null; cells.push({ i, f, s: maskStr(f.mask) }); }
  if (cells.length < 4 || cells.length > 32) return null;
  const S = cells[0].f.S, shape = (c) => {
    let y0 = S, y1 = -1, x0 = S, x1 = -1, top = 0, sym = 0, un = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (c.f.mask[y * S + x]) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    const h = y1 - y0 + 1, w = x1 - x0 + 1, ty = y0 + Math.max(1, Math.round(h * 0.3));
    for (let y = y0; y < y1 + 1; y++) for (let x = x0; x <= x1; x++) { const a = c.f.mask[y * S + x], b = c.f.mask[y * S + (x0 + x1 - x)]; if (a || b) { un++; if (a && b) sym++; } if (y < ty && a) top++; }
    return { h, w, fill: c.f.area / (w * h), top: top / (w * Math.max(1, ty - y0)), sym: un ? sym / un : 1, area: c.f.area };
  };
  cells.forEach((c) => { c.sh = shape(c); });
  // 1. colours first: white pieces are lighter than black ones
  const ls = cells.map((c) => c.f.lum).sort((a, b) => a - b); let cut = (ls[0] + ls[ls.length - 1]) / 2;
  if (ls[ls.length - 1] - ls[0] < 40) return null;
  for (let it = 0; it < 8; it++) { const lo = ls.filter((v) => v < cut), hi = ls.filter((v) => v >= cut); if (!lo.length || !hi.length) break; cut = (lo.reduce((a, b) => a + b, 0) / lo.length + hi.reduce((a, b) => a + b, 0) / hi.length) / 2; }
  const out = new Array(64).fill(''), sure = {};
  for (const white of [true, false]) {
    const mine = cells.filter((c) => (c.f.lum >= cut) === white);
    // 2. group each colour's pieces by silhouette (strictly: same piece, same picture)
    let groups = [];
    for (const c of mine) {
      let g = null, bs = 0.86;
      for (const k of groups) { const sc = maskScore(c.f.mask, k.rep.s, S); if (sc > bs) { bs = sc; g = k; } }
      if (g) g.m.push(c); else groups.push({ rep: c, m: [c] });
    }
    while (groups.length > 6) { groups.sort((a, b) => a.m.length - b.m.length); const sm = groups.shift(); let t = groups[0], bs = -1; for (const k of groups) { const sc = maskScore(sm.rep.f.mask, k.rep.s, S); if (sc > bs) { bs = sc; t = k; } } t.m.push(...sm.m); }
    const avg = (g, k) => g.m.reduce((a, c) => a + c.sh[k], 0) / g.m.length;
    groups.forEach((g) => { g.h = avg(g, 'h'); g.fill = avg(g, 'fill'); g.sym = avg(g, 'sym'); g.top = avg(g, 'top'); g.area = avg(g, 'area'); });
    // 3. name the groups: pawn is the smallest, king the tallest, queen next if as big, knight the most lopsided, rook the blockiest, bishop what is left
    const left = groups.slice(), put = (g, t) => { for (const c of g.m) { const ch = white ? t.toUpperCase() : t; out[c.i] = ch; sure[c.i] = ch; } left.splice(left.indexOf(g), 1); };
    left.sort((a, b) => a.area - b.area); if (left.length < 2) return null; put(left[0], 'p');
    left.sort((a, b) => b.h - a.h || a.top - b.top); const king = left[0], kh = king.h, ka = king.area; if (left.length > 1 && kh - left[1].h < 1 && Math.abs(king.top - left[1].top) < 0.05) return null; // cannot tell king from queen: let the AI read it
    put(king, 'k');
    if (left.length && kh - left[0].h <= 3 && left[0].area >= ka * 0.85) put(left[0], 'q');
    if (left.length > 3) return null;
    if (left.length) { const kn = left.reduce((a, b) => (b.sym < a.sym ? b : a)); if (kn.sym < 0.9 || left.length === 3) put(kn, 'n'); }
    if (left.length) { const rk = left.reduce((a, b) => (b.fill + b.top * 0.5 > a.fill + a.top * 0.5 ? b : a)); put(rk, 'r'); }
    if (left.length) put(left[0], 'b');
  }
  // 4. sanity: one king each, a sensible number of every piece, no pawns on the back ranks
  const cnt = {}; for (const ch of out) if (ch) cnt[ch] = (cnt[ch] || 0) + 1;
  if (cnt.K !== 1 || cnt.k !== 1 || (cnt.P || 0) > 8 || (cnt.p || 0) > 8) return null;
  for (const [P, Q, R, B, N] of ['PQRBN', 'pqrbn']) { // extra pieces are only possible through promotion: a misread shape shows up as too many of one kind
    const x = Math.max(0, (cnt[Q] || 0) - 1) + Math.max(0, (cnt[R] || 0) - 2) + Math.max(0, (cnt[B] || 0) - 2) + Math.max(0, (cnt[N] || 0) - 2);
    if (x > 8 - (cnt[P] || 0) || Object.values(cnt).reduce((t, v, i) => t, 0) < 0) return null;
  }
  let wr = 0, wn = 0, br = 0, bn = 0;
  out.forEach((c, i) => { if (c === 'P') { wr += i >> 3; wn++; } else if (c === 'p') { br += i >> 3; bn++; } });
  let flipped = !!flippedHint; if (wn && bn && Math.abs(wr / wn - br / bn) > 0.5) flipped = !(wr / wn > br / bn);
  const rows = [];
  for (let r = 0; r < 8; r++) { let s = '', e = 0; for (let f = 0; f < 8; f++) { const p = out[cellOf(r * 8 + f, flipped)]; if (p) { if (e) { s += e; e = 0; } s += p; } else e++; } rows.push(s + (e || '')); }
  if (/^[Pp]|[Pp]$/.test(rows[0]) || /[Pp]/.test(rows[0] + rows[7])) return null;
  return { board: rows.join('/'), flipped, weak: 0, sure, boot: true };
}
// board square (engine index: rank 8 first) -> cell in the picture (top-left first); flipped = black at the bottom
const cellOf = (sq, flipped) => { const r = sq >> 3, c = sq & 7; return (flipped ? 7 - r : r) * 8 + (flipped ? 7 - c : c); };
// the legal move whose two squares both changed the most
function matchMove(d, st, flipped, T) {
  const at = (sq) => d[cellOf(sq, flipped)];
  let best = null, bestScore = 0;
  for (const m of chess.legal(st)) {
    if (m.promo && m.promo !== 'q') continue;
    const a = at(m.from), b = at(m.to);
    if (a < T || b < T) continue;
    let score = a + b;
    if (m.castle) score += at(m.castle === 'k' ? m.to + 1 : m.to - 2) + at(m.castle === 'k' ? m.to - 1 : m.to + 1);
    if (m.ep) score += at(m.to + (st.white ? 8 : -8));
    if (score > bestScore) { best = m; bestScore = score; }
  }
  return best;
}
const CHESS_T = 14; // a square counts as changed above this average colour difference (0 to 255)

module.exports = { cellDiffs, startOrientation, occupancy, COVER_CELLS, coverCount, PIECES, cellFeatures, maskStr, maskScore, classifyCell, learnPieces, recognizeBoard, bootstrapBoard, cellOf, matchMove, CHESS_T };
