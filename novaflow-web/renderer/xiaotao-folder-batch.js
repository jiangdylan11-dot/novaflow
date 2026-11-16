// 小桃 · a folder the user names in a sentence.
//
// "把 D:\素材\角色 里的图都转成水彩风": a web page cannot read a folder from its path, so the folder is
// reached through one the user allowed before (kept in IndexedDB with the path they typed, plus the
// folders the import dialogs keep) and, the first time, through one folder choice. This file only finds
// the path in the sentence, reaches the folder and lists its files; 小桃 then feeds the files one by one
// through the same turn a single attached file takes (xiaotao-art-agent.js: folder batch).
(function (root) {
  'use strict';
  const DB = 'foart-xiaotao-folders', STORE = 'folders', KEEP = 24;
  const SHARED_DB = 'foart-folder-grants';
  const PATH = /(?:"([^"\n]+)"|“([^”\n]+)”|((?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|~\/|\/(?:Users|home|Volumes|mnt)\/)[^\s"“”，。；！？<>|*?]*))/;
  // What follows the path and only points at its content: "文件夹里的所有图片都".
  const TAIL = /^\s*(?:这个|那个)?(?:文件夹|目录|路径)?\s*(?:里面|里边|里头|里|中|下面|下|内)?(?:的)?(?:所有|全部|每一?[个张段])?(?:的)?(?:图片|图像|照片|图|视频|音频|文件|素材|东西|内容)?(?:全部|全都|都|逐个|挨个|一个个|一张张)?/;
  const IDLE = /^(?:请|帮我|帮忙|麻烦|给我|把|将|对|用|看看|看一下|处理|弄|搞|一下|下|吧|了|的|这个|这张图|这个文件|[\s，。,.!！~、：:])*$/;

  /** The folder path in a sentence, and the sentence as it reads for one file of that folder. */
  function find(message) {
    const text = String(message || ''), hit = PATH.exec(text);
    if (!hit) return null;
    let path = (hit[1] || hit[2] || hit[3] || '').trim().replace(/[\\/]+$/, '');
    const parts = segments(path);
    // A drive alone ("D:\") or a file ("a.png") is not a folder to work through.
    if (!parts.length || /\.[A-Za-z0-9]{2,5}$/.test(parts[parts.length - 1]) && !hit[1] && !hit[2]) return null;
    const before = text.slice(0, hit.index).replace(/\s+$/, ''), after = text.slice(hit.index + hit[0].length), tail = TAIL.exec(after)[0];
    const deep = /子文件夹|子目录|所有层|每一层/.test(text) && !/不(?:要|含|包括|用).{0,4}子(?:文件夹|目录)/.test(text);
    const rest = (before + '\u0001' + after.slice(tail.length)).replace(/(?:[，,]?\s*(?:包括|包含|连同|含)\s*(?:所有)?子(?:文件夹|目录)(?:里的?)?(?:也要?|一起)?)/g, '');
    return { path, name: parts[parts.length - 1], deep, instruction: kind => IDLE.test(rest.replace('\u0001', '')) ? '' : rest.replace('\u0001', kind === 'image' ? '这张图' : kind === 'video' ? '这个视频' : kind === 'audio' ? '这段音频' : '这个文件').trim() };
  }
  const segments = path => String(path || '').replace(/^\\\\/, '').split(/[\\/]+/).filter(part => part && !/^[A-Za-z]:$/.test(part) && part !== '~');
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  const open = name => new Promise(resolve => {
    try {
      if (!root.indexedDB) { resolve(null); return; }
      const req = root.indexedDB.open(name, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch { /* exists */ } };
      req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  const readList = async name => {
    const db = await open(name); if (!db) return [];
    return await new Promise(resolve => {
      try { const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('list'); req.onsuccess = () => { db.close(); resolve(Array.isArray(req.result) ? req.result : []); }; req.onerror = () => { db.close(); resolve([]); }; }
      catch { try { db.close(); } catch { /* closed */ } resolve([]); }
    });
  };
  const writeList = async list => {
    const db = await open(DB); if (!db) return;
    await new Promise(resolve => {
      try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(list.slice(0, KEEP), 'list'); tx.oncomplete = tx.onerror = tx.onabort = () => { db.close(); resolve(); }; }
      catch { resolve(); }
    });
  };
  async function remember(path, handle) {
    const kept = (await readList(DB)).filter(row => row && row.handle && !same(row.path, path));
    await writeList([{ path, handle }, ...kept]);
  }
  const walk = async (handle, parts) => { let dir = handle; for (const part of parts) dir = await dir.getDirectoryHandle(part); return dir; };
  const readable = async (handle, ask) => {
    try {
      let state = typeof handle.queryPermission === 'function' ? await handle.queryPermission({ mode: 'read' }) : 'granted';
      if (state !== 'granted' && ask && typeof handle.requestPermission === 'function') state = await handle.requestPermission({ mode: 'read' });
      return state === 'granted';
    } catch { return false; }
  };
  /** Folders allowed before that may hold `path`: [{handle, below:[names to walk down]}], best first. */
  async function candidates(path) {
    const parts = segments(path), found = [];
    for (const row of await readList(DB)) {
      if (!row || !row.handle || row.handle.kind !== 'directory') continue;
      const kept = segments(row.path);
      if (kept.length <= parts.length && kept.every((part, i) => same(part, parts[i]))) found.push({ handle: row.handle, below: parts.slice(kept.length), exact: true });
    }
    // Folders the import dialogs keep carry no path: the name has to appear in the typed path.
    for (const handle of await readList(SHARED_DB)) {
      if (!handle || handle.kind !== 'directory') continue;
      for (let i = parts.length - 1; i >= 0; i--) if (same(parts[i], handle.name)) { found.push({ handle, below: parts.slice(i + 1) }); break; }
    }
    return found.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || a.below.length - b.below.length);
  }
  /**
   * { handle } when the folder can be read right now; { ask:'permission' } when a folder allowed before
   * needs the browser's own confirmation; { ask:'pick' } when it has to be chosen once; { unsupported }.
   */
  async function resolve(path) {
    if (typeof root.showDirectoryPicker !== 'function') return { unsupported: true };
    let waiting = false;
    for (const item of await candidates(path)) {
      if (!await readable(item.handle, false)) { waiting = true; continue; }
      try { return { handle: await walk(item.handle, item.below) }; } catch { /* moved or renamed: try the next */ }
    }
    return { ask: waiting ? 'permission' : 'pick' };
  }
  /** Call inside the user's click: the browser confirmation for a kept folder, else one folder choice. */
  async function grant(path) {
    const parts = segments(path);
    for (const item of await candidates(path)) {
      if (!await readable(item.handle, true)) continue;
      try { const handle = await walk(item.handle, item.below); if (!item.exact || item.below.length) await remember(path, handle); return { handle }; } catch { /* next */ }
    }
    let picked;
    try { picked = await root.showDirectoryPicker({ id: 'foart-xiaotao-folder', mode: 'read' }); }
    catch (error) { return { cancelled: error?.name === 'AbortError', blocked: error?.name !== 'AbortError' }; }
    // The user may point at a folder above the one they named: walk down to it when the names line up.
    let handle = picked, at = -1;
    for (let i = parts.length - 1; i >= 0; i--) if (same(parts[i], picked.name)) { at = i; break; }
    if (at >= 0 && at < parts.length - 1) { try { handle = await walk(picked, parts.slice(at + 1)); } catch { handle = picked; } }
    await remember(path, handle);
    return { handle, other: !same(handle.name, parts[parts.length - 1]) ? handle.name : '' };
  }
  const natural = (a, b) => String(a).localeCompare(String(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
  /** Files of the folder in name order: [{name, path, file()}]; `folders` counts the subfolders left out. */
  async function list(handle, { deep = false, limit = 5000 } = {}) {
    const files = []; let folders = 0;
    const visit = async (dir, prefix) => {
      const entries = [];
      for await (const entry of dir.values()) entries.push(entry);
      entries.sort((a, b) => natural(a.name, b.name));
      for (const entry of entries) {
        if (files.length >= limit) return;
        if (/^[.~$]/.test(entry.name) || /^(?:thumbs\.db|desktop\.ini)$/i.test(entry.name)) continue;
        if (entry.kind === 'directory') { if (deep) await visit(entry, prefix + entry.name + '/'); else folders++; continue; }
        files.push({ name: entry.name, path: prefix + entry.name, file: () => entry.getFile() });
      }
    };
    await visit(handle, '');
    return { files, folders };
  }
  root.FoartXiaotaoFolder = Object.freeze({ find, resolve, grant, list, remember });
})(typeof window !== 'undefined' ? window : globalThis);
