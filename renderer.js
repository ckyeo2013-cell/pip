/*
 * Pip desktop renderer: draws the 3D pet (tiny WebGL ellipsoid renderer),
 * makes it roam the desktop, and runs the chat / settings panel.
 */
(() => {
  'use strict';
  const chessLv = () => (settings.chessLevel === 'sloppy' ? 'sloppy' : 'sharp') + ':' + (Number(settings.chessStrength) || 7).toFixed(2) + (settings.chessBlunders >= 0 ? ':b' + Number(settings.chessBlunders).toFixed(2) : '') + (settings.chessBrilliants >= 0 ? ':f' + Number(settings.chessBrilliants).toFixed(2) : '');
  const Model = globalThis.GliderModel;
  const pip = window.pip;

  const SIZE = 220;
  const FEET = 0.8; // where the feet sit inside the 220px square (fraction of height)
  const settings = { petName: 'Pip', palette: 'classic', style: 'classic', wander: true, quips: true, seenIntro: false, hasKey: false };
  const area = { w: window.innerWidth, h: window.innerHeight };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const rand = (a, b) => a + Math.random() * (b - a);
  const sfx = (n) => { try { PipSfx.play(n); } catch (_) {} };

  const QUIPS = [
    'Sip some water?',
    'Quick stretch time!',
    'Roll your shoulders back~',
    'Look away from the screen for 20 seconds',
    'You are doing great',
    'Snack break?',
    'Psst... right-click me for the menu!',
    'Click me if you need help deciding something!',
    'Deep breath in... and out',
    'Posture check!',
  ];

  const $ = (id) => document.getElementById(id);
  const petEl = $('pet'), shEl = $('sh'), bubble = $('bubble'), panel = $('panel');
  const msgs = $('msgs'), inp = $('inp'), settingsEl = $('settings');
  const canvas = document.querySelector('canvas');

  // ---------------------------------------------------------------- WebGL
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const VS = `
    attribute vec3 aP;
    uniform vec3 uC; uniform vec3 uR; uniform mat3 uM; uniform float uScale; uniform float uShellLen;
    varying vec3 vN; varying vec3 vL; varying vec2 vK;
    void main() {
      vK = vec2((uR.x + uR.z) * 0.5, uR.y);
      vec3 n = normalize(uM * (aP / uR));
      vec3 wp = uM * (aP * uR) + uC + n * uShellLen;
      vN = n;
      vL = aP;
      gl_Position = vec4(wp.x * uScale, wp.y * uScale, -wp.z * 0.25 * uScale, 1.0);
    }`;
  // Fur: the base pass is shaded with a fine speckled grain; extra "shell" passes redraw each furry
  // part slightly bigger with most strands cut away, so the outline is soft and fuzzy instead of smooth.
  const FS = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec3 vN; varying vec3 vL; varying vec2 vK;
    uniform vec3 uColor; uniform float uSpec; uniform float uFur; uniform float uShell; uniform float uYarn;
    float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
    void main() {
      float strand = hash(floor(vL * 95.0));
      if (uShell > 0.0 && strand < 0.25 + uShell * 0.7) discard;
      vec3 n = normalize(vN);
      // tiny random tilt of the surface per strand: gives the rough, fluffy texture
      float g1 = hash(floor(vL * 70.0) + 3.1) - 0.5, g2 = hash(floor(vL * 70.0) + 7.7) - 0.5;
      n = normalize(n + vec3(g1, g2, 0.0) * 0.5 * uFur);
      vec3 L = normalize(vec3(-0.45, 0.75, 0.75));
      float d = smoothstep(0.08, 0.95, dot(n, L) * 0.5 + 0.5);
      vec3 shade = mix(uColor * 0.58 * vec3(0.92, 0.93, 1.05), uColor * 1.08, d);
      float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.2);
      shade += vec3(1.0, 0.93, 0.85) * rim * 0.18 * uFur;
      // salt-and-pepper speckle, two sizes
      float sp = hash(floor(vL * 48.0) + 11.3) - 0.5;
      shade *= 1.0 + (strand - 0.5) * 0.30 * uFur + sp * 0.22 * uFur;
      // strands darker near the skin, lighter at the tips
      shade *= mix(1.0, 0.6 + uShell * 0.4, step(0.001, uShell));
      if (uYarn > 0.5) {
        // knitted yarn: rows of little V-shaped stitches wrapped around each part, plus a bit of loose-fibre fuzz
        float cols = max(6.0, floor(max(vK.x, 0.1) * 6.2832 / 0.06));
        float u = atan(vL.z, vL.x) / 6.2832 * cols;
        float v = asin(clamp(vL.y, -1.0, 1.0)) * max(vK.y, 0.1) / 0.06;
        float fx = fract(u), s = fract(v + 0.45 * abs(fx * 2.0 - 1.0));
        float lum = 0.7 + 0.42 * sin(s * 3.14159) * (0.8 + 0.2 * sin(fx * 3.14159));
        lum *= 0.88 + 0.12 * smoothstep(0.0, 0.18, fx) * smoothstep(1.0, 0.82, fx);
        lum *= 0.94 + 0.12 * hash(floor(vec3(u, v, 1.0)) + 5.0);
        shade *= lum;
      }
      vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
      shade += vec3(pow(max(dot(n, H), 0.0), 60.0) * uSpec);
      gl_FragColor = vec4(shade, 1.0);
    }`;

  const SHELLS = 4, FUR_LEN = 0.05; // fuzz layers and how far the longest strands stick out (model units)

  // One tiny ellipsoid renderer per canvas (Pip has one, the branch he perches on has another).
  function createStage(cv) {
    cv.width = cv.height = Math.round(SIZE * dpr);
    const g = cv.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!g) return null;
    const U = {};
    const sh = (type, src) => { const x = g.createShader(type); g.shaderSource(x, src); g.compileShader(x); return x; };
    const prog = g.createProgram();
    g.attachShader(prog, sh(g.VERTEX_SHADER, VS));
    g.attachShader(prog, sh(g.FRAGMENT_SHADER, FS));
    g.linkProgram(prog);
    g.useProgram(prog);
    for (const n of ['C', 'R', 'M', 'Color', 'Spec', 'Fur', 'Scale', 'Shell', 'ShellLen', 'Yarn']) U[n] = g.getUniformLocation(prog, 'u' + n);

    const lat = 20, lon = 28, pos = [], idx = [];
    for (let i = 0; i <= lat; i++) {
      const th = (i * Math.PI) / lat;
      for (let j = 0; j <= lon; j++) {
        const ph = (j * 2 * Math.PI) / lon;
        pos.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      }
    }
    for (let i = 0; i < lat; i++)
      for (let j = 0; j < lon; j++) {
        const a = i * (lon + 1) + j, b = a + lon + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const count = idx.length;
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(pos), g.STATIC_DRAW);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), g.STATIC_DRAW);
    const loc = g.getAttribLocation(prog, 'aP');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
    g.enable(g.DEPTH_TEST);
    g.depthFunc(g.LEQUAL);
    g.clearColor(0, 0, 0, 0);
    g.viewport(0, 0, cv.width, cv.height);
    g.uniform1f(U.Scale, 1 / 1.8);
    return {
      draw(parts) {
        g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
        const pass = (list, shell, len) => {
          g.uniform1f(U.Shell, shell);
          g.uniform1f(U.ShellLen, len);
          for (const p of list) {
            g.uniform3fv(U.C, p.c);
            g.uniform3fv(U.R, p.r);
            g.uniformMatrix3fv(U.M, false, p.M);
            g.uniform3fv(U.Color, p.color);
            g.uniform1f(U.Spec, p.spec);
            g.uniform1f(U.Fur, p.fur);
            g.uniform1f(U.Yarn, p.yarn || 0);
            g.drawElements(g.TRIANGLES, count, g.UNSIGNED_SHORT, 0);
          }
        };
        pass(parts, 0, 0);
        const furry = parts.filter((p) => p.fur >= 0.8 && p.shell !== false);
        for (let k = 1; k <= SHELLS; k++) pass(furry, k / SHELLS, (k / SHELLS) * FUR_LEN);
      },
    };
  }

  const petStage = createStage(canvas);
  const gl = petStage; // truthy when WebGL works
  if (!petStage) {
    canvas.style.display = 'none';
    $('fallback').style.display = 'block';
  }
  function draw(parts) { petStage.draw(parts); }

  // "Drawn by me": the player's own pixel frames replace the 3D model; frames cross-fade as the pose changes
  const DS = ['idle', 'glide', 'happy', 'sleepy', 'thinking'];
  const dcv = document.createElement('canvas'); dcv.id = 'drawn'; dcv.width = dcv.height = 220; canvas.after(dcv);
  let dImgs = {}, dRef = null, dOn = false;
  function drawnReady() {
    if (settings.drawn !== dRef) { dRef = settings.drawn; dImgs = {}; for (const k of DS) if (dRef && typeof dRef[k] === 'string') { const im = new Image(); im.src = dRef[k]; dImgs[k] = im; } }
    return !!(dImgs.idle && dImgs.idle.naturalWidth);
  }
  function setDrawnMode(on) { if (on === dOn) return; dOn = on; canvas.style.visibility = on ? 'hidden' : 'visible'; dcv.style.display = on ? 'block' : 'none'; }
  function drawSprite(now, dz) {
    setDrawnMode(true);
    const c = dcv.getContext('2d'), g = clamp(dz.glide, 0, 1), cr = clamp(dz.crouch, 0, 1);
    const w = { glide: g, happy: st.happy, sleepy: st.sleepy || 0, thinking: st.thinking };
    c.clearRect(0, 0, 220, 220); c.imageSmoothingEnabled = false; c.save();
    c.translate(110, 120 + Math.sin(now / 450) * 2 * (1 - g)); c.scale((clamp(st.bodyYaw * 2.5, -1, 1) || 1) * (1 + 0.08 * cr), 1 - 0.12 * cr);
    for (const k of DS) {
      const im = dImgs[k]; if (!im || !im.naturalWidth) continue;
      const a = k === 'idle' ? 1 : clamp(w[k], 0, 1); if (a < 0.01) continue;
      c.globalAlpha = a; c.drawImage(im, -110, -110, 220, 220);
    }
    c.restore();
  }

  // The branch Pip perches on: built from the same ellipsoids, drawn in its own canvas
  // that sits exactly under Pip's canvas (same size and scale), so his feet meet the wood.
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const rotZm = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const BRANCH_TOP = -1.08; // model-space height of the wood's top surface = Pip's feet
  function branchParts(g, t) {
    const parts = [];
    const WOOD = [[0.4, 0.29, 0.19], [0.33, 0.23, 0.15]];
    const LEAF = [[0.45, 0.7, 0.38], [0.36, 0.6, 0.33]];
    const X0 = -1.55, X1 = 1.5, N = 16;
    const rad = (s) => lerp(0.13, 0.05, s);
    const yc = (s) => BRANCH_TOP - rad(s) - 0.25 * (s - 0.508);
    const xAt = (s) => lerp(X0, X1, s);
    const kAt = (d, w = 0.2) => easeOut(clamp((g - d) / w, 0, 1));
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1), k = kAt(s * 0.8);
      if (k > 0.01) parts.push({ c: [xAt(s), yc(s), 0], r: [0.15 * k, rad(s) * k, rad(s) * k * 0.95], M: I3, color: WOOD[i % 2], spec: 0, fur: 0.5 });
    }
    const twigs = [[0.16, 0.95, 0.55, -0.1], [0.3, 1.25, 0.5, -0.15], [0.72, 0.75, 0.6, -0.1], [0.9, -0.45, 0.4, 0]];
    let li = 0;
    const leaf = (x, y, z, ang, d, size) => {
      const k = kAt(d, 0.22);
      if (k < 0.01) { li++; return; }
      const pop = k * (1 + 0.2 * Math.sin(k * Math.PI)) * size;
      parts.push({ c: [x, y, z], r: [0.19 * pop, 0.085 * pop, 0.035 * pop], M: rotZm(ang + Math.sin(t * 1.4 + li) * 0.12 * k),
        color: LEAF[li % 2], spec: 0.1, fur: 0.4 });
      li++;
    };
    for (const [s, a, len, z] of twigs) {
      const bx = xAt(s), by = yc(s) + rad(s) * 0.6, d = s * 0.8 + 0.05, k = kAt(d, 0.2);
      if (k > 0.01) {
        for (let j = 0; j < 3; j++) {
          const f = (j + 0.5) / 3;
          parts.push({ c: [bx + Math.cos(a) * len * f * k, by + Math.sin(a) * len * f * k, z], r: [(len / 6) * 1.3 * k, 0.03 * k, 0.03 * k], M: rotZm(a), color: WOOD[1], spec: 0, fur: 0.5 });
        }
      }
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      leaf(ex, ey, z - 0.05, a + 0.3, d + 0.12, 1);
      leaf(ex - 0.12, ey - 0.04, z + 0.04, a - 0.5, d + 0.16, 0.85);
      leaf(ex + 0.1, ey + 0.1, z - 0.1, a + 0.9, d + 0.2, 0.8);
    }
    for (let j = 0; j < 5; j++) leaf(X0 + 0.1 + j * 0.07, BRANCH_TOP + 0.05 + (j % 3) * 0.1, -0.15 + (j % 2) * 0.2, 0.6 + j * 0.5, 0.05 + j * 0.03, 1.2);
    for (let j = 0; j < 3; j++) leaf(X1 - 0.05 - j * 0.12, BRANCH_TOP - 0.08 + j * 0.06, -0.1 + j * 0.1, 0.2 - j * 0.7, 0.85 + j * 0.03, 1);
    return parts;
  }
  let branchEl = null, branchStage = null;
  function ensureBranchStage() {
    if (branchStage || !petStage) return branchStage;
    branchEl = document.createElement('canvas');
    branchEl.id = 'branch';
    document.body.insertBefore(branchEl, petEl);
    branchStage = createStage(branchEl);
    return branchStage;
  }

  // ---------------------------------------------------------------- state
  const floorY = () => area.h - SIZE * FEET - 6;
  const st = {
    x: area.w - SIZE - 40,
    y: floorY(),
    face: -1,
    bodyYaw: -0.45,
    lookYaw: 0,
    lookPitch: 0,
    hop: null,
    glide: 0,
    crouch: 0,    // squat before take-off and after landing
    tilt: 0,      // body tilt (radians) while flying
    flight: null, // a glide up to (or down from) a perch
    perch: null,  // set while Pip sits on his branch
    landT: 0,
    pendingCmd: null,
    hopY: 0,
    happy: 0,
    thinking: 0,
    nextBlink: performance.now() + 2500,
    blinkT: -1,
    nextHop: performance.now() + rand(6000, 12000),
    nextQuip: performance.now() + rand(40000, 80000),
    dragging: false,
    chatOpen: false,
    queue: [],   // hops and moves Pip still has to do (from chat commands)
    stay: false, // chat told Pip to stay put
    away: null,  // sad: {phase:'sulk'|'out'|'gone'|'in', t0, dir, off}
    ax: 0,       // horizontal offset while walking off / back on
    nextIdle: performance.now() + rand(20000, 40000), napUntil: 0, shake: 0, dragVx: 0, dragTiltCur: 0, ragRot: 0, rag: null,
  };
  const mouse = { x: area.w / 2, y: area.h / 2 };
  let thinkingFlag = false;
  let happyUntil = 0;
  let alertUntil = 0;
  const quiet = () => !!settings.quiet || !!st.inCall;
  let bubbleTimer = 0;
  let interactive = false;
  let panelPos = null;  // where the user dragged the chat window to (null = sit next to Pip)
  let panelDrag = null; // set while the chat window is being dragged
  let lastPanel = { left: 0, top: 0 };

  function clampX() { st.x = clamp(st.x, -30, Math.max(-30, area.w - SIZE + 30)); }

  function startHop(tx, h, ty) {
    sfx('hop');
    ty = ty === undefined ? st.y : ty;
    const dx = Math.abs(tx - st.x), dy = Math.abs(ty - st.y);
    const dist = Math.hypot(dx, dy);
    st.hop = {
      t0: performance.now(), dur: 550 + dist * 1.2,
      fx: st.x, tx, fy: st.y, ty, h, far: dist > 70,
    };
    if (dx > 10) st.face = tx > st.x ? 1 : -1;
  }

  // ---------------------------------------------------------------- flying and perching
  let br = null;   // the branch that is on screen: { x, y, g, state: 'grow' | 'hold' | 'shrink' }
  let pend = null; // a branch about to grow at the landing spot: { x, y, t0 }
  const minPetX = () => 8, maxPetX = () => Math.max(8, area.w - SIZE - 8);

  // Where Pip should sit to be "at" a point on the screen: on a branch just above it,
  // or beside it when the point is too close to the top of the screen.
  function perchSpot(px, py) {
    let x = px - SIZE / 2;
    let feetY = py - 26;
    if (feetY - SIZE * 0.7 < 0) {
      feetY = Math.max(SIZE * 0.75, py + 20);
      x += px < area.w / 2 ? 150 : -150;
    }
    return { x, y: feetY - SIZE * FEET };
  }

  function leavePerch() {
    st.perch = null;
    pend = null;
    if (br && br.state !== 'shrink') br.state = 'shrink';
  }

  // Glide to (tx, ty) (top-left of Pip's square). With opts.branch a branch grows there to land on.
  function startFlight(tx, ty, opts) {
    opts = opts || {};
    const now = performance.now();
    tx = clamp(tx, minPetX(), maxPetX());
    ty = clamp(ty, -20, floorY());
    const dx = tx - st.x, dy = ty - st.y, dist = Math.hypot(dx, dy);
    if (dist < 40) { cheer(900); return false; }
    leavePerch();
    const lift = opts.branch ? clamp(dist * 0.32, 80, 300) : clamp(dist * 0.12, 30, 120);
    const crouch = 260;
    const dur = clamp(900 + dist * 1.1, 1300, 3000);
    st.flight = {
      t0: now, crouch, dur, fx: st.x, fy: st.y, tx, ty,
      cx: st.x + dx * 0.3, cy: Math.max(-30, Math.min(st.y, ty) - lift),
      branch: !!opts.branch, face: dx >= 0 ? 1 : -1,
    };
    if (Math.abs(dx) > 10) st.face = st.flight.face;
    st.hop = null;
    st.hopY = 0; // a hop in progress must not leave its height behind
    st.queue = [];
    // the branch finishes growing about when Pip arrives
    if (opts.branch) pend = { x: tx, y: ty, t0: now + Math.max(650, crouch + dur * 0.85 - 1100) };
    return true;
  }

  function updateFlight(now) {
    let fp = 0;
    const F = st.flight;
    if (F) {
      const el = now - F.t0;
      if (el < F.crouch) {
        st.crouch = Math.sin((el / F.crouch) * Math.PI / 2) * 0.9;
        st.glide = 0;
      } else {
        const p = Math.min(1, (el - F.crouch) / F.dur);
        fp = p;
        const sm = p * p * (3 - 2 * p), u = 1 - sm;
        st.x = u * u * F.fx + 2 * u * sm * F.cx + sm * sm * F.tx;
        st.y = u * u * F.fy + 2 * u * sm * F.cy + sm * sm * F.ty;
        const vx = 2 * u * (F.cx - F.fx) + 2 * sm * (F.tx - F.cx);
        const vy = 2 * u * (F.cy - F.fy) + 2 * sm * (F.ty - F.cy);
        st.tiltTarget = clamp(F.face * Math.atan2(vy, Math.abs(vx) + 1e-3) * 0.5, -0.55, 0.55) * (1 - clamp((p - 0.75) / 0.25, 0, 1));
        st.glide = p < 0.15 ? p / 0.15 : p < 0.8 ? 1 : 1 - ((p - 0.8) / 0.2) * 0.85;
        st.crouch = p < 0.12 ? 0.9 * (1 - p / 0.12) : 0;
        if (p >= 1) {
          st.x = F.tx;
          st.y = F.ty;
          st.flight = null;
          st.glide = 0.15;
          st.landT = now; sfx('land');
          st.tiltTarget = 0;
          if (F.branch) st.perch = { until: now + 40000 };
          cheer(1100);
          if (st.pendingCmd) { const c = st.pendingCmd; st.pendingCmd = null; petCommand(c); }
        }
      }
    } else {
      st.tiltTarget = 0;
      if (!st.hop && !st.dragging) st.glide *= 0.85;
      const lt = (now - st.landT) / 320;
      st.crouch = lt < 1 ? Math.sin(Math.min(1, lt * 2) * Math.PI) * (1 - lt) * 0.6 : st.crouch * 0.8;
    }
    st.tilt += ((st.tiltTarget || 0) - st.tilt) * 0.2;
    return fp;
  }

  let lastBranchT = 0;
  function updateBranch(now) {
    const dt = clamp(now - (lastBranchT || now), 0, 100);
    lastBranchT = now;
    if (br && br.state === 'shrink') { br.g -= dt / 500; if (br.g <= 0) br = null; }
    if (!br && pend && now >= pend.t0) { br = { x: pend.x, y: pend.y, g: 0, state: 'grow' }; pend = null; }
    if (br && br.state === 'grow') { br.g = Math.min(1, br.g + dt / 1100); if (br.g >= 1) br.state = 'hold'; }
    if (br && ensureBranchStage()) {
      branchEl.style.display = 'block';
      branchEl.style.transform = `translate(${br.x.toFixed(1)}px, ${br.y.toFixed(1)}px)`;
      branchStage.draw(branchParts(br.g, now / 1000));
    } else if (branchEl) {
      branchEl.style.display = 'none';
    }
  }

  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
  const noEmoji = (t) => String(t == null ? '' : t).replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?])/g, '$1').trim();
  function showBubble(text, ms = 5000) {
    text = noEmoji(text);
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
  }
  function cheer(ms = 1300) { happyUntil = performance.now() + ms; }

  // ---------------------------------------------------------------- dance moves
  // A dance is a timeline of moves layered on top of whatever Pip is doing (hopping, perched...).
  // Everything runs on a beat (about 115 bpm): each move lasts whole beats and starts and ends in a neutral pose,
  // so moves chain without popping. Jumps squash and stretch on the beat, arms move one at a time,
  // the tail whips and the head nods in time.
  const BEAT = 520; // ms
  const TAU = Math.PI * 2;
  const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const jump = (f, h) => -4 * f * (1 - f) * h;   // one beat-long hop, a parabola
  const squash = (f) => Math.max(f < 0.2 ? (1 - f / 0.2) * 0.75 : 0, f > 0.82 ? ((f - 0.82) / 0.18) * 0.55 : 0); // crouch on landing and before take-off
  // fn(z, c): c = { q: 0..1 through the move, b: beats so far, f: 0..1 through this beat, n: beat number, s(k): sine with k cycles per move, arc: 0..1..0 }
  const MOVES = {
    sway:      { beats: 4, fn(z, c) { z.yaw = c.s(2) * 0.5; z.tilt = c.s(2) * 0.2; z.x = c.s(2) * 12; z.crouch = 0.22 * Math.abs(c.s(2)); z.tail = c.s(2) * 0.9; z.nod = c.s(4) * 0.08; } },
    bounce:    { beats: 2, fn(z, c) { z.hop = jump(c.f, 34); z.crouch = squash(c.f); z.armL = z.armR = Math.sin(Math.PI * c.f) * 0.45; z.tail = -Math.sin(TAU * c.f) * 0.5; z.tilt = c.s(1) * 0.05; z.nod = -0.12 * squash(c.f); } },
    pogo:      { beats: 4, fn(z, c) { z.hop = jump(c.f, 72); z.crouch = squash(c.f) * 1.1; z.armL = z.armR = Math.sin(Math.PI * c.f) * 0.9; z.yaw = c.s(1) * 0.2; z.tilt = c.s(2) * 0.04; z.tail = Math.sin(TAU * c.f) * 0.6; } },
    spin:      { beats: 2, full: true, fn(z, c) { z.yaw = sstep(c.q) * TAU; z.hop = -c.arc * 28; z.glide = c.arc * 0.9; z.tail = c.arc; z.crouch = c.q < 0.18 ? (1 - c.q / 0.18) * 0.5 : c.q > 0.85 ? ((c.q - 0.85) / 0.15) * 0.45 : 0; } },
    twirl:     { beats: 2, full: true, fn(z, c) { const a = Math.sin(Math.PI * clamp((c.q - 0.1) / 0.8, 0, 1)); z.yaw = -sstep(c.q) * TAU * 2; z.hop = -a * 60; z.glide = a * 0.95; z.tail = a; z.crouch = c.q < 0.15 ? (1 - c.q / 0.15) * 0.7 : c.q > 0.88 ? ((c.q - 0.88) / 0.12) * 0.6 : 0; } },
    wiggle:    { beats: 2, fn(z, c) { z.tilt = c.s(6) * 0.14; z.yaw = c.s(3) * 0.25; z.crouch = 0.3 * c.arc; z.tail = c.s(3) * 0.8; z.nod = c.s(6) * 0.05; } },
    shimmy:    { beats: 2, fn(z, c) { z.tilt = c.s(6) * 0.1; z.yaw = c.s(3) * 0.3; z.crouch = 0.35 * c.arc; z.armR = 0.35 + 0.3 * c.s(6); z.armL = 0.35 - 0.3 * c.s(6); z.tail = c.s(3) * 0.7; } },
    flourish:  { beats: 2, fn(z, c) { z.glide = c.arc; z.tilt = c.s(1) * 0.1; z.yaw = c.s(1) * 0.3; z.hop = -c.arc * 10; z.tail = c.arc * 0.6; z.nod = 0.15 * c.arc; } },
    disco:     { beats: 4, fn(z, c) { // point at the sky on one beat, the other arm on the next
      const h = Math.sin(Math.PI * c.f), R = c.n % 2 === 0 ? h : 0, L = c.n % 2 === 1 ? h : 0, side = R - L;
      z.armR = R * 0.95; z.armL = L * 0.95; z.tilt = -side * 0.16; z.yaw = side * 0.4; z.hop = -h * 10; z.crouch = 0.25 * (1 - h); z.tail = side * 0.9; z.x = side * 10; z.nod = 0.1 * h; } },
    floss:     { beats: 4, fn(z, c) { const a = c.s(4); z.glide = 0.5; z.armR = 0.4 * a; z.armL = -0.4 * a; z.yaw = -a * 0.7; z.tilt = -a * 0.2; z.crouch = 0.3; z.x = a * 10; z.tail = -a * 0.8; } },
    shuffle:   { beats: 4, fn(z, c) { z.x = c.s(2) * 38; z.yaw = c.s(2) * 0.55; z.hop = -Math.abs(c.s(4)) * 12; z.crouch = 0.2; z.armR = 0.25 + 0.25 * c.s(4); z.armL = 0.25 - 0.25 * c.s(4); z.tail = c.s(2) * 0.9; } },
    moonwalk:  { beats: 4, fn(z, c) { z.x = -st.face * 80 * Math.sin(Math.PI * c.q); z.yaw = 0.7 * st.face * Math.min(1, Math.sin(Math.PI * c.q) * 3); z.hop = -Math.abs(c.s(8)) * 5; z.tilt = c.s(8) * 0.05; z.armR = 0.2 + 0.15 * c.s(4); z.armL = 0.2 - 0.15 * c.s(4); z.crouch = 0.2; } },
    headbang:  { beats: 4, fn(z, c) { const e = Math.pow(1 - c.f, 2.5); z.nod = -0.55 * e; z.crouch = 0.45 * e; z.tilt = 0.1 * e * (c.n % 2 ? 1 : -1); z.yaw = c.s(2) * 0.18; z.tail = c.s(4); z.armL = z.armR = 0.25; } },
    dab:       { beats: 2, fn(z, c) { const p = sstep(c.q / 0.15) * (1 - sstep((c.q - 0.75) / 0.25)); z.armR = p; z.armL = p * 0.55; z.tilt = 0.3 * p; z.yaw = 0.8 * p; z.nod = -0.3 * p; z.crouch = 0.2 * p; } },
    six_seven: { beats: 4, fn(z, c) { z.armR = 0.5 + 0.5 * c.s(4); z.armL = 0.5 - 0.5 * c.s(4); z.hop = -Math.abs(c.s(4)) * 8; z.crouch = 0.15; z.tilt = c.s(4) * 0.1; z.nod = c.s(8) * 0.06; z.yaw = c.s(2) * 0.2; } },
    robot:     { beats: 4, fn(z, c) { const on = Math.floor(c.b) % 2 === 0; z.yaw = Math.round(c.s(2) * 2) / 2 * 0.7; z.tilt = Math.round(c.s(2) * 2) / 2 * 0.15; z.armR = on ? 0.9 : 0.1; z.armL = on ? 0.1 : 0.9; z.nod = (Math.floor(c.b * 2) % 2 ? 1 : -1) * 0.12; } },
    wave:      { beats: 4, fn(z, c) { const env = clamp(Math.min(c.q, 1 - c.q) / 0.12, 0, 1); z.armR = env * (0.7 + 0.25 * c.s(5)); z.yaw = 0.35 * env; z.tilt = 0.08 * env * c.s(1); z.nod = 0.1 * c.s(2); z.tail = c.s(3) * 0.5; } },
    backflip:  { beats: 4, full: true, fn(z, c) { // crouch, spring, one full turn in the air, land in a squat
      const u = clamp((c.q - 0.22) / 0.56, 0, 1), a = Math.sin(Math.PI * u);
      z.crouch = sstep(c.q / 0.2) * 0.85 * (1 - sstep((c.q - 0.2) / 0.07)) + sstep((c.q - 0.78) / 0.03) * (1 - sstep((c.q - 0.8) / 0.2)) * 0.8;
      z.hop = -a * 140; z.flip = -sstep(u) * TAU; z.glide = a * 0.5; z.tail = a; } },
    cartwheel: { beats: 4, full: true, fn(z, c) {
      const u = clamp((c.q - 0.2) / 0.6, 0, 1), a = Math.sin(Math.PI * u);
      z.crouch = sstep(c.q / 0.18) * 0.6 * (1 - sstep((c.q - 0.18) / 0.07)) + sstep((c.q - 0.78) / 0.03) * (1 - sstep((c.q - 0.8) / 0.2)) * 0.6;
      z.hop = -a * 60; z.tilt = sstep(u) * TAU * st.face; z.glide = a; z.tail = a * 0.7; } },
    ta_da:     { beats: 3, fn(z, c) { // the finale: jump, arms wide, hold, then a little bow
      const jumpF = clamp(c.b, 0, 1), open = sstep(c.q / 0.3) * (1 - sstep((c.q - 0.72) / 0.2)), bow = sstep((c.q - 0.72) / 0.12) * (1 - sstep((c.q - 0.9) / 0.1));
      z.hop = jump(jumpF, 50) * (c.b < 1 ? 1 : 0); z.crouch = (c.b < 1 ? squash(jumpF) : 0) + bow * 0.45; z.glide = open; z.nod = 0.2 * open - 0.45 * bow; z.tail = open * 0.8; z.tilt = 0.05 * Math.sin(c.b * 5) * open; } },
    groom:     { beats: 5, fn(z, c) { z.tilt = c.s(5) * 0.1; z.yaw = c.s(2.5) * 0.35; z.hop = -Math.abs(c.s(5)) * 3; z.glide = 0.25 + 0.15 * c.s(5); } },
    stretch:   { beats: 2.5, fn(z, c) { z.glide = c.arc; z.tilt = -0.12 * c.arc; z.nod = 0.3 * c.arc; z.crouch = 0.25 * (1 - c.arc); } },
  };
  // Pip invents an animation for any move he has no ready-made dance for (karate chop, kick, bow, salute...) from the words in its name.
  const IMPROV = [
    [/karate|chop|punch|hit|slap|smash|jab|strike|hadouken|fight/, 'Hi-YAH!', 2, (z, c, sd) => { const wind = sstep(c.q / 0.35), hit = sstep((c.q - 0.38) / 0.1), rec = sstep((c.q - 0.6) / 0.35), k = hit * (1 - rec); z.armR = wind * (1 - hit) - 0.35 * k; z.armL = 0.3 * wind * (1 - rec); z.tilt = sd * (-0.12 * wind * (1 - hit) + 0.22 * k); z.crouch = 0.25 * wind * (1 - hit) + 0.35 * k; z.x = sd * 26 * k; z.nod = -0.3 * k; z.yaw = sd * 0.35 * k; z.hop = -5 * k; z.tail = -sd * k; }],
    [/kick|karate kick|stomp/, 'Hyaa!', 2, (z, c, sd) => { const up = sstep(c.q / 0.3) * (1 - sstep((c.q - 0.55) / 0.3)); z.tilt = -sd * 0.3 * up; z.hop = -14 * up; z.armL = z.armR = 0.7 * up; z.x = sd * 18 * up; z.crouch = 0.2 * (1 - up); z.tail = sd * up; }],
    [/bow|curtsy|thank|respect|salute/, '', 2, (z, c) => { const p = sstep(c.q / 0.3) * (1 - sstep((c.q - 0.65) / 0.3)); z.nod = -0.55 * p; z.crouch = 0.4 * p; z.armR = 0.5 * p; z.armL = 0.5 * p; z.tilt = 0.05 * p; }],
    [/wave|hello|hi\b|greet|bye/, 'Hi!', 2, (z, c) => { const p = sstep(c.q / 0.15) * (1 - sstep((c.q - 0.85) / 0.15)); z.armR = (0.8 + 0.2 * Math.sin(c.q * TAU * 5)) * p; z.tilt = 0.06 * p; z.yaw = 0.2 * p; z.tail = Math.sin(c.q * TAU * 3) * 0.4 * p; }],
    [/flex|muscle|strong|lift|pump|hero/, 'Strong!', 2, (z, c) => { const p = sstep(c.q / 0.25) * (1 - sstep((c.q - 0.75) / 0.25)); z.armL = z.armR = p; z.crouch = 0.2 * p; z.tilt = Math.sin(c.q * TAU * 3) * 0.05 * p; z.nod = 0.1 * p; z.hop = -2 * p; }],
    [/shiver|cold|freez|scared|tremble|shake/, 'Brrr!', 2, (z, c) => { const p = sstep(c.q / 0.15) * (1 - sstep((c.q - 0.85) / 0.15)); z.tilt = Math.sin(c.q * 120) * 0.07 * p; z.x = Math.sin(c.q * 110) * 3 * p; z.crouch = 0.35 * p; z.armL = z.armR = 0.3 * p; }],
    [/jump|leap|hop|bounce|boing/, '', 2, (z, c) => { z.hop = -Math.abs(Math.sin(c.q * Math.PI * 2)) * 40; z.crouch = Math.max(0, Math.cos(c.q * Math.PI * 4)) * 0.3; z.armL = z.armR = Math.abs(Math.sin(c.q * Math.PI * 2)) * 0.6; }],
    [/ninja|sneak|stealth|spy/, 'Shh...', 2, (z, c, sd) => { const p = sstep(c.q / 0.2) * (1 - sstep((c.q - 0.8) / 0.2)); z.crouch = 0.6 * p; z.x = sd * 50 * Math.sin(c.q * Math.PI) ; z.tilt = sd * 0.15 * p; z.armR = 0.5 * p; z.tail = sd * 0.5 * p; }],
  ];
  function improvise(text) {
    const w = String(text || '').toLowerCase(), hit = IMPROV.find(([re]) => re.test(w)), sd = st.face || 1;
    let beats = 2, fn, say = '';
    if (hit) { say = hit[1]; beats = hit[2]; fn = (z, c) => hit[3](z, c, sd); }
    else { // never heard of it: act it out with a lively made-up move, different for each phrase
      let h = 7; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const a = 1 + (h % 3), b = 1 + ((h >> 3) % 3), side = (h >> 6) & 1 ? 1 : -1; beats = 2;
      fn = (z, c) => { const p = sstep(c.q / 0.15) * (1 - sstep((c.q - 0.85) / 0.15)); z.armR = (0.5 + 0.5 * Math.sin(c.q * TAU * a)) * p; z.armL = (0.5 + 0.5 * Math.sin(c.q * TAU * b + 1.5)) * p; z.tilt = side * 0.18 * Math.sin(c.q * TAU * a) * p; z.yaw = side * 0.4 * Math.sin(c.q * TAU * b) * p; z.hop = -Math.abs(Math.sin(c.q * TAU * a)) * 12 * p; z.crouch = 0.2 * p; z.nod = 0.15 * Math.sin(c.q * TAU * b) * p; z.tail = Math.sin(c.q * TAU * a) * 0.6 * p; };
    }
    if (st.dance || st.rag || st.dragging) return;
    MOVES._imp = { beats, fn };
    sfx('dance'); if (say) showBubble(say, 1800);
    st.dance = { t0: performance.now(), segs: [{ move: '_imp', t0: 0, dur: beats * BEAT }], total: beats * BEAT, lastSeg: -1 };
    cheer(beats * BEAT + 600);
  }
  const DANCE_ALL = Object.keys(MOVES).filter((k) => k !== '_imp');
  const DANCE_POOL = ['disco', 'floss', 'shuffle', 'pogo', 'six_seven', 'headbang', 'moonwalk', 'robot', 'shimmy', 'spin', 'twirl', 'bounce', 'dab', 'wiggle', 'flourish'];
  const DANCE_BIG = ['backflip', 'cartwheel'];
  function buildDance(style) {
    let seq;
    if (style && style !== 'routine' && Object.prototype.hasOwnProperty.call(MOVES, style)) {
      // one move on repeat, about five seconds of it (two flips is plenty)
      const reps = style === 'groom' || style === 'stretch' ? 1 : DANCE_BIG.includes(style) ? 2 : Math.max(1, Math.round(10 / MOVES[style].beats));
      seq = new Array(reps).fill(style);
    } else {
      // a fresh routine every time: gentle opener, a few moves, maybe a flip, then the finale
      const mid = DANCE_POOL.slice().sort(() => Math.random() - 0.5).slice(0, 4);
      if (Math.random() < 0.6) mid.splice(2, 0, DANCE_BIG[Math.floor(Math.random() * DANCE_BIG.length)]);
      seq = [Math.random() < 0.5 ? 'sway' : 'wave'].concat(mid, ['ta_da']);
    }
    let t = 0;
    const segs = seq.map((move) => { const dur = MOVES[move].beats * BEAT, sg = { move, t0: t, dur }; t += dur; return sg; });
    return { segs, total: t };
  }
  function startDance(style) {
    const built = buildDance(style);
    sfx('dance');
    st.dance = { t0: performance.now(), segs: built.segs, total: built.total, lastSeg: -1 };
  }
  function danceOffsets(now) {
    const z = { yaw: 0, tilt: 0, hop: 0, glide: 0, x: 0, flip: 0, crouch: 0, nod: 0, armL: 0, armR: 0, tail: 0 };
    const d = st.dance;
    if (!d) return z;
    const e = now - d.t0;
    if (e >= d.total || st.dragging || st.away || st.rag) { st.dance = null; return z; }
    let i = 0;
    while (i < d.segs.length - 1 && e >= d.segs[i + 1].t0) i++;
    const sg = d.segs[i], mv = MOVES[sg.move], q = clamp((e - sg.t0) / sg.dur, 0, 1);
    if (d.lastSeg !== i) { // a new move starts
      d.lastSeg = i;
      if (sg.move === 'six_seven') showBubble('6... 7!', 2400);
      else if (sg.move === 'ta_da') { sfx('proud'); cheer(2200); }
      else if (sg.move === 'backflip' || sg.move === 'cartwheel') sfx('hop');
    }
    const b = q * mv.beats, f = b - Math.floor(b), n = Math.floor(b);
    mv.fn(z, { q, b, f, n, arc: Math.sin(Math.PI * q), s: (k) => Math.sin(q * TAU * k) });
    const w = mv.full ? 1 : clamp(Math.min(e, d.total - e) / 350, 0, 1); // ease the whole dance in and out
    if (w < 1) for (const k of Object.keys(z)) z[k] *= w;
    happyUntil = Math.max(happyUntil, now + 250); // ears wiggle and he waves while dancing
    return z;
  }

  // ---------------------------------------------------------------- ragdoll: fling him and he really tumbles
  // A small rigid-body sim: gravity, air drag, bounces that trade spin for sliding (and back), rolling and skidding.
  // After a moment of panic a sugar glider does what a sugar glider does: he spreads his membrane, rights himself,
  // swoops down in a glide and lands with a skid. Hard, repeated knocks keep him tumbling (and dizzy).
  const RAG_G = 2400;         // gravity, px/s^2
  const RAG_R = SIZE * 0.26;  // radius that spin and rolling are measured with, px
  const wrapPi = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
  function startRag(vx, vy) {
    leavePerch(); st.flight = null; st.hop = null; st.hopY = 0; st.queue = []; st.dance = null; st.pendingCmd = null; st.napUntil = 0;
    const peak = Math.hypot(vx, vy);
    st.rag = {
      vx, vy, rot: 0, vrot: clamp(vx / 200, -14, 14) + (Math.random() - 0.5) * 4,
      hits: 0, peak, rest: 0, t: 0, mode: 'tumble', // tumble -> glide -> skid
      glideAt: 0.28 + 0.5 * Math.min(1, peak / 4000), // harder throws panic for longer
      glideAmt: 0, glided: false, landed: false, spin: 0,
    };
    setEmotion('scared', 3000);
  }
  // Bounce off one surface ('floor' | 'ceil' | 'left' | 'right'). The surface pushes back along its normal and also
  // grips: the sliding at the contact point is turned into spin and the other way round. Returns the impact speed.
  function ragBounce(r, kind) {
    const floor = kind === 'floor', horiz = floor || kind === 'ceil';
    const n = floor ? -1 : kind === 'ceil' ? 1 : kind === 'left' ? 1 : -1; // which way the surface pushes
    const into = -(horiz ? r.vy : r.vx) * n;
    if (into <= 0) return 0;
    const gl = r.mode === 'glide';
    const e = gl ? 0.3 : into > 900 ? 0.52 : into > 450 ? 0.42 : 0.3;
    const a = clamp(0.22 + into / 3600, 0.22, 0.65) * (gl ? 0.4 : 1);
    const sig = floor || kind === 'left' ? -1 : 1;
    const slip = (horiz ? r.vx : r.vy) + sig * r.vrot * RAG_R; // how fast the touching point slides along the surface
    if (horiz) r.vx -= a * slip / 3; else r.vy -= a * slip / 3;
    r.vrot -= sig * 2 * a * slip / (3 * RAG_R);
    if (horiz) r.vy = n * into * e; else r.vx = n * into * e;
    return into;
  }
  function ragSub(r, h, now) {
    const fl = floorY(), lo = minPetX(), hi = maxPetX();
    r.t += h;
    if (r.mode === 'tumble' && r.t > r.glideAt + 0.35 * r.hits && fl - st.y > 110) { // snap out of it: membrane open (every hard knock delays it)
      r.mode = 'glide'; r.glided = true; r.rot = wrapPi(r.rot);
      setEmotion('happy', 2400);
      if (!quiet() && Math.random() < 0.5) showBubble(['Wheee!', 'I can fly!', 'Gliding!'][Math.floor(Math.random() * 3)], 1800);
    }
    if (r.mode === 'glide') {
      const lift = r.vy > 0 ? clamp(Math.abs(r.vx) * 2.4, 0, RAG_G * 0.93) : 0; // the membrane carries him once he is falling
      r.vy += (RAG_G - lift) * h;
      if (r.vy > 330) r.vy += (330 - r.vy) * Math.min(1, 16 * h); // and caps how fast he drops, even when he has almost no forward speed
      r.vx -= r.vx * (0.45 + Math.abs(r.vx) * 0.0004) * h;
      const face = r.vx >= 0 ? 1 : -1;
      if (Math.abs(r.vx) > 60) st.face = face;
      const tgt = clamp(face * Math.atan2(r.vy, Math.abs(r.vx) + 1) * 0.5, -0.55, 0.55) + Math.sin(now / 260) * 0.04;
      r.vrot += (55 * (tgt - r.rot) - 12.5 * r.vrot) * h; // righting reflex: a damped spring toward the glide pose
    } else if (r.mode === 'skid') {
      r.vx -= r.vx * 4.2 * h;
      r.vrot += (70 * (0 - r.rot) - 15 * r.vrot) * h;
      r.vy = 0;
    } else {
      r.vy += RAG_G * h;
      const dr = 0.1 + Math.hypot(r.vx, r.vy) * 0.00006; // air drag grows with speed
      r.vx -= r.vx * dr * h; r.vy -= r.vy * dr * h;
      if (st.y < fl - 2) r.vrot -= r.vrot * 0.25 * h;
    }
    r.vrot = clamp(r.vrot, -26, 26);
    st.x += r.vx * h; st.y += r.vy * h; r.rot += r.vrot * h;
    r.spin += Math.abs(r.vrot) * h;
    const hit = (into) => { if (into > 320) { r.hits++; st.landT = now; sfx('bounce'); } };
    if (st.x < lo) { st.x = lo; hit(ragBounce(r, 'left')); }
    if (st.x > hi) { st.x = hi; hit(ragBounce(r, 'right')); }
    if (st.y < 0) { st.y = 0; hit(ragBounce(r, 'ceil')); }
    if (st.y >= fl) {
      st.y = fl;
      if (r.mode === 'glide' && r.vy < 800) { // a proper landing: fold the membrane and skid
        r.mode = 'skid'; r.landed = true; r.vy = 0; st.landT = now; sfx('land'); cheer(1400);
      } else if (r.mode === 'skid') {
        r.vy = 0;
      } else if (r.vy > 250) {
        hit(ragBounce(r, 'floor'));
        if (r.mode === 'glide') r.mode = 'tumble'; // slammed into the floor too fast to land
      } else {
        // lying or rolling on the floor: spin and sliding settle into rolling, then rolling friction takes over
        r.vy = 0;
        const a = 1 - Math.exp(-14 * h), slip = r.vx - r.vrot * RAG_R;
        r.vx -= a * slip / 3; r.vrot += a * 2 * slip / (3 * RAG_R);
        const rr = Math.exp(-1.4 * h); r.vx *= rr; r.vrot *= rr;
        if (Math.abs(r.vx) < 150) { const k = Math.exp(-5 * h); r.vx *= k; r.vrot *= k; }
      }
    }
  }
  function endRag(r, now) {
    st.rag = null;
    st.ragRot = wrapPi(r.rot); // eases back to upright by itself
    st.nextHop = now + 7000; st.y = floorY(); clampX(); pip.savePos(st.x);
    if (r.landed) { setEmotion('happy', 2600); cheer(1800); } // stuck the landing
    else if (r.peak > 1800 || r.hits >= 3) setEmotion('dizzy', 6000);
    else setEmotion('surprised', 1800);
  }
  function ragStep(now, dt) {
    const r = st.rag;
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n; // small steps so a hard throw cannot skip through a wall
    for (let i = 0; i < n; i++) ragSub(r, h, now);
    r.glideAmt += ((r.mode === 'glide' ? 1 : 0) - r.glideAmt) * (1 - Math.exp(-7 * dt));
    const fl = floorY();
    const still = st.y >= fl - 1 && Math.hypot(r.vx, r.vy) < 40 && (r.mode === 'skid' ? Math.abs(r.rot) < 0.15 : Math.abs(r.vrot) < 0.6);
    r.rest = still ? r.rest + dt : 0;
    if (r.rest > (r.mode === 'skid' ? 0.2 : 0.5) || r.t > 14) endRag(r, now);
  }

  // ---------------------------------------------------------------- idle behaviours
  function pickIdle(now) {
    const r = Math.random();
    st.nextIdle = now + rand(25000, 70000);
    if (r < 0.25) setEmotion('yawn', 2800);
    else if (r < 0.5) startDance('groom');
    else if (r < 0.65) { startDance('stretch'); setEmotion('yawn', 2200); }
    else if (r < 0.85) {
      const tx = clamp(mouse.x - SIZE / 2, minPetX(), maxPetX());
      if (Math.abs(tx - st.x) > 120) { startHop(tx, 55); cheer(1200); } else setEmotion('happy', 2000);
    } else { setEmotion('sleepy', 14000); st.napUntil = now + 14000; showBubble('zzz...', 3000); }
  }

  // ---------------------------------------------------------------- emotions
  // Face/body targets per emotion; the current values ease toward them. Sad is separate (he walks off, see goSad).
  const EMO = {
    neutral: {},
    happy: { mouth: 1, happy: 0.9 },
    excited: { mouth: 1, mouthO: 0.5, happy: 0.5, wide: 0.5, alert: 1, bounce: 1 },
    mad: { brow: 1, mouth: -0.9, blush: 0.7, earBack: 1, shake: 0.05, stomp: 1 },
    scared: { wide: 1, mouth: -0.4, mouthO: 0.4, earBack: 0.8, brow: -0.6, shake: 0.06, crouch: 0.6 },
    surprised: { wide: 1, mouthO: 1, alert: 1, brow: -0.2, jump: 1 },
    love: { mouth: 1, blush: 1, happy: 0.8, sway: 1 },
    shy: { mouth: 0.2, blush: 1, sleepy: 0.25, brow: -0.3, tilt: 0.18 },
    embarrassed: { mouth: -0.2, blush: 1, wide: 0.2, brow: -0.4, shake: 0.02, tilt: 0.15 },
    bored: { mouth: -0.3, sleepy: 0.7, brow: -0.15, earBack: 0.3 },
    confused: { thinking: 0.9, brow: -0.4, mouth: -0.2, wide: 0.2, tilt: -0.12 },
    proud: { mouth: 1, alert: 1, happy: 0.25 },
    sleepy: { sleepy: 1, mouth: 0, mouthO: 0.5 },
    jealous: { brow: 0.6, mouth: -0.5, blush: 0.3, earBack: 0.4, tilt: 0.1 },
    disgusted: { brow: 0.4, mouth: -1, earBack: 0.5, tilt: -0.1 },
    nervous: { wide: 0.5, mouth: -0.2, earBack: 0.3, brow: -0.5, shake: 0.03 },
    dizzy: { wide: 0.5, mouth: -0.3, mouthO: 0.3, thinking: 0.9, wobble: 1 },
    yawn: { sleepy: 0.6, mouthO: 1 },
    lonely: { brow: -0.8, mouth: -0.7, sleepy: 0.5, earBack: 0.4 },
  };
  // resting face: shaped by how he feels about the user (saved between sessions, see mood memory in main.js)
  function moodBase() {
    const m = st.mood;
    if (!m || settings.moodMemory === false) return EMO.neutral;
    if (m.grudge) return { brow: 0.4, mouth: -0.45, earBack: 0.35 };
    if (m.level === 'hurt' || m.level === 'wary') return { brow: -0.4, mouth: -0.3, sleepy: 0.15 };
    if (m.level === 'close' || m.level === 'best friend') return { mouth: 0.55, happy: 0.1 };
    if (m.level === 'friendly') return { mouth: 0.25 };
    return EMO.neutral;
  }
  const EPRI = { neutral: 0, yawn: 0.5, bored: 1, sleepy: 1, happy: 1.5, confused: 1.5, proud: 2, excited: 2, surprised: 2, shy: 2, nervous: 2, dizzy: 2.5, embarrassed: 2.5, love: 3, jealous: 3, disgusted: 3, lonely: 3, mad: 4, scared: 4 };
  const refreshMood = () => pip.moodGet().then((m) => { st.mood = m; return m; }).catch(() => null);
  const EMO_KEYS = ['brow', 'mouth', 'mouthO', 'wide', 'blush', 'earBack', 'sleepy', 'happy', 'alert', 'thinking'];
  st.emo = { name: 'neutral', until: 0, cur: {} };
  function setEmotion(name, ms) {
    if (name === 'sad') { sfx('sad'); goSad(); return; }
    if (!EMO[name]) name = 'neutral';
    const nowE = performance.now(), cp = EPRI[st.emo.name] || 1;
    if (name !== 'neutral' && nowE < st.emo.until && st.emo.name !== name && (EPRI[name] || 1) < cp && nowE - st.emo.t0 < 12000) return; // a stronger feeling is not shoved aside by a weaker one
    if (name !== 'neutral') ms = (ms || 9000) * 1.7; // feelings linger longer
    if (name !== 'neutral' && st.emo.name !== name) sfx(name);
    if (st.away) comeBack();
    st.emo.name = name;
    st.emo.until = name === 'neutral' ? 0 : performance.now() + (ms || 9000);
    st.emo.t0 = performance.now();
    if (name === 'dizzy') { showBubble('Whoa... everything is spinning', 3500); st.nextHop = performance.now() + 7000; }
    if (name === 'excited') for (const dx of [50, -50]) st.queue.push({ tx: clamp(st.x + dx, minPetX(), maxPetX()), h: 50 });
    if (name === 'love') startDance('sway');
    if (name === 'surprised') st.queue.push({ tx: st.x, h: 80 });
    if (name === 'proud') startDance('flourish');
  }
  function emoStep(now) { // eases the face toward the emotion; returns body offsets
    const e = st.emo, T = (now < e.until ? EMO[e.name] : moodBase()) || {};
    if (now >= e.until && e.name !== 'neutral') e.name = 'neutral';
    const edt = Math.min(0.06, (now - (e.ln || now)) / 1000); e.ln = now;
    const er = now < e.until ? 7.9 : 2.2; // ease in quickly, let go of a feeling slowly
    for (const k of EMO_KEYS) e.cur[k] = (e.cur[k] || 0) + ((T[k] || 0) - (e.cur[k] || 0)) * (1 - Math.exp(-edt * er));
    const o = { tilt: 0, hop: 0, crouch: 0 };
    if (T.shake) o.tilt += Math.sin(now * 0.06) * T.shake;
    if (T.tilt) o.tilt += T.tilt * Math.min(1, (now - e.t0) / 400);
    if (T.stomp && !st.hop) o.hop = -Math.max(0, Math.sin(now / 160)) * 7;
    if (T.bounce && !st.hop) o.hop = -Math.abs(Math.sin(now / 150)) * 12;
    if (T.crouch) o.crouch = T.crouch;
    if (T.wobble) { o.tilt += Math.sin(now * 0.007) * 0.3; o.x = Math.sin(now * 0.0045) * 14; o.yaw = Math.sin(now * 0.009) * 0.9; }
    return o;
  }
  // quick reactions to what the user types, so he shows feelings even if the AI does not call the tool
  function reactToText(t) {
    const x = String(t).toLowerCase();
    const rude = /\b(stupid|idiot|dumb|shut up|hate you|useless|annoying|you suck)\b/.test(x);
    const sorry = /\b(sorry|my bad|i apologi[sz]e|forgive me)\b/.test(x);
    const nice = /\b(love you|you.?re (the )?best|so cute|adorable|thanks|thank you|great job|well done|good job|awesome|amazing)\b/.test(x);
    if (/\b(karate|chop|kick|punch|ninja|salute|flex|shiver|curtsy|high.?five)\b/.test(x) && /\b(do|show|give|try|can you|please)\b/.test(x)) setTimeout(() => improvise(x), 250); // act it out right away, whatever the AI says
    const hadGrudge = !!(st.mood && st.mood.grudge);
    pip.moodEvent(rude ? 'rude' : sorry ? 'apology' : nice ? 'kind' : 'chat');
    if (sorry && hadGrudge) { setEmotion('happy', 6000); showBubble('Okay. Apology accepted.', 4500); }
    setTimeout(refreshMood, 400);
    if (/\b(stupid|idiot|dumb|shut up|hate you|useless|annoying|you suck)\b/.test(x)) setEmotion('mad');
    else if (/\b(go away|leave me alone)\b/.test(x)) setEmotion('sad');
    else if (/\b(love you|i love|you.?re (the )?best|so cute|adorable)\b/.test(x)) setEmotion('love');
    else if (/\b(thanks|thank you|great job|well done|good job|awesome|amazing)\b/.test(x)) setEmotion('happy');
    else if (/\b(sorry|my bad|forgive me)\b/.test(x) && st.away) comeBack();
    else if (/\b(boo|scary|ghost|spider|snake)\b/.test(x)) setEmotion('scared');
    else if (/\b(omg|no way|wow|whoa)\b/.test(x)) setEmotion('surprised');
  }

  // ---------------------------------------------------------------- feelings: sad = walk off the screen until asked back
  function goSad() {
    if (st.away) return;
    st.dance = null; st.queue = []; st.stay = false;
    const now = performance.now();
    const dir = st.x + SIZE / 2 < area.w / 2 ? -1 : 1;
    const off = dir < 0 ? st.x + SIZE + 80 : area.w - st.x + 80;
    st.away = { phase: 'sulk', t0: now, dir, off };
    showBubble('...okay', 2400);
  }
  function comeBack(msg) {
    const a = st.away;
    if (!a || a.phase === 'in') return;
    a.phase = 'in'; a.t0 = performance.now(); sfx('happy');
    petEl.style.visibility = ''; shEl.style.visibility = '';
    st.face = -a.dir;
    cheer(2500); alertUntil = performance.now() + 3000;
    showBubble(msg || "I'm back!", 3500);
  }
  function awayStep(now) { // returns extra hop; updates st.ax, st.sadAmt
    const a = st.away;
    if (!a) { st.ax = 0; st.sadAmt = 0; return 0; }
    const e = now - a.t0;
    let hop = 0;
    st.sadAmt = 1;
    if (a.phase === 'sulk') { st.ax = 0; if (e > 2400) { a.phase = 'out'; a.t0 = now; st.face = a.dir; } }
    else if (a.phase === 'out') {
      const p = clamp(e / 2600, 0, 1);
      st.ax = a.dir * a.off * p * p;
      hop = -Math.abs(Math.sin(p * Math.PI * 5)) * 10;
      if (p >= 1) { a.phase = 'gone'; petEl.style.visibility = 'hidden'; shEl.style.visibility = 'hidden'; }
    } else if (a.phase === 'gone') { st.ax = a.dir * a.off; }
    else if (a.phase === 'in') {
      const p = clamp(e / 1600, 0, 1);
      st.ax = a.dir * a.off * (1 - p) * (1 - p);
      hop = -Math.abs(Math.sin(p * Math.PI * 4)) * 14;
      st.sadAmt = 1 - p;
      if (p >= 1) { st.away = null; st.ax = 0; st.sadAmt = 0; }
    }
    return hop;
  }

  // Commands from the chat (the pet_do tool): hop, dance, cheer, go/fly somewhere, land, stay, roam.
  function petCommand(c) {
    if (!c || typeof c !== 'object' || st.dragging) return;
    // glance: look at a spot on the screen (fractions) for a moment instead of at the cursor; never interrupts what he is doing
    if (c.action === 'look') {
      const lx = Number(c.x), ly = Number(c.y);
      if (Number.isFinite(lx) && Number.isFinite(ly)) st.gaze = { x: clamp(lx, 0, 1) * area.w, y: clamp(ly, 0, 1) * area.h, until: performance.now() + clamp(Number(c.ms) || 1200, 200, 6000) };
      return;
    }
    // already flying: do the new move once Pip has landed
    if (st.away && c.action !== 'sad' && !(c.action === 'feel' && c.emotion === 'sad')) { comeBack(); if (c.action === 'return') return; if (['hop', 'dance', 'cheer', 'feel'].includes(c.action)) setTimeout(() => petCommand(c), 1700); return; }
    if (c.action === 'feel') { setEmotion(c.emotion); return; }
    if (c.action === 'return') return;
    if (c.action === 'sad') {
      if (st.flight) { st.pendingCmd = c; return; }
      if (st.perch) { st.pendingCmd = c; startFlight(st.x, floorY(), { branch: false }); return; }
      goSad(); return;
    }
    if (st.flight && ['go', 'fly', 'land', 'hop', 'dance'].includes(c.action)) { st.pendingCmd = c; return; }
    const minX = minPetX(), maxX = maxPetX();
    const at = (x) => clamp(x, minX, maxX);
    const x0 = st.x;
    st.queue = [];
    // fly to a point on screen: perch on a branch just above it (or glide down if it is at floor level)
    const flyTo = (px, py) => {
      const sp = perchSpot(px, py);
      const onFloor = sp.y >= floorY() - 30;
      if (!startFlight(sp.x, onFloor ? floorY() : sp.y, { branch: !onFloor })) cheer(1200);
    };
    switch (c.action) {
      case 'hop':
        for (let i = 0; i < clamp(Math.round(Number(c.times)) || 1, 1, 5); i++) st.queue.push({ tx: x0, h: 70, cheer: 900 });
        break;
      case 'dance':
        // on a branch he dances in place; on the floor he hops side to side
        if (!c.style || c.style === 'routine') for (const dx of [70, -70, 70, -70, 0]) st.queue.push({ tx: st.perch ? x0 : at(x0 + dx), h: 55, cheer: 1500 });
        startDance(c.style);
        break;
      case 'act': improvise(c.move); break;
      case 'cheer':
        cheer(2500);
        break;
      case 'go': {
        const w = c.where;
        if (w === 'left') flyTo(area.w * 0.12, area.h * 0.45);
        else if (w === 'right') flyTo(area.w * 0.88, area.h * 0.45);
        else if (w === 'middle') flyTo(area.w * 0.5, area.h * 0.45);
        else flyTo(mouse.x, mouse.y);
        break;
      }
      case 'fly':
        flyTo(clamp(Number(c.x), 0, 1) * area.w, clamp(Number(c.y), 0, 1) * area.h);
        break;
      case 'land':
        if (!startFlight(st.x, floorY(), { branch: false })) cheer(1000);
        break;
      case 'stay':
        st.stay = true;
        break;
      case 'roam':
        st.stay = false;
        st.nextHop = performance.now() + 1500;
        break;
    }
  }

  // ---------------------------------------------------------------- loop
  let lastRender = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastRender < 28) return; // ~35 fps keeps the overlay light on the GPU
    lastRender = now;
    const dt = clamp((now - (st.lastT || now)) / 1000, 0, 0.06); st.lastT = now;
    st.shake *= Math.pow(0.5, dt);

    // wandering: hops, plus the occasional long glide across the desktop
    const fp = updateFlight(now);
    if (st.rag) ragStep(now, dt);
    if (st.perch && !st.flight && !st.stay) {
      if (st.chatOpen) st.perch.until = Math.max(st.perch.until, now + 15000);
      else if (now > st.perch.until) startFlight(st.x, floorY(), { branch: false }); // time to glide home
    }
    if (!st.away && !st.rag && now > st.napUntil && !st.hop && !st.flight && !st.perch && !st.dragging && !st.chatOpen && settings.wander && !quiet() && !st.stay && now > st.nextHop) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const big = Math.random() < 0.3;
      const span = big ? rand(500, Math.max(600, area.w * 0.5)) : rand(120, 380);
      let tx = clamp(st.x + dir * span, 8, area.w - SIZE - 8);
      if (Math.abs(tx - st.x) < 90) tx = clamp(st.x - dir * span, 8, area.w - SIZE - 8);
      if (Math.abs(tx - st.x) >= 90) startHop(tx, big ? 150 : 60);
      st.nextHop = now + rand(10000, 24000);
    }
    if (!st.away && !st.rag && !st.hop && !st.flight && !st.dragging && !st.chatOpen && !st.dance && !quiet() && settings.wander && !st.stay && now > st.nextIdle) pickIdle(now);
    if (!st.away && !st.rag && !st.hop && !st.flight && !st.dragging && st.queue.length) {
      const q = st.queue.shift();
      startHop(q.tx, q.h);
      if (q.cheer) cheer(q.cheer);
    }
    if (st.hop) {
      const p = (now - st.hop.t0) / st.hop.dur;
      if (p >= 1) {
        st.x = st.hop.tx;
        st.y = st.hop.ty;
        st.hop = null;
        st.hopY = 0;
        st.glide = 0;
      } else {
        const e = ease(p);
        st.x = lerp(st.hop.fx, st.hop.tx, e);
        st.y = lerp(st.hop.fy, st.hop.ty, e);
        st.hopY = -Math.sin(p * Math.PI) * st.hop.h;
        st.glide = st.hop.far ? Math.pow(Math.sin(p * Math.PI), 0.6) : 0;
      }
    }

    // look at the cursor anywhere on the desktop
    const cx = st.x + SIZE / 2, cy = st.y + st.hopY + SIZE * 0.4;
    const gz = st.gaze && now < st.gaze.until ? st.gaze : null; // a glance at the chessboard wins over the cursor for a moment
    const tYaw = clamp(((gz ? gz.x : mouse.x) - cx) / 400, -1, 1) * 0.75;
    const tPitch = clamp((cy - (gz ? gz.y : mouse.y)) / 400, -1, 1) * 0.4;
    const K = (r) => 1 - Math.exp(-dt * r); // frame-rate independent easing
    st.lookYaw += (tYaw - st.lookYaw) * K(7.6);
    st.lookPitch += (tPitch - st.lookPitch) * K(7.6);

    const flying = (st.flight && now - st.flight.t0 > st.flight.crouch && fp < 0.9) || (st.rag && st.rag.glideAmt > 0.5);
    const tBody = (st.hop && st.hop.far) || flying ? st.face * 1.15 : st.perch ? st.face * 0.3 : st.face * 0.45;
    st.bodyYaw += (tBody - st.bodyYaw) * K(9);

    let blink = 1;
    if (st.blinkT < 0 && now > st.nextBlink) st.blinkT = now;
    if (st.blinkT >= 0) {
      const k = (now - st.blinkT) / 150;
      if (k >= 1) { st.blinkT = -1; st.nextBlink = now + rand(2000, 5500); }
      else blink = Math.abs(k * 2 - 1);
    }

    st.happy += ((now < happyUntil ? 1 : 0) - st.happy) * K(7);
    const hr = new Date().getHours();
    st.sleepy = (st.sleepy || 0) + (((hr >= 23 || hr < 6) && !st.chatOpen && !st.dragging && now > alertUntil ? 0.85 : 0) - (st.sleepy || 0)) * K(1.2);
    st.alert = (st.alert || 0) + (((now < alertUntil || st.chatOpen) ? 1 : 0) - (st.alert || 0)) * K(9);
    st.thinking += ((thinkingFlag ? 1 : 0) - st.thinking) * K(6);

    const dz = danceOffsets(now);
    dz.hop += awayStep(now);
    if (st.away) { st.happy = 0; st.emo.until = 0; }
    const sadAmt = st.sadAmt || 0;
    const eo = emoStep(now), ec = st.emo.cur;
    dz.hop += eo.hop; dz.tilt += eo.tilt; dz.x += eo.x || 0; dz.yaw += eo.yaw || 0;
    if (st.dragging) st.dragTiltCur += (clamp(st.dragVx / 1600, -0.8, 0.8) - st.dragTiltCur) * 0.25; else st.dragTiltCur *= 0.85;
    dz.tilt += st.dragTiltCur;
    if (st.rag) {
      const r = st.rag, sp = Math.hypot(r.vx, r.vy);
      dz.tilt += r.rot;
      // panicking: arms flail with the speed; gliding: membrane wide open; landing: folded away again
      dz.glide += r.glideAmt * 0.95 + (1 - r.glideAmt) * (r.mode === 'skid' ? 0 : (0.5 + 0.5 * Math.sin(now / 55)) * clamp(sp / 1200, 0.3, 1));
      dz.tail += clamp(r.vrot * 0.08, -1.2, 1.2) * (1 - r.glideAmt);
    } else if (st.ragRot) { st.ragRot *= 0.92; if (Math.abs(st.ragRot) < 0.01) st.ragRot = 0; dz.tilt += st.ragRot; }
    { // smooth every pose channel so switching between hop, drag, dance, glide and emotion never snaps (flip stays raw: it is a full rotation)
      const sm = st.sm || (st.sm = {}), fl = dz.flip ? 3 : 1, S = (k, v, r) => { let n = sm[k] === undefined ? v : sm[k] + (v - sm[k]) * (1 - Math.exp(-dt * r * fl)); if (Math.abs(n) < 0.004 && Math.abs(v) < 0.004) n = 0; return (sm[k] = n); };
      dz.tilt = S('tilt', dz.tilt, 16); dz.x = S('x', dz.x, 16); dz.yaw = S('yaw', dz.yaw, 14); dz.nod = S('nod', dz.nod, 14);
      dz.glide = S('glide', st.glide + dz.glide, 10); dz.armL = S('armL', dz.armL, 16); dz.armR = S('armR', dz.armR, 16); dz.tail = S('tail', dz.tail, 14); dz.hop = S('hop', dz.hop, 35);
      dz.crouch = S('crouch', Math.max(dz.crouch, eo.crouch, st.crouch), 14); eo.crouch = 0; st.sCrouch = dz.crouch;
    }
    const sadBrow = sadAmt, sadMouth = sadAmt;
    if (gl && settings.species === 'drawn' && drawnReady()) drawSprite(now, dz);
    else if (gl) {
      setDrawnMode(false);
      draw(Model.buildParts({
        t: now / 1000,
        bodyYaw: st.bodyYaw + dz.yaw,
        lookYaw: st.lookYaw,
        lookPitch: st.lookPitch + dz.nod,
        glide: clamp(dz.glide, 0, 1),
        crouch: clamp(dz.crouch, 0, 1),
        blink,
        happy: Math.max(st.happy, ec.happy || 0),
        thinking: Math.max(st.thinking, ec.thinking || 0),
        sleepy: Math.max(st.sleepy || 0, sadAmt * 0.8, ec.sleepy || 0),
        brow: (ec.brow || 0) - sadBrow * 0.9,
        mouth: (ec.mouth || 0) - sadMouth,
        mouthO: Math.max(ec.mouthO || 0, (typeof PipVoice !== 'undefined' && PipVoice.isSpeaking()) ? 0.12 + 0.28 * Math.abs(Math.sin(now * 0.018) * Math.sin(now * 0.007 + 1)) : 0),
        wide: ec.wide || 0,
        blush: ec.blush || 0,
        earBack: Math.max(ec.earBack || 0, sadAmt * 0.6),
        flip: dz.flip,
        armL: dz.armL,
        armR: dz.armR,
        tailSwing: dz.tail,
        alert: Math.max(st.alert, ec.alert || 0),
        palette: settings.palette,
        style: skinNow(),
        skin: settings.skin || 'classic',
        species: settings.species || 'glider',
      }));
    }

    petEl.style.transform = `translate(${(st.x + st.ax + dz.x).toFixed(1)}px, ${(st.y + st.hopY + dz.hop).toFixed(1)}px) rotate(${(st.tilt + dz.tilt).toFixed(3)}rad)`;
    updateBranch(now);
    const hy = st.hopY + dz.hop; // dance jumps count too: the shadow shrinks while he is in the air
    const above = floorY() - (st.y + hy); // how high above the floor Pip is
    const sc = clamp(1 + hy / 260 - above / 900, 0.4, 1);
    shEl.style.transform = `translate(${(st.x + st.ax + dz.x + SIZE / 2 - 42).toFixed(1)}px, ${(floorY() + SIZE * FEET - 6).toFixed(1)}px) scale(${sc.toFixed(2)})`;
    shEl.style.opacity = String(st.perch ? 0 : clamp(1 + hy / 140 - above / 500, 0.15, 1));

    if (settings.quips && !quiet() && !st.chatOpen && !st.dragging && now > st.nextQuip) {
      showBubble(QUIPS[Math.floor(Math.random() * QUIPS.length)], 6000);
      cheer(900);
      st.nextQuip = now + rand(90000, 180000);
    }

    if (st.chatOpen) positionPanel();
  }

  // ---------------------------------------------------------------- mouse
  function overPet(x, y) {
    const dx = (x - (st.x + SIZE / 2)) / (SIZE * 0.36);
    const dy = (y - (st.y + st.hopY + SIZE * 0.55)) / (SIZE * 0.46);
    return dx * dx + dy * dy < 1;
  }
  function overPanel(x, y) {
    if (!st.chatOpen) return false;
    const r = panel.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  function updateInteractive() {
    const hot = overPet(mouse.x, mouse.y);
    canvas.classList.toggle('hot', hot);
    const gr = typeof PipGames !== 'undefined' && PipGames.isOpen() ? PipGames.rect() : null;
    const overGames = !!gr && mouse.x >= gr.left && mouse.x <= gr.right && mouse.y >= gr.top && mouse.y <= gr.bottom;
    const pk = document.querySelector('.pick'), pr = pk ? pk.getBoundingClientRect() : null;
    const overPick = !!pr && mouse.x >= pr.left && mouse.x <= pr.right && mouse.y >= pr.top && mouse.y <= pr.bottom;
    const want = st.dragging || !!panelDrag || !!resizing || hot || overPanel(mouse.x, mouse.y) || overGames || overPick;
    if (want !== interactive) {
      interactive = want;
      pip.setInteractive(want);
    }
  }
  pip.onCursor((p) => {
    mouse.x = p.x;
    mouse.y = p.y;
    updateInteractive();
  });

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { sx: e.clientX, sy: e.clientY, ox: st.x, oy: st.y, moved: false, samples: [], peak: 0 };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      st.dragging = true;
      leavePerch();
      st.flight = null;
      st.pendingCmd = null;
      st.hop = null;
      st.hopY = 0;
      st.glide = 0.6;
      st.rag = null; st.napUntil = 0; st.ragRot = 0;
      canvas.classList.add('drag');
    }
    if (drag.moved) {
      const tn = performance.now(), sm = drag.samples;
      sm.push({ x: e.clientX, y: e.clientY, t: tn });
      while (sm.length > 2 && tn - sm[0].t > 110) sm.shift();
      if (sm.length > 1) {
        const a = sm[sm.length - 2], q = Math.max(8, tn - a.t) / 1000;
        const vx = (e.clientX - a.x) / q, vy = (e.clientY - a.y) / q, sp = Math.hypot(vx, vy);
        st.dragVx += (vx - st.dragVx) * 0.3;
        drag.peak = Math.max(drag.peak, sp);
        if (sp > 800) st.shake += (sp - 800) * q * 0.0012;
        if (st.shake > 2.2 && !(st.emo.name === 'dizzy' && performance.now() < st.emo.until)) setEmotion('dizzy', 6000);
      }
      st.x = drag.ox + dx;
      st.y = clamp(drag.oy + dy, 0, floorY());
      clampX();
    }
  });
  const endDrag = (e) => {
    if (!drag) return;
    const wasDrag = drag.moved;
    let fling = null;
    if (wasDrag && drag.samples.length > 1 && performance.now() - drag.samples[drag.samples.length - 1].t < 120) { // only a release while still moving flings him
      const sm = drag.samples, b = sm[sm.length - 1];
      let a = sm[0];
      for (const s of sm) if (b.t - s.t <= 70) { a = s; break; } // where the hand was really heading at the moment of release
      if (a === b) a = sm[sm.length - 2];
      const q = Math.max(16, b.t - a.t) / 1000;
      const vx = (b.x - a.x) / q, vy = (b.y - a.y) / q;
      if (Math.hypot(vx, vy) > 900) fling = { vx: clamp(vx, -4200, 4200) * 0.95, vy: clamp(vy, -4200, 4200) * 0.95 };
    }
    drag = null;
    st.dragVx = 0;
    st.dragging = false;
    st.glide = 0;
    canvas.classList.remove('drag');
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    if (wasDrag && fling) {
      startRag(fling.vx, fling.vy);
    } else if (wasDrag) {
      // glide back down to the desktop floor like a proper sugar glider
      if (floorY() - st.y > 40) {
        // dropped up in the air: a branch grows right under him and he stays there
        const now = performance.now();
        pend = { x: st.x, y: st.y, t0: now };
        st.perch = { until: now + 90000 };
        st.landT = now;
        cheer(900);
      } else if (Math.abs(st.y - floorY()) > 4) startHop(st.x, 25, floorY());
      pip.savePos(st.x);
      st.nextHop = performance.now() + rand(8000, 16000);
    } else if (st.gameOn) {
      pip.chessStop(); st.gameOn = false; showBubble('Okay, I stopped the game.', 3500);
    } else {
      cheer();
      if (!st.hop) startHop(st.x, 38);
      st.chatOpen ? closeChat() : openChat();
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); pip.showMenu(); });

  pip.onArea((a) => {
    area.w = a.w;
    area.h = a.h;
    clampX();
    if (!st.hop && !st.dragging && !st.perch && !st.flight) st.y = floorY();
    else st.y = Math.min(st.y, floorY());
  });

  // ---------------------------------------------------------------- chat
  let history = [];
  let chatId = null;      // which saved chat this conversation is stored under
  const chatsEl = $('chats');
  let convoCtx = null;
  let busy = false;
  let typingEl = null;   // the "working..." bubble, so step updates can reach it
  const stopBtn = $('stop');
  let rec = null;        // the recording in progress (voice chat)
  let micBusy = false;   // from tapping the mic until the words have been sent
  let wide = false;
  let customSize = null; // { w, h } once the user has dragged the resize corner
  let resizing = null;
  let reopenAfter = false; // reopen the chat after an action that needed the panel out of the way
  const cards = new Map(); // pending approval cards by id

  function positionPanel() {
    const W = customSize ? Math.min(customSize.w, area.w - 24) : wide ? Math.min(620, area.w - 24) : 330;
    const H = customSize ? Math.min(customSize.h, area.h - 24) : Math.min(wide ? 680 : 440, area.h - 24);
    panel.style.width = W + 'px';
    panel.style.height = H + 'px';
    let left, top;
    if (panelPos) {
      left = clamp(panelPos.left, 12, Math.max(12, area.w - W - 12));
      top = clamp(panelPos.top, 12, Math.max(12, area.h - H - 12));
      panelPos = { left, top };
    } else if (st.y + 50 - H >= 12) {
      left = clamp(st.x + SIZE / 2 - W / 2, 12, area.w - W - 12);
      top = st.y + 50 - H;
    } else {
      left = st.x - W - 4 >= 12 ? st.x - W - 4 : st.x + SIZE + 4;
      left = clamp(left, 12, area.w - W - 12);
      top = clamp(st.y, 12, area.h - H - 12);
    }
    lastPanel = { left, top };
    panel.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  // Drag the bottom-right corner to resize the chat. The top-left corner stays where it is.
  const rz = $('rz');
  rz.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    panelPos = { left: lastPanel.left, top: lastPanel.top };
    const r = panel.getBoundingClientRect();
    resizing = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    rz.setPointerCapture(e.pointerId);
    e.preventDefault();
    updateInteractive();
  });
  rz.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    customSize = {
      w: clamp(resizing.w + e.clientX - resizing.x, 280, Math.max(280, area.w - lastPanel.left - 12)),
      h: clamp(resizing.h + e.clientY - resizing.y, 300, Math.max(300, area.h - lastPanel.top - 12)),
    };
    positionPanel();
    msgs.scrollTop = msgs.scrollHeight;
  });
  const endResize = () => { resizing = null; updateInteractive(); };
  rz.addEventListener('pointerup', endResize);
  rz.addEventListener('pointercancel', endResize);

  // Drag the chat window by its top bar; double-click the bar to put it back next to Pip.
  const hd = panel.querySelector('.hd');
  hd.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    panelDrag = { dx: e.clientX - lastPanel.left, dy: e.clientY - lastPanel.top };
    hd.setPointerCapture(e.pointerId);
    hd.classList.add('dragging');
    e.preventDefault();
    updateInteractive();
  });
  hd.addEventListener('pointermove', (e) => {
    if (!panelDrag) return;
    panelPos = { left: e.clientX - panelDrag.dx, top: e.clientY - panelDrag.dy };
    positionPanel();
  });
  const endPanelDrag = (e) => {
    if (!panelDrag) return;
    panelDrag = null;
    hd.classList.remove('dragging');
    try { hd.releasePointerCapture(e.pointerId); } catch (_) {}
    updateInteractive();
  };
  hd.addEventListener('pointerup', endPanelDrag);
  hd.addEventListener('pointercancel', endPanelDrag);
  hd.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    panelPos = null;
    positionPanel();
  });

  // Tiny safe renderer (no innerHTML): ``` code blocks with a Copy button, `inline code`, **bold**.
  function inline(parent, text) {
    for (const part of text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/)) {
      if (!part) continue;
      if (part.length > 2 && part[0] === '`') {
        const c = document.createElement('code');
        c.textContent = part.slice(1, -1);
        parent.appendChild(c);
      } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        const b = document.createElement('b');
        b.textContent = part.slice(2, -2);
        parent.appendChild(b);
      } else parent.appendChild(document.createTextNode(part));
    }
  }
  function renderRich(el, text) {
    text.split('```').forEach((part, i) => {
      if (i % 2 === 0) { inline(el, part.replace(/^\n+|\n+$/g, '')); return; }
      const nl = part.indexOf('\n');
      const lang = nl >= 0 ? part.slice(0, nl).trim() : '';
      const code = (nl >= 0 ? part.slice(nl + 1) : part).replace(/\n$/, '');
      const box = document.createElement('div');
      box.className = 'codeblk';
      const head = document.createElement('div');
      head.className = 'ch';
      const l = document.createElement('span');
      l.textContent = lang || 'code';
      const cp = document.createElement('button');
      cp.textContent = 'Copy';
      cp.addEventListener('click', () => { pip.copyText(code); cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy'; }, 1400); });
      head.append(l, cp);
      const pre = document.createElement('pre');
      const c = document.createElement('code');
      c.textContent = code;
      pre.appendChild(c);
      box.append(head, pre);
      el.appendChild(box);
    });
  }

  function addMsg(role, text) {
    if (role === 'pet') text = noEmoji(text);
    const d = document.createElement('div');
    d.className = 'm ' + role;
    if (role === 'pet' && (text.includes('`') || text.includes('**'))) renderRich(d, text);
    else d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  function addTyping() {
    const d = document.createElement('div');
    d.className = 'm pet typing';
    d.innerHTML = '<i></i><i></i><i></i><span class="step"></span>';
    typingEl = d;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  function greet() {
    addMsg('pet', `Hi, I'm ${settings.petName}. Ask me anything, or tell me your options and I'll pick one for you.`);
  }

  function openChat() {
    comeBack("You called?");
    sfx('open');
    if (st.napUntil > performance.now()) { st.napUntil = 0; st.emo.until = 0; }
    st.chatOpen = true;
    bubble.classList.remove('show');
    panel.classList.add('open');
    if (!msgs.children.length) greet();
    positionPanel();
    pip.focus();
    inp.focus();
    updateInteractive();
  }
  function closeChat() {
    PipVoice.stopSpeaking();
    if (rec) rec.cancel();
    st.chatOpen = false;
    settingsEl.classList.remove('open');
    panel.classList.remove('open');
    st.nextHop = performance.now() + rand(8000, 16000);
    updateInteractive();
  }

  function trimmedHistory() {
    const h = history.slice(-16);
    while (h.length && h[0].role !== 'user') h.shift();
    return h;
  }

  const POLICY_UI = [['open', 'Open apps and websites', true], ['type', 'Type text for me', true], ['press', 'Press buttons', true], ['look', 'Look at my screen', true],
    ['chat', 'Open a chat in a messaging app', true], ['keys', 'Press keyboard shortcuts', false], ['cmd', 'Run terminal commands', false], ['files', 'Write, move or trash files', false]];
  function buildPolicyUi() {
    if ($('tp-box')) return;
    const box = document.createElement('div');
    box.id = 'tp-box';
    box.innerHTML = '<label style="display:block;margin-top:8px"><b>Per action</b> (overrides the switches above; "Default" keeps the normal rules)</label>';
    for (const [g, label, canNever] of POLICY_UI) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:center;margin:3px 0';
      const sel = document.createElement('select');
      sel.id = 'tp-' + g;
      sel.innerHTML = '<option value="">Default</option>' + (canNever ? '<option value="never">Never ask</option>' : '') + '<option value="always">Always ask</option>';
      row.append(document.createTextNode(label), sel);
      box.appendChild(row);
    }
    $('s-trustsaid').closest('label').after(box);
  }
  let liveEl = null; // the reply bubble that fills in word by word while the AI writes
  pip.onDelta(({ text }) => {
    if (!busy || !text) return;
    if (!liveEl) { liveEl = addMsg('pet', ''); if (typingEl) msgs.appendChild(typingEl); }
    liveEl.textContent += text;
    msgs.scrollTop = msgs.scrollHeight;
  });

  function closeChatForGame() { try { if (st.chatOpen) closeChat(); } catch (_) {} }
  // Chess on a real website or app, driven by Pip's own engine, no AI service involved.
  async function screenChess() {
    closeChatForGame();
    const color = await pickOne('Chess on screen: which side are you playing?', [['white', 'I am white'], ['black', 'I am black']]);
    if (!color) return;
    showBubble('Open the chess game, then follow my steps.', 5000);
    const res = await pip.chessScreen({ white: color === 'white', level: chessLv() });
    if (res && res.message) showBubble(res.message, 8000);
  }
  // a tiny two-choice popup next to Pip
  function pickOne(question, options) {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'pick';
      const q = document.createElement('div'); q.textContent = question; box.appendChild(q);
      const done = (v) => { box.remove(); resolve(v); };
      for (const [v, label] of options) { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', () => done(v)); box.appendChild(b); }
      const c = document.createElement('button'); c.textContent = 'Cancel'; c.addEventListener('click', () => done(null)); box.appendChild(c);
      document.body.appendChild(box);
      box.style.left = Math.max(8, Math.min(area.w - 280, st.x - 40)) + 'px';
      box.style.top = Math.max(8, st.y - 130) + 'px';
    });
  }
  const CLIP_RE = /^(explain|reply|draft a reply|summari[sz]e|fix|proofread|rewrite|shorten|simplify|translate(?: to ([a-z ]{2,20}))?)(?: (?:this|that|it|what i copied|my clipboard|the clipboard))?[.!]?$/i;
  const CLIP_ASK = { explain: 'Explain what I copied.', summarize: 'Summarize what I copied in a few sentences.', fix: 'Fix any mistakes in what I copied (spelling, grammar, or bugs if it is code) and give me the corrected version.', proofread: 'Proofread what I copied and give me the corrected version.', rewrite: 'Rewrite what I copied so it reads better.', shorten: 'Shorten what I copied but keep the meaning.', simplify: 'Explain what I copied in simpler words.', reply: 'Draft a short, friendly reply to what I copied (it is probably a message to me). Give just the reply, then one line offering a more formal or more casual version.', 'draft a reply': 'Draft a short, friendly reply to what I copied (it is probably a message to me). Give just the reply, then one line offering a more formal or more casual version.' };
  async function send(text, opts = {}) {
    text = text.trim();
    if (busy || !text) return;
    const cm = !opts.ctx && text.match(CLIP_RE);
    if (cm) {
      let clip = '';
      try { clip = (await pip.readClipboard()).trim(); } catch (_) {}
      if (!clip) { localReply(text, 'Your clipboard is empty. Copy some text first, then ask me again.'); return; }
      const verb = cm[1].toLowerCase().replace('summarise', 'summarize');
      opts = { ...opts, ctx: { text: clip } };
      text = verb.startsWith('translate') ? `Translate what I copied${cm[2] ? ' to ' + cm[2] : ' to English'}.` : CLIP_ASK[verb];
    }
    PipVoice.stopSpeaking();
    addMsg('user', text);
    if (opts.ctx) convoCtx = opts.ctx;
    history.push({ role: 'user', content: text });
    reactToText(text);
    if (st.away && !/\b(go away|leave|bye)\b/i.test(text)) comeBack();
    busy = true;
    thinkingFlag = true;
    stopBtn.hidden = false;
    const typing = addTyping();
    try {
      const res = await pip.chat({ messages: trimmedHistory(), ctx: convoCtx });
      typing.remove();
      if (liveEl) { liveEl.remove(); liveEl = null; } // the final message below replaces the live one
      if (res.error === 'no_key') {
        history.pop();
        addMsg('pet', `I need ${res.provider === 'gemini' ? 'a Google Gemini key' : res.provider === 'groq' ? 'a Groq key' : res.provider === 'cloudflare' ? 'a Cloudflare token' : 'an Anthropic key'} before I can chat! Tap the gear button above and paste one in. (Simple things like opening sites, volume, timers, maths and coin flips work without it)`);
      } else if (res.error) {
        history.pop();
        addMsg('pet', 'Oops, something went wrong: ' + res.error);
      } else {
        history.push({ role: 'assistant', content: res.text });
        saveHistory();
        addMsg('pet', res.text); sfx('pop');
        cheer(1100);
        if (settings.voiceReply === 'always' || (settings.voiceReply !== 'never' && opts.voice)) PipVoice.speak(res.text);
      }
    } catch (e) {
      typing.remove();
      if (liveEl) { liveEl.remove(); liveEl = null; }
      history.pop();
      addMsg('pet', 'I could not reach my brain just now. Try again in a moment.');
    } finally {
      busy = false;
      thinkingFlag = false;
      stopBtn.hidden = true;
      typingEl = null;
      if (reopenAfter) { reopenAfter = false; openChat(); }
    }
  }

  // ---------------------------------------------------------------- approvals
  // Pip never acts on its own: every action shows up here and waits for a click.
  function showApproval({ id, title, details, risk }) {
    if (!st.chatOpen) openChat();
    const card = document.createElement('div');
    const danger = risk === 'high';
    card.className = 'm card' + (danger ? ' danger' : '');
    const h = document.createElement('b');
    h.textContent = (danger ? 'Warning: ' : '') + title;
    const pre = document.createElement('pre');
    pre.textContent = details;
    const acts = document.createElement('div');
    acts.className = 'acts';
    const ok = document.createElement('button');
    ok.className = 'ok';
    ok.textContent = danger ? 'Approve (I checked)' : 'Approve';
    const no = document.createElement('button');
    no.className = 'no';
    no.textContent = 'Decline';
    const res = document.createElement('span');
    res.className = 'res';
    const settle = (approved, label) => {
      cards.delete(id);
      ok.remove();
      no.remove();
      res.textContent = label;
      if (approved !== null) pip.respondApproval(id, approved);
    };
    ok.addEventListener('click', () => settle(true, ' Approved'));
    no.addEventListener('click', () => settle(false, ' Declined'));
    acts.append(ok, no, res);
    card.append(h, pre, acts);
    msgs.appendChild(card);
    msgs.scrollTop = msgs.scrollHeight;
    cards.set(id, (label) => settle(null, label));
    pip.focus();
  }
  pip.onApproval(showApproval);
  pip.onApprovalExpired(({ id, label }) => { const f = cards.get(id); if (f) f(label || 'Expired'); });
  pip.onProgress(({ n, title }) => {
    const el = typingEl && typingEl.querySelector('.step');
    if (!el) return;
    el.textContent = `step ${n}: ${String(title || '').toLowerCase().slice(0, 40)}${n >= 8 ? ' (press Stop if I am going in circles)' : ''}`;
    msgs.scrollTop = msgs.scrollHeight;
  });
  stopBtn.addEventListener('click', () => { pip.stopChat(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && busy) pip.stopChat(); });
  pip.onSay(({ text, ms }) => showBubble(text, ms || 3000));
  pip.onPet(petCommand);
  pip.onHidePanel(() => { if (st.chatOpen) { reopenAfter = true; closeChat(); } });

  function localReply(userText, petText) {
    addMsg('user', userText);
    addMsg('pet', petText);
    cheer(1100);
  }

  // ---------------------------------------------------------------- voice chat
  const mic = $('mic');
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) mic.classList.add('hidden');
  const DEFAULT_HINT = 'Say something...';
  let hintTimer = null;
  function hint(text, ms) {
    clearTimeout(hintTimer);
    inp.placeholder = text || DEFAULT_HINT;
    if (text && ms) hintTimer = setTimeout(() => { inp.placeholder = DEFAULT_HINT; }, ms);
  }
  function micUi(state) {
    mic.classList.toggle('on', state === 'listening');
    mic.classList.toggle('busy', state === 'working');
    mic.title = state === 'listening' ? 'Tap to stop and send' : state === 'working' ? 'Working on it...' : 'Talk to me';
    if (state !== 'listening') mic.style.removeProperty('--lvl');
  }
  async function onMic() {
    if (rec) { rec.stop(); return; }              // second tap: finish now
    if (micBusy || busy) return;
    PipVoice.stopSpeaking();                      // tapping while Pip talks interrupts it and starts listening
    micBusy = true;
    try {
      const status = await pip.voiceStatus();
      if (!status.ok) { addMsg('pet', status.reason); return; }
      const access = await pip.voiceMic();
      if (!access.ok) { addMsg('pet', access.reason); return; }
      try {
        rec = await PipVoice.record({ onLevel: (l) => mic.style.setProperty('--lvl', Math.min(1, l * 8).toFixed(2)) });
      } catch (e) {
        const denied = /NotAllowed|denied|permission/i.test(String((e && e.name) || '') + String((e && e.message) || ''));
        addMsg('pet', denied
          ? "I can't use the microphone. Check that it is allowed for Pip in your system's privacy settings, then tap the mic again."
          : "I couldn't open a microphone. Is one plugged in?");
        return;
      }
      micUi('listening');
      hint('Listening... tap the mic when you are done');
      const r = await rec.done;
      rec = null;
      if (!r.heard) {
        micUi('idle');
        hint(r.reason === 'cancel' ? '' : "I didn't hear anything. Tap the mic and try again.", 4000);
        return;
      }
      micUi('working');
      hint('Turning your voice into text...');
      const t = await pip.transcribe(r.audio);
      if (t.error) { addMsg('pet', t.error); return; }
      if (!t.text) { hint("I couldn't make out any words. Try again.", 4000); return; }
      micUi('idle');
      hint('');
      await send(t.text, { voice: true });
    } finally {
      rec = null;
      micBusy = false;
      micUi('idle');
      if (/^(Listening|Turning)/.test(inp.placeholder)) hint('');
    }
  }
  mic.addEventListener('click', onMic);
  // Dictation anywhere (Ctrl/Cmd+Alt+D): talk, pause, and the cleaned-up words are typed at your cursor. No chat window needed.
  let dict = null;
  async function onDictate() {
    if (dict) { dict.stop(); return; }
    if (micBusy || busy) return;
    micBusy = true;
    try {
      const status = await pip.voiceStatus(); if (!status.ok) { showBubble(status.reason, 7000); return; }
      const access = await pip.voiceMic(); if (!access.ok) { showBubble(access.reason, 7000); return; }
      try { dict = await PipVoice.record({ silenceMs: 1100, noSpeechMs: 7000, maxMs: 120000, onLevel: () => { alertUntil = performance.now() + 400; } }); } catch (_) { showBubble("I can't open the microphone.", 4000); return; }
      sfx('hop'); showBubble('Listening... just talk, then pause', 120000);
      const r = await dict.done; dict = null;
      if (!r.heard) { showBubble(r.reason === 'cancel' ? '' : "I didn't hear anything.", 2500); return; }
      showBubble('Typing...', 8000); thinkingFlag = true;
      const t = await pip.transcribe(r.audio);
      if (t.error || !t.text) { showBubble(t.error || "I couldn't make out any words.", 5000); return; }
      const d = await pip.dictate(t.text);
      showBubble(d.error ? `${d.error}. Copied nothing; try again.` : 'Done!', 2000); if (!d.error) cheer(900);
    } finally { dict = null; micBusy = false; thinkingFlag = false; }
  }
  pip.onVoiceDictate(onDictate);
  pip.onScreenAsk(() => { if (!st.chatOpen) openChat(); send('Look at my screen and help me with whatever I am doing right now.'); });
  pip.onVoiceHotkey(() => { if (!st.chatOpen) openChat(); onMic(); });

  function onSubmit() {
    const v = inp.value;
    inp.value = '';
    inp.style.height = 'auto';
    send(v);
  }

  $('go').addEventListener('click', onSubmit);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onSubmit(); }
  });
  inp.addEventListener('input', () => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(90, inp.scrollHeight) + 'px';
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.chatOpen) closeChat(); });

  $('close').addEventListener('click', closeChat);
  $('expand').addEventListener('click', () => { wide = !wide; customSize = null; $('expand').classList.toggle('wide', wide); $('expand').title = wide ? 'Smaller window' : 'Bigger window'; positionPanel(); });
  $('reset').addEventListener('click', () => {
    PipVoice.stopSpeaking();
    if (rec) rec.cancel();
    history = [];
    chatId = null;
    convoCtx = null;
    msgs.textContent = '';
    chatsEl.classList.remove('open');
    greet();
  });

  // ---------------------------------------------------------------- saved chats
  function saveHistory() {
    if (!history.length) return;
    if (!chatId) chatId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    pip.saveChat(chatId, history);
  }
  async function showChats() {
    settingsEl.classList.remove('open');
    chatsEl.classList.add('open');
    const box = $('chat-list');
    box.textContent = '';
    const list = await pip.listChats();
    if (!list.length) { const n = document.createElement('div'); n.className = 'none'; n.textContent = 'No saved chats yet. Your conversations are saved here automatically.'; box.appendChild(n); return; }
    for (const c of list) {
      const row = document.createElement('div');
      row.className = 'row';
      const t = document.createElement('span'); t.className = 't'; t.textContent = c.title;
      const d = document.createElement('span'); d.className = 'd'; d.textContent = new Date(c.updated).toLocaleDateString();
      const x = document.createElement('button'); x.textContent = '×'; x.title = 'Delete this chat';
      x.addEventListener('click', async (e) => { e.stopPropagation(); await pip.deleteChat(c.id); if (c.id === chatId) chatId = null; showChats(); });
      row.addEventListener('click', async () => {
        if (busy) return;
        const full = await pip.getChat(c.id);
        if (!full) return;
        history = full.messages.map((m) => ({ role: m.role, content: m.content }));
        chatId = full.id;
        convoCtx = null;
        msgs.textContent = '';
        for (const m of history) addMsg(m.role === 'user' ? 'user' : 'pet', m.content);
        chatsEl.classList.remove('open');
      });
      row.append(t, d, x);
      box.appendChild(row);
    }
  }
  $('hist').addEventListener('click', () => (chatsEl.classList.contains('open') ? chatsEl.classList.remove('open') : showChats()));

  document.querySelector('.chips').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    switch (b.dataset.c) {
      case 'decide':
        inp.value = 'Help me decide: ';
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
        break;
      case 'coin':
        localReply('Flip a coin', Math.random() < 0.5 ? 'Heads!' : 'Tails!');
        break;
      case 'fact':
        send('Tell me a surprising, fun fact I probably do not know.');
        break;
      case 'cheer':
        send('I could use a little cheering up!');
        break;
      case 'screen':
        if (settings.actions === false) localReply('Help with my screen', 'Turn on "Let Pip do things for me" in the gear button settings, and I can look at your screen (only after you approve each look).');
        else send('Look at my screen and help me with the question on it. Give me the answer.');
        break;
      case 'sys':
        inp.value = 'Open ';
        inp.focus();
        inp.setSelectionRange(5, 5);
        break;
      case 'cal':
        inp.value = "When is 's birthday?";
        inp.focus();
        inp.setSelectionRange(8, 8);
        break;
      case 'games': closeChatForGame(); openGames(); break;
      case 'screenchess': screenChess(); break;
      case 'rematch': (async () => { closeChatForGame(); const r = await pip.chessScreen({ rematch: true, level: chessLv() }); if (r && r.message) showBubble(r.message, 8000); })(); break;
      case 'chessauto': (async () => { closeChatForGame(); const r = await pip.chessAuto({ level: chessLv() }); if (r && r.message) showBubble(r.message, 9000); })(); break;
      case 'noblunders': { // one tap: Pip stops blundering (also mid-game); tap again to give the old setting back
        const off = settings.chessBlunders === 0, was = Number(settings.chessBlundersWas);
        (async () => {
          const saved = await pip.saveSettings({ chessBlunders: off ? (was >= 0 ? was : -1) : 0, chessBlundersWas: off ? -1 : (Number.isFinite(Number(settings.chessBlunders)) ? Number(settings.chessBlunders) : -1) });
          Object.assign(settings, saved); syncNoBl();
          showBubble(settings.chessBlunders === 0 ? 'No more blunders. I will play my best from here.' : 'Okay, I can slip again.', 3500);
        })();
        break;
      }
      case 'chessresign': (async () => { const r = await pip.chessResign(); if (r && r.message) showBubble(r.message, 5000); })(); break;
      case 'chessteach': (async () => {
        closeChatForGame();
        const w = await pickOne('Which button should I learn?', [['newGame', 'New game'], ['playAgain', 'Play again (after game)'], ['resign', 'Resign'], ['confirm', 'Resign confirm (Yes)'], ['draw', 'Offer draw'], ['drawConfirm', 'Draw confirm']]);
        if (!w) return;
        const r = await pip.chessTeach(w); if (r && r.message) showBubble(r.message, 5000);
      })(); break;
      case 'stopgame': pip.chessStop(); showBubble('Okay, I stopped.', 3000); break;
      case 'clipsum': send('summarize'); break;
      case 'clipfix': send('fix'); break;
      case 'clip': {
        let text = '';
        try { text = (await pip.readClipboard()).trim(); } catch (_) {}
        if (!text) localReply('What I copied', 'Your clipboard is empty. Copy some text first, then ask me again!');
        else send('Explain or summarize what I copied.', { ctx: { text } });
        break;
      }
    }
  });

  // ---------------------------------------------------------------- settings
  function applySettings() {
    $('nm').textContent = settings.petName;
    try { PipSfx.setEnabled(settings.sounds !== false); PipSfx.setVolume(settings.soundVolume == null ? 0.5 : settings.soundVolume); } catch (_) {}
  }
  function renderCals(list) {
    settings.calendars = list;
    const box = $('s-cals');
    box.textContent = '';
    if (!list.length) {
      const n = document.createElement('div');
      n.className = 'none';
      n.textContent = 'None yet';
      box.appendChild(n);
    }
    for (const c of list) {
      const row = document.createElement('div');
      row.className = 'cal';
      const name = document.createElement('span');
      name.textContent = (c.kind === 'file' ? '' : '') + c.label;
      const rm = document.createElement('button');
      rm.textContent = 'Remove';
      rm.addEventListener('click', async () => renderCals(await pip.removeCalendar(c.id)));
      row.append(name, rm);
      box.appendChild(row);
    }
  }
  const calStatus = (t) => { $('s-calstatus').textContent = t; };
  function calResult(r) {
    if (r.canceled) return calStatus('');
    if (r.error) return calStatus(r.error);
    renderCals(r.calendars);
    $('s-calname').value = '';
    $('s-calurl').value = '';
    calStatus(`Added (found ${r.events} event${r.events === 1 ? '' : 's'})`);
  }
  $('s-caladd').addEventListener('click', async () => {
    const url = $('s-calurl').value.trim();
    if (!url) return calStatus('Paste a calendar link first.');
    calStatus('Checking the link...');
    calResult(await pip.addCalendarUrl($('s-calname').value, url));
  });
  $('s-calfile').addEventListener('click', async () => {
    calStatus('Reading the file...');
    calResult(await pip.addCalendarFile());
  });

  function showProvider() {
    const v = $('s-provider').value;
    $('s-gem').classList.toggle('hidden', v !== 'gemini');
    $('s-groq').classList.toggle('hidden', v !== 'groq');
    $('s-cf').classList.toggle('hidden', v !== 'cloudflare');
    $('s-anth').classList.toggle('hidden', v === 'gemini' || v === 'groq' || v === 'cloudflare');
  }
  $('s-provider').addEventListener('change', showProvider);
  $('s-getkey-a').addEventListener('click', () => pip.openKeyPage('anthropic'));
  $('s-getkey-g').addEventListener('click', () => pip.openKeyPage('gemini'));
  $('s-getkey-gr').addEventListener('click', () => pip.openKeyPage('groq'));
  $('s-getkey-cf').addEventListener('click', () => pip.openKeyPage('cloudflare'));

  function skinNow() { // "Seasonal" picks the skin from today's date
    const s = settings.style || 'classic';
    if (s !== 'season') return s;
    const d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    if (m === 12 || (m === 1 && day <= 2)) return 'santa';
    if ((m === 10 && day >= 15) || (m === 11 && day <= 1)) return 'pumpkin';
    if ((m === 3 && day >= 20) || (m === 4 && day <= 25)) return 'bunny';
    if (m === 1 || m === 2) return 'snowman';
    return 'classic';
  }
  function openSettings() {
    $('s-find').value = '';
    $('s-key').value = '';
    $('s-key').placeholder = settings.hasAnthropicKey ? 'Key saved (type to replace)' : 'sk-ant-...';
    $('s-gkey').value = '';
    $('s-gkey').placeholder = settings.hasGeminiKey ? 'Key saved (type to replace)' : 'AIza...';
    $('s-grkey').value = '';
    $('s-grkey').placeholder = settings.hasGroqKey ? 'Key saved (type to replace)' : 'gsk_...';
    $('s-grmodel').value = settings.groqModel || 'openai/gpt-oss-120b';
    $('s-cfkey').value = '';
    $('s-cfkey').placeholder = settings.hasCloudflareKey ? 'Token saved (type to replace)' : 'API token';
    $('s-cfacct').value = settings.cloudflareAccountId || '';
    $('s-cfmodel').value = settings.cloudflareModel || '@cf/google/gemma-4-26b-a4b-it';
    $('s-provider').value = settings.provider || 'anthropic';
    $('s-voiceprov').value = settings.voiceProvider || 'auto';
    $('s-voicereply').value = settings.voiceReply || 'voice';
    $('s-voicetts').value = settings.voiceTts || 'natural';
    $('s-voicestyle').value = settings.voiceStyle || 'cheerful';
    $('s-autoupd').checked = settings.autoUpdate !== false;
    $('s-chessconfirm').checked = !!settings.chessConfirm; $('s-chessfidget').checked = settings.chessFidget !== false;
    $('s-actionlog').checked = settings.actionLog !== false;
    $('s-gmodel').value = settings.geminiModel || 'gemini-2.5-flash';
    showProvider();
    $('s-name').value = settings.petName;
    $('s-palette').value = settings.palette;
    $('s-species').value = settings.species || 'glider';
    dLoad();
    $('s-skin').value = settings.skin || 'classic';
    $('s-style').value = settings.style || 'classic';
    $('s-model').value = settings.model || 'claude-haiku-5-5';
    $('s-wander').checked = !!settings.wander;
    $('s-quips').checked = !!settings.quips;
    $('s-short').checked = settings.shortReplies !== false;
    $('s-fallback').checked = settings.fallback !== false;
    $('s-react').checked = settings.reactions !== false;
    $('s-sound').checked = settings.sounds !== false;
    $('s-vol').value = Math.round((settings.soundVolume == null ? 0.5 : settings.soundVolume) * 100);
    $('s-memory').checked = settings.moodMemory !== false;
    $('s-apppersona').checked = settings.appPersona !== false;
    $('s-level').value = settings.chessLevel === 'sloppy' ? 'sloppy' : 'sharp'; $('s-strength').value = settings.chessStrength || 7;
    { const bl = Number(settings.chessBlunders), br = Number(settings.chessBrilliants);
      $('s-blauto').checked = !(bl >= 0); $('s-blunders').value = bl >= 0 ? bl : 2; $('s-blunders').disabled = !(bl >= 0);
      $('s-bralto').checked = !(br >= 0); $('s-brill').value = br >= 0 ? br : 1; $('s-brill').disabled = !(br >= 0);
      $('s-blunders-v').textContent = $('s-blauto').checked ? 'auto' : $('s-blunders').value; $('s-brill-v').textContent = $('s-bralto').checked ? 'auto' : $('s-brill').value; }
    $('s-clock').value = settings.chessClock || '';
    $('s-shape').checked = settings.shapeWindow !== false;
    $('s-login').checked = !!settings.openAtLogin;
    $('s-actions').checked = settings.actions !== false;
    $('s-full').checked = settings.fullAccess !== false;
    $('s-autolook').checked = !!settings.autoLook;
    $('s-autotype').checked = !!settings.autoType;
    $('s-autopress').checked = !!settings.autoPress;
    $('s-trusted').value = (settings.trustedSites || []).join(', ');
    $('s-trustsaid').checked = !!settings.trustSaid;
    buildPolicyUi();
    for (const [g] of POLICY_UI) $('tp-' + g).value = (settings.toolPolicy || {})[g] || '';
    $('s-hotkey').checked = settings.voiceHotkey !== false;
    $('s-folder').textContent = settings.workFolder || 'None chosen';
    renderCals(settings.calendars || []);
    $('s-maccal-wrap').classList.toggle('hidden', settings.platform !== 'darwin');
    $('s-maccal').checked = !!settings.macCalendar;
    calStatus('');
    $('s-status').textContent = '';
    showSec(null);
    settingsEl.classList.add('open');
  }
  $('gear').addEventListener('click', () => (chatsEl.classList.remove('open'), settingsEl.classList.contains('open') ? settingsEl.classList.remove('open') : openSettings()));
  function showSec(k) {
    $('s-menu').classList.toggle('off', !!k);
    $('s-find').classList.toggle('hidden', !!k && k !== '_');
    $('s-results').classList.toggle('on', k === '_');
    if (k !== '_') $('s-find').value = '';
    for (const s of settingsEl.querySelectorAll('.sec')) s.classList.toggle('on', s.id === 'sec-' + k);
    $('s-cancel').textContent = 'Back';
    settingsEl.scrollTop = 0;
  }
  $('s-find').addEventListener('input', () => { // settings search: lists matching options, tap one to jump to it
    const q = $('s-find').value.trim().toLowerCase(), box = $('s-results');
    if (!q) { showSec(null); return; }
    showSec('_'); box.textContent = '';
    const words = q.split(/\s+/); let n = 0;
    for (const sec of settingsEl.querySelectorAll('.sec')) {
      const title = settingsEl.querySelector(`.s-go[data-sec="${sec.id.slice(4)}"] b`).textContent;
      for (const el of sec.querySelectorAll('label, .hint')) {
        const own = Array.from(el.childNodes).filter((x) => x.nodeType === 3).map((x) => x.textContent).join(' ').trim() || el.textContent.trim();
        if (!own || n >= 10 || !words.every((w) => (own + ' ' + title).toLowerCase().includes(w))) continue;
        n++;
        const b = document.createElement('button'); b.type = 'button'; b.className = 's-go';
        const t = document.createElement('b'), d = document.createElement('span');
        t.textContent = own.length > 80 ? own.slice(0, 78) + '...' : own; d.textContent = title; b.append(t, d);
        b.addEventListener('click', () => { showSec(sec.id.slice(4)); el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); });
        box.appendChild(b);
      }
    }
    if (!n) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = 'Nothing matches that.'; box.appendChild(d); }
  });
  $('s-vol').addEventListener('input', () => { try { PipSfx.setVolume(Number($('s-vol').value) / 100); PipSfx.play('pop'); } catch (_) {} }); // hear the new volume as you drag
  for (const b of settingsEl.querySelectorAll('.s-go')) b.addEventListener('click', () => showSec(b.dataset.sec));
  $('s-cancel').addEventListener('click', () => ($('s-menu').classList.contains('off') ? showSec(null) : settingsEl.classList.remove('open')));
  $('s-choose').addEventListener('click', async () => {
    const f = await pip.chooseFolder();
    settings.workFolder = f;
    $('s-folder').textContent = f || 'None chosen';
  });
  $('s-clear').addEventListener('click', async () => {
    await pip.clearFolder();
    settings.workFolder = '';
    $('s-folder').textContent = 'None chosen';
  });
  // Keep the overlay window shaped to just Pip and his panels (Windows/Linux), so a browser never sees a full-screen window on top of it
  let lastShape = '';
  setInterval(() => {
    try {
      let rects = null;
      if (settings.shapeWindow !== false) {
        rects = [];
        const P = 150; // padding: he moves between updates and his effects reach a little past his box
        const els = Array.from(document.body.children);
        const b = document.getElementById('bubble'); if (b) els.push(b);
        for (const el of els) {
          if (!el.getBoundingClientRect || /^(SCRIPT|STYLE)$/.test(el.tagName)) continue;
          const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
          rects.push({ x: Math.round(r.left - P), y: Math.round(r.top - P), width: Math.round(r.width + 2 * P), height: Math.round(r.height + 2 * P) });
        }
      }
      const key = JSON.stringify(rects);
      if (key !== lastShape) { lastShape = key; pip.setShape(rects); }
    } catch (_) {}
  }, 120);
  window.addEventListener('error', (e) => { try { pip.debugLog('error', (e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); } catch (_) {} });
  window.addEventListener('unhandledrejection', (e) => { try { pip.debugLog('rejection', String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)); } catch (_) {} });
  PipVoice.onFallback = (why) => { // once per session: say why Pip sounds like a robot
    if (settings.voiceTts === 'system') return;
    showBubble(!why || why === 'system' ? 'I sound robotic because no voice service is set up. Settings > Voice has free options.' : 'My natural voice failed (' + String(why).slice(0, 80) + '), so I am using the computer voice.', 9000);
  };
  $('s-testvoice').addEventListener('click', async () => {
    $('s-status').textContent = 'Testing...';
    try {
      await saveNow(); PipVoice.warned = true;
      const t = 'Hi, I am Pip. How does this sound?', r = await pip.speak(t);
      if (r && r.audio) { $('s-status').textContent = ''; PipVoice.speak(t); }
      else $('s-status').textContent = !r || r.error === 'system' ? 'No natural voice: add a Groq, Gemini or Cloudflare key.' : String(r.error).slice(0, 120);
    } catch (e) { $('s-status').textContent = 'Test failed.'; }
  });
  $('s-debug').addEventListener('click', async () => {
    try { const r = await pip.debugCopy(); $('s-status').textContent = `Copied ${r.lines} log lines. Paste them in your bug report.`; } catch (_) { $('s-status').textContent = 'Could not copy the log.'; }
  });
  const syncNoBl = () => { const b = document.querySelector('[data-c="noblunders"]'); if (b) b.textContent = settings.chessBlunders === 0 ? 'Chess: blunders are OFF (tap to allow)' : 'Chess: no blunders'; };
  syncNoBl();
  async function saveNow() {
    const saved = await pip.saveSettings({
      apiKey: $('s-key').value,
      geminiKey: $('s-gkey').value,
      provider: $('s-provider').value,
      voiceProvider: $('s-voiceprov').value,
      voiceReply: $('s-voicereply').value,
      voiceTts: $('s-voicetts').value,
      voiceStyle: $('s-voicestyle').value,
      autoUpdate: $('s-autoupd').checked,
      chessConfirm: $('s-chessconfirm').checked,
      chessFidget: $('s-chessfidget').checked,
      actionLog: $('s-actionlog').checked,
      geminiModel: $('s-gmodel').value,
      groqKey: $('s-grkey').value,
      groqModel: $('s-grmodel').value,
      cloudflareKey: $('s-cfkey').value,
      cloudflareAccountId: $('s-cfacct').value,
      cloudflareModel: $('s-cfmodel').value,
      petName: $('s-name').value,
      palette: $('s-palette').value,
      species: $('s-species').value,
      drawn: settings.drawn || {},
      skin: $('s-skin').value,
      style: $('s-style').value,
      model: $('s-model').value,
      wander: $('s-wander').checked,
      quips: $('s-quips').checked,
      shortReplies: $('s-short').checked,
      fallback: $('s-fallback').checked,
      reactions: $('s-react').checked,
      sounds: $('s-sound').checked,
      soundVolume: Number($('s-vol').value) / 100,
      moodMemory: $('s-memory').checked,
      appPersona: $('s-apppersona').checked,
      chessLevel: $('s-level').value,
      chessStrength: Number($('s-strength').value),
      chessBlunders: $('s-blauto').checked ? -1 : Number($('s-blunders').value),
      chessBrilliants: $('s-bralto').checked ? -1 : Number($('s-brill').value),
      chessClock: $('s-clock').value,
      shapeWindow: $('s-shape').checked,
      openAtLogin: $('s-login').checked,
      actions: $('s-actions').checked,
      fullAccess: $('s-full').checked,
      autoLook: $('s-autolook').checked,
      autoType: $('s-autotype').checked,
      autoPress: $('s-autopress').checked,
      voiceHotkey: $('s-hotkey').checked,
      trustSaid: $('s-trustsaid').checked,
      toolPolicy: Object.fromEntries(POLICY_UI.map(([g]) => [g, $('tp-' + g).value]).filter(([, v]) => v)),
      trustedSites: $('s-trusted').value.split(/[,\s]+/).filter(Boolean),
      macCalendar: $('s-maccal').checked,
    });
    Object.assign(settings, saved);
    applySettings(); syncNoBl();
    for (const [id, f, ph] of [['s-key', 'hasAnthropicKey', 'sk-ant-...'], ['s-gkey', 'hasGeminiKey', 'AIza...'], ['s-grkey', 'hasGroqKey', 'gsk_...'], ['s-cfkey', 'hasCloudflareKey', 'API token']]) if ($(id).value) { $(id).value = ''; $(id).placeholder = settings[f] ? 'Key saved (type to replace)' : ph; }
    $('s-status').textContent = 'Saved';
    clearTimeout(saveNow.t2); saveNow.t2 = setTimeout(() => { $('s-status').textContent = ''; }, 1200);
  }
  // autosave: no Save button. Changes apply as you make them (typing waits for a short pause)
  let saveQ = Promise.resolve(), saveT = 0;
  const autosave = () => { saveQ = saveQ.then(saveNow).catch(() => { $('s-status').textContent = 'Could not save'; }); };
  settingsEl.addEventListener('change', (e) => { if (e.target.closest('#sec-ai, #sec-voice, #sec-look, #sec-access, #sec-cals, #sec-chess, #sec-general')) { clearTimeout(saveT); autosave(); } });
  settingsEl.addEventListener('input', (e) => { if (e.target.matches('input[type=text],input[type=range]') && e.target.id !== 's-find' && e.target.id !== 's-calname' && e.target.id !== 's-calurl') { clearTimeout(saveT); saveT = setTimeout(autosave, 700); } });

  pip.onMood((m) => {
    const now = performance.now();
    if (m.type === 'call') { st.inCall = !!m.on; if (m.on) showBubble("Zoom meeting, I'll stay quiet", 5000); return; }
    if (quiet()) return;
    if (settings.reactions === false && ['idle', 'music', 'copied', 'morning'].includes(m.type)) return;
    if (m.type === 'emote') { if (m.name === 'excited' || m.name === 'proud') startDance('flourish'); setEmotion(m.name, 6000); return; }
    if (m.type === 'idle') {
      const h = new Date().getHours();
      if (m.deep || h >= 23 || h < 5) { setEmotion('sleepy', 20000); showBubble(h >= 23 || h < 5 ? 'Zzz... it is bedtime for gliders.' : 'Zzz... I am taking a nap.', 8000); return; }
      const r = Math.random();
      if (r < 0.34) { setEmotion('yawn', 7000); showBubble('*stretches* Hello? Anyone there?', 5000); }
      else if (r < 0.67) { startDance(); showBubble('Nobody is looking. Dance party!', 5000); }
      else { setEmotion('bored', 9000); if (!st.hop) startHop(clamp(rand(minPetX(), maxPetX()), minPetX(), maxPetX()), 60); showBubble('Hello? Anyone there?', 5000); }
      return;
    }
    if (m.type === 'music') { if (m.on) { setEmotion('excited', 6000); startDance(); showBubble('Ooh, music!', 4000); } return; }
    if (m.type === 'copied') { alertUntil = now + 2500; if (Math.random() < 0.25) showBubble('Ooh, what did you copy?', 3000); return; }
    if (m.type === 'morning') { setEmotion('happy', 7000); showBubble('Good morning! Ready for today?', 6000); return; }
    if (m.type === 'return') {
      alertUntil = now + 4000;
      cheer(2200);
      if (!st.hop && !st.chatOpen) startHop(st.x, 38);
      {
        const L = m.level || 'new', long = m.away >= 60;
        const lines = m.grudge || L === 'hurt' ? ['Oh. You are back.', '...hi.']
          : L === 'wary' ? ['Oh, hello again.', 'Back already?']
          : L === 'close' || L === 'best friend' ? (long ? ['FINALLY. I missed you!', 'Where have you been?! I was so bored.'] : ['You are back! I knew you could not stay away.', 'Miss me?'])
          : L === 'friendly' ? ['Welcome back!', 'Hey, you are back!']
          : [long ? 'Welcome back! It has been a while' : 'Welcome back!'];
        showBubble(lines[Math.floor(Math.random() * lines.length)], 6000);
      }
    } else if (m.type === 'stretch') {
      alertUntil = now + 3000;
      showBubble(`You've been at it for ${m.mins >= 120 ? Math.round(m.mins / 60) + ' hours' : m.mins + ' minutes'}. Quick stretch?`, 10000);
    } else if (m.type === 'late') {
      showBubble("It's getting late... maybe time to wind down?", 9000);
    }
  });
  pip.onGame((g) => { st.gameOn = !!g.on; if (g.on) showBubble('Playing. Click me to stop the game.', 4000); });
  pip.onSettings((s) => { Object.assign(settings, s); applySettings(); syncNoBl(); });
  pip.onOpenChat(() => { if (!st.chatOpen) openChat(); else pip.focus(); });
  pip.onChatNote(({ text }) => { if (!st.chatOpen) openChat(); addMsg('pet', text); });
  pip.onClipHelper(async () => { // tray item or Ctrl/Cmd+Alt+C: one tap to do something useful with what you just copied
    if (!st.chatOpen) openChat();
    if (busy) return;
    const v = await pickOne('What should I do with what you copied?', [['summarize', 'Summarize'], ['explain', 'Explain'], ['reply', 'Draft a reply'], ['fix', 'Fix writing'], ['translate', 'Translate']]);
    if (v) send(v);
  });

  // ---------------------------------------------------------------- battery reactions
  try {
    navigator.getBattery().then((b) => {
      let low = false;
      const chk = () => {
        if (settings.reactions === false) return;
        if (!b.charging && b.level <= 0.15 && !low) { low = true; if (!quiet()) { setEmotion('nervous', 9000); showBubble('Your battery is low. Time for a charger?', 7000); } }
        else if (b.charging && low) { low = false; if (!quiet()) { setEmotion('happy', 5000); showBubble('Charging. Thank you!', 4000); } }
      };
      b.addEventListener('levelchange', chk); b.addEventListener('chargingchange', chk); chk();
    }).catch(() => {});
  } catch (_) {}

  // ---------------------------------------------------------------- status pill: what Pip is doing right now
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'position:absolute;left:0;top:0;padding:3px 10px;border-radius:10px;font-size:12px;background:var(--bg);color:var(--text);box-shadow:var(--shadow);pointer-events:none;opacity:0;transition:opacity .2s;white-space:nowrap;z-index:2';
  document.body.appendChild(statusEl);
  let statusText = '', statusT = 0;
  pip.onStatus(({ text }) => { statusText = noEmoji(text || '').slice(0, 60); statusT = performance.now(); });
  setInterval(() => {
    const now = performance.now();
    if (statusText && now - statusT > 40000) statusText = '';
    let label = statusText || (thinkingFlag ? 'Thinking...' : '');
    if (!label && st.rag) label = 'Whoa!';
    else if (!label && st.emo.name === 'dizzy' && now < st.emo.until) label = 'Dizzy...';
    else if (!label && st.napUntil > now) label = 'Napping';
    const show = !!label && !st.away;
    if (label) statusEl.textContent = label;
    statusEl.style.opacity = show ? '1' : '0';
    statusEl.style.transform = `translate(${(st.x + st.ax + SIZE / 2).toFixed(0)}px, ${(st.y + st.hopY + SIZE * 0.95).toFixed(0)}px) translateX(-50%)`;
  }, 120);

  // ---------------------------------------------------------------- mood memory at startup: a long absence makes him miss you
  refreshMood().then((m) => {
    if (!m || settings.moodMemory === false || m.absentHours < 30) return;
    setTimeout(() => {
      setEmotion('lonely', 9000);
      showBubble(m.grudge || m.bond < -15 ? 'Oh. You are back.' : m.bond > 15 ? 'I missed you!' : 'Hey, you are back.', 6000);
    }, 2500);
  });
  setInterval(refreshMood, 60000);

  // ---------------------------------------------------------------- games window: how Pip reacts to the game
  if (typeof PipGames !== 'undefined') PipGames.init({
    sfx,
    say: (t) => showBubble(t, 4500),
    emote: (name) => { if (name === 'excited' || name === 'proud') startDance('flourish'); setEmotion(name, 5000); },
    status: (t) => { statusText = t; statusT = performance.now(); },
    started: () => { pip.moodEvent('game'); setEmotion('excited', 3000); showBubble("Let's play!", 3000); },
    end: (game, result) => {
      if (result === 'pip') { sfx('win'); startDance(Math.random() < 0.5 ? 'backflip' : 'six_seven'); setEmotion('excited', 7000); showBubble('Good game!', 5000); }
      else if (result === 'player') { sfx('lose'); setEmotion(Math.random() < 0.5 ? 'sad' : 'surprised', 6000); if (st.emo.name !== 'sad') showBubble('Well played. You got me.', 5000); }
      else { sfx('draw'); setEmotion('neutral'); showBubble('A draw. Not bad!', 4500); }
    },
  });
  $('s-style').addEventListener('change', () => { settings.style = $('s-style').value; startDance('twirl'); }); // preview a cosmetic straight away
  $('s-species').addEventListener('change', () => { settings.species = $('s-species').value; startDance('twirl'); });
  { // pixel editor for "Draw your own Pip"
    const N = 32, frames = {}, cv = $('s-dcv'), fr = (k) => frames[k] || (frames[k] = Object.assign(document.createElement('canvas'), { width: N, height: N }));
    const cur = () => $('s-dstate').value;
    const show = () => { const v = cv.getContext('2d'); v.clearRect(0, 0, N, N); if (cur() !== 'idle') { v.globalAlpha = 0.25; v.drawImage(fr('idle'), 0, 0); v.globalAlpha = 1; } v.drawImage(fr(cur()), 0, 0); };
    const commit = () => { const d = {}; for (const k of DS) { const c = fr(k); if (c.getContext('2d').getImageData(0, 0, N, N).data.some((v, i) => i % 4 === 3 && v)) d[k] = c.toDataURL('image/png'); } settings.drawn = d; show(); };
    window.dLoad = () => { for (const k of DS) { const c = fr(k), x = c.getContext('2d'), u = (settings.drawn || {})[k]; x.clearRect(0, 0, N, N); if (u) { const im = new Image(); im.onload = () => { x.drawImage(im, 0, 0); show(); }; im.src = u; } } show(); };
    for (const c of ['#2b2b33', '#9a9ca6', '#e9e4d8', '#ffffff', '#c98a8f', '#e8b4b8', '#d9863f', '#e8c34a', '#6fae6a', '#6ab7c9', '#5b7bd6', '#8a6cc4']) {
      const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.addEventListener('click', () => { $('s-dcol').value = c; $('s-derase').checked = false; }); $('s-dsw').appendChild(b);
    }
    const plot = (x, y) => { const c = fr(cur()).getContext('2d'); for (const px of $('s-dmirror').checked ? [x, N - 1 - x] : [x]) { if ($('s-derase').checked) c.clearRect(px, y, 1, 1); else { c.fillStyle = $('s-dcol').value; c.fillRect(px, y, 1, 1); } } };
    let last = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [clamp(Math.floor((e.clientX - r.left) / r.width * N), 0, N - 1), clamp(Math.floor((e.clientY - r.top) / r.height * N), 0, N - 1)]; };
    const stroke = (e) => { const [x, y] = pos(e), [lx, ly] = last || [x, y], n = Math.max(Math.abs(x - lx), Math.abs(y - ly), 1); for (let i = 1; i <= n; i++) plot(Math.round(lx + (x - lx) * i / n), Math.round(ly + (y - ly) * i / n)); last = [x, y]; show(); };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); last = null; stroke(e); });
    cv.addEventListener('pointermove', (e) => { if (last) stroke(e); });
    cv.addEventListener('pointerup', () => { if (last) { last = null; commit(); } });
    $('s-dstate').addEventListener('change', show);
    $('s-dclear').addEventListener('click', () => { fr(cur()).getContext('2d').clearRect(0, 0, N, N); commit(); });
    $('s-dcopy').addEventListener('click', () => { const c = fr(cur()).getContext('2d'); c.clearRect(0, 0, N, N); c.drawImage(fr('idle'), 0, 0); commit(); });
    $('s-drawopen').addEventListener('click', () => { $('s-draw').hidden = !$('s-draw').hidden; });
  }
  $('s-skin').addEventListener('change', () => { settings.skin = $('s-skin').value; startDance('twirl'); });
  $('s-palette').addEventListener('change', () => { settings.palette = $('s-palette').value; });
  for (const [auto, sl, val] of [['s-blauto', 's-blunders', 's-blunders-v'], ['s-bralto', 's-brill', 's-brill-v']]) { // sliders with an "auto" tick box
    const sync = () => { $(sl).disabled = $(auto).checked; $(val).textContent = $(auto).checked ? 'auto' : $(sl).value; };
    $(auto).addEventListener('change', sync); $(sl).addEventListener('input', sync);
  }
  $('s-trymove').addEventListener('click', () => { const v = $('s-move').value; if (v === 'karate chop' || v === 'kick' || v === 'bow' || v === 'flex') improvise(v); else startDance(v); });
  const openGames = (which) => { PipGames.setLevel(chessLv()); PipGames.open(which); };

  // ---------------------------------------------------------------- start
  pip.getSettings().then((s) => {
    Object.assign(settings, s);
    if (typeof s.petX === 'number') { st.x = s.petX; clampX(); }
    applySettings();
    if (!s.seenIntro) {
      setTimeout(() => showBubble(`Hi! I'm ${settings.petName} Click me to chat, right-click for the menu!`, 8000), 1200);
      cheer(1500);
      pip.saveSettings({ seenIntro: true });
    }
  });

  requestAnimationFrame(frame);
})();

// let the mouse wheel scroll the quick-action chips sideways
(() => { const c = document.querySelector('.chips'); if (c) c.addEventListener('wheel', (e) => { if (e.deltaY) { c.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false }); })();
