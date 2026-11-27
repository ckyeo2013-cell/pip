'use strict';
/*
 * The morning brief: today's calendar events, tasks that are due, and the weather, in a few friendly lines.
 *   fetchWeather({ fetchFn, city, unit }) -> { ok, city, now, hi, lo, rain, words } | { ok: false, reason }
 *   buildBrief({ now, events, tasks, weather, calendarConnected, noteReason }) -> { text, short }
 * The weather comes from Open-Meteo (free, no account or key). Only the city name the user typed in settings is sent,
 * and nothing is looked up at all while that box is empty.
 */

// WMO weather codes -> plain words
const WORDS = [
  [[0], 'clear'], [[1], 'mostly clear'], [[2], 'partly cloudy'], [[3], 'overcast'], [[45, 48], 'foggy'],
  [[51, 53, 55, 56, 57], 'drizzly'], [[61, 63, 65, 66, 67], 'rainy'], [[71, 73, 75, 77], 'snowy'],
  [[80, 81, 82], 'showery'], [[85, 86], 'snow showers'], [[95, 96, 99], 'stormy'],
];
const describeWeather = (code) => { for (const [codes, w] of WORDS) if (codes.includes(code)) return w; return 'mixed'; };

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const cache = { key: '', at: 0, value: null };

async function getJson(fetchFn, url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetchFn(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function fetchWeather({ fetchFn, city, unit = 'c', now = Date.now() }) {
  const name = String(city || '').trim().slice(0, 80);
  if (!name) return { ok: false, reason: 'no city' };
  const key = `${name.toLowerCase()}|${unit}`;
  if (cache.key === key && now - cache.at < 30 * 60000 && cache.value) return cache.value;
  try {
    const g = await getJson(fetchFn, `${GEO}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`);
    const hit = g && Array.isArray(g.results) && g.results[0];
    if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return { ok: false, reason: `I could not find a place called "${name}".` };
    const q = `latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto&temperature_unit=${unit === 'f' ? 'fahrenheit' : 'celsius'}`;
    const f = await getJson(fetchFn, `${FORECAST}?${q}`);
    const cur = f && f.current, day = f && f.daily;
    if (!cur || !day || !Array.isArray(day.temperature_2m_max)) return { ok: false, reason: 'The weather service sent something unexpected.' };
    const r = {
      ok: true, city: hit.name || name, unit: unit === 'f' ? 'F' : 'C',
      now: Math.round(cur.temperature_2m), hi: Math.round(day.temperature_2m_max[0]), lo: Math.round(day.temperature_2m_min[0]),
      rain: Number.isFinite(day.precipitation_probability_max && day.precipitation_probability_max[0]) ? day.precipitation_probability_max[0] : null,
      words: describeWeather(cur.weather_code),
    };
    cache.key = key; cache.at = now; cache.value = r;
    return r;
  } catch (e) {
    return { ok: false, reason: 'I could not reach the weather service.' };
  }
}

const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function buildBrief({ now = new Date(), events = null, tasks = [], weather = null, calendarConnected = true, calendarProblem = '' }) {
  const h = now.getHours();
  const hello = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const lines = [`${hello}! Here is your day:`];
  const shortBits = [];

  // calendar
  if (events) {
    const today = events.filter((e) => e.start.toDateString() === now.toDateString());
    const timed = today.filter((e) => !e.allDay), allDay = today.filter((e) => e.allDay);
    const upcoming = timed.filter((e) => e.start.getTime() >= now.getTime() - 30 * 60000);
    if (!today.length) { lines.push('• Calendar: nothing scheduled today.'); shortBits.push('a clear calendar'); }
    else {
      lines.push(`• Calendar: ${plural(today.length, 'thing')} today.`);
      for (const e of allDay.slice(0, 3)) lines.push(`   - ${e.summary} (all day)`);
      for (const e of timed.slice(0, 8)) lines.push(`   - ${clock(e.start)}: ${e.summary}${e.location ? ` at ${e.location}` : ''}`);
      if (timed.length > 8) lines.push(`   ...and ${timed.length - 8} more`);
      const next = upcoming[0];
      shortBits.push(next ? `${plural(today.length, 'event')}, next at ${clock(next.start)}` : plural(today.length, 'event'));
    }
  } else if (calendarProblem) lines.push(`• Calendar: ${calendarProblem}`);
  else if (!calendarConnected) lines.push('• Calendar: not connected yet (add one in settings under Calendars).');

  // tasks
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const due = tasks.filter((t) => t.due && t.due < endOfDay);
  const overdue = due.filter((t) => t.due < now.getTime() - 60000);
  const later = tasks.filter((t) => !t.due || t.due >= endOfDay);
  if (!tasks.length) lines.push('• To do: nothing on your list.');
  else {
    lines.push(`• To do: ${plural(tasks.length, 'task')}${due.length ? `, ${due.length} due today${overdue.length ? ` (${overdue.length} overdue)` : ''}` : ''}.`);
    for (const t of due.slice(0, 5)) lines.push(`   - ${t.text}${t.due < now.getTime() - 60000 ? ' (overdue)' : ` (${clock(new Date(t.due))})`}`);
    for (const t of later.slice(0, Math.max(0, 5 - due.length))) lines.push(`   - ${t.text}`);
  }
  if (tasks.length) shortBits.push(due.length ? `${plural(due.length, 'task')} due${overdue.length ? `, ${overdue.length} late` : ''}` : plural(tasks.length, 'task'));

  // weather
  let tip = '';
  if (weather && weather.ok) {
    const rainy = weather.rain != null && weather.rain >= 50;
    lines.push(`• Weather in ${weather.city}: ${weather.words}, ${weather.now}°${weather.unit} now (${weather.lo}° to ${weather.hi}°${weather.rain != null ? `, ${weather.rain}% chance of rain` : ''}).`);
    shortBits.push(`${weather.now}°${weather.unit} and ${weather.words}`);
    if (rainy) tip = 'Take an umbrella!';
    else if (weather.unit === 'C' ? weather.hi >= 33 : weather.hi >= 91) tip = 'It will be hot, so drink plenty of water.';
    else if (weather.unit === 'C' ? weather.lo <= 5 : weather.lo <= 41) tip = 'It will be cold, so wear something warm.';
  } else if (weather && weather.reason && weather.reason !== 'no city') lines.push(`• Weather: ${weather.reason}`);
  if (tip) lines.push('', tip);

  return { text: lines.join('\n'), short: shortBits.length ? `${hello}! ${shortBits.join(', ')}.` : `${hello}!` };
}

module.exports = { fetchWeather, buildBrief, describeWeather };
