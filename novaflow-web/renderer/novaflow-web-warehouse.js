// Browser-owned local warehouse. Only generated outputs enter the save queue;
// selecting a folder never uploads its files to the control plane or Worker.
(function (root) {
  'use strict';
  const MEDIA = /\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov)$/i;
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
  const records = new Map();
  let db, directory = null, permission = 'prompt', lastError = '', panel, status, listing, preview, previousFocus;
  let serial = Promise.resolve(), previewUrl = '', busy = false, feedback = '';
  let folderLabel, connectionLabel, errorLabel, summary, breadcrumbs, search, sort, viewer;
  let folderTrail = [], entries = [], filter = 'all', listingVersion = 0, thumbnailObserver;
  const thumbnailUrls = new Set();

  async function database() {
    if (!root.indexedDB) throw new Error('浏览器未提供本地保存空间');
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open('novaflow-local-warehouse', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('settings');
        request.result.createObjectStore('outputs', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function transaction(store, mode, run) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = run(tx.objectStore(store));
      tx.oncomplete = () => resolve(request && request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('浏览器本地存储失败'));
    });
  }
  async function persist(record) {
    if (db) await transaction('outputs', 'readwrite', store => store.put(record));
  }
  const ready = (async () => {
    try {
      db = await database();
      directory = await transaction('settings', 'readonly', store => store.get('directory')) || null;
      const saved = await transaction('outputs', 'readonly', store => store.getAll());
      saved.forEach(record => records.set(record.id, record));
      if (directory) permission = await directory.queryPermission({ mode: 'readwrite' });
    } catch (error) { lastError = '仓库设置未能恢复：' + error.message; }
  })();

  function enqueue(run) {
    const next = serial.then(run, run);
    serial = next.catch(() => {});
    return next;
  }
  function pendingCount() { return [...records.values()].filter(item => item.blob).length; }
  function tell() {
    if (!status) return;
    folderLabel.textContent = directory ? directory.name : '连接本地文件夹';
    connectionLabel.textContent = directory ? (permission === 'granted' ? '已连接本机' : '需要恢复授权') : '尚未连接';
    connectionLabel.dataset.connected = String(!!directory && permission === 'granted');
    status.textContent = feedback || (pendingCount() ? pendingCount() + ' 个结果等待保存' : directory && permission === 'granted' ? '新生成的图片和视频将自动保存到此文件夹' : '选择作品文件夹，即可浏览并自动保存生成结果');
    errorLabel.textContent = lastError; errorLabel.hidden = !lastError;
    panel.querySelector('[data-warehouse-action="authorize"]').hidden = !directory || permission === 'granted';
    panel.querySelector('[data-warehouse-action="disconnect"]').hidden = !directory;
    panel.querySelector('[data-warehouse-action="open-folder"]').disabled = !directory || permission !== 'granted';
    panel.querySelector('[data-warehouse-action="retry"]').hidden = !lastError || !pendingCount() || permission !== 'granted';
  }
  function notice() {
    if (panel && !panel.hidden) { tell(); return; }
    let node = root.document.getElementById('novaflow-warehouse-notice');
    if (!node) {
      node = root.document.createElement('button'); node.id = 'novaflow-warehouse-notice';
      node.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483645;padding:12px 18px;border:1px solid #477266;border-radius:10px;background:#173e32;color:#fff;cursor:pointer';
      node.onclick = () => open(); root.document.body.appendChild(node);
    }
    node.textContent = lastError ? '仓库保存未完成 · 点击查看' : '有 ' + pendingCount() + ' 个生成结果待保存 · 连接本地仓库';
    node.hidden = pendingCount() === 0 && !lastError;
  }
  function cleanName(name, type) {
    let value = String(name || '').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(-150);
    if (!MEDIA.test(value)) {
      const ext = Object.keys(MIME).find(key => MIME[key] === type);
      if (!ext) throw new Error('不支持入库的文件类型');
      value = 'NovaFlow_' + Date.now() + '.' + ext;
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(value)) value = 'NovaFlow_' + value;
    return value;
  }
  async function digest(blob) {
    const result = await root.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
  }
  async function write(record) {
    const dot = record.name.lastIndexOf('.');
    const base = record.name.slice(0, dot) + '_' + record.hash.slice(0, 12);
    const ext = record.name.slice(dot);
    for (let i = 0; i < 1000; i++) {
      const name = base + (i ? '_' + i : '') + ext;
      let file;
      try {
        file = await directory.getFileHandle(name);
        const existing = await file.getFile();
        if (existing.size === record.blob.size && await digest(existing) === record.hash) return name;
        continue; // Never replace a user's file, even if its name collides.
      } catch (error) { if (error.name !== 'NotFoundError') throw error; }
      file = await directory.getFileHandle(name, { create: true });
      const stream = await file.createWritable();
      try { await stream.write(record.blob); await stream.close(); }
      catch (error) { await stream.abort().catch(() => {}); throw error; }
      return name;
    }
    throw new Error('同名文件过多，请更换文件夹后重试');
  }
  async function flushNow() {
    await ready;
    // A folder selected in another tab also applies to this tab's next output.
    if (db) {
      const selected = await transaction('settings', 'readonly', store => store.get('directory')) || null;
      if ((!selected || !directory || !directory.isSameEntry || !await directory.isSameEntry(selected))) folderTrail = [];
      directory = selected;
    }
    if (!directory) { tell(); notice(); return; }
    permission = await directory.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') { tell(); notice(); return; }
    const run = async () => {
      for (const record of records.values()) {
        if (!record.blob) continue;
        const latest = db && await transaction('outputs', 'readonly', store => store.get(record.id));
        if (latest?.discarded) { records.set(record.id, latest); continue; }
        const name = await write(record);
        const saved = { ...record, savedName: name, blob: null };
        // Keep the retryable blob until the disk write and local index commit.
        await persist(saved); records.set(record.id, saved);
      }
    };
    try {
      if (root.navigator.locks) await root.navigator.locks.request('novaflow-warehouse-write', run);
      else await run();
      lastError = '';
    } catch (error) { lastError = '未写入本地文件夹，结果保留待重试：' + error.message; }
    tell(); notice();
    if (panel && !panel.hidden) await refreshList();
  }
  async function save({ blob, name }) {
    await ready;
    try {
      name = cleanName(name, blob.type);
      const hash = await digest(blob), id = name + ':' + hash;
      return await enqueue(async () => {
        if (!records.has(id)) {
          const record = { id, name, hash, blob, createdAt: Date.now() };
          records.set(id, record);
          try { await persist(record); }
          catch (error) { lastError = '浏览器暂存失败，请保持页面打开并连接文件夹：' + error.message; notice(); }
        }
        await flushNow();
        return { ok: !records.get(id).blob, pending: !!records.get(id).blob };
      });
    } catch (error) { lastError = '结果入库失败：' + error.message; tell(); notice(); return { ok: false, error: lastError }; }
  }

  async function connect() {
    if (busy) return;
    if (!root.showDirectoryPicker) {
      lastError = '当前浏览器不支持文件夹映射，请使用 Chrome 或 Edge；待保存结果仍可在下方下载。'; tell(); return;
    }
    busy = true;
    try {
      // Call the picker before any await so the button's user activation is kept.
      const selected = await root.showDirectoryPicker({ id: 'novaflow-warehouse', mode: 'readwrite' });
      await ready;
      await enqueue(async () => {
        directory = selected; permission = await selected.queryPermission({ mode: 'readwrite' });
        folderTrail = [];
        lastError = '';
        if (db) await transaction('settings', 'readwrite', store => store.put(selected, 'directory'));
        await flushNow(); await refreshList();
      });
    } catch (error) { if (error.name !== 'AbortError') lastError = '连接文件夹失败：' + error.message; }
    finally { busy = false; tell(); }
  }
  async function authorize() {
    if (!directory || busy) return;
    busy = true;
    try {
      permission = await directory.requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') await enqueue(flushNow);
      else lastError = '未取得写入权限，生成结果保留待保存。';
    } catch (error) { lastError = error.message; }
    finally { busy = false; tell(); }
  }
  async function disconnect() {
    await enqueue(async () => {
      directory = null; permission = 'prompt'; lastError = '';
      folderTrail = [];
      if (db) await transaction('settings', 'readwrite', store => store.delete('directory'));
      await refreshList(); tell();
    });
  }
  async function openFolder() {
    if (!directory || permission !== 'granted') throw new Error('请先连接本地文件夹并恢复授权');
    const id = root.crypto.randomUUID();
    const name = '.novaflow-open-' + id + '.json';
    const target = directory;
    const file = await target.getFileHandle(name, { create: true });
    const stream = await file.createWritable();
    await stream.write(new Blob([JSON.stringify({ id, createdAt: Date.now() })]));
    await stream.close();
    const link = node('a', null, root.document.body);
    link.href = 'novaflow://warehouse/open?id=' + id + '&sub=' + encodeURIComponent(folderTrail.map(folder => folder.name).join('/'));
    link.click(); link.remove();
    feedback = '请允许浏览器打开 NovaFlow；需要新版助手。首次定位其他目录时请选择仓库根目录。'; lastError = ''; tell();
    // The native helper removes its proof after opening. Also clean up if the
    // browser prompt was cancelled or the helper is not installed.
    root.setTimeout(() => target.removeEntry(name).catch(() => {}), 180000);
  }
  async function removeAsset(item) {
    return enqueue(async () => {
      if (item.pending) {
        const record = records.get(item.id);
        if (!record?.blob) throw new Error('此素材已保存，请刷新后重试');
        const discarded = { ...record, blob: null, discarded: true };
        await persist(discarded); records.set(item.id, discarded);
      } else {
        const parent = item.parent;
        if (!parent || await parent.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('请先恢复文件夹写入授权');
        const current = await parent.getFileHandle(item.name);
        if (!await current.isSameEntry(item.handle)) throw new Error('文件已被替换，请刷新后重试');
        await parent.removeEntry(item.name);
      }
      clearPreview();
      lastError = ''; feedback = item.pending ? '已删除未保存结果' : '已从本地文件夹删除素材';
      await refreshList(); tell(); notice();
    });
  }
  function confirmRemove(item, host) {
    host.replaceChildren();
    node('span', item.pending ? '永久删除此未保存结果？' : '从电脑永久删除？无法撤销。', host);
    const yes = action(host, '确认删除', () => removeAsset(item)); yes.className = 'nf-wh-delete';
    action(host, '取消', () => { host.replaceChildren(); addDelete(item, host); });
    yes.focus();
  }
  function addDelete(item, host) {
    const button = action(host, '删除素材', () => confirmRemove(item, host));
    button.className = 'nf-wh-delete'; button.setAttribute('aria-label', '删除素材 ' + item.name);
  }
  function node(tag, text, parent) {
    const value = root.document.createElement(tag);
    if (text != null) value.textContent = text;
    if (parent) parent.appendChild(value);
    return value;
  }
  function action(parent, text, fn, id) {
    const button = node('button', text, parent); button.type = 'button';
    if (id) button.dataset.warehouseAction = id;
    button.onclick = () => Promise.resolve(fn()).catch(error => { lastError = error.message; tell(); });
    return button;
  }
  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = ''; if (preview) preview.replaceChildren();
    if (viewer) viewer.hidden = true;
  }
  function showPreview(blob, name, item) {
    clearPreview(); previewUrl = URL.createObjectURL(blob);
    viewer.hidden = false;
    const media = node(/\.(mp4|webm|mov)$/i.test(name) ? 'video' : 'img', null, preview);
    media.src = previewUrl; media.alt = name; media.controls = true;
    media.className = 'nf-wh-full-media';
    const details = node('div', null, preview); details.className = 'nf-wh-preview-details';
    const label = node('div', null, details); node('strong', name, label); node('p', formatBytes(blob.size), label);
    action(details, '下载原文件', () => download(blob, name));
    if (item) { const actions = node('div', null, details); actions.className = 'nf-wh-asset-actions'; addDelete(item, actions); }
    viewer.querySelector('button').focus();
  }
  function formatBytes(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = node('a', null, root.document.body);
    link.href = url; link.download = name; link.click(); link.remove();
    root.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const ICONS = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    video: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4Z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>'
  };
  function icon(type, parent) {
    const span = node('span', null, parent); span.className = 'nf-wh-icon'; span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + ICONS[type] + '</svg>';
    return span;
  }
  function clearThumbnails() {
    if (thumbnailObserver) thumbnailObserver.disconnect();
    thumbnailUrls.forEach(url => URL.revokeObjectURL(url)); thumbnailUrls.clear();
  }
  function renderList() {
    clearThumbnails(); listing.replaceChildren(); breadcrumbs.replaceChildren();
    const version = ++listingVersion;
    const pending = [...records.values()].filter(item => item.blob).map(item => ({ ...item, pending: true, kind: 'file' }));
    const rootCrumb = action(breadcrumbs, directory ? directory.name : '本地仓库', () => { folderTrail = []; return refreshList(); });
    rootCrumb.className = 'nf-wh-crumb';
    folderTrail.forEach((folder, index) => {
      node('span', '/', breadcrumbs);
      action(breadcrumbs, folder.name, () => { folderTrail = folderTrail.slice(0, index + 1); return refreshList(); }).className = 'nf-wh-crumb';
    });
    const visibleEntries = [...entries, ...pending];
    const counts = { all: visibleEntries.filter(item => item.kind === 'file').length, image: 0, video: 0 };
    visibleEntries.forEach(item => { if (item.kind === 'file') counts[/\.(mp4|webm|mov)$/i.test(item.name) ? 'video' : 'image']++; });
    panel.querySelectorAll('[data-warehouse-filter]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.warehouseFilter === filter));
      button.querySelector('.nf-wh-count').textContent = counts[button.dataset.warehouseFilter];
    });
    const needle = search.value.trim().toLowerCase();
    const items = visibleEntries.filter(item => {
      if (needle && !item.name.toLowerCase().includes(needle)) return false;
      if (item.kind === 'directory' || filter === 'all') return true;
      return (filter === 'video') === /\.(mp4|webm|mov)$/i.test(item.name);
    }).sort((a, b) => (a.kind === 'directory' ? 0 : 1) - (b.kind === 'directory' ? 0 : 1) || (sort.value === 'newest' ? (b.modified || b.createdAt || 0) - (a.modified || a.createdAt || 0) : 0) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    summary.textContent = items.length + ' 项' + (entries.length >= 1000 ? ' · 当前目录最多读取 1,000 项' : '');
    if (!items.length) {
      const empty = node('div', null, listing); empty.className = 'nf-wh-empty'; icon(directory ? 'image' : 'folder', empty);
      const title = needle ? '没有找到匹配的文件' : filter === 'pending' ? '所有生成结果已保存' : !directory ? '把作品留在自己的电脑上' : permission !== 'granted' ? '恢复授权后继续浏览' : filter === 'all' ? '这个文件夹还没有作品' : '当前文件夹暂无' + (filter === 'video' ? '视频' : '图片');
      node('h3', title, empty);
      node('p', needle ? '试试其他文件名，或清空搜索。' : filter === 'pending' ? '之后生成的新作品也会自动保存。' : !directory ? '连接一个本地文件夹，集中浏览生成的图片和视频。' : permission !== 'granted' ? '点击上方“恢复授权”，保留的生成结果会继续保存。' : '新生成的作品会自动出现在这里。旧作品需要选择原来的存储文件夹。', empty);
      if (!directory) action(empty, '选择本地文件夹', connect).className = 'nf-wh-primary';
      else if (filter === 'all' && !needle && permission === 'granted') action(empty, '返回创作', close).className = 'nf-wh-primary';
      return;
    }
    const jobs = new WeakMap();
    if (root.IntersectionObserver) thumbnailObserver = new root.IntersectionObserver(observations => {
      observations.forEach(observation => { if (observation.isIntersecting) { thumbnailObserver.unobserve(observation.target); jobs.get(observation.target)(); } });
    }, { root: listing, rootMargin: '100px' });
    for (const item of items.slice(0, 200)) {
      const folder = item.kind === 'directory', video = /\.(mp4|webm|mov)$/i.test(item.name);
      const wrapper = node('div', null, listing); wrapper.className = 'nf-wh-asset-wrap';
      const card = action(wrapper, '', async () => {
        if (folder) { folderTrail.push(item.handle); await refreshList(); }
        else showPreview(item.blob || await item.handle.getFile(), item.name, item);
      });
      card.className = 'nf-wh-asset'; card.title = item.name; card.setAttribute('aria-label', (folder ? '打开文件夹 ' : '预览 ') + item.name);
      const thumb = node('div', null, card); thumb.className = 'nf-wh-thumb' + (folder ? ' nf-wh-folder' : ''); icon(folder ? 'folder' : video ? 'video' : 'image', thumb);
      if (!folder) { const type = node('span', item.pending ? '待保存' : item.name.split('.').pop().toUpperCase(), thumb); type.className = 'nf-wh-type'; }
      const info = node('div', null, card); info.className = 'nf-wh-asset-info'; node('strong', item.name, info);
      node('span', folder ? '文件夹' : item.pending ? formatBytes(item.blob.size) + ' · 等待保存' : formatBytes(item.size) + ' · ' + new Date(item.modified).toLocaleDateString('zh-CN'), info);
      if (folder) continue;
      const actions = node('div', null, wrapper); actions.className = 'nf-wh-asset-actions'; addDelete(item, actions);
      const load = async () => {
        try {
          const file = item.blob || await item.handle.getFile();
          if (version !== listingVersion || panel.hidden) return;
          const url = URL.createObjectURL(file); thumbnailUrls.add(url);
          const media = node(video ? 'video' : 'img', null, thumb); media.className = 'nf-wh-thumbnail'; media.src = url; media.alt = ''; media.muted = true; media.preload = 'metadata';
          if (video) media.onloadedmetadata = () => { if (Number.isFinite(media.duration) && media.duration > 0) media.currentTime = Math.min(0.1, media.duration / 2); };
        } catch { /* A moved file keeps its placeholder; opening reports the error. */ }
      };
      jobs.set(card, load); if (thumbnailObserver) thumbnailObserver.observe(card); else void load();
    }
    if (items.length > 200) { const limit = node('p', '已显示前 200 项，可搜索文件名或进入子文件夹继续查找。', listing); limit.className = 'nf-wh-limit'; }
  }
  async function refreshList() {
    if (!listing) return;
    const version = ++listingVersion;
    const found = [];
    try {
      if (directory && permission === 'granted') {
        const current = folderTrail.at(-1) || directory;
        for await (const [name, handle] of current.entries()) {
          if (handle.kind === 'directory') found.push({ name, handle, kind: 'directory' });
          else if (MEDIA.test(name)) {
            try { const file = await handle.getFile(); found.push({ name, handle, parent: current, kind: 'file', size: file.size, modified: file.lastModified }); }
            catch { /* The file may disappear while a local generation is moving it. */ }
          }
          if (found.length >= 1000) break;
        }
      }
    } catch (error) { lastError = '读取文件夹失败：' + error.message; tell(); }
    if (version !== listingVersion) return;
    entries = found; renderList();
  }
  function close() {
    panel.hidden = true; clearPreview(); clearThumbnails(); ++listingVersion;
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }
  async function open() {
    if (!panel) {
      const style = node('style', `
#novaflow-local-warehouse{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:13px/1.5 "Segoe UI",Tahoma,Geneva,Verdana,sans-serif;color:rgba(229,235,242,.92);color-scheme:dark;text-align:left}
#novaflow-local-warehouse *{box-sizing:border-box}
#novaflow-local-warehouse [hidden],#novaflow-local-warehouse[hidden]{display:none!important}
#novaflow-local-warehouse h2,#novaflow-local-warehouse h3,#novaflow-local-warehouse p{color:inherit;margin:0;padding:0;line-height:1.5}
#novaflow-local-warehouse .nf-wh-card{position:relative;width:min(1000px,94vw);height:min(680px,85vh);display:flex;flex-direction:column;background:#212121;border:1px solid rgba(255,255,255,.1);border-radius:8px;box-shadow:none;overflow:hidden}
#novaflow-local-warehouse button{font:inherit;color:inherit;background:none;border:1px solid transparent;border-radius:8px;padding:8px 12px;cursor:pointer;box-shadow:none;transition:background .15s,border-color .15s;flex-shrink:0;line-height:1.5}
#novaflow-local-warehouse button:hover{background:#ffffff0c}
#novaflow-local-warehouse button:focus-visible,#novaflow-local-warehouse input:focus-visible,#novaflow-local-warehouse select:focus-visible{outline:2px solid #37c99c;outline-offset:3px}
#novaflow-local-warehouse .nf-wh-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex-shrink:0}
#novaflow-local-warehouse .nf-wh-icon svg{width:100%;height:100%}
#novaflow-local-warehouse .nf-wh-header{display:flex;align-items:center;gap:14px;padding:12px 14px;background:#1d1d1d;border-bottom:1px solid #333}
#novaflow-local-warehouse .nf-wh-brand{width:44px;height:44px;display:grid;place-items:center;color:#49d8ae;background:#23b48914;border:1px solid #3bc49b2b;border-radius:12px}
#novaflow-local-warehouse .nf-wh-brand .nf-wh-icon{width:25px;height:25px}
#novaflow-local-warehouse .nf-wh-title{flex:1}
#novaflow-local-warehouse h2{font-size:13px;font-weight:600;letter-spacing:0;color:#ccc}
#novaflow-local-warehouse .nf-wh-title p{margin-top:3px;font-size:12px;color:#8c9a96}
#novaflow-local-warehouse .nf-wh-connection{display:flex;align-items:center;gap:7px;font-size:12px;color:#9facaa;background:#ffffff05;border:1px solid #ffffff0c;border-radius:5px;padding:3px 8px}
#novaflow-local-warehouse .nf-wh-connection:before{content:'';width:6px;height:6px;border-radius:50%;background:#788480}
#novaflow-local-warehouse .nf-wh-connection[data-connected="true"]{color:#70d9b7}
#novaflow-local-warehouse .nf-wh-connection[data-connected="true"]:before{background:#40d2a3;box-shadow:0 0 0 3px #40d2a313}
#novaflow-local-warehouse .nf-wh-close{display:grid;place-items:center;padding:1px 6px;color:#9a9a9a;margin-left:0}
#novaflow-local-warehouse .nf-wh-body{display:flex;flex:1;min-height:0}
#novaflow-local-warehouse .nf-wh-sidebar{width:168px;flex-shrink:0;padding:18px 10px;background:#1d1d1d;border-right:1px solid #ffffff09;display:flex;flex-direction:column;gap:6px}
#novaflow-local-warehouse .nf-wh-eyebrow{font-size:10px;font-weight:600;letter-spacing:1.5px;color:#777;padding:0 12px;margin-bottom:7px}
#novaflow-local-warehouse .nf-wh-nav{display:flex;gap:11px;align-items:center;text-align:left;padding:11px 13px;color:#aaa;border-radius:8px}
#novaflow-local-warehouse .nf-wh-nav[aria-pressed="true"]{background:#1ba879;border-color:transparent;color:#fff}
#novaflow-local-warehouse .nf-wh-count{margin-left:auto;font-size:11px;color:#aaa;font-variant-numeric:tabular-nums}
#novaflow-local-warehouse .nf-wh-folder-info{margin-top:auto;padding:16px 12px 6px;border-top:1px solid #ffffff0b;overflow:hidden}
#novaflow-local-warehouse .nf-wh-folder-info strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:7px 0;color:#ccc;font-size:13px}
#novaflow-local-warehouse .nf-wh-folder-info p{color:#888;font-size:11px;line-height:1.8}
#novaflow-local-warehouse .nf-wh-folder-info button{margin-top:12px;font-size:11px;padding:5px 8px;color:#999;border-color:#ffffff10}
#novaflow-local-warehouse .nf-wh-main{flex:1;min-width:0;display:flex;flex-direction:column}
#novaflow-local-warehouse .nf-wh-toolbar{display:flex;align-items:center;gap:8px;padding:14px 18px 12px;flex-wrap:wrap}
#novaflow-local-warehouse .nf-wh-breadcrumbs{display:flex;align-items:center;gap:3px;flex:1;min-width:100px;flex-wrap:wrap;color:#888}
#novaflow-local-warehouse .nf-wh-crumb{padding:5px 7px;color:#ccc;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#novaflow-local-warehouse .nf-wh-secondary{border-color:#ffffff16;background:#333;color:#ccc;font-size:12px}
#novaflow-local-warehouse .nf-wh-primary{background:#1ba879;color:#fff;border-color:transparent;font-weight:550}
#novaflow-local-warehouse .nf-wh-primary:hover{background:#22b988}
#novaflow-local-warehouse .nf-wh-filters{display:flex;align-items:center;gap:12px;padding:0 18px 14px;border-bottom:1px solid #ffffff08}
#novaflow-local-warehouse .nf-wh-search{display:flex;align-items:center;gap:9px;max-width:340px;flex:1;border:1px solid #ffffff0f;border-radius:8px;background:#090909;padding:7px 11px;color:#777}
#novaflow-local-warehouse input{color:#ddd;background:none;border:0;outline:none;font:inherit;width:100%;min-width:60px;padding:0;height:22px}
#novaflow-local-warehouse input::placeholder{color:#777}
#novaflow-local-warehouse select{font:inherit;font-size:12px;background:#303030;border:1px solid #ffffff10;color:#aaa;border-radius:7px;padding:8px;max-width:130px}
#novaflow-local-warehouse .nf-wh-summary{color:#888;margin-left:auto;white-space:nowrap;font-size:12px}
#novaflow-local-warehouse .nf-wh-list{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));align-content:start;gap:14px;padding:18px;scrollbar-width:thin;scrollbar-color:#3d4b44 transparent}
#novaflow-local-warehouse .nf-wh-asset{min-width:0;overflow:hidden;background:#292929;border:1px solid #ffffff0b;padding:0;border-radius:10px;text-align:left}
#novaflow-local-warehouse .nf-wh-asset:hover{background:#333;border-color:#46bc9266}
#novaflow-local-warehouse .nf-wh-asset-wrap{min-width:0;border:1px solid #ffffff12;border-radius:8px;overflow:hidden;background:#262626}
#novaflow-local-warehouse .nf-wh-asset-wrap .nf-wh-asset{width:100%;border:0;border-radius:0}
#novaflow-local-warehouse .nf-wh-asset-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:4px;padding:3px 6px;font-size:11px}
#novaflow-local-warehouse .nf-wh-asset-actions button{padding:4px 6px;font-size:11px}
#novaflow-local-warehouse .nf-wh-delete{color:#e6a3a3}
#novaflow-local-warehouse button:disabled{opacity:.45;cursor:default}
#novaflow-local-warehouse .nf-wh-thumb{position:relative;aspect-ratio:4/3;background:#141414;display:grid;place-items:center;color:#516c5b;overflow:hidden}
#novaflow-local-warehouse .nf-wh-thumb>.nf-wh-icon{width:36px;height:36px}
#novaflow-local-warehouse .nf-wh-folder{background:#242424;color:#76cfa6}
#novaflow-local-warehouse .nf-wh-folder>.nf-wh-icon{width:55px;height:55px}
#novaflow-local-warehouse .nf-wh-thumbnail{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#141414}
#novaflow-local-warehouse .nf-wh-type{position:absolute;bottom:8px;left:8px;z-index:1;border-radius:4px;background:#0a100ecc;color:#d9e8df;padding:2px 6px;font-size:9px;letter-spacing:.6px}
#novaflow-local-warehouse .nf-wh-asset-info{padding:11px 12px;display:flex;flex-direction:column;gap:5px}
#novaflow-local-warehouse .nf-wh-asset-info strong{font-size:12px;font-weight:500;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#novaflow-local-warehouse .nf-wh-asset-info>span{color:#888;font-size:10px}
#novaflow-local-warehouse .nf-wh-empty{grid-column:1/-1;min-height:320px;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:32px}
#novaflow-local-warehouse .nf-wh-empty>.nf-wh-icon{width:68px;height:68px;background:#24ae7d0a;border:1px solid #38aa7a20;border-radius:20px;padding:17px;color:#588c72;margin-bottom:22px}
#novaflow-local-warehouse .nf-wh-empty h3{font-size:17px;font-weight:500;color:#ccc;margin-bottom:9px}
#novaflow-local-warehouse .nf-wh-empty p{font-size:12px;line-height:1.9;color:#999;max-width:380px}
#novaflow-local-warehouse .nf-wh-empty button{margin-top:25px;padding:9px 22px}
#novaflow-local-warehouse .nf-wh-footer{display:flex;align-items:center;gap:15px;padding:11px 24px;font-size:11px;color:#888;border-top:1px solid #ffffff09}
#novaflow-local-warehouse .nf-wh-footer span:last-child{margin-left:auto;white-space:nowrap}
#novaflow-local-warehouse .nf-wh-error{background:#7a3d1c2b;border-bottom:1px solid #bb754d38;color:#efb793;padding:10px 24px;white-space:pre-wrap}
#novaflow-local-warehouse .nf-wh-limit{grid-column:1/-1;color:#999;font-size:12px}
#novaflow-local-warehouse .nf-wh-viewer{position:absolute;inset:0;background:#1d1d1dfc;z-index:2;display:flex;flex-direction:column;padding:20px}
#novaflow-local-warehouse .nf-wh-viewer>button{align-self:flex-end;margin-bottom:12px;color:#aaa}
#novaflow-local-warehouse .nf-wh-preview{display:flex;flex-direction:column;flex:1;min-height:0;gap:20px}
#novaflow-local-warehouse .nf-wh-full-media{width:100%;height:100%;min-height:0;flex:1;object-fit:contain;background:#101010;border-radius:8px}
#novaflow-local-warehouse .nf-wh-preview-details{display:flex;align-items:center;gap:20px;padding:0 8px 4px}
#novaflow-local-warehouse .nf-wh-preview-details>div{flex:1;overflow-wrap:anywhere}
#novaflow-local-warehouse .nf-wh-preview-details strong{font-size:13px;font-weight:500;color:#ddd}
#novaflow-local-warehouse .nf-wh-preview-details p{font-size:11px;color:#999;margin-top:5px}
#novaflow-local-warehouse .nf-wh-preview-details button{border-color:#ffffff1a}
@media(max-width:760px){#novaflow-local-warehouse .nf-wh-card{height:94vh;width:96vw;border-radius:12px}#novaflow-local-warehouse .nf-wh-header{padding:17px}#novaflow-local-warehouse .nf-wh-connection{display:none}#novaflow-local-warehouse .nf-wh-sidebar{width:145px;padding:19px 8px}#novaflow-local-warehouse .nf-wh-nav{padding:10px 7px;gap:7px}#novaflow-local-warehouse .nf-wh-toolbar,#novaflow-local-warehouse .nf-wh-filters{padding-left:15px;padding-right:15px}#novaflow-local-warehouse .nf-wh-list{padding:15px;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:12px}#novaflow-local-warehouse .nf-wh-footer span:last-child{display:none}#novaflow-local-warehouse .nf-wh-empty{min-height:260px;padding:15px}}
`, root.document.head);
      style.dataset.novaflowWarehouse = '1';
      panel = node('div', null, root.document.body); panel.id = 'novaflow-local-warehouse'; panel.hidden = true;
      const card = node('section', null, panel); card.className = 'nf-wh-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', '本地仓库');
      const header = node('header', null, card); header.className = 'nf-wh-header';
      const title = node('div', null, header); title.className = 'nf-wh-title'; node('h2', '本地仓库', title);
      connectionLabel = node('span', '', header); connectionLabel.className = 'nf-wh-connection';
      const x = action(header, '', close, 'close'); x.className = 'nf-wh-close'; x.setAttribute('aria-label', '关闭仓库'); icon('close', x);
      errorLabel = node('div', '', card); errorLabel.className = 'nf-wh-error'; errorLabel.setAttribute('role', 'alert');
      const body = node('div', null, card); body.className = 'nf-wh-body';
      const sidebar = node('nav', null, body); sidebar.className = 'nf-wh-sidebar'; sidebar.setAttribute('aria-label', '仓库分类');
      node('p', '作品库', sidebar).className = 'nf-wh-eyebrow';
      for (const [key, label, symbol] of [['all', '全部作品', 'grid'], ['image', '图片', 'image'], ['video', '视频', 'video']]) {
        const button = action(sidebar, '', () => { filter = key; renderList(); }); button.className = 'nf-wh-nav'; button.dataset.warehouseFilter = key; icon(symbol, button); node('span', label, button); node('span', '0', button).className = 'nf-wh-count';
      }
      const folderInfo = node('div', null, sidebar); folderInfo.className = 'nf-wh-folder-info';
      node('p', '保存位置', folderInfo); folderLabel = node('strong', '', folderInfo); node('p', '文件仅在本机浏览', folderInfo);
      action(folderInfo, '断开映射', disconnect, 'disconnect');
      const main = node('div', null, body); main.className = 'nf-wh-main';
      const toolbar = node('div', null, main); toolbar.className = 'nf-wh-toolbar';
      breadcrumbs = node('div', null, toolbar); breadcrumbs.className = 'nf-wh-breadcrumbs'; breadcrumbs.setAttribute('aria-label', '当前文件夹');
      action(toolbar, '恢复授权', authorize, 'authorize').className = 'nf-wh-primary';
      action(toolbar, '重试保存', () => enqueue(flushNow), 'retry').className = 'nf-wh-secondary';
      action(toolbar, '打开 Windows 文件夹', openFolder, 'open-folder').className = 'nf-wh-secondary';
      action(toolbar, '连接 / 更换文件夹', connect, 'connect').className = 'nf-wh-secondary';
      const filters = node('div', null, main); filters.className = 'nf-wh-filters';
      const searchBox = node('label', null, filters); searchBox.className = 'nf-wh-search'; icon('search', searchBox);
      search = node('input', null, searchBox); search.type = 'search'; search.placeholder = '搜索当前文件夹'; search.setAttribute('aria-label', '搜索作品'); search.oninput = renderList;
      summary = node('span', '', filters); summary.className = 'nf-wh-summary';
      sort = node('select', null, filters); sort.setAttribute('aria-label', '作品排序');
      node('option', '最新优先', sort).value = 'newest'; node('option', '文件名', sort).value = 'name'; sort.onchange = renderList;
      listing = node('div', null, main); listing.className = 'nf-wh-list'; listing.setAttribute('aria-label', '仓库文件');
      const footer = node('footer', null, main); footer.className = 'nf-wh-footer'; status = node('span', '', footer); status.setAttribute('role', 'status');
      viewer = node('div', null, card); viewer.className = 'nf-wh-viewer'; viewer.hidden = true;
      const previewClose = action(viewer, '', () => { clearPreview(); panel.querySelector('[data-warehouse-action="close"]').focus(); });
      previewClose.className = 'nf-wh-close'; previewClose.setAttribute('aria-label', '关闭预览'); icon('close', previewClose);
      preview = node('div', null, viewer); preview.className = 'nf-wh-preview';
      root.addEventListener('focus', () => { if (!panel.hidden) void enqueue(async () => { await flushNow(); await refreshList(); }).catch(error => { lastError = error.message; tell(); }); });
      panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!viewer.hidden) clearPreview(); else close(); }
        if (event.key === 'Tab') {
          const buttons = [...(viewer.hidden ? card : viewer).querySelectorAll('button,input,select,video')].filter(button => button.getClientRects().length);
          if (event.shiftKey && root.document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
          else if (!event.shiftKey && root.document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
        }
      });
    }
    previousFocus = root.document.activeElement; panel.hidden = false;
    const tip = root.document.getElementById('novaflow-warehouse-notice'); if (tip) tip.hidden = true;
    tell(); panel.querySelector('button').focus();
    await ready; await enqueue(async () => { await flushNow(); await refreshList(); }); tell();
    return { ok: true, result: { opened: true, mapped: !!directory } };
  }
  root.NovaFlowWebWarehouse = { open, save, connect, authorize, disconnect, openFolder, removeAsset, ready };
})(typeof window !== 'undefined' ? window : globalThis);
