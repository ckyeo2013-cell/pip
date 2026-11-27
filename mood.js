'use strict';
/*
 * Mood memory: how Pip feels about the user, kept between sessions (bond -100..100, plus a grudge timer after rudeness).
 * Split out of main.js; behaviour is unchanged. createMood(fileFn) -> { MOOD, load, save, level, gain, summary, touch }
 */
const fs = require('fs');

function createMood(fileFn) {
  const MOOD = { bond: 0, grudgeUntil: 0, lastSeen: Date.now(), days: [], gainDay: '', gainToday: 0 };
  let timer = null;
  function load() {
    try {
      Object.assign(MOOD, JSON.parse(fs.readFileSync(fileFn(), 'utf8')));
      const gone = Math.max(0, (Date.now() - (MOOD.lastSeen || Date.now())) / 86400000);
      if (MOOD.bond > 0) MOOD.bond = Math.max(0, MOOD.bond - 0.5 * gone); else if (MOOD.bond < 0) MOOD.bond = Math.min(0, MOOD.bond + 3 * gone); // time heals, and friendships fade a little
    } catch (_) { /* first run */ }
  }
  function save() { clearTimeout(timer); timer = setTimeout(() => { try { fs.writeFileSync(fileFn(), JSON.stringify(MOOD)); } catch (_) {} }, 600); }
  const level = (b) => (b < -30 ? 'hurt' : b < -10 ? 'wary' : b < 15 ? 'new' : b < 40 ? 'friendly' : b < 70 ? 'close' : 'best friend');
  function gain(n) { // positive changes are capped per day, so a friendship takes days, not one chat
    const d = new Date().toDateString();
    if (MOOD.gainDay !== d) { MOOD.gainDay = d; MOOD.gainToday = 0; }
    const ok = Math.max(0, Math.min(n, 8 - MOOD.gainToday));
    MOOD.gainToday += ok; MOOD.bond = Math.min(100, MOOD.bond + ok);
  }
  function summary() {
    const now = Date.now();
    return { bond: Math.round(MOOD.bond), level: level(MOOD.bond), grudge: now < MOOD.grudgeUntil, days: MOOD.days.length, absentHours: (now - (MOOD.lastSeen || now)) / 3600000 };
  }
  function touch() {
    const d = new Date().toDateString();
    if (!MOOD.days.includes(d)) { MOOD.days.push(d); if (MOOD.days.length > 400) MOOD.days.shift(); }
  }
  return { MOOD, load, save, level, gain, summary, touch };
}

module.exports = { createMood };
