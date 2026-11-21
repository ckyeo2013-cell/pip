'use strict';
// Checks for Pip's own brain (brain.js): what it understands, what it leaves to the AI, and that its plans are valid tool calls.
const assert = require('assert');
const os = require('os');
const brain = require('./brain');
const { createActions } = require('./actions');
const sys = require('./system');

let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };
const plan = (text, extra) => brain.think(text, { platform: 'win32', hasAI: false, now: new Date(2026, 10, 21, 14, 5), ...extra });
const step = (text, extra) => { const p = plan(text, extra); assert.ok(p && p.steps, `no plan for: ${text}`); return p.steps; };

(async () => {
  await t('answers small talk, time, date, maths, coins and dice at once with no tools', () => {
    for (const q of ['hi', 'hello pip', 'thanks', 'what can you do', 'tell me a joke', 'fun fact', 'flip a coin', 'roll a die', 'roll a d20', 'pick a number between 1 and 10']) assert.ok(plan(q) && plan(q).reply, q);
    assert.match(plan('what time is it').reply, /2:05/);
    assert.match(plan("whats the date").reply, /Saturday, November 21, 2026/);
    assert.strictEqual(plan('what is 12*8').reply, '12*8 = 96');
    assert.strictEqual(plan('15% of 80').reply, '12');
    assert.strictEqual(plan('what is 2 + 2 x 3').reply, '2 + 2 x 3 = 8');
  });
  await t('maths never runs anything but numbers and operators', () => {
    assert.strictEqual(brain.safeMath('process.exit()'), null);
    assert.strictEqual(brain.safeMath('2**999999'), null);
    assert.strictEqual(brain.safeMath('(1+2)*3'), 9);
    assert.strictEqual(plan('what is 5/0'), null);
  });
  await t('opens sites, apps and settings; leaves bigger jobs to the AI', () => {
    assert.deepStrictEqual(step('open youtube')[0], { name: 'open_url', input: { url: 'youtube' } });
    assert.deepStrictEqual(step('Hey Pip, could you please open spotify')[0], { name: 'open_app', input: { name: 'spotify' } });
    assert.deepStrictEqual(step('wifi settings')[0], { name: 'open_system_settings', input: { page: 'wifi' } });
    assert.deepStrictEqual(step('open task manager')[0], { name: 'open_system_settings', input: { page: 'task_manager' } });
    assert.strictEqual(plan('open the pod bay doors and play music'), null);
  });
  await t('search and play', () => {
    assert.deepStrictEqual(step('play lofi beats on youtube')[0], { name: 'search_site', input: { site: 'youtube', query: 'lofi beats', play: true } });
    assert.deepStrictEqual(step('search up cats')[0], { name: 'search_site', input: { site: 'google', query: 'cats' } });
    assert.deepStrictEqual(step('search cats on amazon')[0].input, { site: 'amazon', query: 'cats', play: false });
    assert.strictEqual(plan('play something'), null);
    assert.strictEqual(plan('search my calendar for dentist'), null);
  });
  await t('sound, scroll and browser controls', () => {
    assert.deepStrictEqual(step('turn it up')[0].input, { action: 'volume_up' });
    assert.deepStrictEqual(step('set the volume to 30')[0].input, { action: 'set_volume', value: 30 });
    assert.deepStrictEqual(step('skip this song')[0].input, { action: 'next' });
    assert.deepStrictEqual(step('scroll down')[0], { name: 'scroll', input: { direction: 'down', amount: 1 } });
    assert.deepStrictEqual(step('go to the bottom')[0].input, { direction: 'bottom', amount: 1 });
    assert.deepStrictEqual(step('new tab')[0], { name: 'browser', input: { action: 'new_tab' } });
    assert.deepStrictEqual(step('close this tab')[0].input, { action: 'close_tab' });
  });
  await t('timers and reminders', () => {
    assert.deepStrictEqual(step('remind me in 20 minutes to stretch')[0].input, { minutes: 20, message: 'stretch' });
    assert.deepStrictEqual(step('remind me to call mom in 1 hour')[0].input, { minutes: 60, message: 'call mom' });
    assert.strictEqual(step('set a timer for 5 minutes')[0].input.minutes, 5);
    assert.strictEqual(plan('remind me in 30 seconds to blink'), null);
  });
  await t('calendar lookups', () => {
    assert.deepStrictEqual(step("when is Sam's birthday")[0].input, { query: 'Sam' });
    assert.deepStrictEqual(step("what's on my calendar tomorrow")[0].input, { query: '', start_date: '2026-11-22', end_date: '2026-11-22' });
  });
  await t('chats: without an AI it opens the chat and types the message but never sends; with an AI it only opens', () => {
    const s = step('message Sam on discord saying do you want to call later at 10 or 11?');
    assert.deepStrictEqual(s.map((x) => x.name), ['open_chat', 'type_text']);
    assert.deepStrictEqual(s[0].input, { app: 'discord', name: 'Sam' });
    assert.deepStrictEqual(s[1].input, { text: 'do you want to call later at 10 or 11?', at_cursor: true, replace: true });
    assert.ok(!('press_enter' in s[1].input), 'never presses Enter on its own');
    assert.deepStrictEqual(step('text Sam on discord: hi there').map((x) => x.name), ['open_chat', 'type_text']);
    assert.deepStrictEqual(step('open the study group chat on discord')[0].input, { app: 'discord', name: 'study group' });
    assert.strictEqual(plan('message Sam on discord saying hi', { hasAI: true }), null, 'the AI should check the screen before typing a message');
    assert.ok(plan('open the study group chat on discord', { hasAI: true }).steps);
  });
  await t('leaves real questions and writing to the AI', () => {
    for (const q of ['write me a poem about cats', 'how do I fix this bug', 'explain quantum physics', 'what is the capital of France', '10', '', 'x'.repeat(500)]) assert.strictEqual(plan(q), null, q);
  });
  await t('every plan is a valid tool call that the action layer accepts (nothing is run)', async () => {
    const K = createActions({ platform: 'win32', shell: {}, clipboard: {}, execFile: () => {}, getRoot: () => os.tmpdir(), getFull: () => true,
      remind: () => new Date(), tmpDir: os.tmpdir(), countdown: 0, calendar: { describe: () => ['test'], windowFor: () => ({ from: new Date(), to: new Date() }), search: async () => [] },
      getScreenInfo: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 600 }, scaleFactor: 1 }) });
    for (const q of ['open youtube', 'open notepad', 'wifi settings', 'play lofi on youtube', 'search up cats', 'turn it up', 'set the volume to 30', 'scroll down', 'new tab',
      'remind me in 20 minutes to stretch', "when is Sam's birthday", 'message Sam on discord saying hi', 'open the study group chat on slack', 'type hello']) {
      for (const s of step(q)) { const a = await K.prepare(s.name, s.input); assert.ok(a && a.title, `${q} -> ${s.name}`); }
    }
  });
  await t('works for every OS and never throws on odd input', () => {
    for (const plat of ['win32', 'darwin', 'linux']) for (const q of ['open', 'play', 'search', 'remind me', 'message on discord', '😀', '%%%', 'open   ', 'turn it', 'what is']) brain.think(q, { platform: plat });
    assert.ok(sys.pageNames('linux').length > 0);
  });
  console.log(`\n${passed} brain checks passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})();
