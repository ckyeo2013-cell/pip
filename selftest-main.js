'use strict';
// Loads main.js against a pretend Electron to check provider settings, routing and approval wording.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pipmain-'));
const handlers = {}, listeners = {}, sent = [];
class Win {
  constructor() { this.webContents = { send: (c, p) => sent.push([c, p]), on() {}, setWindowOpenHandler() {} }; }
  setIgnoreMouseEvents() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} loadFile() {} once() {} on() {} showInactive() {}
  isVisible() { return true; } isDestroyed() { return false; } setBounds() {} hide() {} blur() {} focus() {}
}
const electron = {
  app: { requestSingleInstanceLock: () => true, on() {}, quit() {}, getPath: () => userData, dock: null, setLoginItemSettings() {}, whenReady: () => ({ then: (f) => { f(); } }) },
  BrowserWindow: Win,
  Tray: class { on() {} setToolTip() {} setContextMenu() {} },
  Menu: { buildFromTemplate: () => ({ popup() {} }) },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 }, size: { width: 1200, height: 800 }, scaleFactor: 1, id: 1 }), getCursorScreenPoint: () => ({ x: 0, y: 0 }), on() {} },
  ipcMain: { handle: (c, f) => { handlers[c] = f; }, on: (c, f) => { listeners[c] = f; } },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}) },
  safeStorage: { isEncryptionAvailable: () => false },
  dialog: {}, shell: { openExternal: async (u) => { opened.push(u); }, trashItem: async () => {}, openPath: async () => '', showItemInFolder() {} },
  desktopCapturer: {}, systemPreferences: {}, Notification: class { static isSupported() { return false; } },
};
const opened = [];
const realLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? electron : realLoad.call(this, req, ...rest); };

const calls = [];
let script = [];
global.fetch = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  const r = script.shift();
  return { ok: true, status: 200, json: async () => r };
};
const txt = (t) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });

(async () => {
  require('./main.js');
  const intervalKillers = setTimeout(() => {}, 0); // keep node alive until we finish
  let n = 0;
  const t = async (name, fn) => { try { await fn(); n++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n     ' + e.stack); process.exitCode = 1; } };

  await t('default provider is Anthropic and asks for a key', async () => {
    const s = await handlers['settings:get']();
    assert.strictEqual(s.provider, 'anthropic');
    assert.strictEqual(s.groqModel, 'openai/gpt-oss-120b');
    assert.deepStrictEqual([s.hasAnthropicKey, s.hasGeminiKey], [false, false]);
    const r = await handlers.chat({}, { messages: [{ role: 'user', content: 'hi' }] });
    assert.deepStrictEqual(r, { error: 'no_key', provider: 'anthropic' });
  });
  await t('saving a Gemini key + model never leaks the key to the page', async () => {
    const s = await handlers['settings:save']({}, { provider: 'gemini', geminiKey: 'AIzaSECRET', geminiModel: ' models/gemini-2.5-flash-lite ' });
    assert.strictEqual(s.provider, 'gemini');
    assert.strictEqual(s.geminiModel, 'gemini-2.5-flash-lite');
    assert.strictEqual(s.hasGeminiKey, true);
    assert.ok(!JSON.stringify(s).includes('AIzaSECRET'));
    assert.ok(!('geminiKeyPlain' in s) && !('geminiKeyEnc' in s));
    const bad = await handlers['settings:save']({}, { provider: 'evil', geminiModel: '../../x?y' });
    assert.strictEqual(bad.provider, 'gemini');
    assert.strictEqual(bad.geminiModel, 'gemini-2.5-flash-lite');
  });
  await t('chat goes to Gemini with the saved key and model', async () => {
    script = [txt('Hi from Gemini')];
    const r = await handlers.chat({}, { messages: [{ role: 'user', content: 'hello' }] });
    assert.deepStrictEqual(r, { text: 'Hi from Gemini' });
    assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash-lite:generateContent/);
    assert.strictEqual(calls[0].init.headers['x-goog-api-key'], 'AIzaSECRET');
    assert.ok(calls[0].body.tools[0].functionDeclarations.some((d) => d.name === 'open_system_settings'));
    assert.match(calls[0].body.systemInstruction.parts[0].text, /Control Panel and settings/);
  });
  await t('approval cards on Gemini say who receives the data, and Approve/Decline work', async () => {
    sent.length = 0;
    script = [{ candidates: [{ content: { parts: [{ functionCall: { name: 'look_at_screen', args: {} } }] } }] }, txt('Okay, not looking.')];
    const p = handlers.chat({}, { messages: [{ role: 'user', content: 'what is on my screen' }] });
    await new Promise((r) => setTimeout(r, 50));
    const req = sent.find((m) => m[0] === 'approve:request');
    assert.ok(req, 'approval request was sent');
    assert.match(req[1].details, /Google's Gemini \(free tier: Google may use and review it\)/);
    assert.ok(!/Anthropic/.test(req[1].details));
    listeners['approve:response']({}, { id: req[1].id, ok: false });
    assert.deepStrictEqual(await p, { text: 'Okay, not looking.' });
    assert.match(calls[calls.length - 1].body.contents[2].parts[0].functionResponse.response.error, /declined/);
  });
  await t('switching back to Anthropic uses the Anthropic API and its own (separate) key slot', async () => {
    await handlers['settings:save']({}, { provider: 'anthropic', apiKey: 'sk-ant-X', model: 'claude-sonnet-5-5' });
    script = [{ content: [{ type: 'text', text: 'Hi from Claude' }], stop_reason: 'end_turn' }];
    const r = await handlers.chat({}, { messages: [{ role: 'user', content: 'hello' }] });
    assert.deepStrictEqual(r, { text: 'Hi from Claude' });
    const c = calls[calls.length - 1];
    assert.strictEqual(c.url, 'https://api.anthropic.com/v1/messages');
    assert.strictEqual(c.init.headers['x-api-key'], 'sk-ant-X');
    assert.strictEqual((await handlers['settings:get']()).hasGeminiKey, true);
  });
  await t('Groq: saving a key + model never leaks the key; chat goes to Groq with a Bearer header', async () => {
    const saved = await handlers['settings:save']({}, { provider: 'groq', groqKey: 'gsk_SECRET', groqModel: ' llama-3.1-8b-instant ' });
    assert.strictEqual(saved.provider, 'groq');
    assert.strictEqual(saved.groqModel, 'llama-3.1-8b-instant');
    assert.strictEqual(saved.hasGroqKey, true);
    assert.ok(!JSON.stringify(saved).includes('gsk_SECRET'));
    assert.ok(!('groqKeyPlain' in saved) && !('groqKeyEnc' in saved));
    const bad = await handlers['settings:save']({}, { groqModel: '../../x?y' });
    assert.strictEqual(bad.groqModel, 'llama-3.1-8b-instant');
    script = [{ choices: [{ message: { content: 'Hi from Groq' } }] }];
    const r = await handlers.chat({}, { messages: [{ role: 'user', content: 'hello' }] });
    assert.deepStrictEqual(r, { text: 'Hi from Groq' });
    const c = calls[calls.length - 1];
    assert.strictEqual(c.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.strictEqual(c.init.headers.authorization, 'Bearer gsk_SECRET');
    assert.strictEqual(c.body.model, 'llama-3.1-8b-instant');
    assert.ok(c.body.tools.some((d) => d.function.name === 'open_system_settings'));
  });
  await t('Groq: with no Groq key the chat asks for one, and approval cards name Groq', async () => {
    await handlers['settings:save']({}, { provider: 'groq' });
    sent.length = 0;
    script = [{ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'look_at_screen', arguments: '{}' } }] } }] }, { choices: [{ message: { content: 'Okay, not looking.' } }] }];
    const p = handlers.chat({}, { messages: [{ role: 'user', content: 'what is on my screen' }] });
    await new Promise((r) => setTimeout(r, 50));
    const req = sent.find((m) => m[0] === 'approve:request');
    assert.ok(req, 'approval request was sent');
    assert.match(req[1].details, /Groq's AI service/);
    assert.ok(!/Anthropic|Gemini/.test(req[1].details));
    listeners['approve:response']({}, { id: req[1].id, ok: false });
    assert.deepStrictEqual(await p, { text: 'Okay, not looking.' });
  });
  await t('Pip can move its body from chat even when computer actions are off, and nothing else', async () => {
    await handlers['settings:save']({}, { provider: 'groq', actions: false });
    sent.length = 0;
    script = [{ choices: [{ message: { content: null, tool_calls: [{ id: 'p1', type: 'function', function: { name: 'pet_do', arguments: '{"action":"dance"}' } }] } }] }, { choices: [{ message: { content: 'Look at me go!' } }] }];
    const r = await handlers.chat({}, { messages: [{ role: 'user', content: 'dance for me' }] });
    assert.deepStrictEqual(r, { text: 'Look at me go!' });
    const first = calls[calls.length - 2];
    assert.deepStrictEqual(first.body.tools.map((d) => d.function.name), ['pet_do']);
    assert.match(first.body.messages[0].content, /pet_do tool/);
    assert.ok(!/run_command|You can take actions on the user's computer/.test(JSON.stringify(first.body)));
    assert.deepStrictEqual(sent.find((m) => m[0] === 'pet'), ['pet', { action: 'dance' }]);
    assert.ok(!sent.some((m) => m[0] === 'approve:request'), 'no approval card for moving Pip');
    script = [{ choices: [{ message: { content: null, tool_calls: [{ id: 'p2', type: 'function', function: { name: 'system_info', arguments: '{}' } }] } }] }, { choices: [{ message: { content: 'Cannot.' } }] }];
    await handlers.chat({}, { messages: [{ role: 'user', content: 'what is my pc' }] });
    assert.match(calls[calls.length - 1].body.messages.slice(-1)[0].content, /turned off/);
    await handlers['settings:save']({}, { actions: true });
  });
  await t('only the three key pages can be opened', () => {
    listeners['link:open']({}, 'gemini'); listeners['link:open']({}, 'anthropic'); listeners['link:open']({}, 'groq'); listeners['link:open']({}, 'https://evil.example');
    assert.deepStrictEqual(opened, ['https://aistudio.google.com/apikey', 'https://console.anthropic.com/settings/keys', 'https://console.groq.com/keys']);
  });
  console.log(`\n${n} main-process checks passed${process.exitCode ? ' (some FAILED)' : ''}`);
  clearTimeout(intervalKillers);
  fs.rmSync(userData, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
})();
