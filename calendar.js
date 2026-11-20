'use strict';
/*
 * Read-only calendar lookups for Pip.
 *  - .ics calendars: a web link (Google "secret address in iCal format", Outlook.com
 *    published ICS link, iCloud public link...) or a .ics file on disk.
 *  - macOS: the Calendar app itself, searched by name (handy for birthdays).
 * Repeating events (like yearly birthdays) are expanded, so "when is Sam's birthday"
 * finds the NEXT one, not the year it was first added.
 */

const MAX_BYTES = 15 * 1024 * 1024;
const CACHE_MS = 5 * 60 * 1000;
const DAY = 86400000;
const MAX_SPAN_DAYS = 1100;
const MAX_RESULTS = 40;
const PER_SERIES = 5;

// ------------------------------------------------------------ ICS parsing
function splitUnquoted(s, sep) {
  const out = [];
  let cur = '', q = false;
  for (const c of s) {
    if (c === '"') q = !q;
    if (c === sep && !q) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

function parseLine(line) {
  let colon = -1, q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ':' && !q) { colon = i; break; }
  }
  if (colon < 0) return null;
  const parts = splitUnquoted(line.slice(0, colon), ';');
  const name = parts.shift().toUpperCase();
  const params = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value: line.slice(colon + 1) };
}

const unescapeText = (s) => s.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');

function parseDT(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const allDay = params.VALUE === 'DATE' || m[4] === undefined;
  return {
    y: +m[1], mo: +m[2], d: +m[3],
    h: allDay ? 0 : +m[4], mi: allDay ? 0 : +m[5], s: allDay ? 0 : +(m[6] || 0),
    allDay, tz: m[7] ? 'UTC' : (params.TZID || null),
  };
}

function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const g = (t) => +parts.find((p) => p.type === t).value;
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function toDate(f) {
  const local = () => new Date(f.y, f.mo - 1, f.d, f.h, f.mi, f.s);
  if (f.allDay || !f.tz) return local();
  const guess = Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s);
  if (f.tz === 'UTC') return new Date(guess);
  try {
    let t = guess - tzOffsetMs(guess, f.tz);
    t = guess - tzOffsetMs(t, f.tz);
    return new Date(t);
  } catch (_) {
    return local(); // unknown zone name (e.g. a Windows zone name): treat as local time
  }
}

function parseICS(text, fallbackName = 'Calendar') {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  let calName = fallbackName;
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const ln = raw.trim();
    if (ln === 'BEGIN:VEVENT') { cur = { calendar: null, exdates: [], rruleText: null }; continue; }
    if (ln === 'END:VEVENT') {
      if (cur && cur.start && !cur.cancelled) events.push(cur);
      cur = null;
      continue;
    }
    const p = parseLine(ln);
    if (!p) continue;
    if (!cur) { if (p.name === 'X-WR-CALNAME' && p.value) calName = unescapeText(p.value); continue; }
    switch (p.name) {
      case 'UID': cur.uid = p.value; break;
      case 'SUMMARY': cur.summary = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'DTSTART': cur.start = parseDT(p.value, p.params); break;
      case 'DTEND': cur.end = parseDT(p.value, p.params); break;
      case 'RRULE': cur.rruleText = p.value; break;
      case 'EXDATE':
        for (const v of p.value.split(',')) { const d = parseDT(v, p.params); if (d) cur.exdates.push(d); }
        break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseDT(p.value, p.params); break;
      case 'STATUS': if (/cancel/i.test(p.value)) cur.cancelled = true; break;
      default:
    }
  }
  for (const e of events) {
    e.calendar = calName;
    e.summary = e.summary || '(no title)';
    e.rrule = e.rruleText ? parseRRule(e.rruleText) : null;
  }
  return events;
}

// ------------------------------------------------------------ recurrence
const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const dn = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY);
const fromDn = (n) => { const t = new Date(n * DAY); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const dowOf = (n) => new Date(n * DAY).getUTCDay();
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function parseRRule(s) {
  const r = {};
  for (const kv of String(s).replace(/^RRULE:/i, '').split(';')) {
    const i = kv.indexOf('=');
    if (i > 0) r[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1);
  }
  if (!['YEARLY', 'MONTHLY', 'WEEKLY', 'DAILY'].includes(r.FREQ)) return null;
  const nums = (v) => v.split(',').map(Number).filter((n) => Number.isFinite(n) && n !== 0);
  return {
    freq: r.FREQ,
    interval: Math.max(1, parseInt(r.INTERVAL || '1', 10) || 1),
    count: r.COUNT ? parseInt(r.COUNT, 10) : null,
    until: r.UNTIL ? parseDT(r.UNTIL) : null,
    byday: r.BYDAY
      ? r.BYDAY.split(',').map((x) => {
        const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x.trim().toUpperCase());
        return m ? { n: m[1] ? parseInt(m[1], 10) : 0, dow: DOW[m[2]] } : null;
      }).filter(Boolean)
      : null,
    bymonthday: r.BYMONTHDAY ? nums(r.BYMONTHDAY) : null,
    bymonth: r.BYMONTH ? nums(r.BYMONTH) : null,
    approx: !!(r.BYSETPOS || r.BYYEARDAY || r.BYWEEKNO),
  };
}

