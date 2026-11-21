// Headless check of Pip's flying: runs renderer.js against a fake screen, clock and WebGL
// (no window needed) and drives the same commands the chat sends (pet_do fly / go / land).
// Headless simulation of renderer.js: fake DOM, fake clock, no WebGL.
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, 'renderer.js'), 'utf8');

function stub(name) {
  const fn = function () { return stub(name + '()'); };
  const target = { style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, children: [], dataset: {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, insertBefore() {}, setAttribute() {}, focus() {}, remove() {},
    getBoundingClientRect() { return { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }; },
    getContext() { return null; }, querySelector() { return stub('q'); }, querySelectorAll() { return []; },
    value: '', textContent: '', innerHTML: '', checked: false, width: 0, height: 0, scrollHeight: 0, offsetHeight: 0 };
  return new Proxy(Object.assign(fn, target), { get(t, k) { return k in t ? t[k] : (k === Symbol.toPrimitive ? () => 0 : stub(name + '.' + String(k))); }, set(t, k, v) { t[k] = v; return true; } });
}

let NOW = 1000;
const draws = { pet: 0, branch: 0 };
function fakeGL(tag) {
  return new Proxy({}, { get(_, k) {
    if (k === 'drawElements') return () => { draws[tag]++; };
    if (k === 'getUniformLocation' || k === 'createShader' || k === 'createProgram' || k === 'createBuffer') return () => ({});
    if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return 1;
    return () => 0;
  } });
}
const rafQueue = [];
const handlers = {};
const pipApi = new Proxy({}, { get(_, k) {
  if (k === 'getSettings') return () => Promise.resolve({ petName: 'Pip', palette: 'classic', wander: false, quips: false, seenIntro: true, hasKey: true });
  if (typeof k === 'string' && k.startsWith('on')) return (cb) => { handlers[k] = cb; };
  return () => Promise.resolve({});
} });
const els = {};
const petCanvas = stub('petcanvas'); petCanvas.getContext = () => fakeGL('pet');
const canvasEvents = {};
petCanvas.addEventListener = (type, fn) => { canvasEvents[type] = fn; };
let branchCanvas = null;
const doc = { getElementById: (id) => els[id] || (els[id] = stub(id)), querySelector: () => petCanvas,
  createElement: () => { branchCanvas = stub('branchcanvas'); branchCanvas.getContext = () => fakeGL('branch'); return branchCanvas; }, body: stub('body'), addEventListener() {}, hasFocus: () => true };
const win = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, pip: pipApi, addEventListener() {}, requestAnimationFrame: (f) => { rafQueue.push(f); return 1; } };
const g = { window: win, document: doc, performance: { now: () => NOW }, requestAnimationFrame: win.requestAnimationFrame, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, console };
const gt = Object.assign({ GliderModel: require('./model.js') }, g);
const keys = Object.keys(g);
new Function(...keys, 'globalThis', src)(...keys.map((k) => g[k]), gt);
// NOTE: the Function args above mirror keys; globalThis passed last.

function step(ms) { const end = NOW + ms; while (NOW < end) { NOW += 30; const q = rafQueue.splice(0); q.forEach((f) => f(NOW)); } }
const S = { canvasEvents, step, handlers, win, els, draws, now: () => NOW, branch: () => branchCanvas };

const pos = () => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) rotate\(([-\d.]+)rad\)/.exec(S.els.pet.style.transform); return { x: +m[1], y: +m[2], rot: +m[3] }; };
const bshown = () => !!S.branch() && S.branch().style.display === 'block';
const ok = (n) => console.log('ok -', n);
const pet = (c) => S.handlers.onPet(c);

S.handlers.onSettings({ wander: false, quips: false });
S.step(600);
let p = pos();
assert.ok(p.y > 600, 'starts on the floor, y=' + p.y); ok('starts on the floor (y=' + p.y.toFixed(0) + ')');
const floorPos = { x: p.x, y: p.y };
assert.ok(S.draws.pet > 0); ok('pet drawn through the new stage (' + S.draws.pet + ' draw calls)');

// ---- fly to a spot: x .25, y .2 of a 1600x900 screen
pet({ action: 'fly', x: 0.25, y: 0.2 });
S.step(150); p = pos();
assert.ok(Math.abs(p.y - floorPos.y) < 2, 'crouches first, stays on the floor'); ok('crouches before take-off');
S.step(700); p = pos();
assert.ok(p.y < floorPos.y - 40, 'rising mid flight, y=' + p.y); ok('rising mid-flight (y=' + p.y.toFixed(0) + ')');
const tilts = [];
for (let i = 0; i < 40; i++) { S.step(60); tilts.push(pos().rot); }
S.step(3500); p = pos();
const sp = { x: 400 - 110, y: 180 - 26 - 176 };
assert.ok(Math.abs(p.x - sp.x) < 3 && Math.abs(p.y - Math.max(-20, sp.y)) < 3, 'landed at the target, got ' + JSON.stringify(p) + ' want ' + JSON.stringify(sp)); ok('landed beside the target (' + p.x.toFixed(0) + ',' + p.y.toFixed(0) + ')');
assert.ok(Math.max(...tilts.map(Math.abs)) > 0.05 && Math.max(...tilts.map(Math.abs)) <= 0.56); ok('tilts into the flight, max ' + Math.max(...tilts.map(Math.abs)).toFixed(2) + ' rad');
assert.ok(bshown() && S.draws.branch > 0); ok('branch grew and is drawn (' + S.draws.branch + ' draw calls)');
assert.strictEqual(S.els.sh.style.opacity, '0'); ok('floor shadow hidden while perched');
const where = pos();
S.step(10000); p = pos();
assert.ok(Math.abs(p.x - where.x) < 1 && Math.abs(p.y - where.y) < 3); ok('stays perched');

