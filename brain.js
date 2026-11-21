'use strict';
/*
 * Pip's own little brain: plain code, no AI, no internet, no key. It understands simple, common requests
 * and turns them into the same tools the AI would use (so every approval card and safety rule still applies).
 * Anything it does not understand returns null and goes to the AI (or asks for a key).
 *
 *   think(text, ctx) -> null
 *                    -> { reply }                          answer straight away
 *                    -> { steps: [{ name, input }], finish(outputs) -> text }   run tools, then answer
 *
 * ctx = { platform, hasAI, now: Date }
 *   hasAI true: Pip skips the things that need eyes (like sending a message), so the AI can check the screen first.
 */
const sys = require('./system');

const CHAT_APP_RE = '(discord|slack|teams|microsoft teams|whatsapp)';
const LOCAL_APPS = ['spotify', 'discord', 'whatsapp', 'slack', 'teams', 'microsoft teams', 'notepad', 'calculator', 'calc', 'paint', 'word', 'excel',
  'powerpoint', 'outlook', 'vs code', 'vscode', 'visual studio code', 'steam', 'chrome', 'firefox', 'edge', 'brave', 'file explorer', 'explorer',
  'terminal', 'telegram', 'zoom', 'obsidian', 'notion', 'photoshop', 'blender', 'minecraft', 'roblox', 'epic games', 'obs'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const FACTS = [
  'Sugar gliders can glide about 50 metres between trees. That is a lot for something this small! 🦊',
  'Honey never spoils. People have found edible honey in ancient Egyptian tombs.',
  'Octopuses have three hearts, and two of them stop when they swim.',
  'A day on Venus is longer than its year.',
  'Bananas are slightly radioactive, but you would need millions at once to notice anything.',
  'Wombats poop cubes. They are the only animal known to do it.',
  'There are more possible chess games than atoms in the observable universe.',
  'Sharks are older than trees. They have been around for over 400 million years.',
  'A group of flamingos is called a flamboyance.',
  'Your stomach gets a new lining every few days, or it would digest itself.',
];
const JOKES = [
  'Why did the computer go to the doctor? It had a virus! 🤒',
  'I told my computer I needed a break. Now it will not stop sending me vacation ads.',
  'Why do programmers prefer dark mode? Because light attracts bugs. 🐛',
  'What do you call a sugar glider who tells jokes? A pun-ny possum!',
  'Why was the JavaScript developer sad? Because he did not Node how to Express himself.',
  'I would tell you a UDP joke, but you might not get it.',
];

// ---------------------------------------------------------------- helpers
function clean(text) {
  let t = String(text || '').trim().replace(/\s+/g, ' ');
  // greetings and politeness in front: "hey pip, can you please ..."
  for (let i = 0; i < 3; i++) {
    t = t.replace(/^(?:hey|hi|hello|yo|ok(?:ay)?|so|um+|hmm+)[ ,]+(?=\S)/i, '')
      .replace(/^pip[ ,:]+(?=\S)/i, '')
      .replace(/^(?:please|pls|can you|could you|would you|will you|i want you to|i need you to|i'd like you to|go ahead and|just)\s+/i, '');
  }
  t = t.replace(/\s+(?:please|pls|for me|thanks|thank you)$/i, '').replace(/[.!]+$/g, '').trim();
  return t;
}

function minutesFrom(str) {
  const m = /(?:in|for|after)\s+(?:about\s+)?(\d+(?:\.\d+)?|an?|one|two|three|four|five|ten|fifteen|twenty|thirty)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?)\b/i.exec(str);
  if (!m) return null;
  const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
  const n = words[m[1].toLowerCase()] !== undefined ? words[m[1].toLowerCase()] : Number(m[1]);
  const unit = m[2].toLowerCase();
  if (/^s/.test(unit)) return { seconds: true, m };
  return { minutes: Math.round(/^h/.test(unit) ? n * 60 : n), m };
}

function safeMath(expr) {
  const e = String(expr).replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/\^/g, '**').replace(/,/g, '').trim();
  if (!/^[\d+\-*/%().\s]+$/.test(e) || !/\d/.test(e) || !/[+\-*/%]/.test(e.replace(/^\s*-/, ''))) return null;
  if (e.length > 60 || /\*\*\s*\d{3,}/.test(e)) return null;
  try {
    const v = Function(`"use strict"; return (${e});`)(); // only digits and operators got through the check above
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch (_) { return null; }
}
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6));

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const chatAppId = (s) => (normName(s) === 'microsoftteams' ? 'teams' : normName(s));

