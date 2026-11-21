'use strict';
/*
 * Voice chat, page side. Records one clip from the microphone (only after the user taps the mic),
 * stops by itself when they stop talking, and packs it as a small 16 kHz mono WAV.
 * Also cleans Pip's replies for reading aloud and speaks them with the computer's own voices
 * (nothing is sent anywhere for that). The pure helpers are tested in Node (selftest.js).
 */
(function (root) {
  const TARGET_RATE = 16000;

  function rms(f32) {
    let s = 0;
    for (let i = 0; i < f32.length; i++) s += f32[i] * f32[i];
    return Math.sqrt(s / (f32.length || 1));
  }

  // Averages neighbouring samples, which is good enough for speech and avoids harsh aliasing.
  function downsample(f32, inRate, outRate = TARGET_RATE) {
    if (outRate >= inRate) return f32;
    const ratio = inRate / outRate;
    const n = Math.floor(f32.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio), b = Math.min(f32.length, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += f32[j];
      out[i] = s / Math.max(1, b - a);
    }
    return out;
  }

  function floatTo16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const v = Math.max(-1, Math.min(1, f32[i]));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  }

  function encodeWav(int16, sampleRate = TARGET_RATE) {
    const bytes = int16.length * 2;
    const buf = new ArrayBuffer(44 + bytes);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, bytes, true);
    for (let i = 0; i < int16.length; i++) v.setInt16(44 + i * 2, int16[i], true);
    return new Uint8Array(buf);
  }

  function toBase64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // What Pip says out loud: no code, links, markdown marks or emoji, and not a whole essay.
  function speechText(md, maxChars = 700) {
    let t = String(md || '');
    const hadCode = /```/.test(t);
    t = t.replace(/```[\s\S]*?(```|$)/g, ' ');
    t = t.replace(/`([^`]*)`/g, '$1');
    t = t.replace(/https?:\/\/\S+/g, 'a link');
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\n]+)\*/g, '$1').replace(/__([^_]+)__/g, '$1');
    t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^\s*[-*•]\s+/gm, '').replace(/^\s*\d+[.)]\s+/gm, '');
    t = t.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');
    t = t.replace(/\s+/g, ' ').trim();
    if (hadCode) t = (t + ' I put the code in the chat.').trim();
    if (t.length > maxChars) {
      const cut = t.slice(0, maxChars);
      const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
      t = (end > maxChars * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')) + ' The rest is in the chat.';
    }
    return t;
  }

  // Records until the person stops talking (or taps again, or the time limit). One clip, nothing kept on disk.
  async function record(opts = {}) {
    const { silenceMs = 1400, maxMs = 60000, noSpeechMs = 8000, threshold = 0.02, onLevel } = opts;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const Ctx = root.AudioContext || root.webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    let firstVoice = -1, lastVoice = -1, lastVoiceAt = 0, finished = false;
    const startedAt = performance.now();
    let resolveFn;
    const done = new Promise((r) => { resolveFn = r; });

    function finish(reason) {
      if (finished) return;
      finished = true;
      try { proc.disconnect(); src.disconnect(); } catch (_) {}
      stream.getTracks().forEach((t) => t.stop());
      const rate = ctx.sampleRate;
      try { ctx.close(); } catch (_) {}
      const heard = firstVoice >= 0 && reason !== 'cancel';
      if (!heard) return resolveFn({ heard: false, reason });
      // keep a little before the first word and after the last one
      const from = Math.max(0, firstVoice - 3), to = Math.min(chunks.length, lastVoice + 5);
      let total = 0;
      for (let i = from; i < to; i++) total += chunks[i].length;
      const all = new Float32Array(total);
      let o = 0;
      for (let i = from; i < to; i++) { all.set(chunks[i], o); o += chunks[i].length; }
      const pcm = floatTo16(downsample(all, rate, TARGET_RATE));
      resolveFn({ heard: true, reason, ms: Math.round((pcm.length / TARGET_RATE) * 1000), audio: toBase64(encodeWav(pcm, TARGET_RATE)) });
    }

    proc.onaudioprocess = (e) => {
      if (finished) return;
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      const level = rms(d);
      if (onLevel) onLevel(level);
      const now = performance.now();
      if (level > threshold) { if (firstVoice < 0) firstVoice = chunks.length - 1; lastVoice = chunks.length - 1; lastVoiceAt = now; }
      if (firstVoice >= 0 && now - lastVoiceAt > silenceMs) finish('silence');
      else if (firstVoice < 0 && now - startedAt > noSpeechMs) finish('nospeech');
      else if (now - startedAt > maxMs) finish('max');
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    return { stop: () => finish('manual'), cancel: () => finish('cancel'), done };
  }

  // ---------------------------------------------------------------- reading replies aloud
  const canSpeak = () => !!(root.speechSynthesis && root.SpeechSynthesisUtterance);
  function stopSpeaking() { try { if (canSpeak()) root.speechSynthesis.cancel(); } catch (_) {} }
  function isSpeaking() { try { return canSpeak() && root.speechSynthesis.speaking; } catch (_) { return false; } }
  function speak(text, onEnd) {
    const t = speechText(text);
    if (!t || !canSpeak()) { if (onEnd) onEnd(); return false; }
    stopSpeaking();
    const u = new root.SpeechSynthesisUtterance(t);
    u.rate = 1.05; u.pitch = 1.15; // a little bright, like a small sugar glider
    u.onend = u.onerror = () => { if (onEnd) onEnd(); };
    root.speechSynthesis.speak(u);
    return true;
  }

  const api = { rms, downsample, floatTo16, encodeWav, toBase64, speechText, record, canSpeak, speak, stopSpeaking, isSpeaking, TARGET_RATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PipVoice = api;
})(typeof window !== 'undefined' ? window : globalThis);
