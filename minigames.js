/* Pip's own games window: chess, checkers, connect four and tic-tac-toe against Pip. Everything runs offline in this window,
   no AI service and no screen reading needed. The game rules and Pip's move choice are plain functions (exported for tests);
   the window itself only exists in the browser. */
(function (root) {
  'use strict';
  const rnd = (n) => Math.floor(Math.random() * n);
  // level is "sharp:N" or "sloppy:N" (N = strength 1..10)
  const strN = (l) => Math.max(1, Math.min(10, parseFloat(String(l).split(':')[1]) || 7));
  const LEVEL_DEPTH = new Proxy({}, { get: (_, l) => (String(l).startsWith('sloppy') ? 2 + Math.round((strN(l) - 1) / 3) : 3 + Math.round((strN(l) - 1) * 5 / 9)) });
  const SLIP = new Proxy({}, { get: (_, l) => (String(l).startsWith('sloppy') ? 0.3 - 0.02 * strN(l) : 0.06 - 0.006 * strN(l)) });

  // ================================================================ tic-tac-toe (board: 9 cells of '', 'X', 'O'; Pip is O)
  const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  function tttWinner(b) {
    for (const [x, y, z] of TTT_LINES) if (b[x] && b[x] === b[y] && b[y] === b[z]) return b[x];
    return b.every(Boolean) ? 'draw' : null;
  }
  function tttScore(b, turn) { // +1 Pip (O) wins, -1 X wins, with the faster win scoring higher
    const w = tttWinner(b);
    if (w === 'O') return 10 - b.filter(Boolean).length;
    if (w === 'X') return b.filter(Boolean).length - 10;
    if (w === 'draw') return 0;
    let best = turn === 'O' ? -99 : 99;
    for (let i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = turn;
      const v = tttScore(b, turn === 'O' ? 'X' : 'O');
      b[i] = '';
      best = turn === 'O' ? Math.max(best, v) : Math.min(best, v);
    }
    return best;
  }
  function tttPick(b, level) {
    const free = [];
    for (let i = 0; i < 9; i++) if (!b[i]) free.push(i);
    if (Math.random() < (SLIP[level] || 0) * 1.5) return free[rnd(free.length)];
    let best = -99, picks = [];
    for (const i of free) {
      b[i] = 'O';
      const v = tttScore(b, 'X');
      b[i] = '';
      if (v > best) { best = v; picks = [i]; } else if (v === best) picks.push(i);
    }
    return picks[rnd(picks.length)];
  }

  // ================================================================ connect four (42 cells, row 0 on top; 'R' = you, 'Y' = Pip)
  const C4W = 7, C4H = 6;
  function c4Drop(b, col, p) {
    for (let r = C4H - 1; r >= 0; r--) if (!b[r * C4W + col]) { const n = b.slice(); n[r * C4W + col] = p; return { b: n, r }; }
    return null;
  }
  function c4Wins(b, p) {
    for (let r = 0; r < C4H; r++) for (let c = 0; c < C4W; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        let k = 0;
        for (; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= C4H || cc < 0 || cc >= C4W || b[rr * C4W + cc] !== p) break; }
        if (k === 4) return true;
      }
    }
    return false;
  }
  function c4Eval(b) { // from Pip's (Y) point of view
    let s = 0;
    for (let r = 0; r < C4H; r++) if (b[r * C4W + 3] === 'Y') s += 6; else if (b[r * C4W + 3] === 'R') s -= 6;
    for (let r = 0; r < C4H; r++) for (let c = 0; c < C4W; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        let y = 0, x = 0, ok = true;
        for (let k = 0; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= C4H || cc < 0 || cc >= C4W) { ok = false; break; } const v = b[rr * C4W + cc]; if (v === 'Y') y++; else if (v === 'R') x++; }
        if (!ok || (y && x)) continue;
        s += [0, 1, 6, 30, 0][y] - [0, 1, 6, 30, 0][x];
      }
    }
    return s;
  }
  const C4ORDER = [3, 2, 4, 1, 5, 0, 6];
  function c4Search(b, depth, alpha, beta, turn) {
    if (c4Wins(b, 'Y')) return 100000 + depth;
    if (c4Wins(b, 'R')) return -100000 - depth;
    if (b.every(Boolean)) return 0;
    if (depth === 0) return c4Eval(b);
    let best = turn === 'Y' ? -Infinity : Infinity;
    for (const c of C4ORDER) {
      const d = c4Drop(b, c, turn);
      if (!d) continue;
      const v = c4Search(d.b, depth - 1, alpha, beta, turn === 'Y' ? 'R' : 'Y');
      if (turn === 'Y') { if (v > best) best = v; if (v > alpha) alpha = v; } else { if (v < best) best = v; if (v < beta) beta = v; }
      if (alpha >= beta) break;
    }
    return best;
  }
  function c4Pick(b, level) {
    const cols = C4ORDER.filter((c) => c4Drop(b, c, 'Y'));
    for (const c of cols) if (c4Wins(c4Drop(b, c, 'Y').b, 'Y')) return c; // win now
    for (const c of cols) { const d = c4Drop(b, c, 'R'); if (d && c4Wins(d.b, 'R')) { if (Math.random() >= (SLIP[level] || 0)) return c; } } // block, unless a slip
    if (Math.random() < (SLIP[level] || 0) * 1.2) return cols[rnd(cols.length)];
    const depth = Math.min(LEVEL_DEPTH[level] || 4, 8);
    let best = -Infinity, picks = [];
    for (const c of cols) {
      const v = c4Search(c4Drop(b, c, 'Y').b, depth - 1, -Infinity, Infinity, 'R');
      if (v > best) { best = v; picks = [c]; } else if (v === best) picks.push(c);
    }
    return picks[rnd(picks.length)];
  }

  // ================================================================ checkers (American rules: forced captures, multi-jumps, kings)
  // squares r * 8 + c; 'w' = you (moves up the board), 'b' = Pip (moves down); capitals are kings
  function ckStart() {
    const b = new Array(64).fill('');
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) { if (r < 3) b[r * 8 + c] = 'b'; else if (r > 4) b[r * 8 + c] = 'w'; }
    return b;
  }
  const ckSide = (p) => (p ? p.toLowerCase() : '');
  function ckMoves(b, side) {
    const caps = [], simple = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (ckSide(p) !== side) continue;
      const king = p === p.toUpperCase(), fwd = side === 'w' ? -1 : 1;
      const dirs = king ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[fwd, -1], [fwd, 1]];
      const jump = (from, path, taken, isKing) => {
        let any = false;
        const dd = isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : dirs;
        for (const [dr, dc] of dd) {
          const r = (from >> 3) + dr, c = (from & 7) + dc, r2 = r + dr, c2 = c + dc;
          if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) continue;
          const over = r * 8 + c, land = r2 * 8 + c2;
          if (!b[over] || ckSide(b[over]) === side || taken.includes(over)) continue;
          if (b[land] && land !== sq) continue; // the square we started from counts as empty
          any = true;
          const promoted = !isKing && ((side === 'w' && r2 === 0) || (side === 'b' && r2 === 7));
          if (promoted) caps.push({ path: path.concat(land), caps: taken.concat(over) }); // becoming a king ends the move
          else jump(land, path.concat(land), taken.concat(over), isKing);
        }
        if (!any && path.length > 1) caps.push({ path, caps: taken });
      };
      jump(sq, [sq], [], king);
      for (const [dr, dc] of dirs) {
        const r = (sq >> 3) + dr, c = (sq & 7) + dc;
        if (r < 0 || r > 7 || c < 0 || c > 7 || b[r * 8 + c]) continue;
        simple.push({ path: [sq, r * 8 + c], caps: [] });
      }
    }
    return caps.length ? caps : simple;
  }
  function ckApply(b, m) {
    const n = b.slice(), from = m.path[0], to = m.path[m.path.length - 1];
    let p = n[from];
    n[from] = '';
    for (const s of m.caps) n[s] = '';
    const row = to >> 3;
    if (p === 'w' && row === 0) p = 'W'; else if (p === 'b' && row === 7) p = 'B';
    n[to] = p;
    return n;
  }
  function ckEval(b) { // from Pip's (b) point of view
    let s = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p) continue;
      const r = sq >> 3, c = sq & 7, king = p === p.toUpperCase(), mine = ckSide(p) === 'b';
      let v = king ? 170 : 100 + (mine ? r : 7 - r) * 4;
      if (!king && ((mine && r === 0) || (!mine && r === 7))) v += 8; // keeps the back row guarded
      if (c === 0 || c === 7) v -= 2;
      if (r >= 2 && r <= 5 && c >= 2 && c <= 5) v += 3;
      s += mine ? v : -v;
    }
    return s;
  }
  function ckSearch(b, side, depth, alpha, beta) {
    const ms = ckMoves(b, side);
    if (!ms.length) return side === 'b' ? -100000 - depth : 100000 + depth;
    if (depth === 0) return ckEval(b);
    let best = side === 'b' ? -Infinity : Infinity;
    for (const m of ms) {
      const v = ckSearch(ckApply(b, m), side === 'b' ? 'w' : 'b', depth - 1, alpha, beta);
      if (side === 'b') { if (v > best) best = v; if (v > alpha) alpha = v; } else { if (v < best) best = v; if (v < beta) beta = v; }
      if (alpha >= beta) break;
    }
    return best;
  }
  function ckPick(b, level) {
    const ms = ckMoves(b, 'b');
    if (!ms.length) return null;
    if (ms.length === 1) return ms[0];
    if (Math.random() < (SLIP[level] || 0)) return ms[rnd(ms.length)];
    const depth = Math.min(LEVEL_DEPTH[level] || 4, 8);
    let best = -Infinity, picks = [];
    for (const m of ms) {
      const v = ckSearch(ckApply(b, m), 'w', depth - 1, -Infinity, Infinity);
      if (v > best) { best = v; picks = [m]; } else if (v === best) picks.push(m);
    }
    return picks[rnd(picks.length)];
  }

  const logic = { tttWinner, tttPick, tttScore, c4Drop, c4Wins, c4Pick, ckStart, ckMoves, ckApply, ckPick, ckEval };
  root.PipGameLogic = logic;
  if (typeof document === 'undefined') { if (typeof module !== 'undefined' && module.exports) module.exports = logic; return; }

  // ================================================================ the window
  let host = { sfx() {}, say() {}, emote() {}, status() {}, end() {}, started() {} };
  let panel = null, body = null, titleSel = null, levelSel = null, strSel = null, statusEl = null, game = 'chess', level = 'sharp:7', token = 0, playerSide = 'first';
  let worker = null, reqId = 0;
  const pending = {};
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const PCH = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
  const THINK = new Proxy({}, { get: (_, l) => (String(l).startsWith('sloppy') ? 600 : 1500) });
  const say = (t) => host.say(t);
  let lastTalk = -9, plies = 0;
  const talk = (lines, force) => { if (!force && plies - lastTalk < 4) return; lastTalk = plies; const [t, feel] = lines[rnd(lines.length)]; host.say(t); if (feel) host.emote(feel); };

  function ensureWorker() {
    if (worker !== null) return worker;
    try {
      worker = new Worker('chess-worker.js');
      worker.onmessage = (e) => { const p = pending[e.data.id]; if (!p) return; delete pending[e.data.id]; if (e.data.error) p.rej(new Error(e.data.error)); else p.res(e.data.r); };
      worker.onerror = () => { worker = false; for (const id of Object.keys(pending)) { const p = pending[id]; delete pending[id]; try { p.res(root.PipChess.bestMoveState(p.st, p.opts)); } catch (err) { p.rej(err); } } };
    } catch (_) { worker = false; }
    return worker;
  }
  function askEngine(st, opts) {
    return new Promise((res, rej) => {
      if (ensureWorker()) { const id = ++reqId; pending[id] = { res, rej, st, opts }; worker.postMessage({ id, st, opts }); }
      else setTimeout(() => { try { res(root.PipChess.bestMoveState(st, opts)); } catch (e) { rej(e); } }, 30);
    });
  }

  function build() {
    panel = el('div'); panel.id = 'gm';
    const hd = el('div', 'gm-hd');
    titleSel = el('select');
    for (const [v, t] of [['chess', 'Chess'], ['checkers', 'Checkers'], ['connect4', 'Connect four'], ['ttt', 'Tic-tac-toe']]) { const o = el('option', '', t); o.value = v; titleSel.appendChild(o); }
    levelSel = el('select');
    for (const [v, t] of [['sharp', 'Sharp'], ['sloppy', 'Sloppy']]) { const o = el('option', '', t); o.value = v; levelSel.appendChild(o); }
    strSel = el('input'); strSel.type = 'range'; strSel.min = 1; strSel.max = 10; strSel.step = 0.05; strSel.title = 'Weaker \u2192 Stronger'; strSel.style.width = '90px';
    levelSel.value = level.split(':')[0]; strSel.value = strN(level);
    const again = el('button', '', 'New game'), side = el('button', '', 'Swap sides'), x = el('button', 'x', 'Close');
    hd.append(titleSel, levelSel, strSel, again, side, x);
    statusEl = el('div', 'gm-status', '');
    body = el('div', 'gm-body');
    panel.append(hd, statusEl, body);
    document.body.appendChild(panel);
    titleSel.addEventListener('change', () => { game = titleSel.value; start(); });
    const lvChange = () => { level = levelSel.value + ':' + Number(strSel.value).toFixed(2); start(); };
    levelSel.addEventListener('change', lvChange); strSel.addEventListener('change', lvChange);
    again.addEventListener('click', () => start());
    side.addEventListener('click', () => { playerSide = playerSide === 'first' ? 'second' : 'first'; start(); });
    x.addEventListener('click', close);
    // drag by the header
    let drag = null;
    hd.addEventListener('mousedown', (e) => { if (e.target !== hd) return; const r = panel.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; });
    document.addEventListener('mousemove', (e) => { if (!drag) return; panel.style.left = Math.max(0, e.clientX - drag.dx) + 'px'; panel.style.top = Math.max(0, e.clientY - drag.dy) + 'px'; });
    document.addEventListener('mouseup', () => { drag = null; });
  }
  const setStatus = (t) => { statusEl.textContent = t; };
  function finish(result) { // result: 'player' | 'pip' | 'draw'
    token++;
    host.end(game, result);
    setStatus(result === 'player' ? 'You won! Well played.' : result === 'pip' ? 'Pip won. Good game!' : 'It is a draw.');
  }

  function start() {
    token++;
    body.textContent = '';
    plies = 0; lastTalk = -9;
    host.started(game);
    if (game === 'ttt') startTtt(); else if (game === 'connect4') startC4(); else if (game === 'checkers') startCheckers(); else startChess();
  }

  // ---- tic-tac-toe
  function startTtt() {
    const my = token, b = new Array(9).fill(''), grid = el('div', 'gm-ttt'), cells = [];
    const you = playerSide === 'first' ? 'X' : 'O';
    const draw = () => cells.forEach((c, i) => { c.textContent = b[i]; });
    for (let i = 0; i < 9; i++) { const c = el('button', 'gm-tcell'); cells.push(c); grid.appendChild(c); c.addEventListener('click', () => play(i)); }
    body.appendChild(grid);
    let turn = 'X';
    const check = () => {
      const w = tttWinner(b);
      if (!w) return false;
      draw(); finish(w === 'draw' ? 'draw' : (w === you ? 'player' : 'pip'));
      return true;
    };
    const pipMove = () => {
      if (my !== token) return;
      const i = tttPick(b.slice(), level);
      // tttPick plays as 'O'; when Pip is X, mirror the board so the same search works
      let mv = i;
      if (you === 'O') { const m = b.map((v) => (v === 'X' ? 'O' : v === 'O' ? 'X' : '')); mv = tttPick(m, level); }
      b[mv] = you === 'X' ? 'O' : 'X'; host.sfx('move'); plies++; draw();
      if (check()) return;
      turn = you; setStatus('Your turn.');
    };
    function play(i) {
      if (my !== token || b[i] || turn !== you) return;
      b[i] = you; host.sfx('move'); plies++; draw();
      if (check()) return;
      turn = 'pip'; setStatus('Pip is thinking...');
      setTimeout(pipMove, 350);
    }
    setStatus(you === 'X' ? 'You are X. Your turn.' : 'You are O. Pip goes first.');
    if (you === 'O') { turn = 'pip'; setTimeout(pipMove, 400); }
  }

  // ---- connect four
  function startC4() {
    const my = token, b = new Array(42).fill(''), wrap = el('div', 'gm-c4'), cells = [], me = playerSide === 'first' ? 'R' : 'Y', pip = me === 'R' ? 'Y' : 'R';
    for (let r = 0; r < C4H; r++) for (let c = 0; c < C4W; c++) { const e = el('button', 'gm-c4cell'); e.dataset.col = String(c); cells[r * C4W + c] = e; wrap.appendChild(e); e.addEventListener('click', () => drop(c)); }
    body.appendChild(wrap);
    const draw = () => cells.forEach((e, i) => { e.className = 'gm-c4cell' + (b[i] === 'R' ? ' red' : b[i] === 'Y' ? ' yel' : ''); });
    let turn = 'R';
    const settle = (p) => {
      draw();
      if (c4Wins(b, p)) { finish(p === me ? 'player' : 'pip'); return true; }
      if (b.every(Boolean)) { finish('draw'); return true; }
      return false;
    };
    const pipTurn = () => {
      if (my !== token) return;
      let col;
      if (pip === 'Y') col = c4Pick(b.slice(), level);
      else { const m = b.map((v) => (v === 'R' ? 'Y' : v === 'Y' ? 'R' : '')); col = c4Pick(m, level); } // Pip as red: mirror so the search always plays Y
      const d = c4Drop(b, col, pip);
      b.splice(0, 42, ...d.b); host.sfx('move'); plies++;
      if (settle(pip)) return;
      turn = me; setStatus('Your turn.');
    };
    function drop(col) {
      if (my !== token || turn !== me) return;
      const d = c4Drop(b, col, me);
      if (!d) return;
      b.splice(0, 42, ...d.b); host.sfx('move'); plies++;
      if (settle(me)) return;
      turn = 'pip'; setStatus('Pip is thinking...');
      setTimeout(pipTurn, 450);
    }
    setStatus(me === 'R' ? 'You are red. Click a column.' : 'You are yellow. Pip goes first.');
    if (me === 'Y') { turn = 'pip'; setTimeout(pipTurn, 450); }
  }

  // ---- checkers (you are light and move up; Pip is dark). Swapping sides is not offered here, you always move first.
  function startCheckers() {
    const my = token, wrap = el('div', 'gm-board'), cells = [];
    let b = ckStart(), sel = null, cands = [], step = 0, turn = 'w', quiet = 0;
    for (let sq = 0; sq < 64; sq++) {
      const dark = ((sq >> 3) + (sq & 7)) % 2 === 1, c = el('button', 'gm-cell ' + (dark ? 'dk' : 'lt'));
      cells.push(c); wrap.appendChild(c);
      c.addEventListener('click', () => click(sq));
    }
    body.appendChild(wrap);
    const draw = (hl) => cells.forEach((c, sq) => {
      const p = b[sq];
      c.className = 'gm-cell ' + (((sq >> 3) + (sq & 7)) % 2 === 1 ? 'dk' : 'lt') + (sel === sq ? ' sel' : '') + (hl && hl.includes(sq) ? ' hint' : '');
      c.textContent = '';
      if (p) { const d = el('span', 'gm-pc ' + (ckSide(p) === 'w' ? 'w' : 'b') + (p === p.toUpperCase() ? ' king' : ''), p === p.toUpperCase() ? 'K' : ''); c.appendChild(d); }
    });
    const over = (side) => {
      if (ckMoves(b, side).length) return false;
      finish(side === 'w' ? 'pip' : 'player'); return true;
    };
    function pipTurn() {
      if (my !== token) return;
      const m = ckPick(b, level);
      if (!m) { finish('player'); return; }
      const capture = m.caps.length > 0;
      b = ckApply(b, m); plies++; quiet = capture ? 0 : quiet + 1; host.sfx(capture ? 'capture' : 'move');
      if (capture && m.caps.length > 1) talk([['A double jump!', 'excited']], true);
      draw();
      if (over('w')) return;
      if (quiet >= 80) { finish('draw'); return; }
      turn = 'w'; setStatus('Your turn.');
    }
    function click(sq) {
      if (my !== token || turn !== 'w') return;
      if (sel === null || (b[sq] && ckSide(b[sq]) === 'w' && step === 0)) {
        const all = ckMoves(b, 'w').filter((m) => m.path[0] === sq);
        if (!all.length) { setStatus(ckMoves(b, 'w')[0] && ckMoves(b, 'w')[0].caps.length ? 'You must capture.' : 'That piece cannot move.'); return; }
        sel = sq; cands = all; step = 0; draw(cands.map((m) => m.path[1])); return;
      }
      const next = cands.filter((m) => m.path[step + 1] === sq);
      if (!next.length) { sel = null; cands = []; step = 0; draw(); return; }
      step++;
      const done = next.find((m) => m.path.length === step + 1);
      if (done && next.every((m) => m.path.length === step + 1)) {
        b = ckApply(b, done); plies++; quiet = done.caps.length ? 0 : quiet + 1; host.sfx(done.caps.length ? 'capture' : 'move');
        sel = null; cands = []; step = 0; draw();
        if (over('b')) return;
        turn = 'pip'; setStatus('Pip is thinking...'); setTimeout(pipTurn, 500);
        return;
      }
      cands = next; draw(cands.map((m) => m.path[step + 1]));
    }
    draw(); setStatus('You are light and move first. Captures are forced.');
  }

  // ---- chess
  function startChess() {
    const C = root.PipChess, my = token;
    if (!C) { setStatus('The chess engine did not load.'); return; }
    const youWhite = playerSide === 'first';
    let st = C.startState(), hist = [st], moves = [], sel = null, last = null, busy = false, prevEv = null;
    const wrap = el('div', 'gm-board'), cells = [];
    const order = [];
    for (let i = 0; i < 64; i++) order.push(youWhite ? i : 63 - i);
    order.forEach((sq) => {
      const c = el('button', 'gm-cell ' + (((sq >> 3) + (sq & 7)) % 2 === 0 ? 'lt' : 'dk'));
      cells[sq] = c; wrap.appendChild(c);
      c.addEventListener('click', () => click(sq));
    });
    body.appendChild(wrap);
    const legalFrom = (from) => C.legal(st).filter((m) => m.from === from && (!m.promo || m.promo === 'q'));
    const draw = (hints) => {
      const chk = C.inCheck(st) ? st.board.findIndex((p) => p === (st.white ? 'K' : 'k')) : -1;
      for (let sq = 0; sq < 64; sq++) {
        const p = st.board[sq], c = cells[sq];
        c.className = 'gm-cell ' + (((sq >> 3) + (sq & 7)) % 2 === 0 ? 'lt' : 'dk') + (sel === sq ? ' sel' : '') + (hints && hints.includes(sq) ? ' hint' : '') + (last && (last.from === sq || last.to === sq) ? ' last' : '') + (chk === sq ? ' chk' : '');
        c.textContent = '';
        if (p) c.appendChild(el('span', 'gm-pc ' + (p === p.toUpperCase() ? 'w' : 'b'), PCH[p.toLowerCase()]));
      }
    };
    const material = () => { let s = 0; const V = { p: 1, n: 3, b: 3, r: 5, q: 9 }; for (const p of st.board) if (p && p.toLowerCase() !== 'k') s += (p === p.toUpperCase() ? 1 : -1) * V[p.toLowerCase()]; return youWhite ? s : -s; };
    const endCheck = () => {
      const s = C.status(st);
      if (s === 'checkmate') { draw(); finish(st.white === youWhite ? 'pip' : 'player'); return true; }
      if (s === 'stalemate') { draw(); finish('draw'); return true; }
      const reps = hist.filter((h) => C.key(h) === C.key(st)).length;
      const pieces = st.board.filter((p) => p && p.toLowerCase() !== 'k');
      if (reps >= 3 || !pieces.length || (pieces.length === 1 && 'nb'.includes(pieces[0].toLowerCase()))) { draw(); finish('draw'); return true; }
      return false;
    };
    const play = (m, byPlayer) => {
      const took = st.board[m.to] || m.ep;
      last = { from: m.from, to: m.to };
      moves.push(C.sqName(m.from) + C.sqName(m.to) + (m.promo || ''));
      st = C.apply(st, m); hist.push(st); plies++;
      host.sfx(took ? 'capture' : 'move');
      if (C.inCheck(st)) { host.sfx('check'); if (byPlayer) talk([['Check on me!', 'surprised']], true); else talk([['Check.', 'excited']], true); }
      draw();
    };
    const pipTurn = async () => {
      if (my !== token || busy) return;
      busy = true; setStatus('Pip is thinking...'); host.status('Chess: thinking');
      let r;
      try { r = await askEngine(st, { ms: THINK[level] || 800, queen: true, level, hist, moves }); } catch (e) { busy = false; setStatus('Pip could not move: ' + e.message); return; }
      busy = false; host.status('');
      if (my !== token) return;
      if (r.over) { endCheck(); return; }
      const m = C.legal(st).find((x) => C.sqName(x.from) === r.from && C.sqName(x.to) === r.to && (x.promo || null) === (r.promo || null));
      const lost = st.board[m.to] || m.ep;
      play(m, false);
      const ev = r.mateIn != null ? (r.mateIn > 0 ? 99 : -99) : r.evalPawns;
      if (ev != null) {
        if (prevEv != null && ev - prevEv >= 2.5) talk([['Ooh, you left something hanging.', 'surprised']]);
        else if (ev >= 4) talk([['I like my position.', 'proud'], ['This is going well for me.', 'happy']]);
        else if (ev <= -4) talk([['Uh oh, I am in trouble.', 'nervous'], ['This is getting tough.', 'nervous']]);
        else if (lost && 'qr'.includes((lost || '').toLowerCase())) talk([['Gotcha.', 'proud']]);
        prevEv = ev;
      }
      if (endCheck()) return;
      setStatus(C.inCheck(st) ? 'You are in check.' : 'Your turn.');
    };
    function click(sq) {
      if (my !== token || busy || st.white !== youWhite) return;
      const p = st.board[sq], mine = p && (p === p.toUpperCase()) === youWhite;
      if (sel !== null) {
        const m = legalFrom(sel).find((x) => x.to === sq);
        if (m) {
          const wasMaterial = material();
          sel = null; play(m, true);
          if (material() - wasMaterial <= -3 && st.board.some((q) => q)) talk([['Ouch, that one hurt.', 'sad']]);
          if (endCheck()) return;
          setTimeout(pipTurn, 250);
          return;
        }
      }
      if (mine) { const ms = legalFrom(sq); sel = sq; draw(ms.map((x) => x.to)); } else { sel = null; draw(); }
    }
    draw();
    setStatus(youWhite ? 'You are white. Your turn.' : 'You are black. Pip moves first.');
    if (!youWhite) setTimeout(pipTurn, 400);
  }

  function open(which) {
    if (!panel) build();
    panel.style.display = 'block';
    if (which && ['chess', 'checkers', 'connect4', 'ttt'].includes(which)) game = which;
    titleSel.value = game; levelSel.value = level.split(':')[0]; strSel.value = strN(level);
    start();
  }
  function close() { token++; if (panel) panel.style.display = 'none'; }
  root.PipGames = {
    init(h) { host = Object.assign(host, h || {}); },
    open, close, setLevel(l) { if (/^(sharp|sloppy):[\d.]+$/.test(l)) { level = l; if (levelSel) { levelSel.value = l.split(':')[0]; strSel.value = strN(l); } } },
    isOpen: () => !!panel && panel.style.display !== 'none',
    rect: () => (panel ? panel.getBoundingClientRect() : null),
    logic,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
