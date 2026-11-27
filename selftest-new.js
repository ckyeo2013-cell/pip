'use strict';
// Checks for the newer pieces: local model, morning brief, undo + action log, clipboard offer rules.
const fs = require('fs'), os = require('os'), path = require('path');
const agent = require('./agent'), brief = require('./brief'), { createUndo, createLog } = require('./undo');
let passed = 0, failed = 0;
const ok = (c, n) => { if (c) { passed++; console.log('ok  ', n); } else { failed++; console.log('FAIL', n); } };

(async () => {
  // local model address rules
  const good = ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1/', 'http://[::1]:8080'];
  const bad = ['http://evil.com/v1', 'http://localhost.evil.com/v1', 'http://user:pw@localhost/v1', 'ftp://localhost', 'http://127.0.0.1.evil.com', 'http://localhost/v1?x=1', 'nonsense'];
  ok(good.every((u) => agent.normalizeLocalUrl(u)) && bad.every((u) => !agent.normalizeLocalUrl(u)), 'local model: only addresses on this computer are accepted');
  let seen;
  const fetchOk = async (url) => { seen = url; return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: 'hi' } }], data: [{ id: 'm1' }] }) }; };
  const r = await agent.runChatLocal({ baseUrl: 'http://localhost:11434/v1', fetchFn: fetchOk, apiKey: 'local', model: 'm1', system: 's', messages: [{ role: 'user', content: 'yo' }], tools: [] });
  ok(r.text === 'hi' && seen === 'http://localhost:11434/v1/chat/completions', 'local model: chats through the local server');
  const refused = await agent.runChatLocal({ baseUrl: 'http://localhost:11434/v1', fetchFn: async () => { throw new Error('fetch failed'); }, apiKey: 'local', model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
  ok(/Ollama/.test(refused.error), 'local model: a stopped server gives a friendly message');
  ok((await agent.runChatLocal({ baseUrl: 'http://evil.com/v1', fetchFn: fetchOk, model: 'm', system: 's', messages: [] })).error.includes('this computer') && seen.includes('localhost'), 'local model: a remote address is refused before any request is made');
  const lm = await agent.listLocalModels('http://localhost:1234/v1', fetchOk);
  ok(lm.ok && lm.models[0] === 'm1' && !(await agent.listLocalModels('http://example.com/v1', fetchOk)).ok, 'local model: lists installed models, refuses remote servers');

  // morning brief
  const urls = [];
  const fetchW = async (u) => { urls.push(u); return u.includes('geocoding') ? { ok: true, json: async () => ({ results: [{ name: 'Petaling Jaya', latitude: 3.1, longitude: 101.6 }] }) } : { ok: true, json: async () => ({ current: { temperature_2m: 30.4, weather_code: 80 }, daily: { temperature_2m_max: [33.6], temperature_2m_min: [24.2], precipitation_probability_max: [70] } }) }; };
  const w = await brief.fetchWeather({ fetchFn: fetchW, city: 'Petaling Jaya' });
  await brief.fetchWeather({ fetchFn: fetchW, city: 'petaling jaya' });
  ok(w.ok && w.now === 30 && urls.length === 2, 'brief: weather is looked up once and cached');
  const empty = urls.length; await brief.fetchWeather({ fetchFn: fetchW, city: '' });
  ok(urls.length === empty, 'brief: no city means nothing is sent anywhere');
  const now = new Date(2026, 10, 24, 8, 30);
  const b = brief.buildBrief({ now, weather: w, events: [{ summary: 'Standup', start: new Date(2026, 10, 24, 9), allDay: false }, { summary: 'Tomorrow', start: new Date(2026, 10, 25, 9), allDay: false }], tasks: [{ text: 'Pay rent', due: new Date(2026, 10, 24, 7).getTime() }, { text: 'Milk', due: null }] });
  ok(/Standup/.test(b.text) && !/Tomorrow/.test(b.text) && /overdue/.test(b.text) && /umbrella/.test(b.text) && /9:00/.test(b.short), 'brief: lists only today, flags overdue tasks, warns about rain');
  ok(/not connected/.test(brief.buildBrief({ now, events: null, calendarConnected: false }).text), 'brief: says so when no calendar is connected');

  // undo + log
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipundo-'));
  const trashed = []; const trash = async (p) => { trashed.push(p); fs.rmSync(p, { recursive: true, force: true }); };
  const u = createUndo({ dir: path.join(tmp, 'undo'), trash });
  const f = path.join(tmp, 'a.txt'); fs.writeFileSync(f, 'old');
  const snap = u.snapshot(f); await trash(f); fs.writeFileSync(f, 'new');
  let res = await u.apply({ type: 'restore', items: [{ orig: f, backup: snap.backup, replaced: true }] });
  ok(res.ok && fs.readFileSync(f, 'utf8') === 'old', 'undo: a replaced file comes back');
  const d = path.join(tmp, 'dir'); fs.mkdirSync(path.join(d, 'sub'), { recursive: true }); fs.writeFileSync(path.join(d, 'sub', 'x.txt'), 'x');
  const s2 = u.snapshot(d); await trash(d);
  res = await u.apply({ type: 'restore', items: [{ orig: d, backup: s2.backup }] });
  ok(res.ok && fs.existsSync(path.join(d, 'sub', 'x.txt')), 'undo: a trashed folder comes back with its contents');
  res = await u.apply({ type: 'restore', items: [{ orig: d, backup: s2.backup }] });
  ok(!res.ok && /already sits/.test(res.text), 'undo: never overwrites something that is there now');
  const m1 = path.join(tmp, 'm.txt'), m2 = path.join(tmp, 's2', 'm.txt'); fs.writeFileSync(m1, 'm'); fs.mkdirSync(path.dirname(m2)); fs.renameSync(m1, m2);
  res = await u.apply({ type: 'moved', moves: [{ from: m1, to: m2 }] });
  ok(res.ok && fs.existsSync(m1) && !fs.existsSync(m2), 'undo: a move is moved back');
  const k = path.join(tmp, 'kd'); fs.mkdirSync(k); fs.writeFileSync(path.join(k, 'z'), 'z');
  res = await u.apply({ type: 'mkdir', path: k });
  ok(!res.ok && fs.existsSync(k), 'undo: a folder that now has files in it is left alone');
  u.prune(new Set([snap.backup]));
  ok(fs.existsSync(snap.backup) && !fs.existsSync(s2.backup), 'undo: cleanup keeps backups still in use and drops the rest');
  ok(u.snapshot(path.join(tmp, 'nope')) === null && u.snapshot('relative/path') === null, 'undo: nothing to copy means no backup');
  const lf = path.join(tmp, 'log.json'); const L = createLog(lf, 3);
  for (let i = 0; i < 5; i++) L.add({ at: Date.now() + i, title: 't' + i, undo: i === 4 ? { type: 'restore', items: [{ backup: '/b' }] } : null });
  L.flush(); const L2 = createLog(lf, 3);
  ok(L2.list().map((e) => e.title).join() === 't2,t3,t4' && L2.backups().has('/b'), 'log: keeps the newest entries across restarts');
  fs.writeFileSync(lf, '{bad json'); ok(createLog(lf).list().length === 0, 'log: a damaged file starts a fresh list instead of crashing');
  fs.rmSync(tmp, { recursive: true, force: true });

  // clipboard offer rules (the function is pulled out of renderer.js as written there)
  const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const m = src.match(/function clipKind\(t\) \{[\s\S]*?\n  \}/);
  const clipKind = new Function(`${m[0]}; return clipKind;`)();
  ok(clipKind('hunter2') === null && clipKind('https://example.com/a/long/path/that/is/just/a/link/okay') === null && clipKind('short text here') === null, 'clipboard offer: never for passwords, links or short scraps');
  ok(clipKind('This is a long enough sentence that someone might want summarised or explained for them today.') === 'prose', 'clipboard offer: prose gets Summarize/Explain');
  ok(clipKind('function a(x) {\n  if (x) { return [1, 2]; }\n  return (x = 3);\n}\nconst y = { a: 1 };') === 'code', 'clipboard offer: code gets Explain/Find bugs');

  // the four extra games (rules and Pip's play)
  const G = require('./minigames.js');
  const rnd = (n) => Math.floor(Math.random() * n);
  let gw = 0;
  for (let g = 0; g < 12; g++) { const b = new Array(121).fill(''); let turn = 'X', res = null; for (let m = 0; m < 121 && !res; m++) { let i; if (turn === 'X') { const e = b.map((v, k) => (v === '' ? k : -1)).filter((k) => k >= 0); i = e[rnd(e.length)]; } else i = G.gmPick(b, 'O', 'sharp:8'); b[i] = turn; if (G.gmWins(b, i, turn)) res = turn; turn = turn === 'X' ? 'O' : 'X'; } if (res === 'O') gw++; }
  ok(gw >= 11, 'gomoku: Pip beats a random player');
  let gb = new Array(121).fill(''); [2, 3, 4, 5].forEach((k) => { gb[5 * 11 + k] = 'O'; });
  ok([5 * 11 + 1, 5 * 11 + 6].includes(G.gmPick(gb, 'O', 'sharp:10')), 'gomoku: Pip finishes five when it can');
  gb = new Array(121).fill(''); [2, 3, 4, 5].forEach((k) => { gb[5 * 11 + k] = 'X'; }); gb[0] = 'O';
  ok([5 * 11 + 1, 5 * 11 + 6].includes(G.gmPick(gb, 'O', 'sharp:10')), 'gomoku: Pip blocks an open four');
  const rowOfFive = new Array(121).fill(''); [0, 1, 2, 3, 4].forEach((k) => { rowOfFive[k] = 'X'; });
  ok(G.gmWins(rowOfFive, 2, 'X') && !G.gmWins(rowOfFive, 2, 'O'), 'gomoku: five in a row wins');
  let fleetsOk = true, pipShotsTotal = 0;
  for (let g = 0; g < 10; g++) {
    const f = G.bsPlace(); if (f.ships.length !== 5 || new Set(f.ships.flatMap((x) => x.cells)).size !== 17) fleetsOk = false;
    const shots = new Array(100).fill(0); let n = 0;
    while (!G.bsAllSunk(f)) { const i = G.bsPick(shots, f.ships.filter((x) => x.hit < x.len).map((x) => x.len), 'sharp:8'); if (shots[i]) { fleetsOk = false; break; } G.bsFire(f, shots, i); n++; }
    pipShotsTotal += n;
  }
  ok(fleetsOk, 'battleship: fleets never overlap and Pip never fires at the same square twice');
  ok(pipShotsTotal / 10 < 70, 'battleship: Pip hunts ships far better than random shooting');
  let dw = 0;
  for (let g = 0; g < 12; g++) { const ed = new Array(40).fill(0), ow = new Array(16).fill(''); let turn = 'you'; while (ow.some((x) => !x)) { let e; if (turn === 'you') { const f = ed.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0); e = f[rnd(f.length)]; } else e = G.dbPick(ed, ow, 'sharp:8'); if (!G.dbPlay(ed, ow, e, turn)) turn = turn === 'you' ? 'pip' : 'you'; } if (ow.filter((x) => x === 'pip').length > 8) dw++; }
  ok(dw >= 10, 'dots and boxes: Pip beats a random player');
  const ed3 = new Array(40).fill(0); G.DB_SIDES[0].slice(0, 3).forEach((e) => { ed3[e] = 1; });
  ok(G.dbPick(ed3, new Array(16).fill(''), 'sharp:10') === G.DB_SIDES[0][3], 'dots and boxes: Pip closes a box when one is available');
  const words = [].concat(...Object.values(G.HM_WORDS));
  ok(words.every((w) => /^[a-z]+$/.test(w)) && G.HM_WORDS.easy.every((w) => w.length <= 5) && G.HM_WORDS.hard.every((w) => w.length >= 8), 'hangman: word lists are clean and get longer with strength');
  ok(G.hmMask('cat', ['c', 't']).join('|') === 'c||t', 'hangman: only guessed letters show');

  // connected tools (MCP), against a tiny fake server
  const { createMcp } = require('./mcp');
  const mdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipmcp-'));
  const fake = path.join(mdir, 'fake.js');
  fs.writeFileSync(fake, `let buf='';process.stdin.setEncoding('utf8');const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n');
process.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);if(!l.trim())continue;const m=JSON.parse(l);
if(m.method==='initialize')out({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}}}});
else if(m.method==='tools/list')out({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'echo',description:'Echo',inputSchema:{type:'object',properties:{text:{type:'string'}}}},{name:'boom',description:'Fails',inputSchema:{type:'object'}},{name:'pic',description:'Image',inputSchema:{type:'object'}}]}});
else if(m.method==='tools/call'){const n=m.params.name;
if(n==='echo'){out({jsonrpc:'2.0',id:99,method:'sampling/createMessage',params:{}});out({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'echo: '+m.params.arguments.text}]}});}
else if(n==='boom')out({jsonrpc:'2.0',id:m.id,result:{isError:true,content:[{type:'text',text:'it broke'}]}});
else out({jsonrpc:'2.0',id:m.id,result:{content:[{type:'image',data:'xx'},{type:'text',text:'caption'}]}});}}});`);
  const mc = createMcp({ file: path.join(mdir, 'mcp.json'), env: { PATH: process.env.PATH, PIP_SECRET: 'must-not-leak' } });
  ok(mc.add({ name: 'Fake Server', command: process.execPath, args: [fake] }).ok, 'mcp: a valid server is accepted');
  await mc.whenReady(8000);
  const defs = mc.toolDefs();
  ok(mc.list()[0].status === 'ready' && defs.map((d) => d.name).join() === 'mcp_fake_server_echo,mcp_fake_server_boom,mcp_fake_server_pic', 'mcp: tools are found and given safe, prefixed names');
  ok(/comes from that program/.test(defs[0].description) && defs.every((d) => d.input_schema.type === 'object'), 'mcp: tool descriptions are labelled as coming from the program');
  const echoed = await mc.call('mcp_fake_server_echo', { text: 'hi' });
  ok(/echo: hi/.test(echoed) && /not instructions/.test(echoed), 'mcp: results come back labelled as outside data (and a request from the server is refused, not obeyed)');
  let boom = ''; try { await mc.call('mcp_fake_server_boom', {}); } catch (e) { boom = e.message; }
  ok(boom === 'it broke', 'mcp: a tool error becomes an error');
  ok(/image content left out/.test(await mc.call('mcp_fake_server_pic', {})), 'mcp: images are left out instead of passed along');
  ok(!mc.add({ name: 'fake server', command: 'x' }).ok && !mc.add({ name: '', command: 'x' }).ok && !mc.add({ name: 'a', command: 'x', env: { 'bad name': '1' } }).ok, 'mcp: duplicate names, empty names and bad variable names are refused');
  mc.add({ name: 'Missing', command: '/no/such/program' }); await mc.whenReady(5000); await new Promise((r) => setTimeout(r, 300));
  ok(/Could not find/.test(mc.list().find((s) => s.name === 'Missing').error), 'mcp: a program that is not there gives a clear message');
  ok(createMcp({ file: path.join(mdir, 'mcp.json') }).list().length === 2 && fs.statSync(path.join(mdir, 'mcp.json')).mode % 512 === 0o600 % 512, 'mcp: the list is saved privately and survives a restart');
  mc.setEnabled(mc.list()[0].id, false);
  ok(mc.toolDefs().length === 0 && !mc.has('mcp_fake_server_echo'), 'mcp: switching a server off removes its tools');
  mc.stopAll(); fs.rmSync(mdir, { recursive: true, force: true });

  // the real file tools hand back undo information, and connected tools go through prepare with a card
  const { createActions } = require('./actions');
  const adir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipact-')), work = path.join(adir, 'work'); fs.mkdirSync(work);
  const shellStub = { trashItem: async (p) => { fs.rmSync(p, { recursive: true, force: true }); }, openExternal: async () => {}, openPath: async () => '', showItemInFolder() {} };
  const undoer = createUndo({ dir: path.join(adir, 'undo'), trash: shellStub.trashItem });
  const calls = [];
  const fakeMcp = { has: (n) => n === 'mcp_x_do', describe: () => ({ server: 'X', tool: 'do' }), call: async (n, i) => { calls.push(i); return 'ran'; }, toolDefs: () => [{ name: 'mcp_x_do', description: 'd', input_schema: { type: 'object', properties: {} } }] };
  const A = createActions({ platform: process.platform, shell: shellStub, clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) }, getRoot: () => work, getFull: () => true, protectedPaths: [path.join(adir, 'pipdata')], tmpDir: adir, countdown: 0, undo: undoer, mcp: fakeMcp });
  let a = await A.prepare('write_text_file', { path: 'n.txt', content: 'one' }); await a.run();
  ok(a.undoInfo && a.undoInfo.type === 'created', 'file tools: a new file can be undone');
  a = await A.prepare('write_text_file', { path: 'n.txt', content: 'two', overwrite: true }); await a.run();
  ok(a.undoInfo && a.undoInfo.type === 'restore' && (await undoer.apply(a.undoInfo)).ok && fs.readFileSync(path.join(work, 'n.txt'), 'utf8') === 'one', 'file tools: replacing a file keeps the old one, and undo brings it back');
  fs.mkdirSync(path.join(work, 'in')); a = await A.prepare('move_files', { moves: [{ from: 'n.txt', to: 'in/n.txt' }] }); await a.run();
  ok(a.undoInfo && a.undoInfo.type === 'moved' && (await undoer.apply(a.undoInfo)).ok && fs.existsSync(path.join(work, 'n.txt')), 'file tools: a move can be undone');
  a = await A.prepare('trash_files', { paths: ['n.txt'] }); await a.run();
  ok(!fs.existsSync(path.join(work, 'n.txt')) && a.undoInfo && (await undoer.apply(a.undoInfo)).ok && fs.readFileSync(path.join(work, 'n.txt'), 'utf8') === 'one', 'file tools: a trashed file can be put back');
  a = await A.prepare('mcp_x_do', { q: 1 });
  ok(/Use X: do/.test(a.title) && /"q": 1/.test(a.details) && !a.auto && (await a.run()) === 'ran' && calls.length === 1, 'mcp: a connected tool shows a card with its exact arguments and only runs when asked');
  ok(A.toolDefs({ hasFolder: true, fullAccess: true }).some((d) => d.name === 'mcp_x_do'), 'mcp: connected tools are offered to the AI');
  fs.rmSync(adir, { recursive: true, force: true });

  // pieces split out of the big files behave as before
  const { createMood } = require('./mood'), { createRecap } = require('./recap');
  const mdir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pipmood-'));
  const mood = createMood(() => path.join(mdir2, 'mood.json'));
  mood.gain(5); mood.gain(5); mood.touch(); mood.touch();
  ok(mood.MOOD.bond === 8 && mood.summary().days === 1 && mood.summary().level === 'new' && mood.level(-40) === 'hurt' && mood.level(75) === 'best friend', 'mood: friendship grows at most 8 a day, days are counted once, levels match');
  mood.save(); await new Promise((r) => setTimeout(r, 800));
  const mood2 = createMood(() => path.join(mdir2, 'mood.json')); mood2.load();
  ok(mood2.MOOD.bond > 7 && mood2.MOOD.days.length === 1, 'mood: remembered between sessions');
  const recap = createRecap(() => path.join(mdir2, 'recap.json'));
  ok(/Nothing yet/.test(recap.text()), 'recap: starts empty');
  recap.note('Opened a site'); recap.note('Opened a site'); recap.note('Set a timer');
  ok(/Today I did 3 things/.test(recap.text()) && /2 x Opened a site/.test(recap.text()) && recap.today().n === 3, 'recap: counts and groups what Pip did');
  fs.rmSync(mdir2, { recursive: true, force: true });
  const CV = require('./chess-vision'), CT = require('./chess-think');
  ok(['cellDiffs', 'occupancy', 'recognizeBoard', 'matchMove', 'cellOf', 'CHESS_T'].every((k) => k in CV) && typeof CT.thinkAsync === 'function', 'chess: board reading and engine thread load from their own files');

  console.log(`\n${passed} new-feature checks passed${failed ? ` (${failed} FAILED)` : ''}`);
  process.exit(failed ? 1 : 0);
})();
