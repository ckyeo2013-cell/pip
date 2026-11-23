'use strict';
/*
 * Voice chat, hearing side (runs in the main process).
 * The page records one short clip and hands it over as base64 WAV; this turns it into words with
 * Cloudflare Workers AI, Groq or Google Gemini. Nothing is recorded or sent unless the user taps the mic.
 */

const STT_PROVIDERS = ['cloudflare', 'groq', 'gemini'];
const MAX_AUDIO_B64 = 4000000; // about 90 seconds of 16 kHz mono; the page stops at 60 s

const CF_STT_MODEL = '@cf/openai/whisper-large-v3-turbo';
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_STT_MODEL = 'whisper-large-v3-turbo';
const GEMINI_STT_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// A short hint that nudges Whisper toward how people really talk to Pip (Singlish/Manglish particles, app names),
// so "open Discord lah" is not heard as "open Discord lot".
const STT_HINT = 'Casual Singapore and Malaysia English. Short commands for a desktop pet: open Discord lah, open Spotify, open Chrome, ' +
  'open YouTube lor, play lofi on YouTube, message Sam on Discord, set a timer. Particles: lah, lor, leh, meh, sia, mah.';

const LABELS = { cloudflare: 'Cloudflare', groq: 'Groq', gemini: 'Google Gemini' };

// "auto" means the same company as the chat brain, but only if it can transcribe. Anthropic cannot, so
// those users pick one in settings; choosing it there is the consent for audio to go to that company.
function pickProvider(setting, chatProvider) {
  if (STT_PROVIDERS.includes(setting)) return setting;
  return STT_PROVIDERS.includes(chatProvider) ? chatProvider : null;
}

function errorMessage(provider, status, detail) {
  const who = LABELS[provider];
  const d = detail ? ` (${String(detail).slice(0, 160)})` : '';
  if (status === 401) return `${who} did not accept the key. Check it in Pip settings.${d}`;
  if (status === 403) return `${who} refused the recording. Check the key (for Cloudflare, the token needs the Workers AI permission and the Account ID must match).${d}`;
  if (status === 429) return `${who} says the free limit was reached. Wait a bit and try again.`;
  if (status === 413) return 'That recording was too long to send. Try a shorter message.';
  if (status >= 500) return `${who} had a problem (${status}). Try again in a moment.`;
  return `${who} could not turn that into text (${status}).${d}`;
}

async function readDetail(res) {
  try {
    const j = await res.json();
    return (j && j.error && (j.error.message || (typeof j.error === 'string' ? j.error : ''))) ||
      (Array.isArray(j && j.errors) && j.errors[0] && j.errors[0].message) || '';
  } catch (_) { return ''; }
}

const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 4000);