function monthDays(y, mo, rule, startDay) {
  const n = dim(y, mo);
  let days;
  if (rule.bymonthday) days = rule.bymonthday.map((d) => (d < 0 ? n + d + 1 : d));
  else if (rule.byday) {
    days = [];
    for (const { n: nth, dow } of rule.byday) {
      const all = [];
      for (let d = 1; d <= n; d++) if (dowOf(dn(y, mo, d)) === dow) all.push(d);
      if (!nth) days.push(...all);
      else { const x = nth > 0 ? all[nth - 1] : all[all.length + nth]; if (x) days.push(x); }
    }
  } else if (startDay === 29 && mo === 2 && n === 28 && rule.freq === 'YEARLY') days = [28]; // leap-day birthdays: Feb 28 in other years
  else days = [startDay];
  return [...new Set(days.filter((d) => d >= 1 && d <= n))].sort((a, b) => a - b);
}

// Returns the start-field objects of every occurrence up to toMs (stops early at COUNT/UNTIL).
function occurrenceStarts(ev, toMs) {
  const s = ev.start, rule = ev.rrule;
  const out = [s];
  if (!rule) return out;

  const sd = dn(s.y, s.mo, s.d);
  const endDn = Math.floor(toMs / DAY) + 2;
  const untilMs = rule.until
    ? toDate(rule.until.allDay ? { ...rule.until, h: 23, mi: 59, s: 59 } : rule.until).getTime()
    : Infinity;
  let count = 1;
  const emit = (dnum) => {
    if (dnum <= sd) return true;
    const { y, mo, d } = fromDn(dnum);
    const f = { ...s, y, mo, d };
    const t = toDate(f).getTime();
    if (t > untilMs || t > toMs) return false;
    if (rule.count && ++count > rule.count) return false;
    out.push(f);
    return true;
  };

  const LIMIT = 100000;
  if (rule.freq === 'DAILY') {
    for (let k = 1; k < LIMIT; k++) {
      const x = sd + k * rule.interval;
      if (x > endDn) break;
      if (rule.byday && !rule.byday.some((b) => b.dow === dowOf(x))) continue;
      if (!emit(x)) break;
    }
  } else if (rule.freq === 'WEEKLY') {
    const base = sd - ((dowOf(sd) + 6) % 7); // weeks start on Monday
    const dows = (rule.byday ? rule.byday.map((b) => b.dow) : [dowOf(sd)])
      .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    outer: for (let k = 0; k < LIMIT; k++) {
      const ws = base + 7 * k * rule.interval;
      if (ws > endDn) break;
      for (const dw of dows) if (!emit(ws + ((dw + 6) % 7))) break outer;
    }
  } else if (rule.freq === 'MONTHLY') {
    outer2: for (let k = 0; k < LIMIT; k++) {
      const idx = s.mo - 1 + k * rule.interval;
      const y = s.y + Math.floor(idx / 12), mo = (idx % 12) + 1;
      if (dn(y, mo, 1) > endDn) break;
      for (const d of monthDays(y, mo, rule, s.d)) if (!emit(dn(y, mo, d))) break outer2;
    }
  } else {
    const months = (rule.bymonth || [s.mo]).slice().sort((a, b) => a - b);
    outer3: for (let k = 0; k < LIMIT; k++) {
      const y = s.y + k * rule.interval;
      if (dn(y, 1, 1) > endDn) break;
      for (const mo of months) for (const d of monthDays(y, mo, rule, s.d)) if (!emit(dn(y, mo, d))) break outer3;
    }
  }
  return out;
}

const repeatText = (r) => {
  if (!r) return '';
  const unit = { YEARLY: 'year', MONTHLY: 'month', WEEKLY: 'week', DAILY: 'day' }[r.freq];
  return r.interval > 1 ? `every ${r.interval} ${unit}s` : `${unit}ly`.replace('dayly', 'daily');
};

