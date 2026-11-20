/*
 * Pip desktop renderer: draws the 3D pet (tiny WebGL ellipsoid renderer),
 * makes it roam the desktop, and runs the chat / settings panel.
 */
(() => {
  'use strict';
  const Model = globalThis.GliderModel;
  const pip = window.pip;

  const SIZE = 220;
  const FEET = 0.78; // where the feet sit inside the 220px square (fraction of height)
  const settings = { petName: 'Pip', palette: 'classic', wander: true, quips: true, seenIntro: false, hasKey: false };
  const area = { w: window.innerWidth, h: window.innerHeight };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const rand = (a, b) => a + Math.random() * (b - a);

  const QUIPS = [
    'Sip some water? 💧',
    'Quick stretch time! 🙆',
    'Roll your shoulders back~',
    'Look away from the screen for 20 seconds 👀',
    'You are doing great ✨',
    'Snack break? 🍎',
    'Psst... right-click me for the menu!',
    'Click me if you need help deciding something!',
    'Deep breath in... and out 🌿',
    'Posture check! 🪑',
  ];

  const $ = (id) => document.getElementById(id);
  const petEl = $('pet'), shEl = $('sh'), bubble = $('bubble'), panel = $('panel');
  const msgs = $('msgs'), inp = $('inp'), settingsEl = $('settings');
  const canvas = document.querySelector('canvas');

  // ---------------------------------------------------------------- WebGL
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.height = Math.round(SIZE * dpr);
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
  let sphereCount = 0;
  const U = {};

  if (gl) {
    const VS = `
      attribute vec3 aP;
      uniform vec3 uC; uniform vec3 uR; uniform mat3 uM; uniform float uScale;
      varying vec3 vN; varying vec3 vL;
      void main() {
        vec3 wp = uM * (aP * uR) + uC;
        vN = normalize(uM * (aP / uR));
        vL = aP;
        gl_Position = vec4(wp.x * uScale, wp.y * uScale, -wp.z * 0.25 * uScale, 1.0);
      }`;
    const FS = `
      precision mediump float;
      varying vec3 vN; varying vec3 vL;
      uniform vec3 uColor; uniform float uSpec; uniform float uFur;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 n = normalize(vN);
        vec3 L = normalize(vec3(-0.45, 0.75, 0.75));
        float d = smoothstep(0.08, 0.95, dot(n, L) * 0.5 + 0.5);
        vec3 shade = mix(uColor * 0.58 * vec3(0.92, 0.93, 1.05), uColor * 1.08, d);
        float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.2);
        shade += vec3(1.0, 0.93, 0.85) * rim * 0.2 * uFur;
        shade *= 1.0 + (hash(floor(vL * 34.0)) - 0.5) * 0.07 * uFur;
        vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
        shade += vec3(pow(max(dot(n, H), 0.0), 60.0) * uSpec);
        gl_FragColor = vec4(shade, 1.0);
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    for (const n of ['C', 'R', 'M', 'Color', 'Spec', 'Fur', 'Scale']) U[n] = gl.getUniformLocation(prog, 'u' + n);

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
    sphereCount = idx.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aP');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(U.Scale, 1 / 1.8);
  } else {
    canvas.style.display = 'none';
    $('fallback').style.display = 'block';
  }

  function draw(parts) {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const p of parts) {
      gl.uniform3fv(U.C, p.c);
      gl.uniform3fv(U.R, p.r);
      gl.uniformMatrix3fv(U.M, false, p.M);
      gl.uniform3fv(U.Color, p.color);
      gl.uniform1f(U.Spec, p.spec);
      gl.uniform1f(U.Fur, p.fur);
      gl.drawElements(gl.TRIANGLES, sphereCount, gl.UNSIGNED_SHORT, 0);
    }
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
    hopY: 0,
    happy: 0,
    thinking: 0,
    nextBlink: performance.now() + 2500,
    blinkT: -1,
    nextHop: performance.now() + rand(6000, 12000),
    nextQuip: performance.now() + rand(40000, 80000),
    dragging: false,
    chatOpen: false,
  };
  const mouse = { x: area.w / 2, y: area.h / 2 };
  let thinkingFlag = false;
  let happyUntil = 0;
  let bubbleTimer = 0;
  let interactive = false;

  function clampX() { st.x = clamp(st.x, -30, Math.max(-30, area.w - SIZE + 30)); }

  function startHop(tx, h, ty) {
    ty = ty === undefined ? st.y : ty;
    const dx = Math.abs(tx - st.x), dy = Math.abs(ty - st.y);
    const dist = Math.hypot(dx, dy);
    st.hop = {
      t0: performance.now(), dur: 550 + dist * 1.2,
      fx: st.x, tx, fy: st.y, ty, h, far: dist > 70,
    };
    if (dx > 10) st.face = tx > st.x ? 1 : -1;
  }

  function showBubble(text, ms = 5000) {
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
  }
  function cheer(ms = 1300) { happyUntil = performance.now() + ms; }

  // ---------------------------------------------------------------- loop
  let lastRender = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastRender < 28) return; // ~35 fps keeps the overlay light on the GPU
    lastRender = now;

    // wandering: hops, plus the occasional long glide across the desktop
    if (!st.hop && !st.dragging && !st.chatOpen && settings.wander && now > st.nextHop) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const big = Math.random() < 0.3;
      const span = big ? rand(500, Math.max(600, area.w * 0.5)) : rand(120, 380);
      let tx = clamp(st.x + dir * span, 8, area.w - SIZE - 8);
      if (Math.abs(tx - st.x) < 90) tx = clamp(st.x - dir * span, 8, area.w - SIZE - 8);
      if (Math.abs(tx - st.x) >= 90) startHop(tx, big ? 150 : 60);
      st.nextHop = now + rand(10000, 24000);
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
    const tYaw = clamp((mouse.x - cx) / 400, -1, 1) * 0.75;
    const tPitch = clamp((cy - mouse.y) / 400, -1, 1) * 0.4;
    st.lookYaw += (tYaw - st.lookYaw) * 0.12;
    st.lookPitch += (tPitch - st.lookPitch) * 0.12;

    const tBody = st.hop && st.hop.far ? st.face * 1.15 : st.face * 0.45;
    st.bodyYaw += (tBody - st.bodyYaw) * 0.14;

    let blink = 1;
    if (st.blinkT < 0 && now > st.nextBlink) st.blinkT = now;
    if (st.blinkT >= 0) {
      const k = (now - st.blinkT) / 150;
      if (k >= 1) { st.blinkT = -1; st.nextBlink = now + rand(2000, 5500); }
      else blink = Math.abs(k * 2 - 1);
    }

    st.happy += ((now < happyUntil ? 1 : 0) - st.happy) * 0.2;
    st.thinking += ((thinkingFlag ? 1 : 0) - st.thinking) * 0.14;

    if (gl) {
      draw(Model.buildParts({
        t: now / 1000,
        bodyYaw: st.bodyYaw,
        lookYaw: st.lookYaw,
        lookPitch: st.lookPitch,
        glide: st.glide,
        blink,
        happy: st.happy,
        thinking: st.thinking,
        palette: settings.palette,
      }));
    }

    petEl.style.transform = `translate(${st.x.toFixed(1)}px, ${(st.y + st.hopY).toFixed(1)}px)`;
    const feetY = st.y + SIZE * FEET;
    const sc = clamp(1 + st.hopY / 260, 0.5, 1);
    shEl.style.transform = `translate(${(st.x + SIZE / 2 - 42).toFixed(1)}px, ${(feetY - 6).toFixed(1)}px) scale(${sc.toFixed(2)})`;
    shEl.style.opacity = String(clamp(1 + st.hopY / 140, 0.3, 1));

    if (settings.quips && !st.chatOpen && !st.dragging && now > st.nextQuip) {
      showBubble(QUIPS[Math.floor(Math.random() * QUIPS.length)], 6000);
      cheer(900);
      st.nextQuip = now + rand(90000, 180000);
    }

    if (st.chatOpen) positionPanel();
  }

  // ---------------------------------------------------------------- mouse
  function overPet(x, y) {
    const dx = (x - (st.x + SIZE / 2)) / (SIZE * 0.3);
    const dy = (y - (st.y + st.hopY + SIZE * 0.55)) / (SIZE * 0.4);
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
    const want = st.dragging || hot || overPanel(mouse.x, mouse.y);
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
    drag = { sx: e.clientX, sy: e.clientY, ox: st.x, oy: st.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      st.dragging = true;
      st.hop = null;
      st.hopY = 0;
      st.glide = 0.6;
      canvas.classList.add('drag');
    }
    if (drag.moved) {
      st.x = drag.ox + dx;
      st.y = clamp(drag.oy + dy, 0, floorY());
      clampX();
    }
  });
  const endDrag = (e) => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    st.dragging = false;
    st.glide = 0;
    canvas.classList.remove('drag');
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    if (wasDrag) {
      // glide back down to the desktop floor like a proper sugar glider
      if (Math.abs(st.y - floorY()) > 4) startHop(st.x, 25, floorY());
      pip.savePos(st.x);
      st.nextHop = performance.now() + rand(8000, 16000);
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
    if (!st.hop && !st.dragging) st.y = floorY();
  });

  // ---------------------------------------------------------------- chat
  let history = [];
  let convoCtx = null;
  let busy = false;
  let wide = false;
  let reopenAfter = false; // reopen the chat after an action that needed the panel out of the way
  const cards = new Map(); // pending approval cards by id

  function positionPanel() {
    const W = wide ? Math.min(620, area.w - 24) : 330;
    const H = Math.min(wide ? 680 : 440, area.h - 24);
    panel.style.width = W + 'px';
    panel.style.height = H + 'px';
    let left, top;
    if (st.y + 50 - H >= 12) {
      left = clamp(st.x + SIZE / 2 - W / 2, 12, area.w - W - 12);
      top = st.y + 50 - H;
    } else {
      left = st.x - W - 4 >= 12 ? st.x - W - 4 : st.x + SIZE + 4;
      left = clamp(left, 12, area.w - W - 12);
      top = clamp(st.y, 12, area.h - H - 12);
    }
    panel.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

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
      cp.addEventListener('click', () => { pip.copyText(code); cp.textContent = 'Copied ✓'; setTimeout(() => { cp.textContent = 'Copy'; }, 1400); });
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
    d.innerHTML = '<i></i><i></i><i></i>';
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  function greet() {
    addMsg('pet', `Hi! I'm ${settings.petName} 🐾 Ask me anything, or tell me your options and I'll pick one for you!`);
  }

  function openChat() {
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

  async function send(text, opts = {}) {
    text = text.trim();
    if (busy || !text) return;
    addMsg('user', text);
    if (opts.ctx) convoCtx = opts.ctx;
    history.push({ role: 'user', content: text });
    busy = true;
    thinkingFlag = true;
    const typing = addTyping();
    try {
      const res = await pip.chat({ messages: trimmedHistory(), ctx: convoCtx });
      typing.remove();
      if (res.error === 'no_key') {
        history.pop();
        addMsg('pet', `I need ${res.provider === 'gemini' ? 'a Google Gemini key' : res.provider === 'groq' ? 'a Groq key' : 'an Anthropic key'} before I can chat! Tap the ⚙ above and paste one in. (Coin flips work without it 🪙)`);
      } else if (res.error) {
        history.pop();
        addMsg('pet', 'Oops, something went wrong: ' + res.error);
      } else {
        history.push({ role: 'assistant', content: res.text });
        addMsg('pet', res.text);
        cheer(1100);
      }
    } catch (e) {
      typing.remove();
      history.pop();
      addMsg('pet', 'I could not reach my brain just now. Try again in a moment.');
    } finally {
      busy = false;
      thinkingFlag = false;
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
    h.textContent = (danger ? '⚠️ ' : '🔒 ') + title;
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
    ok.addEventListener('click', () => settle(true, '✓ Approved'));
    no.addEventListener('click', () => settle(false, '✗ Declined'));
    acts.append(ok, no, res);
    card.append(h, pre, acts);
    msgs.appendChild(card);
    msgs.scrollTop = msgs.scrollHeight;
    cards.set(id, (label) => settle(null, label));
    pip.focus();
  }
  pip.onApproval(showApproval);
  pip.onApprovalExpired(({ id }) => { const f = cards.get(id); if (f) f('⏱ Expired'); });
  pip.onSay(({ text, ms }) => showBubble(text, ms || 3000));
  pip.onHidePanel(() => { if (st.chatOpen) { reopenAfter = true; closeChat(); } });

  function localReply(userText, petText) {
    addMsg('user', userText);
    addMsg('pet', petText);
    cheer(1100);
  }

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
  $('expand').addEventListener('click', () => { wide = !wide; $('expand').textContent = wide ? '⤡' : '⤢'; positionPanel(); });
  $('reset').addEventListener('click', () => {
    history = [];
    convoCtx = null;
    msgs.textContent = '';
    greet();
  });

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
        localReply('Flip a coin', Math.random() < 0.5 ? 'Heads! 🪙' : 'Tails! 🪙');
        break;
      case 'fact':
        send('Tell me a surprising, fun fact I probably do not know.');
        break;
      case 'cheer':
        send('I could use a little cheering up!');
        break;
      case 'screen':
        if (settings.actions === false) localReply('🖥️ Help with my screen', 'Turn on "Let Pip do things for me" in the ⚙ settings, and I can look at your screen (only after you approve each look).');
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
      case 'clip': {
        let text = '';
        try { text = (await pip.readClipboard()).trim(); } catch (_) {}
        if (!text) localReply('📋 What I copied', 'Your clipboard is empty. Copy some text first, then ask me again!');
        else send('Explain or summarize what I copied.', { ctx: { text } });
        break;
      }
    }
  });

  // ---------------------------------------------------------------- settings
  function applySettings() {
    $('nm').textContent = settings.petName;
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
      name.textContent = (c.kind === 'file' ? '📄 ' : '🔗 ') + c.label;
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
    calStatus(`Added ✓ (found ${r.events} event${r.events === 1 ? '' : 's'})`);
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
    $('s-anth').classList.toggle('hidden', v === 'gemini' || v === 'groq');
  }
  $('s-provider').addEventListener('change', showProvider);
  $('s-getkey-a').addEventListener('click', () => pip.openKeyPage('anthropic'));
  $('s-getkey-g').addEventListener('click', () => pip.openKeyPage('gemini'));
  $('s-getkey-gr').addEventListener('click', () => pip.openKeyPage('groq'));

  function openSettings() {
    $('s-key').value = '';
    $('s-key').placeholder = settings.hasAnthropicKey ? 'Key saved ✓ (type to replace)' : 'sk-ant-...';
    $('s-gkey').value = '';
    $('s-gkey').placeholder = settings.hasGeminiKey ? 'Key saved ✓ (type to replace)' : 'AIza...';
    $('s-grkey').value = '';
    $('s-grkey').placeholder = settings.hasGroqKey ? 'Key saved ✓ (type to replace)' : 'gsk_...';
    $('s-grmodel').value = settings.groqModel || 'llama-3.3-70b-versatile';
    $('s-provider').value = settings.provider || 'anthropic';
    $('s-gmodel').value = settings.geminiModel || 'gemini-2.5-flash';
    showProvider();
    $('s-name').value = settings.petName;
    $('s-palette').value = settings.palette;
    $('s-model').value = settings.model || 'claude-haiku-5-5';
    $('s-wander').checked = !!settings.wander;
    $('s-quips').checked = !!settings.quips;
    $('s-login').checked = !!settings.openAtLogin;
    $('s-actions').checked = settings.actions !== false;
    $('s-full').checked = settings.fullAccess !== false;
    $('s-folder').textContent = settings.workFolder || 'None chosen';
    renderCals(settings.calendars || []);
    $('s-maccal-wrap').classList.toggle('hidden', settings.platform !== 'darwin');
    $('s-maccal').checked = !!settings.macCalendar;
    calStatus('');
    $('s-status').textContent = '';
    settingsEl.classList.add('open');
  }
  $('gear').addEventListener('click', () => (settingsEl.classList.contains('open') ? settingsEl.classList.remove('open') : openSettings()));
  $('s-cancel').addEventListener('click', () => settingsEl.classList.remove('open'));
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
  $('s-save').addEventListener('click', async () => {
    const saved = await pip.saveSettings({
      apiKey: $('s-key').value,
      geminiKey: $('s-gkey').value,
      provider: $('s-provider').value,
      geminiModel: $('s-gmodel').value,
      groqKey: $('s-grkey').value,
      groqModel: $('s-grmodel').value,
      petName: $('s-name').value,
      palette: $('s-palette').value,
      model: $('s-model').value,
      wander: $('s-wander').checked,
      quips: $('s-quips').checked,
      openAtLogin: $('s-login').checked,
      actions: $('s-actions').checked,
      fullAccess: $('s-full').checked,
      macCalendar: $('s-maccal').checked,
    });
    Object.assign(settings, saved);
    applySettings();
    $('s-status').textContent = 'Saved ✓';
    setTimeout(() => settingsEl.classList.remove('open'), 700);
  });

  pip.onSettings((s) => { Object.assign(settings, s); applySettings(); });
  pip.onOpenChat(() => { if (!st.chatOpen) openChat(); else pip.focus(); });

  // ---------------------------------------------------------------- start
  pip.getSettings().then((s) => {
    Object.assign(settings, s);
    if (typeof s.petX === 'number') { st.x = s.petX; clampX(); }
    applySettings();
    if (!s.seenIntro) {
      setTimeout(() => showBubble(`Hi! I'm ${settings.petName} 🐾 Click me to chat, right-click for the menu!`, 8000), 1200);
      cheer(1500);
      pip.saveSettings({ seenIntro: true });
    }
  });

  requestAnimationFrame(frame);
})();