async function transcribe({ fetchFn, provider, apiKey, accountId, audioB64, timeoutMs = 60000 }) {
  if (!STT_PROVIDERS.includes(provider)) return { error: 'No hearing provider is chosen. Open the gear > Voice and pick one.' };
  if (typeof audioB64 !== 'string' || !audioB64 || audioB64.length > MAX_AUDIO_B64 || !/^[A-Za-z0-9+/=]+$/.test(audioB64)) {
    return { error: 'That recording was not usable. Try again.' };
  }

  let url, init;
  if (provider === 'cloudflare') {
    url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${CF_STT_MODEL}`;
    init = { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ audio: audioB64, task: 'transcribe', initial_prompt: STT_HINT }) };
  } else if (provider === 'groq') {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(audioB64, 'base64')], { type: 'audio/wav' }), 'voice.wav');
    form.append('model', GROQ_STT_MODEL);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    form.append('prompt', STT_HINT);
    url = GROQ_STT_URL;
    init = { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form }; // fetch sets the multipart type itself
  } else {
    url = GEMINI_STT_URL;
    init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: 'Transcribe the speech in this audio exactly as spoken. It is casual Singapore/Malaysia English, so keep slang particles such as lah, lor, leh, meh, sia and mah exactly as said (never "lot"). App names like Discord, Spotify and Chrome are common. Reply with only the spoken words, nothing else. If there is no speech, reply with nothing.' },
          { inlineData: { mimeType: 'audio/wav', data: audioB64 } },
        ] }],
      }),
    };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, { ...init, signal: ac.signal });
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'Turning your voice into text timed out. Try again.' : `Network problem (${e.message})` };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return { error: errorMessage(provider, res.status, await readDetail(res)) };

  let data;
  try { data = await res.json(); } catch (_) { return { error: 'The hearing service sent back something unreadable. Try again.' }; }

  let text = '';
  if (provider === 'cloudflare') {
    text = (data && data.result && data.result.text) || (data && data.text) || '';
  } else if (provider === 'groq') {
    text = (data && data.text) || '';
  } else {
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    text = Array.isArray(parts) ? parts.map((p) => (p && p.text) || '').join(' ') : '';
  }
  text = clean(text);
  // on near-silence Whisper sometimes parrots the hint back; never act on that
  if (provider !== 'gemini' && text.length > 40 && STT_HINT.includes(text.slice(0, 40))) text = '';
  return { text };
}

// ---- dictation clean-up (Wispr-Flow style): drop fillers and stutters, turn spoken punctuation into marks, tidy capitals
function tidy(text) {
  let t = ' ' + clean(text) + ' ';
  t = t.replace(/\b(?:um+|uh+|er+|erm|ah+|hmm+|you know,?|i mean,?|sort of like|kind of like)\b[,.]?/gi, ' ');
  t = t.replace(/\b(\w+)(\s+\1\b)+/gi, '$1'); // "I I want" -> "I want"
  const sp = [[/\s*\b(?:new paragraph)\b[,.]?\s*/gi, '\n\n'], [/\s*\b(?:new line|next line)\b[,.]?\s*/gi, '\n'], [/\s*\bquestion mark\b/gi, '?'], [/\s*\bexclamation (?:mark|point)\b/gi, '!'],
    [/\s*\bfull stop\b|\s*\bperiod\b(?=\s|$)/gi, '.'], [/\s*\bcomma\b/gi, ','], [/\s*\bcolon\b/gi, ':'], [/\s*\bsemicolon\b/gi, ';']];
  for (const [re, r] of sp) t = t.replace(re, r);
  const scratch = t.match(/^(.*[.!?\n])?[^.!?\n]*\bscratch that\b[,.]?\s*(.*)$/is); // "scratch that" drops what came before it in the sentence
  if (scratch) t = (scratch[1] || '') + ' ' + scratch[2];
  t = t.replace(/\s+([,.!?:;])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/ ?\n ?/g, '\n').trim();
  t = t.replace(/(^|[.!?]\s+|\n)([a-z])/g, (_m, a, b) => a + b.toUpperCase()).replace(/\bi\b(?=['\s,.!?]|$)/g, 'I');
  return t;
}

// ---- natural speech (text to voice) with the same providers and keys as hearing
const TTS_TEXT_MAX = 700;
function wavFromPcm16(pcm, rate) {
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const VOICES = { // [Gemini, Groq Orpheus, Cloudflare Aura] per voice character
  cheerful: ['Leda', 'hannah', 'luna'], bright: ['Zephyr', 'autumn', 'stella'], calm: ['Aoede', 'diana', 'athena'], deep: ['Charon', 'troy', 'orion'],
};
let auraBroken = false; // if Cloudflare's Aura voice errors once, stay on MeloTTS for this session
async function synthesize({ fetchFn, provider, apiKey, accountId, text, style, timeoutMs = 30000 }) {
  const vc = VOICES[style] || VOICES.cheerful;
  const t = clean(text).slice(0, TTS_TEXT_MAX);
  if (!t || !STT_PROVIDERS.includes(provider)) return { error: 'no voice' };
  let url, init;
  if (provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';
    init = { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify({
      contents: [{ parts: [{ text: 'Say this in a warm, bright, natural, friendly voice, like a cheerful friend: ' + t }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: vc[0] } } } } }) };
  } else if (provider === 'cloudflare') {
    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/`, hd = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
    if (!auraBroken) { // Deepgram Aura sounds far more human than MeloTTS; it returns the audio itself rather than JSON
      try {
        const r = await fetchFn(base + '@cf/deepgram/aura-1', { method: 'POST', headers: hd, body: JSON.stringify({ text: t, speaker: vc[2] }) });
        const ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '');
        if (r.ok && /audio/i.test(ct)) return { audio: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: ct.split(';')[0] };
        if (r.ok) { const j = await r.json().catch(() => null); const a = j && j.result && j.result.audio; if (a) return { audio: a, mime: 'audio/mpeg' }; }
        auraBroken = true;
      } catch (_) { auraBroken = true; }
    }
    url = base + '@cf/myshell-ai/melotts';
    init = { method: 'POST', headers: hd, body: JSON.stringify({ prompt: t, lang: 'en' }) };
  } else {
    url = 'https://api.groq.com/openai/v1/audio/speech';
    init = { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: 'canopylabs/orpheus-v1-english', voice: vc[1], input: t, response_format: 'wav' }) };
  }
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: ac.signal });
    if (!res.ok) return { error: errorMessage(provider, res.status, await readDetail(res)) };
    if (provider === 'groq') return { audio: Buffer.from(await res.arrayBuffer()).toString('base64'), mime: 'audio/wav' };
    const data = await res.json();
    if (provider === 'cloudflare') { const a = data && data.result && data.result.audio; return a ? { audio: a, mime: 'audio/mpeg' } : { error: 'no audio' }; }
    const part = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const b64 = Array.isArray(part) && part.find((p) => p && p.inlineData && p.inlineData.data);
    return b64 ? { audio: wavFromPcm16(Buffer.from(b64.inlineData.data, 'base64'), 24000).toString('base64'), mime: 'audio/wav' } : { error: 'no audio' };
  } catch (e) { return { error: e.name === 'AbortError' ? 'timed out' : e.message }; } finally { clearTimeout(timer); }
}

module.exports = { VOICES, STT_HINT, transcribe, tidy, synthesize, pickProvider, STT_PROVIDERS, LABELS, MAX_AUDIO_B64 };