// All instances overlapping [fromMs, toMs).
function expand(events, fromMs, toMs) {
  const overridden = new Set();
  for (const e of events) {
    if (e.recurrenceId && e.uid) overridden.add(`${e.uid}|${toDate(e.recurrenceId).getTime()}`);
  }
  const out = [];
  events.forEach((ev, idx) => {
    const t0 = toDate(ev.start).getTime();
    const dur = ev.end ? Math.max(0, toDate(ev.end).getTime() - t0) : (ev.start.allDay ? DAY : 0);
    const skip = new Set(ev.exdates.map((x) => toDate(x).getTime()));
    let n = 0;
    for (const f of occurrenceStarts(ev, toMs)) {
      const t = toDate(f).getTime();
      if (skip.has(t)) continue;
      if (ev.uid && !ev.recurrenceId && overridden.has(`${ev.uid}|${t}`)) continue;
      const hit = dur > 0 ? t + dur > fromMs && t < toMs : t >= fromMs && t < toMs;
      if (!hit) continue;
      if (++n > PER_SERIES) break;
      out.push({
        series: idx, summary: ev.summary, location: ev.location || '', calendar: ev.calendar,
        start: new Date(t), allDay: ev.start.allDay, repeats: repeatText(ev.rrule),
        approx: !!(ev.rrule && (ev.rrule.approx || (ev.rrule.freq === 'YEARLY' && ev.start.mo === 2 && ev.start.d === 29))),
      });
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------ search + formatting
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f'’`]/g, '');

function matches(inst, tokens) {
  if (!tokens.length) return true;
  const hay = norm(`${inst.summary} ${inst.location}`);
  return tokens.every((t) => hay.includes(t));
}

const fmtDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

// Works out the date window. Default: today through the next 366 days (so a yearly birthday is always found).
function windowFor(input, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = parseDay(input && input.start_date) || today;
  let to = parseDay(input && input.end_date);
  to = to ? new Date(to.getTime() + DAY) : new Date(from.getTime() + 366 * DAY); // end date is inclusive
  if (to <= from) throw new Error('The end date must be on or after the start date.');
  if ((to - from) / DAY > MAX_SPAN_DAYS) to = new Date(from.getTime() + MAX_SPAN_DAYS * DAY);
  return { from, to };
}

function formatResults({ query, from, to, insts, notes, labels }) {
  const head = `${query ? `Events matching "${query}"` : 'Events'} from ${fmtDate(from)} to ${fmtDate(new Date(to.getTime() - DAY))}` +
    ` (calendars: ${labels.join(', ') || 'none'}):`;
  const lines = insts.slice(0, MAX_RESULTS).map((i, n) => {
    const when = i.allDay ? `${fmtDate(i.start)} (all day)` : `${fmtDate(i.start)} ${fmtTime(i.start)}`;
    const bits = [`${n + 1}. ${when}: ${i.summary}`];
    if (i.location) bits.push(`at ${i.location}`);
    if (i.repeats) bits.push(`(repeats ${i.repeats}${i.approx ? '; exact date may be approximate' : ''})`);
    return bits.join(' ') + ` [${i.calendar}]`;
  });
  const body = lines.length ? lines.join('\n') : 'No matching events found in that period.';
  const more = insts.length > MAX_RESULTS ? `\n...and ${insts.length - MAX_RESULTS} more (narrow the dates or the search).` : '';
  return `${head}\n${body}${more}${notes.length ? '\n\nNotes:\n' + notes.join('\n') : ''}`;
}

// ------------------------------------------------------------ macOS Calendar app
const JXA = `
function run(argv) {
  var q = argv[0] || '';
  var app = Application('Calendar');
  var out = [];
  app.calendars().forEach(function (c) {
    try {
      var evs = c.events.whose({ summary: { _contains: q } });
      var sum = evs.summary(), st = evs.startDate(), en = evs.endDate();
      var ad = evs.alldayEvent(), rc = evs.recurrence(), lc = evs.location();
      for (var i = 0; i < sum.length && out.length < 300; i++) {
        out.push({ cal: c.name(), summary: sum[i], start: st[i].toISOString(), end: en[i] ? en[i].toISOString() : null,
          allDay: !!ad[i], rrule: rc[i] || null, location: lc[i] || '' });
      }
    } catch (e) { /* some calendars (e.g. Birthdays) may not be scriptable */ }
  });
  return JSON.stringify(out);
}`;

function fieldsFromLocal(d, allDay) {
  return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: allDay ? 0 : d.getHours(), mi: allDay ? 0 : d.getMinutes(), s: 0, allDay, tz: null };
}

// ------------------------------------------------------------ factory
function createCalendar({ fetchFn, readFile, execFile, platform = process.platform, getSources }) {
  const cache = new Map();

  async function fetchText(url) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25000);
    try {
      const res = await fetchFn(url, { signal: ac.signal, redirect: 'follow', headers: { accept: 'text/calendar, text/plain, */*' } });
      if (!res.ok) throw new Error(`the link answered with HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('the calendar file is too big');
      return buf.toString('utf8');
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('the link timed out');
      throw new Error(e.cause && e.cause.code ? `network problem (${e.cause.code})` : e.message);
    } finally { clearTimeout(timer); }
  }

  async function loadSource(src) {
    if (src.kind === 'url') {
      const hit = cache.get(src.id);
      if (hit && Date.now() - hit.t < CACHE_MS && hit.v === src.value) return hit.events;
      const text = await fetchText(src.value);
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('that link did not return a calendar (.ics) file');
      const events = parseICS(text, src.label);
      cache.set(src.id, { t: Date.now(), v: src.value, events });
      return events;
    }
    if (src.kind === 'file') {
      const stat = readFile.stat(src.value);
      if (stat.size > MAX_BYTES) throw new Error('the calendar file is too big');
      const text = readFile.text(src.value);
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('that file is not a calendar (.ics) file');
      return parseICS(text, src.label);
    }
    throw new Error('unknown calendar type');
  }

  function loadMac(query) {
    return new Promise((resolve, reject) => {
      if (platform !== 'darwin') return reject(new Error('the Calendar app can only be read on a Mac'));
      const word = norm(query).split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)[0];
      if (!word) return reject(new Error('the Calendar app is only searched by name, so give a name or word to look for'));
      execFile('osascript', ['-l', 'JavaScript', '-e', JXA, word], { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }, (err, out, stderr) => {
        if (err) {
          if (/-1743|not authorized|not allowed/i.test(String(stderr))) {
            return reject(new Error('macOS has not allowed Pip to control Calendar (System Settings > Privacy & Security > Automation)'));
          }
          return reject(new Error('could not read the Calendar app'));
        }
        try {
          resolve(JSON.parse(out).map((r) => {
            const allDay = !!r.allDay;
            return {
              uid: null, calendar: r.cal || 'Calendar app', summary: r.summary || '(no title)', location: r.location || '',
              start: fieldsFromLocal(new Date(r.start), allDay), end: null, exdates: [],
              rrule: r.rrule ? parseRRule(r.rrule) : null,
            };
          }));
        } catch (_) { reject(new Error('could not understand the Calendar app answer')); }
      });
    });
  }

  // What would be searched, without reading anything (used for the approval card).
  function describe() {
    const { sources, mac } = getSources();
    const labels = sources.map((s) => s.label);
    if (mac && platform === 'darwin') labels.push('Calendar app');
    return labels;
  }

  async function search(input, now = new Date()) {
    const query = typeof (input && input.query) === 'string' ? input.query.trim().slice(0, 80) : '';
    const { from, to } = windowFor(input, now);
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    const { sources, mac } = getSources();
    const notes = [];
    const labels = [];
    let all = [];

    for (const src of sources) {
      try {
        const events = await loadSource(src);
        labels.push(src.label);
        all = all.concat(expand(events, from.getTime(), to.getTime()).filter((i) => matches(i, tokens)));
      } catch (e) {
        notes.push(`Could not read "${src.label}": ${e.message}.`);
      }
    }
    if (mac && platform === 'darwin') {
      try {
        const events = await loadMac(query);
        labels.push('Calendar app');
        all = all.concat(expand(events, from.getTime(), to.getTime()).filter((i) => matches(i, tokens)));
      } catch (e) {
        notes.push(`Calendar app: ${e.message}.`);
      }
    }
    if (!labels.length) {
      throw new Error(notes.join(' ') || 'No calendar is connected yet. The user can add one in Pip settings (the gear) under Calendars.');
    }
    const seen = new Set();
    all = all.filter((i) => {
      const k = `${norm(i.summary)}|${i.start.getTime()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => a.start - b.start);
    return formatResults({ query, from, to, insts: all, notes, labels });
  }

  // Used when adding a calendar in settings: returns how many events it found, or throws.
  async function test(src) {
    cache.delete(src.id);
    return (await loadSource(src)).length;
  }

  return { search, describe, test, windowFor };
}

module.exports = { createCalendar, parseICS, expand, windowFor, parseRRule, formatResults };
