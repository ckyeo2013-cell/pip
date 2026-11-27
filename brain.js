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
  'Sugar gliders can glide about 50 metres between trees. That is a lot for something this small!',
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
  'Why did the computer go to the doctor? It had a virus!',
  'I told my computer I needed a break. Now it will not stop sending me vacation ads.',
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'What do you call a sugar glider who tells jokes? A pun-ny possum!',
  'Why was the JavaScript developer sad? Because he did not Node how to Express himself.',
  'I would tell you a UDP joke, but you might not get it.',
];

// ---------------------------------------------------------------- helpers
// Slang that gets tacked onto a request ("open discord lah", "open discord lor"), and what speech-to-text often hears
// instead of it ("open discord lot"). Safe particles are dropped from the end of any request; the ones that are also
// real words (lot, now, man...) are only dropped right after an app name.
const PARTICLES = ['lah', 'lahh', 'laa', 'lar', 'lor', 'leh', 'loh', 'mah', 'meh', 'sia', 'hor', 'bro', 'bruh', 'dude', 'boss', 'lol', 'ya', 'yah', 'yea'];
const MISHEARD = ['lot', 'lots', 'lat', 'law', 'low', 'la', 'lo', 'luh', 'ah', 'eh', 'now', 'man', 'quick', 'quickly', 'first', 'ok', 'okay', 'yeah'];
const TAIL_WORDS = new Set([...PARTICLES, ...MISHEARD]);
const TAIL_RE = new RegExp(`(?:[\\s,]+(?:${PARTICLES.join('|')}))+$`, 'i');
const APP_TAIL_RE = new RegExp(`\\b(${LOCAL_APPS.map((a) => a.replace(/\s+/g, '\\s+')).join('|')})(?:[\\s,]+(?:${[...TAIL_WORDS].join('|')}))+$`, 'i');

// "discord lot" -> "discord", "vs codee" -> "vs code", "discard" -> "discord". Returns the app's name, or null.
function matchApp(low) {
  low = String(low || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!low) return null;
  if (LOCAL_APPS.includes(low)) return low;
  const words = low.split(' ');
  for (let n = words.length - 1; n >= 1; n--) {
    const head = words.slice(0, n).join(' ');
    if (LOCAL_APPS.includes(head) && words.slice(n).every((w) => TAIL_WORDS.has(w))) return head;
  }
  const flat = low.replace(/ /g, '');
  let best = null, bestD = 99;
  for (const app of LOCAL_APPS) {
    const f = app.replace(/ /g, '');
    if (f.length < 5) continue; // short names (obs, word, zoom) are too easy to confuse with other words
    const d = sys.editDistance(flat, f);
    if (d <= (f.length >= 8 ? 2 : 1) && d < bestD) { best = app; bestD = d; }
  }
  return best;
}

