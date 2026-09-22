// Browser-owned local warehouse. Only generated outputs enter the save queue;
// selecting a folder never uploads its files to the control plane or Worker.
(function (root) {
  'use strict';
  const MEDIA = /\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov)$/i;
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
  const records = new Map();
  let db, directory = null, permission = 'prompt', lastError = '', panel, status, listing, preview, previousFocus;
  let serial = Promise.resolve(), previewUrl = '', busy = false;

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
    const name = directory ? '本地文件夹：' + directory.name : '尚未连接本地文件夹';
    const state = directory && permission !== 'granted' ? ' · 请点击“恢复授权”继续保存' : '';
    status.textContent = name + state + ' · 待保存 ' + pendingCount() + ' 个' + (lastError ? '\n' + lastError : '');
    status.style.color = lastError ? '#ffb486' : '#b7c5c0';
    panel.querySelector('[data-warehouse-action="authorize"]').hidden = !directory || permission === 'granted';
    panel.querySelector('[data-warehouse-action="disconnect"]').hidden = !directory;
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
    if (!directory) { tell(); notice(); return; }
    permission = await directory.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') { tell(); notice(); return; }
    const run = async () => {
      for (const record of records.values()) {
        if (!record.blob) continue;
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
      if (db) await transaction('settings', 'readwrite', store => store.delete('directory'));
      await refreshList(); tell();
    });
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
  }
  function showPreview(blob, name) {
    clearPreview(); previewUrl = URL.createObjectURL(blob);
    const media = node(/\.(mp4|webm|mov)$/i.test(name) ? 'video' : 'img', null, preview);
    media.src = previewUrl; media.alt = name; media.controls = true;
    media.style.cssText = 'max-width:100%;max-height:55vh;object-fit:contain';
    node('p', name, preview);
  }
  async function refreshList() {
    if (!listing) return;
    listing.replaceChildren();
    const pending = [...records.values()].filter(item => item.blob);
    for (const item of pending) {
      const row = node('div', null, listing); row.className = 'nf-wh-row';
      node('span', '待保存 · ' + item.name, row);
      action(row, '预览', () => showPreview(item.blob, item.name));
      action(row, '下载', () => {
        const url = URL.createObjectURL(item.blob), link = node('a', null, root.document.body);
        link.href = url; link.download = item.name; link.click(); link.remove();
        root.setTimeout(() => URL.revokeObjectURL(url), 30000);
      });
    }
    if (!directory || permission !== 'granted') {
      if (!pending.length) node('p', '连接本地仓库后，可浏览该文件夹中的图片和视频。', listing);
      return;
    }
    let count = 0;
    try {
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind !== 'file' || !MEDIA.test(name)) continue;
        const row = node('div', null, listing); row.className = 'nf-wh-row';
        node('span', name, row);
        action(row, '预览', async () => showPreview(await handle.getFile(), name));
        if (++count >= 200) { node('p', '已显示前 200 个媒体文件。', listing); break; }
      }
      if (!count && !pending.length) node('p', '本地仓库暂无图片或视频。生成完成后会自动保存到这里。', listing);
    } catch (error) { lastError = '读取文件夹失败：' + error.message; tell(); }
  }
  function close() {
    panel.hidden = true; clearPreview();
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }
  async function open() {
    if (!panel) {
      const style = node('style', '#novaflow-local-warehouse[hidden]{display:none} #novaflow-local-warehouse{position:fixed;inset:0;z-index:2147483646;background:#0009;display:flex;align-items:center;justify-content:center;font:14px system-ui;color:#eee} #novaflow-local-warehouse .nf-wh-card{width:min(980px,90vw);max-height:88vh;overflow:auto;background:#191d1b;border:1px solid #3c4c44;border-radius:16px;padding:22px;box-shadow:0 12px 60px #0008} #novaflow-local-warehouse button{background:#263c32;border:1px solid #486454;color:#fff;padding:8px 13px;border-radius:7px;cursor:pointer} #novaflow-local-warehouse button:hover{background:#1e825a} #novaflow-local-warehouse .nf-wh-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0} #novaflow-local-warehouse .nf-wh-row{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #ffffff15} #novaflow-local-warehouse .nf-wh-row span{flex:1;overflow-wrap:anywhere} #novaflow-local-warehouse [hidden]{display:none!important}', root.document.head);
      style.dataset.novaflowWarehouse = '1';
      panel = node('div', null, root.document.body); panel.id = 'novaflow-local-warehouse'; panel.hidden = true;
      const card = node('section', null, panel); card.className = 'nf-wh-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', '本地仓库');
      node('h2', '本地仓库', card);
      node('p', '选择这台电脑上的文件夹，生成的图片和视频会自动保存到该文件夹。文件浏览在本机完成。', card);
      status = node('p', '', card); status.style.whiteSpace = 'pre-wrap'; status.setAttribute('role', 'status');
      const controls = node('div', null, card); controls.className = 'nf-wh-actions';
      action(controls, '连接 / 更换文件夹', connect, 'connect');
      action(controls, '恢复授权', authorize, 'authorize');
      action(controls, '刷新 / 重试保存', () => enqueue(async () => { await flushNow(); await refreshList(); }), 'refresh');
      action(controls, '断开映射', disconnect, 'disconnect');
      action(controls, '关闭', close, 'close');
      listing = node('div', null, card); listing.setAttribute('aria-label', '仓库文件');
      preview = node('div', null, card); preview.style.cssText = 'text-align:center;margin-top:16px';
      panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
          const buttons = [...card.querySelectorAll('button')].filter(button => !button.hidden);
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
  root.NovaFlowWebWarehouse = { open, save, connect, authorize, disconnect, ready };
})(typeof window !== 'undefined' ? window : globalThis);
