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
    init = { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ audio: audioB64, task: 'transcribe' }) };
  } else if (provider === 'groq') {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(audioB64, 'base64')], { type: 'audio/wav' }), 'voice.wav');
    form.append('model', GROQ_STT_MODEL);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    url = GROQ_STT_URL;
    init = { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form }; // fetch sets the multipart type itself
  } else {
    url = GEMINI_STT_URL;
    init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: 'Transcribe the speech in this audio exactly as spoken. Reply with only the spoken words, nothing else. If there is no speech, reply with nothing.' },
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
  return { text: clean(text) };
}

module.exports = { transcribe, pickProvider, STT_PROVIDERS, LABELS, MAX_AUDIO_B64 };