// Different ways of saying the same thing, rewritten into the wording the patterns below understand.
const NOT_OPEN = '(?!(?:the |my )?(?:volume|sound|brightness|timer|stopwatch|music|calendar|settings))';
const SYNONYMS = [
  [/^(?:make it (?:a bit |a little |much )?louder|turn it up(?: a (?:bit|little|notch))?|bump (?:it|the volume) up|pump (?:it|up the volume)|more volume|up the volume|volume higher|raise the sound|i can'?t hear(?: it| you| anything)?|it'?s too quiet|too quiet|can'?t hear anything)$/i, 'volume up'],
  [/^(?:make it (?:a bit |a little |much )?(?:quieter|softer|lower)|turn it down(?: a (?:bit|little|notch))?|bump (?:it|the volume) down|less volume|down the volume|volume lower|lower the sound|it'?s too loud|too loud|tone it down|not so loud)$/i, 'volume down'],
  [/^(?:silence(?: it)?|be quiet|shh+|sound off|mute the (?:tv|music|audio)|turn (?:off )?the sound(?: off)?|kill the sound)$/i, 'mute'],
  [/^(?:pause it|stop (?:it|that|playing|the song))$/i, 'pause'],
  [/^(?:skip it|skip that|next one|another one|change (?:the )?song|play something else)$/i, 'next'],
  [/^(?:ping|alert|notify|nudge|wake) me (?=(?:in|after|at)\b)/i, 'remind me '],
  [new RegExp(`^(?:launch|fire up|boot up|load up|start up|bring up|pull up|get into|jump into|hop (?:on|onto|in)|take me to|head (?:over )?to|navigate to|visit|buka)\\s+${NOT_OPEN}`, 'i'), 'open '],
  [/^(?:put on|throw on|stick on|queue up|spin|blast)\s+(?=\S)/i, 'play '],
  [/^(?:maximi[sz]e|unminimi[sz]e|un-minimi[sz]e|restore)\s+(?:the |my )?(?!.*\b(?:tabs?|pages?|files?|folders?|backup|default|settings?)\b)(.+?)(?: window| app)?$/i, 'bring $1 to the front'],
  [/^(?:raise|get|move|put|send)\s+(?:the |my )?(.+?)\s+(?:to the (?:foreground|top)|to front|on top|up front|front and center|into view|in front)$/i, 'bring $1 to the front'],
];
function synonyms(t) {
  for (const [re, to] of SYNONYMS) if (re.test(t)) return t.replace(re, to).trim();
  return t;
}

function clean(text) {
  let t = String(text || '').trim().replace(/\s+/g, ' ');
  // greetings and politeness in front: "hey pip, can you please ..."
  for (let i = 0; i < 3; i++) {
    t = t.replace(/^(?:hey|hi|hello|yo|ok(?:ay)?|so|um+|hmm+|eh|ei|boss|bro)[ ,]+(?=\S)/i, '')
      .replace(/^pip[ ,:]+(?=\S)/i, '')
      .replace(/^(?:please|pls|can you|could you|would you|will you|i want you to|i need you to|i'd like you to|go ahead and|just)\s+/i, '');
  }
  for (let i = 0; i < 4; i++) {
    t = t.replace(/[.!,\s]+$/g, '').replace(/\s+(?:please|pls|for me|thanks|thank you)$/i, '').replace(TAIL_RE, '').replace(APP_TAIL_RE, '$1').trim();
  }
  return synonyms(t.replace(/[.!]+$/g, '').trim());
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
  if (e.length > 120 || /\*\*\s*\d{4,}/.test(e)) return null;
  try {
    // Whole-number sums with no division or decimals run in BigInt so big numbers stay exact (doubles lose digits past 2^53)
    const exact = !/[./]/.test(e);
    const v = Function(`"use strict"; return (${exact ? e.replace(/\d+/g, '$&n') : e});`)(); // only digits and operators got through the check above
    if (typeof v === 'bigint') return v.toString().length > 300 ? null : (v >= -9007199254740991n && v <= 9007199254740991n ? Number(v) : v);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch (_) { return null; }
}
const fmt = (n) => (typeof n === 'bigint' ? n.toString() : Number.isInteger(n) && Math.abs(n) < 1e21 ? BigInt(n).toString() : Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6));

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
  let orig = clean(rawText);
  if (!orig || orig.length > 400) return null;
  { // other languages and a few extra offline tricks (lang.js): answered here, or turned into the English request the rest of this file knows
    const lg = require('./lang').process(orig, ctx.lang, now);
    if (lg && lg.reply) return { reply: lg.reply };
    if (lg && lg.text) orig = lg.text;
  }
  const t = orig.toLowerCase();
  let m;

  // ---- small talk
  const hello = String(rawText || '').toLowerCase().replace(/[!.?,\s]+$/g, '').replace(/,/g, '').trim();
  if (/^(?:hi|hello|hey|yo|sup|hiya|howdy|good (?:morning|afternoon|evening))(?: pip| there)?$|^pip$/.test(hello)) return { reply: pick(['Hi! What can I do for you?', 'Hello! Ready when you are.', 'Hey! What are we doing today?']) };
  if (/^(?:thanks|thank you|thx|ty|cheers)(?: pip| so much| a lot)?$/.test(t)) return { reply: pick(['Anytime!', 'You got it!', 'Happy to help!']) };
  if (/^(?:what can you do|help|what do you do|how do you work|what are your commands)\??$/.test(t)) {
    return { reply: 'Without any AI, I can: open sites and apps ("open YouTube"), search ("play lofi on YouTube", "google cats"), control volume and music, scroll, switch tabs, set timers and reminders ("remind me in 20 minutes to stretch"), do quick maths, flip coins and roll dice, tell the time, open settings pages ("wifi settings"), look in your calendar ("when is Sam\'s birthday"), and open a Discord, Slack, Teams or WhatsApp chat ("message Sam on Discord saying hi"). I also speak Spanish, French, German, Portuguese and Italian for the basics (pick one in settings, or leave it on Auto), and can make passwords, pick between options, work out percentages, reverse or count text, convert colours and roman numerals. For everything else (writing, code, questions, seeing your screen) I need an AI key in the gear button.' };
  }

  // ---- time, date
  if (/^(?:what(?:'s|s| is)? (?:the )?time(?: is it)?(?: now| right now)?|what time is it(?: now| right now)?|time|the time|got the time)\??$/.test(t)) {
    return { reply: `It is ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` };
  }
  if (/^(?:what(?:'s|s| is)? (?:the |today'?s )?date(?: today)?|what day is it(?: today)?|what is today|today'?s date|what(?:'s|s| is) today)\??$/.test(t)) {
    return { reply: `Today is ${now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.` };
  }

  // ---- extra offline chatter
  if (/^(?:how are you|how are you doing|how's it going|hows it going|you ok|you good)\??$/.test(t)) return { reply: pick(['Great, I have snacks and a desktop. Life is good.', 'Fluffy and fine. You?', 'Pretty good! Glided around all day.']) };
  if (/^(?:who are you|what are you|what is your name|what'?s your name)\??$/.test(t)) return { reply: 'I am Pip, a sugar glider who lives on your screen.' };
  if (/^(?:i'?m|im|i am) bored$|^bored$/.test(t)) return { reply: pick(['Want a game? Try the chess button, or ask me for a joke.', 'Same. Let us play something, or I can tell you a fun fact.', 'Flip a coin and do whatever it says.']) };
  if (/^(?:good night|goodnight|gn|night night)(?: pip)?$/.test(t)) return { reply: pick(['Night night! Sleep well.', 'Sweet dreams. I will guard the desktop.']) };
  if (/^(?:good morning|gm)(?: pip)?$/.test(t)) return { reply: pick(['Morning! Ready when you are.', 'Good morning! Coffee first?']) };
  if (/^(?:i love you|love you|ily)(?: pip)?$/.test(t)) return { reply: pick(['Aww. I like you too.', 'Stop it, you are making me blush.']) };
  if (/^(?:you suck|you are bad|ur bad|stupid pip|dumb pip|shut up)$/.test(t)) return { reply: pick(['Ouch. I have feelings, you know.', 'Rude! I will remember that.']) };
  if (/^(?:tell me a riddle|riddle)$/.test(t)) return { reply: pick(['What has keys but cannot open locks? A piano.', 'What gets wetter the more it dries? A towel.', 'What has hands but cannot clap? A clock.']) };
  if (/^(?:sing|sing a song|sing me a song)$/.test(t)) return { reply: 'La la la, I am a glider, glide glide glide.' };
  if (/^(?:8 ?ball|magic 8 ?ball)$/.test(t)) return { reply: pick(['Definitely yes.', 'Ask again later.', 'Very doubtful.', 'Signs point to yes.', 'No chance.']) };

  // ---- dice, coins, random numbers
  if (/^(?:flip|toss) a coin$|^coin ?flip$|^heads or tails\??$/.test(t)) return { reply: Math.random() < 0.5 ? 'Heads!' : 'Tails!' };
  if ((m = /^roll (?:a |an |the )?(?:(\d+)[ -]?sided )?(?:d(\d+)|dice|die)$/.exec(t))) {
    const sides = Math.min(1000, Math.max(2, Number(m[1] || m[2] || 6)));
    return { reply: `${1 + Math.floor(Math.random() * sides)} (out of ${sides})` };
  }
  if ((m = /^(?:pick|give me|choose) (?:a )?(?:random )?number (?:between|from) (-?\d+) (?:and|to) (-?\d+)$/.exec(t))) {
    const a = Math.min(Number(m[1]), Number(m[2])), b = Math.max(Number(m[1]), Number(m[2]));
    return { reply: `${a + Math.floor(Math.random() * (b - a + 1))}` };
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

  // ---- unit conversions, tips, days until, clipboard (all offline)
  {
    const U = { // unit -> [kind, size in the base unit]
      mm: ['len', 0.001], cm: ['len', 0.01], m: ['len', 1], km: ['len', 1000], in: ['len', 0.0254], inch: ['len', 0.0254], inches: ['len', 0.0254],
      ft: ['len', 0.3048], foot: ['len', 0.3048], feet: ['len', 0.3048], yd: ['len', 0.9144], yard: ['len', 0.9144], yards: ['len', 0.9144],
      mi: ['len', 1609.344], mile: ['len', 1609.344], miles: ['len', 1609.344],
      g: ['mass', 1], kg: ['mass', 1000], oz: ['mass', 28.3495], ounce: ['mass', 28.3495], ounces: ['mass', 28.3495],
      lb: ['mass', 453.592], lbs: ['mass', 453.592], pound: ['mass', 453.592], pounds: ['mass', 453.592],
      ml: ['vol', 0.001], l: ['vol', 1], liter: ['vol', 1], liters: ['vol', 1], litre: ['vol', 1], litres: ['vol', 1],
      gal: ['vol', 3.78541], gallon: ['vol', 3.78541], gallons: ['vol', 3.78541], cup: ['vol', 0.236588], cups: ['vol', 0.236588],
      c: ['temp'], celsius: ['temp'], f: ['temp'], fahrenheit: ['temp'], k: ['temp'], kelvin: ['temp'],
    };
    if ((m = /^(?:convert\s+)?(-?\d+(?:\.\d+)?)\s*°?\s*([a-z]+)\s+(?:to|in|into)\s+°?([a-z]+)$/.exec(t)) && U[m[2]] && U[m[3]] && U[m[2]][0] === U[m[3]][0]) {
      const [kind] = U[m[2]], v = Number(m[1]);
      let out;
      if (kind === 'temp') {
        const tc = { c: 1, celsius: 1, f: 2, fahrenheit: 2, k: 3, kelvin: 3 };
        const toC = tc[m[2]] === 1 ? v : tc[m[2]] === 2 ? (v - 32) * 5 / 9 : v - 273.15;
        out = tc[m[3]] === 1 ? toC : tc[m[3]] === 2 ? toC * 9 / 5 + 32 : toC + 273.15;
      } else out = (v * U[m[2]][1]) / U[m[3]][1];
      return { reply: `${m[1]} ${m[2]} = ${fmt(Math.round(out * 1e4) / 1e4)} ${m[3]}` };
    }
    const tipM = /^(?:what(?:'s| is) )?(?:a )?(\d+(?:\.\d+)?)\s*%\s*tip (?:on|for|of) \$?(\d+(?:\.\d+)?)$/.exec(t) || /^(?:what(?:'s| is) )?(?:the )?tip (?:on|for|of) \$?(\d+(?:\.\d+)?) at (\d+(?:\.\d+)?)\s*%$/.exec(t);
    if (tipM) {
      const pct = /^(?:what(?:'s| is) )?(?:the )?tip/.test(t) ? Number(tipM[2]) : Number(tipM[1]);
      const bill = /^(?:what(?:'s| is) )?(?:the )?tip/.test(t) ? Number(tipM[1]) : Number(tipM[2]);
      const tip = Math.round(bill * pct) / 100;
      return { reply: `A ${pct}% tip on ${bill} is ${tip.toFixed(2)}, so the total is ${(bill + tip).toFixed(2)}.` };
    }
    if ((m = /^(?:how many )?days (?:until|till|to|left until|left till) (?:the )?(.+?)\??$/.exec(t))) {
      const fixed = { christmas: [11, 25], 'christmas day': [11, 25], 'new year': [0, 1], "new year's": [0, 1], 'new years': [0, 1], halloween: [9, 31], "valentine's day": [1, 14], valentines: [1, 14], "valentine's": [1, 14] };
      const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      let target = null, md;
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (fixed[m[1]]) {
        target = new Date(today.getFullYear(), fixed[m[1]][0], fixed[m[1]][1]);
        if (target < today) target = new Date(today.getFullYear() + 1, fixed[m[1]][0], fixed[m[1]][1]);
      } else if ((md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(m[1]))) target = new Date(Number(md[1]), Number(md[2]) - 1, Number(md[3]));
      else if ((md = /^(?:(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)|([a-z]+) (\d{1,2})(?:st|nd|rd|th)?)$/.exec(m[1]))) {
        const mi = MONTHS.indexOf(md[2] || md[3]), day = Number(md[1] || md[4]);
        if (mi >= 0 && day >= 1 && day <= 31) { target = new Date(today.getFullYear(), mi, day); if (target < today) target = new Date(today.getFullYear() + 1, mi, day); }
      }
      if (target && !Number.isNaN(target.getTime())) {
        const days = Math.round((target - today) / 86400000);
        return { reply: days === 0 ? "That's today!" : `${days} day${days === 1 ? '' : 's'} to go (${ymd(target)}).` };
      }
    }
    if (/^(?:(?:what(?:'s| is)|whats) (?:on|in) my clipboard|read (?:my )?clipboard|show (?:me )?my clipboard)\??$/.test(t)) {
      return { steps: [{ name: 'read_clipboard', input: {} }], finish: (o) => String(o[0] || '').replace(/^Clipboard text[^\n]*\n+/, '') || 'Your clipboard is empty.' };
    }
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
      return { steps: [{ name: 'set_reminder', input: { minutes: when.minutes, message } }], finish: (o) => `${o[0]} I will tell you in ${when.minutes} minute${when.minutes === 1 ? '' : 's'}: "${message}"` };
    }
  }

  // ---- sound and music
  const media = (action, value, done) => ({ steps: [{ name: 'media_control', input: value === undefined ? { action } : { action, value } }], finish: () => done });
  if ((m = /^(?:set|turn|put|change) (?:the |my )?(?:volume|sound) (?:to|at) (\d{1,3})\s*%?$|^volume (?:to |at )?(\d{1,3})\s*%?$/.exec(t))) {
    const v = Math.min(100, Number(m[1] || m[2]));
    return media('set_volume', v, `Volume set to ${v}%.`);
  }
  if (/^(?:volume up|turn (?:it |the volume |the sound |the music )?up|louder|raise the volume|increase (?:the )?volume|crank it up)$/.test(t)) return media('volume_up', undefined, 'Turned it up.');
  if (/^(?:volume down|turn (?:it |the volume |the sound |the music )?down|quieter|lower the volume|decrease (?:the )?volume|softer)$/.test(t)) return media('volume_down', undefined, 'Turned it down.');
  if (/^(?:mute|unmute|mute (?:it|the sound|the volume|the computer)|unmute (?:it|the sound))$/.test(t)) return media('mute', undefined, 'Toggled mute.');
  if (/^(?:pause|play|resume|stop|pause (?:the )?(?:music|song|track|video)|play (?:the )?(?:music|song|track)|resume (?:the )?(?:music|song|track)|stop (?:the )?music)$/.test(t)) return media('play_pause', undefined, 'Done: play/pause pressed.');
  if (/^(?:next|skip|next (?:song|track)|skip (?:this |the )?(?:song|track)|play the next (?:song|track))$/.test(t)) return media('next', undefined, 'Skipped to the next one.');
  if (/^(?:previous|previous (?:song|track)|last (?:song|track)|go back a (?:song|track)|play the previous (?:song|track))$/.test(t)) return media('previous', undefined, 'Back to the previous one.');

  // ---- scrolling and browser
  if ((m = /^scroll (down|up)(?: a (?:lot|bit|little))?(?: (\d)(?: times| screens?)?)?$|^(?:go|jump|scroll) (?:to )?the (bottom|top)(?: of the page)?$|^(?:back to the top|to the top|to the bottom)$/.exec(t))) {
    const dir = m[1] || m[3] || (/top/.test(t) ? 'top' : 'bottom');
    const amount = m[2] ? Number(m[2]) : (/a lot/.test(t) ? 4 : 1);
    return { steps: [{ name: 'scroll', input: { direction: dir, amount } }], finish: () => `Scrolled ${dir === 'top' ? 'to the top' : dir === 'bottom' ? 'to the bottom' : dir}.` };
  }
  const browserMap = [
    [/^(?:open |make )?(?:a )?new tab$/, 'new_tab'], [/^close (?:this |the |that )?tab$/, 'close_tab'], [/^(?:reopen|bring back|restore) (?:the |my )?(?:last |closed )?tab$/, 'reopen_tab'],
    [/^(?:next tab|switch tab|tab right|(?:go|switch|move|jump|flip) to (?:the )?next tab|next one)$/, 'next_tab'],
    [/^(?:previous tab|prev tab|last tab|tab left|(?:go|switch|move|jump|flip) to (?:the )?(?:previous|prev) tab|go to the last tab i was on)$/, 'previous_tab'],
    [/^(?:go )?back(?: a page)?$/, 'back'], [/^(?:go )?forward(?: a page)?$/, 'forward'], [/^(?:refresh|reload)(?: the| this)?(?: page)?$/, 'refresh'],
    [/^(?:show|bring up|bring|switch to|go to|go back to|focus|open|get|show me)(?: me)? (?:the |my )?(?:web ?)?browser(?: window)?(?: to the front| forward| up)?$|^bring (?:the |my )?(?:web ?)?browser (?:to the front|forward|up)$|^browser to the front$/, 'bring_to_front'],
  ];
  const browserDone = (o) => String(o[0] || 'Done.').split(' (')[0];
  for (const [re, action] of browserMap) if (re.test(t)) return { steps: [{ name: 'browser', input: { action } }], finish: browserDone };
  // "bring discord to the front", "switch to spotify", "focus notepad": any app, and Pip checks it really came forward
  if ((m = /^(?:bring|pull up|switch to|go to|focus|put|show|alt[- ]?tab to)(?: me)? (?:the |my )?([a-z0-9][a-z0-9 ._-]{0,40}?)(?: app| window)? (?:to the (?:front|top)|forward|up|in front)$/.exec(t)) && !/^(?:tab|page|site|website|video|song|music|picture|file|folder)s?\b/.test(m[1])) {
    return { steps: [{ name: 'open_app', input: { name: m[1] } }], finish: (o) => String(o[0] || 'Done.') };
  }
  // "go to tab 3", "switch to tab three", "go to the third tab", "go to the last tab" (voice often writes numbers as words)
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, last: 9, final: 9 };
  const NUMRE = Object.keys(NUM).join('|');
  if ((m = new RegExp(`^(?:go to|switch to|open|jump to|show|show me|flip to)\\s+(?:the\\s+)?(?:tab\\s+(?:number\\s+|no\\.?\\s*)?(\\d|${NUMRE})|(${NUMRE})\\s+tab)$`, 'i').exec(t))) {
    const w = String(m[1] || m[2]).toLowerCase();
    const tab = /^\d$/.test(w) ? Number(w) : NUM[w];
    if (tab >= 1 && tab <= 9) return { steps: [{ name: 'browser', input: { action: 'go_to_tab', tab } }], finish: browserDone };
  }

  // ---- search
  const siteKeys = Object.keys(sys.SEARCH_SITES);
  if ((m = new RegExp(`^(play|search(?: up| for)?|look up|find(?: me)?|show me|google)\\s+(.+?)\\s+(?:on|in|at)\\s+(${siteKeys.join('|')}|google images|google maps)$`, 'i').exec(orig))) {
    let site = m[3].toLowerCase();
    if (site === 'google images') site = 'images';
    if (site === 'google maps') site = 'maps';
    const play = /^play$/i.test(m[1]) && site === 'youtube';
    if (/^play$/i.test(m[1]) && site !== 'youtube') return null;
    return { steps: [{ name: 'search_site', input: { site, query: m[2].trim(), play } }], finish: () => (play ? `Playing "${m[2].trim()}" on YouTube. ▶` : `Searching ${site} for "${m[2].trim()}".`) };
  }
  if ((m = /^(?:search(?: up| for)?|google|look up)\s+(.{2,120})$/i.exec(orig)) && !/\b(?:calendar|chat|chats|computer|files?|folder|desktop|screen|email|inbox|discord|slack|teams|whatsapp)\b/i.test(orig)) {
    return { steps: [{ name: 'search_site', input: { site: 'google', query: m[1].trim() } }], finish: () => `Searching Google for "${m[1].trim()}".` };
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

  // "switch to discord", "alt tab to spotify", "focus notepad", "go back to chrome": only for apps Pip knows by name
  if ((m = /^(?:switch (?:over )?to|alt[- ]?tab(?: over)? to|jump to|focus(?: on)?|go (?:back |over )?to|head back to|return to|get back to)\s+(?:the |my )?(.{1,40}?)(?: app| window)?$/i.exec(orig)) && !/^tabs?\b|\btab\b/i.test(m[1])) {
    const known = matchApp(m[1].toLowerCase());
    if (known) return { steps: [{ name: 'open_app', input: { name: known } }], finish: (o) => String(o[0] || `Opened ${known}.`) };
  }

  // ---- open sites and apps
  if ((m = /^(?:open|launch|start|go to|pull up|run|buka)\s+(?:the\s+)?(.{1,50})$/i.exec(orig))) {
    const what = m[1].trim().replace(/\s+(?:app|website|site)$/i, '');
    const low = what.toLowerCase();
    if (/\s(?:and|then)\s/.test(low) || low.split(' ').length > 4) return null; // a bigger job: leave it to the AI
    const known = matchApp(low);
    if (known) return { steps: [{ name: 'open_app', input: { name: known } }], finish: (o) => String(o[0] || `Opened ${known}.`) };
    if (sys.resolveSite(what)) return { steps: [{ name: 'open_url', input: { url: what } }], finish: () => `Opened ${what}.` };
    if (platform === 'win32' || platform === 'darwin') {
      const words = what.split(/\s+/);
      while (words.length > 1 && TAIL_WORDS.has(words[words.length - 1].toLowerCase())) words.pop(); // "notepad++ lot"
      const target = words.join(' ');
      return { steps: [{ name: 'open_app', input: { name: target } }], finish: (o) => String(o[0] || `Opened ${target}.`) };
    }
  }

  // "help me ask Sam if he wants to call at 5pm": written and typed right here with no AI call (anything fancier goes to the AI)
  if ((m = /^(?:help me (?:to )?)?(?:ask|check with|find out)\s+(?:(.{1,30}?)\s+)?(?:if|whether)\s+(.{3,160}?)(\s+and send(?: it)?)?$/i.exec(orig))) {
    const clause = m[2].trim().replace(/[?.!]+$/, '');
    let q = null, c;
    if ((c = /^(?:he|she|they|you)\s+(?:wants?|would like|want)\s+to\s+(.+)$/i.exec(clause))) q = `do you want to ${c[1]}`;
    else if ((c = /^(?:he|she|they|you)\s+(?:is|are)\s+(free|available|ready|coming|home|around|busy|up|down)\b(.*)$/i.exec(clause))) q = `are you ${c[1]}${c[2]}`;
    else if ((c = /^(?:he|she|they|you)\s+(can|could|will|would|should)\s+(.+)$/i.exec(clause))) q = `${c[1].toLowerCase()} you ${c[2]}`;
    else if ((c = /^(?:he|she|they|you)\s+(?:has|have)\s+(.+)$/i.exec(clause))) q = `do you have ${c[1]}`;
    if (q && !/\b(?:he|she|they|his|her|their|him)\b/i.test(q)) {
      const name = m[1] && !/^(?:my|the|a|an|our|your|this|that)\b/i.test(m[1]) ? m[1].trim().replace(/^./, (ch) => ch.toUpperCase()) : '';
      const text = `${name ? `Hey ${name}, ` : ''}${name ? q : q.replace(/^./, (ch) => ch.toUpperCase())}?`;
      return { steps: [{ name: 'type_text', input: { text, at_cursor: true, press_enter: !!m[3] } }], finish: () => `Typed: "${text}"${m[3] ? ' and sent it' : ''}.` };
    }
  }

  // ---- typing into whatever has the cursor
  if ((m = /^type\s+(.{1,300})$/i.exec(orig)) && !/\bin (?:the |my )?(?:box|field|chat|document|doc)\b/i.test(orig)) {
    const text = m[1].replace(/^["“'‘]|["”'’]$/g, '');
    return { steps: [{ name: 'type_text', input: { text, at_cursor: true } }], finish: (o) => String(o[0] || 'Typed it.') }; // the cursor is already where they want it, so no slow window scan
  }

  return null; // not something the little brain knows
}

module.exports = { think, safeMath, clean, matchApp };