function pageFor(phrase, platform) {
  const want = normName(phrase.replace(/\bsettings?\b/g, ''));
  if (!want) return null;
  const names = sys.pageNames(platform);
  const alias = { wifi: 'wifi', wireless: 'wifi', internet: 'network', bluetooth: 'bluetooth', screen: 'display', sound: 'sound', audio: 'sound', volume: 'sound',
    battery: 'power_battery', power: 'power_battery', notifications: 'notifications', privacy: 'privacy', accounts: 'accounts', update: 'software_update',
    updates: 'software_update', windowsupdate: 'software_update', storage: 'storage', apps: 'apps', defaultapps: 'default_apps', startup: 'startup_apps',
    controlpanel: 'control_panel', taskmanager: 'task_manager', devicemanager: 'device_manager', keyboard: 'keyboard', mouse: 'mouse', printers: 'printers',
    accessibility: 'accessibility', datetime: 'date_time', time: 'date_time', language: 'language_region', about: 'about', vpn: 'vpn', nightlight: 'night_light',
    personalization: 'appearance', appearance: 'appearance', firewall: 'firewall', services: 'services', eventviewer: 'event_viewer' };
  const id = alias[want] || names.find((n) => normName(n) === want);
  return id && names.includes(id) ? id : null;
}

// ---------------------------------------------------------------- the brain
function think(rawText, ctx = {}) {
  const platform = ctx.platform || process.platform;
  const hasAI = !!ctx.hasAI;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const orig = clean(rawText);
  if (!orig || orig.length > 400) return null;
  const t = orig.toLowerCase();
  let m;

  // ---- small talk
  const hello = String(rawText || '').toLowerCase().replace(/[!.?,\s]+$/g, '').replace(/,/g, '').trim();
  if (/^(?:hi|hello|hey|yo|sup|hiya|howdy|good (?:morning|afternoon|evening))(?: pip| there)?$|^pip$/.test(hello)) return { reply: pick(['Hi! 🦊 What can I do for you?', 'Hello! Ready when you are.', 'Hey! What are we doing today?']) };
  if (/^(?:thanks|thank you|thx|ty|cheers)(?: pip| so much| a lot)?$/.test(t)) return { reply: pick(['Anytime! 🦊', 'You got it!', 'Happy to help!']) };
  if (/^(?:what can you do|help|what do you do|how do you work|what are your commands)\??$/.test(t)) {
    return { reply: 'Without any AI, I can: open sites and apps ("open YouTube"), search ("play lofi on YouTube", "google cats"), control volume and music, scroll, switch tabs, set timers and reminders ("remind me in 20 minutes to stretch"), do quick maths, flip coins and roll dice, tell the time, open settings pages ("wifi settings"), look in your calendar ("when is Sam\'s birthday"), and open a Discord, Slack, Teams or WhatsApp chat ("message Sam on Discord saying hi"). For everything else (writing, code, questions, seeing your screen) I need an AI key in the ⚙.' };
  }

  // ---- time, date
  if (/^(?:what(?:'s|s| is)? (?:the )?time(?: is it)?(?: now| right now)?|what time is it(?: now| right now)?|time|the time|got the time)\??$/.test(t)) {
    return { reply: `It is ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. 🕒` };
  }
  if (/^(?:what(?:'s|s| is)? (?:the |today'?s )?date(?: today)?|what day is it(?: today)?|what is today|today'?s date|what(?:'s|s| is) today)\??$/.test(t)) {
    return { reply: `Today is ${now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. 📅` };
  }

  // ---- dice, coins, random numbers
  if (/^(?:flip|toss) a coin$|^coin ?flip$|^heads or tails\??$/.test(t)) return { reply: Math.random() < 0.5 ? 'Heads! 🪙' : 'Tails! 🪙' };
  if ((m = /^roll (?:a |an |the )?(?:(\d+)[ -]?sided )?(?:d(\d+)|dice|die)$/.exec(t))) {
    const sides = Math.min(1000, Math.max(2, Number(m[1] || m[2] || 6)));
    return { reply: `🎲 ${1 + Math.floor(Math.random() * sides)} (out of ${sides})` };
  }
  if ((m = /^(?:pick|give me|choose) (?:a )?(?:random )?number (?:between|from) (-?\d+) (?:and|to) (-?\d+)$/.exec(t))) {
    const a = Math.min(Number(m[1]), Number(m[2])), b = Math.max(Number(m[1]), Number(m[2]));
    return { reply: `🎲 ${a + Math.floor(Math.random() * (b - a + 1))}` };
  }
  if (/^(?:tell me |say |give me )?(?:a |another )?(?:fun fact|random fact|fact)$/.test(t)) return { reply: pick(FACTS) };
  if (/^(?:tell me |say |give me )?(?:a |another )?joke$/.test(t)) return { reply: pick(JOKES) };

  // ---- quick maths
  {
    const body = t.replace(/^(?:what(?:'s| is)|whats|calculate|calc|compute|how much is|solve)\s+/, '').replace(/\s*=?\s*\??$/, '');
    if ((m = /^(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)$/.exec(body))) return { reply: `${fmt((Number(m[1]) / 100) * Number(m[2]))}` };
    const v = safeMath(body);
    if (v !== null) return { reply: `${body.replace(/\*\*/g, '^')} = ${fmt(v)}` };
    if ((m = /^square root of (\d+(?:\.\d+)?)$/.exec(body))) return { reply: `√${m[1]} = ${fmt(Math.sqrt(Number(m[1])))}` };
  }

  // ---- timers and reminders
  if (/\b(?:timer|remind me|reminder)\b/.test(t) && /\b(?:set|start|remind|add|make)\b|^timer/.test(t)) {
    const when = minutesFrom(orig);
    if (when && when.seconds) return null; // reminders are in whole minutes; let the AI sort it out
    if (when) {
      let what = orig.replace(when.m[0], ' ').replace(/\b(?:set|start|make|add)\s+(?:me\s+)?(?:a|an)?\s*(?:timer|reminder)\b/i, ' ').replace(/\bremind me\b/i, ' ')
        .replace(/^\s*(?:to|about|that|of)\s+/i, ' ').replace(/\s+/g, ' ').trim();
      what = what.replace(/^(?:to|about|that|of)\s+/i, '').replace(/^(?:timer|for)\b\s*/i, '').trim();
      const isTimer = /\btimer\b/.test(t);
      const message = what || (isTimer ? `Your ${when.minutes}-minute timer is done!` : 'Time is up!');
      return { steps: [{ name: 'set_reminder', input: { minutes: when.minutes, message } }], finish: (o) => `${o[0]} I will tell you in ${when.minutes} minute${when.minutes === 1 ? '' : 's'}: "${message}" ⏰` };
    }
  }

  // ---- sound and music
  const media = (action, value, done) => ({ steps: [{ name: 'media_control', input: value === undefined ? { action } : { action, value } }], finish: () => done });
  if ((m = /^(?:set|turn|put|change) (?:the |my )?(?:volume|sound) (?:to|at) (\d{1,3})\s*%?$|^volume (?:to |at )?(\d{1,3})\s*%?$/.exec(t))) {
    const v = Math.min(100, Number(m[1] || m[2]));
    return media('set_volume', v, `Volume set to ${v}%. 🔊`);
  }
  if (/^(?:volume up|turn (?:it |the volume |the sound |the music )?up|louder|raise the volume|increase (?:the )?volume|crank it up)$/.test(t)) return media('volume_up', undefined, 'Turned it up. 🔊');
  if (/^(?:volume down|turn (?:it |the volume |the sound |the music )?down|quieter|lower the volume|decrease (?:the )?volume|softer)$/.test(t)) return media('volume_down', undefined, 'Turned it down. 🔉');
  if (/^(?:mute|unmute|mute (?:it|the sound|the volume|the computer)|unmute (?:it|the sound))$/.test(t)) return media('mute', undefined, 'Toggled mute. 🔇');
  if (/^(?:pause|play|resume|stop|pause (?:the )?(?:music|song|track|video)|play (?:the )?(?:music|song|track)|resume (?:the )?(?:music|song|track)|stop (?:the )?music)$/.test(t)) return media('play_pause', undefined, 'Done: play/pause pressed. 🎵');
  if (/^(?:next|skip|next (?:song|track)|skip (?:this |the )?(?:song|track)|play the next (?:song|track))$/.test(t)) return media('next', undefined, 'Skipped to the next one. ⏭️');
  if (/^(?:previous|previous (?:song|track)|last (?:song|track)|go back a (?:song|track)|play the previous (?:song|track))$/.test(t)) return media('previous', undefined, 'Back to the previous one. ⏮️');

  // ---- scrolling and browser
  if ((m = /^scroll (down|up)(?: a (?:lot|bit|little))?(?: (\d)(?: times| screens?)?)?$|^(?:go|jump|scroll) (?:to )?the (bottom|top)(?: of the page)?$|^(?:back to the top|to the top|to the bottom)$/.exec(t))) {
    const dir = m[1] || m[3] || (/top/.test(t) ? 'top' : 'bottom');
    const amount = m[2] ? Number(m[2]) : (/a lot/.test(t) ? 4 : 1);
    return { steps: [{ name: 'scroll', input: { direction: dir, amount } }], finish: () => `Scrolled ${dir === 'top' ? 'to the top' : dir === 'bottom' ? 'to the bottom' : dir}.` };
  }
  const browserMap = [
    [/^(?:open |make )?(?:a )?new tab$/, 'new_tab'], [/^close (?:this |the )?tab$/, 'close_tab'], [/^(?:reopen|bring back|restore) (?:the |my )?(?:last |closed )?tab$/, 'reopen_tab'],
    [/^(?:next tab|switch tab|go to the next tab)$/, 'next_tab'], [/^(?:previous tab|last tab|go to the previous tab)$/, 'previous_tab'],
    [/^(?:go )?back(?: a page)?$/, 'back'], [/^(?:go )?forward(?: a page)?$/, 'forward'], [/^(?:refresh|reload)(?: the| this)?(?: page)?$/, 'refresh'],
  ];
  for (const [re, action] of browserMap) if (re.test(t)) return { steps: [{ name: 'browser', input: { action } }], finish: (o) => String(o[0] || 'Done.').split(' (')[0] };
  if ((m = /^(?:go to|switch to|open) tab (\d)$/.exec(t))) return { steps: [{ name: 'browser', input: { action: 'go_to_tab', tab: Number(m[1]) } }], finish: (o) => String(o[0] || 'Done.').split(' (')[0] };

  // ---- search
  const siteKeys = Object.keys(sys.SEARCH_SITES);
  if ((m = new RegExp(`^(play|search(?: up| for)?|look up|find(?: me)?|show me|google)\\s+(.+?)\\s+(?:on|in|at)\\s+(${siteKeys.join('|')}|google images|google maps)$`, 'i').exec(orig))) {
    let site = m[3].toLowerCase();
    if (site === 'google images') site = 'images';
    if (site === 'google maps') site = 'maps';
    const play = /^play$/i.test(m[1]) && site === 'youtube';
    if (/^play$/i.test(m[1]) && site !== 'youtube') return null;
    return { steps: [{ name: 'search_site', input: { site, query: m[2].trim(), play } }], finish: () => (play ? `Playing "${m[2].trim()}" on YouTube. ▶️` : `Searching ${site} for "${m[2].trim()}". 🔎`) };
  }
  if ((m = /^(?:search(?: up| for)?|google|look up)\s+(.{2,120})$/i.exec(orig)) && !/\b(?:calendar|chat|chats|computer|files?|folder|desktop|screen|email|inbox|discord|slack|teams|whatsapp)\b/i.test(orig)) {
    return { steps: [{ name: 'search_site', input: { site: 'google', query: m[1].trim() } }], finish: () => `Searching Google for "${m[1].trim()}". 🔎` };
  }

  // ---- chats (Discord, Slack, Teams, WhatsApp)
  const openChat = (who, app, extra) => ({ name: 'open_chat', input: Object.assign({ app: chatAppId(app), name: who.trim() }, extra || {}) });
  if ((m = new RegExp(`^(?:open|go to|find|show)\\s+(?:the\\s+)?(?:chat (?:with|for)\\s+)?(.+?)(?:\\s+(?:chat|dm|dms|server|channel))?\\s+(?:on|in|with)\\s+${CHAT_APP_RE}$`, 'i').exec(orig))) {
    const who = m[1].replace(/^(?:my|the)\s+/i, '');
    return { steps: [openChat(who, m[2])], finish: (o) => `Opened "${who}" in ${m[2]}. ${hasAI ? '' : 'I cannot see the screen without an AI, so check the name at the top is the right one.'}`.trim() };
  }
  if (!hasAI) {
    // message Sam on discord saying hi / text Sam on discord: hi / tell Sam on discord hi
    let who = null, app = null, body = null;
    if ((m = new RegExp(`^(?:message|text|dm|tell|ping|msg)\\s+(.+?)\\s+(?:on|in|via|over)\\s+${CHAT_APP_RE}\\s*(?:(?:saying|that says|to say|and say|and tell (?:him|her|them)|:|-|,)\\s*)?(.+)$`, 'i').exec(orig))) {
      [, who, app, body] = m;
    } else if ((m = new RegExp(`^send\\s+(?:a message |a dm |a text )?(.+?)\\s+to\\s+(.+?)\\s+(?:on|in|via)\\s+${CHAT_APP_RE}$`, 'i').exec(orig))) {
      [, body, who, app] = m;
    }
    if (who && app && body) {
      body = body.replace(/^["“'‘]|["”'’]$/g, '').trim();
      who = who.replace(/^(?:my|the)\s+/i, '');
      if (!body) return null;
      return {
        steps: [openChat(who, app), { name: 'type_text', input: { text: body, at_cursor: true, replace: true } }],
        finish: () => `Opened "${who}" in ${app} and typed your message in the box. Check the name at the top is right, then press Enter to send. (I leave sending to you, because without an AI I cannot see the screen to be sure it is the right chat.)`,
      };
    }
  }

  // ---- calendar
  if ((m = /^(?:when(?:'s| is)|what(?:'s| is) the date of|check|look up|find)\s+(?:my\s+)?(.+?)(?:'s|s')?\s+birthday(?:\s+(?:on|in) (?:the |my )?calendar)?$/i.exec(orig))) {
    const who = m[1].replace(/^(?:my|the)\s+/i, '').trim();
    return { steps: [{ name: 'search_calendar', input: { query: who } }], finish: (o) => String(o[0]) };
  }
  if ((m = /^(?:when(?:'s| is)|check|look up|find)\s+(?:my\s+)?(.+?)\s+(?:on|in) (?:the |my )?calendar$/i.exec(orig))) {
    return { steps: [{ name: 'search_calendar', input: { query: m[1].trim() } }], finish: (o) => String(o[0]) };
  }
  if ((m = /^what(?:'s| is)(?: on| in)? (?:my )?(?:calendar|schedule|agenda)(?: for)?\s*(today|tomorrow)?$|^what do i have (today|tomorrow)$/i.exec(orig))) {
    const day = (m[1] || m[2] || 'today').toLowerCase();
    const d = new Date(now); if (day === 'tomorrow') d.setDate(d.getDate() + 1);
    return { steps: [{ name: 'search_calendar', input: { query: '', start_date: ymd(d), end_date: ymd(d) } }], finish: (o) => String(o[0]) };
  }

  // ---- settings pages
  if ((m = /^(.{2,30}?)\s+settings$/i.exec(orig))) {
    const id = pageFor(m[1], platform);
    if (id) return { steps: [{ name: 'open_system_settings', input: { page: id } }], finish: (o) => String(o[0] || 'Opened it.') };
  }
  if ((m = /^(?:open|show|go to|pull up)\s+(?:the\s+|my\s+)?(.+?)(?:\s+settings?)?$/i.exec(orig))) {
    const id = pageFor(m[1], platform);
    if (id && (/\bsettings?\b/i.test(orig) || ['control_panel', 'task_manager', 'device_manager', 'firewall', 'services', 'event_viewer'].includes(id))) {
      return { steps: [{ name: 'open_system_settings', input: { page: id } }], finish: (o) => String(o[0] || 'Opened it.') };
    }
  }

  // ---- open sites and apps
  if ((m = /^(?:open|launch|start|go to|pull up|run)\s+(?:the\s+)?(.{1,50})$/i.exec(orig))) {
    const what = m[1].trim().replace(/\s+(?:app|website|site)$/i, '');
    const low = what.toLowerCase();
    if (/\s(?:and|then)\s/.test(low) || low.split(' ').length > 4) return null; // a bigger job: leave it to the AI
    if (LOCAL_APPS.includes(low)) return { steps: [{ name: 'open_app', input: { name: what } }], finish: (o) => String(o[0] || `Opened ${what}.`) };
    if (sys.resolveSite(what)) return { steps: [{ name: 'open_url', input: { url: what } }], finish: () => `Opened ${what}. 🌐` };
    if (platform === 'win32' || platform === 'darwin') return { steps: [{ name: 'open_app', input: { name: what } }], finish: (o) => String(o[0] || `Opened ${what}.`) };
  }

  // ---- typing into whatever has the cursor
  if ((m = /^type\s+(.{1,300})$/i.exec(orig)) && !/\bin (?:the |my )?(?:box|field|chat|document|doc)\b/i.test(orig)) {
    const text = m[1].replace(/^["“'‘]|["”'’]$/g, '');
    return { steps: [{ name: 'type_text', input: { text } }], finish: (o) => String(o[0] || 'Typed it.') };
  }

  return null; // not something the little brain knows
}

module.exports = { think, safeMath, clean };
