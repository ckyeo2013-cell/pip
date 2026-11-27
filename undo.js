'use strict';
/*
 * Undo for the file actions Pip performs, and the saved "what Pip did" log.
 *
 * The system Trash cannot be asked "give me that file back", so before Pip replaces or trashes something it keeps a private copy in
 * its own folder (inside the app's data folder). One click on Undo then puts the original back. Moves are undone by moving back,
 * and new files by sending them to the Trash. Copies are capped (big items are skipped, old ones are cleaned up), and an item that
 * could not be copied is simply not undoable: it is still in the Trash, as before.
 *
 *   createUndo({ dir, trash })      dir: where backups live; trash(absPath): async, sends a path to the system Trash
 *     .snapshot(abs)   -> { backup } | null     copy before changing/trashing
 *     .apply(desc)     -> Promise<{ ok, text }> carry out an undo descriptor; text is a sentence for the user, ok says whether anything was undone
 *     .prune(keep)     -> void                  delete backups not listed in keep (a Set of backup paths) and ones older than 30 days
 *   createLog(file, max) a small persisted list of what Pip did
 */
const fs = require('fs');
const path = require('path');

const MAX_ITEM = 100 * 1024 * 1024;     // bigger than this is not copied
const MAX_TOTAL = 500 * 1024 * 1024;    // all backups together
const MAX_AGE = 30 * 24 * 3600 * 1000;

function sizeOf(p, cap = Infinity) {
  let total = 0;
  const walk = (q) => {
    if (total > cap) return;
    let st;
    try { st = fs.lstatSync(q); } catch (_) { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) { let names = []; try { names = fs.readdirSync(q); } catch (_) {} for (const n of names) walk(path.join(q, n)); }
    else total += st.size;
  };
  walk(p);
  return total;
}

function createUndo({ dir, trash }) {
  let seq = 0;
  const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  function usedSpace() { return sizeOf(dir); }

  function snapshot(abs) {
    try {
      if (!abs || !path.isAbsolute(abs) || !fs.existsSync(abs)) return null;
      const size = sizeOf(abs, MAX_ITEM);
      if (size > MAX_ITEM || usedSpace() + size > MAX_TOTAL) return null;
      const folder = path.join(dir, uid());
      fs.mkdirSync(folder, { recursive: true });
      const backup = path.join(folder, path.basename(abs));
      fs.cpSync(abs, backup, { recursive: true, errorOnExist: true, dereference: false });
      return { backup };
    } catch (_) { return null; }
  }

  const exists = (p) => { try { fs.lstatSync(p); return true; } catch (_) { return false; } };
  const name = (p) => path.basename(p);

  async function apply(d) {
    if (!d || typeof d !== 'object') return { ok: false, text: 'There is nothing to undo here.' };
    const out = [];
    let ok = 0; // how many things really were undone
    if (d.type === 'moved') {
      for (const { from, to } of d.moves || []) {
        if (!exists(to)) { out.push(`${name(to)} is no longer there.`); continue; }
        if (exists(from)) { out.push(`Something already sits at ${from}, so ${name(to)} stays where it is.`); continue; }
        try {
          fs.mkdirSync(path.dirname(from), { recursive: true });
          try { fs.renameSync(to, from); }
          catch (e) {
            if (!e || e.code !== 'EXDEV') throw e;
            fs.cpSync(to, from, { recursive: true, errorOnExist: true, force: false }); // other drive: copy back, then the copy goes to the Trash
            await trash(to);
          }
          ok++; out.push(`Moved ${name(to)} back.`);
        } catch (e) { out.push(`Could not move ${name(to)} back (${e.message}).`); }
      }
    } else if (d.type === 'created') {
      if (!exists(d.path)) out.push(`${name(d.path)} is already gone.`);
      else { try { await trash(d.path); ok++; out.push(`Sent ${name(d.path)} to the Trash.`); } catch (e) { out.push(`Could not remove ${name(d.path)} (${e.message}).`); } }
    } else if (d.type === 'mkdir') {
      try { fs.rmdirSync(d.path); ok++; out.push(`Removed the empty folder ${name(d.path)}.`); }
      catch (e) { out.push(e && e.code === 'ENOENT' ? `${name(d.path)} is already gone.` : `${name(d.path)} was left alone because it is not empty.`); }
    } else if (d.type === 'restore') {
      for (const it of d.items || []) {
        if (!it.backup || !exists(it.backup)) { out.push(`The saved copy of ${name(it.orig)} is gone (look in the Trash).`); continue; }
        try {
          if (exists(it.orig)) {
            if (!it.replaced) { out.push(`Something already sits at ${it.orig}, so I left it alone.`); continue; }
            await trash(it.orig); // the new version goes to the Trash, the old one comes back
          }
          fs.mkdirSync(path.dirname(it.orig), { recursive: true });
          fs.cpSync(it.backup, it.orig, { recursive: true, errorOnExist: true });
          ok++; out.push(`Restored ${name(it.orig)}.`);
        } catch (e) { out.push(`Could not restore ${name(it.orig)} (${e.message}).`); }
      }
    } else return { ok: false, text: 'I cannot undo that one automatically.' };
    return { ok: ok > 0, text: out.join(' ') || 'Nothing to do.' };
  }

  function prune(keep = new Set()) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { return; }
    const now = Date.now();
    for (const n of names) {
      const folder = path.join(dir, n);
      let st; try { st = fs.statSync(folder); } catch (_) { continue; }
      const kept = [...keep].some((k) => String(k).startsWith(folder + path.sep));
      if (!kept || now - st.mtimeMs > MAX_AGE) { try { fs.rmSync(folder, { recursive: true, force: true }); } catch (_) {} }
    }
  }

  return { snapshot, apply, prune, dir };
}

// ------------------------------------------------------------------------------------------------
// The persisted log of actions. Entries: { id, at, title, detail, undo, undone }
function createLog(file, max = 50) {
  let list = [];
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(d)) list = d.filter((e) => e && typeof e.title === 'string' && Number.isFinite(e.at)).slice(-max).map((e) => ({
      id: String(e.id || e.at), at: e.at, title: String(e.title).slice(0, 120), detail: String(e.detail || '').slice(0, 1200),
      undo: e.undo && typeof e.undo === 'object' ? e.undo : null, undone: !!e.undone,
    }));
  } catch (_) { /* first run */ }
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list), { mode: 0o600 }); } catch (_) {} }, 400);
  };
  const flush = () => { clearTimeout(timer); try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list), { mode: 0o600 }); } catch (_) {} };
  return {
    list: () => list,
    add(e) {
      const entry = { id: `${e.at}-${Math.random().toString(36).slice(2, 6)}`, at: e.at, title: String(e.title).slice(0, 120), detail: String(e.detail || '').slice(0, 1200), undo: e.undo || null, undone: false };
      list.push(entry);
      while (list.length > max) list.shift();
      save();
      return entry;
    },
    get: (id) => list.find((e) => e.id === id) || null,
    markUndone(id) { const e = list.find((x) => x.id === id); if (e) { e.undone = true; save(); } },
    backups() { const s = new Set(); for (const e of list) if (e.undo && !e.undone) for (const it of e.undo.items || []) if (it.backup) s.add(it.backup); return s; },
    clear() { list = []; save(); },
    flush,
  };
}

module.exports = { createUndo, createLog };