// ---- chat opening keeps him up
// (timeout path) after 40s with chat closed he glides home and the branch shrinks away
S.step(40000); p = pos();
assert.ok(Math.abs(p.y - floorPos.y) < 3, 'back on the floor, y=' + p.y); ok('glides home after the perch time');
S.step(1500);
assert.ok(!bshown(), 'branch gone'); ok('branch shrinks away');

// ---- come here: fly to the cursor
S.handlers.onCursor({ x: 900, y: 400 });
pet({ action: 'go', where: 'cursor' });
S.step(5000); p = pos();
assert.ok(Math.abs(p.x - (900 - 110)) < 3 && Math.abs(p.y - (400 - 26 - 176)) < 3, 'at cursor ' + JSON.stringify(p)); ok('"come here" flies to the cursor and perches (' + p.x.toFixed(0) + ',' + p.y.toFixed(0) + ')');
assert.ok(bshown());

// ---- new command during a perch moves to the next place; command mid-flight is queued
pet({ action: 'go', where: 'left' });
S.step(700);
pet({ action: 'go', where: 'right' });         // sent while flying -> runs after landing
S.step(9000); p = pos();
assert.ok(p.x > 1000, 'ended on the right side, x=' + p.x); ok('a command sent mid-flight waits, then runs (ended at x=' + p.x.toFixed(0) + ')');

// ---- target at floor level: glides down with no branch
pet({ action: 'land' });
S.step(5000); p = pos();
assert.ok(Math.abs(p.y - floorPos.y) < 3); ok('"land" glides back to the floor');
S.step(1500);
assert.ok(!bshown()); ok('no branch on the floor');

// ---- near the top edge: Pip sits beside the spot instead of above it
pet({ action: 'fly', x: 0.5, y: 0.02 });
S.step(5000); p = pos();
assert.ok(p.y >= -20 && p.x !== 800 - 110, 'sits beside, got ' + JSON.stringify(p)); ok('near the top edge he perches beside the spot (' + p.x.toFixed(0) + ',' + p.y.toFixed(0) + ')');
// ---- a fly command that arrives in the middle of a hop
pet({ action: 'land' }); S.step(5000);
pet({ action: 'hop', times: 3 });
S.step(250);
pet({ action: 'fly', x: 0.7, y: 0.3 });
S.step(7000); p = pos();
const want = { x: 1120 - 110, y: 270 - 26 - 176 };
assert.ok(Math.abs(p.x - want.x) < 3 && Math.abs(p.y - want.y) < 3, 'landed exactly after interrupting a hop, got ' + JSON.stringify(p) + ' want ' + JSON.stringify(want));
ok('flying out of a hop lands exactly on target');
// ---- dragging: pick him up (even from a perch), drop him in mid-air, he stays there on a new branch
const ev = (x, y) => ({ button: 0, clientX: x, clientY: y, pointerId: 1, preventDefault() {} });
pet({ action: 'land' }); S.step(5000);
pet({ action: 'fly', x: 0.3, y: 0.3 }); S.step(6000);
assert.ok(bshown()); const perched = pos();
const gx = perched.x + 110, gy = perched.y + 100;
S.canvasEvents.pointerdown(ev(gx, gy));
S.canvasEvents.pointermove(ev(gx + 20, gy + 20));
S.canvasEvents.pointermove(ev(gx + 400, gy + 150));
S.step(120); p = pos();
assert.ok(Math.abs(p.x - (perched.x + 400)) < 2 && Math.abs(p.y - (perched.y + 150)) < 2, 'follows the pointer, got ' + JSON.stringify(p)); ok('can be picked up off a perch and dragged');
S.step(900);
S.canvasEvents.pointerup(ev(gx + 400, gy + 150));
const dropped = pos();
S.step(4000); p = pos();
assert.ok(Math.abs(p.x - dropped.x) < 1 && Math.abs(p.y - dropped.y) < 1, 'stays where dropped'); ok('stays where he was dropped (' + p.x.toFixed(0) + ',' + p.y.toFixed(0) + ')');
assert.ok(bshown() && S.els.sh.style.opacity === '0'); ok('a branch grows under him where he was dropped');
S.step(95000); p = pos();
assert.ok(Math.abs(p.y - floorPos.y) < 3); ok('goes home on his own after a long while');
S.step(1500);
// dropped close to the floor: just hops down, no branch
S.canvasEvents.pointerdown(ev(p.x + 110, p.y + 100));
S.canvasEvents.pointermove(ev(p.x + 130, p.y + 100));
S.canvasEvents.pointermove(ev(p.x + 300, p.y + 80));
S.canvasEvents.pointerup(ev(p.x + 300, p.y + 80));
S.step(2500); p = pos();
assert.ok(Math.abs(p.y - floorPos.y) < 3 && !bshown()); ok('dropped near the floor he just settles down, no branch');
console.log('\nALL SIMULATION CHECKS PASSED');
