/* Pip's sound effects: tiny synthesized sounds (Web Audio, no audio files). PipSfx.play('hop'), PipSfx.setEnabled(false), PipSfx.setVolume(0..1) */
(function (root) {
  let ctx = null, enabled = true, volume = 0.5, master = null;
  const last = {};
  function ac() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination); } catch (_) { ctx = null; }
    return ctx;
  }
  // one note: type, start frequency, end frequency (glide), length in seconds, loudness, delay, optional vibrato
  function tone(type, f0, f1, dur, vol, delay, vib) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * volume), t0 + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = vib[0]; lg.gain.value = vib[1]; l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + dur); }
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, delay, freq) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (delay || 0), n = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq || 1200;
    g.gain.value = vol * volume;
    s.connect(f); f.connect(g); g.connect(master); s.start(t0);
  }
  const SOUNDS = {
    hop: () => tone('sine', 330, 620, 0.12, 0.5),
    land: () => { tone('sine', 160, 70, 0.14, 0.6); noise(0.05, 0.25, 0, 500); },
    bounce: () => { tone('sine', 220, 90, 0.12, 0.6); noise(0.04, 0.3, 0, 400); },
    flap: () => noise(0.06, 0.15, 0, 2500),
    pop: () => tone('sine', 520, 780, 0.07, 0.35),
    open: () => { tone('sine', 440, 440, 0.06, 0.3); tone('sine', 660, 660, 0.08, 0.3, 0.06); },
    dance: () => { tone('triangle', 196, 196, 0.1, 0.45); tone('triangle', 247, 247, 0.1, 0.45, 0.14); tone('triangle', 294, 294, 0.12, 0.45, 0.28); },
    happy: () => { tone('sine', 523, 523, 0.09, 0.45); tone('sine', 784, 784, 0.14, 0.45, 0.09); },
    excited: () => { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.09, 0.45, i * 0.08)); },
    sad: () => tone('sine', 440, 220, 0.7, 0.45, 0, [5, 6]),
    mad: () => { tone('sawtooth', 110, 90, 0.35, 0.35, 0, [14, 8]); noise(0.2, 0.2, 0, 300); },
    scared: () => tone('sine', 880, 900, 0.5, 0.35, 0, [14, 40]),
    surprised: () => tone('square', 400, 900, 0.1, 0.25),
    love: () => { tone('sine', 392, 392, 0.18, 0.4); tone('sine', 494, 494, 0.22, 0.4, 0.12); },
    shy: () => tone('sine', 600, 500, 0.2, 0.3),
    bored: () => tone('triangle', 200, 170, 0.5, 0.3),
    confused: () => { tone('sine', 400, 500, 0.12, 0.35); tone('sine', 500, 380, 0.16, 0.35, 0.14); },
    proud: () => { tone('triangle', 392, 392, 0.12, 0.45); tone('triangle', 523, 523, 0.22, 0.45, 0.12); },
    sleepy: () => tone('sine', 300, 150, 0.9, 0.3),
    yawn: () => tone('sine', 350, 160, 1.0, 0.3, 0, [3, 4]),
    dizzy: () => tone('sine', 500, 500, 0.8, 0.35, 0, [7, 120]),
    nervous: () => tone('sine', 700, 700, 0.4, 0.25, 0, [11, 25]),
    lonely: () => tone('sine', 330, 247, 0.6, 0.35),
    jealous: () => tone('sawtooth', 220, 180, 0.3, 0.25),
    disgusted: () => tone('sawtooth', 180, 120, 0.3, 0.25, 0, [9, 10]),
    embarrassed: () => tone('sine', 700, 450, 0.25, 0.3),
    move: () => { noise(0.04, 0.5, 0, 900); tone('sine', 300, 200, 0.05, 0.3); },
    capture: () => { noise(0.07, 0.6, 0, 700); tone('sine', 220, 110, 0.1, 0.5); },
    check: () => { tone('square', 700, 700, 0.08, 0.25); tone('square', 880, 880, 0.12, 0.25, 0.1); },
    win: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.14, 0.5, i * 0.1)); },
    lose: () => { [392, 330, 262, 196].forEach((f, i) => tone('sine', f, f, 0.22, 0.45, i * 0.16)); },
    draw: () => { tone('sine', 392, 392, 0.2, 0.4); tone('sine', 392, 392, 0.2, 0.4, 0.22); },
    tick: () => tone('square', 1200, 1200, 0.02, 0.15),
  };
  function play(name) {
    if (!enabled || volume <= 0) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    const now = Date.now();
    if (last[name] && now - last[name] < 90) return; // never machine-gun the same sound
    last[name] = now;
    try { const c = ac(); if (c && c.state === 'suspended') c.resume(); fn(); } catch (_) {}
  }
  const api = { play, names: Object.keys(SOUNDS), setEnabled: (v) => { enabled = !!v; }, setVolume: (v) => { volume = Math.max(0, Math.min(1, Number(v) || 0)); } };
  root.PipSfx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
