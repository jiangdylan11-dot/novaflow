// Desktop bundled particle templates, with browser-local user edits.
(function (root) {
  'use strict';
  const api = root.electronAPI;
  const previousLoad = api.loadUserData, previousSave = api.saveUserData;
  let database, bundled, initialized = false, initialization;
  function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = root.indexedDB.open('novaflow-web-user-data', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('data');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = null; reject(request.error); };
    });
    return database;
  }
  async function store(key, data, write = false) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const tx = connection.transaction('data', write ? 'readwrite' : 'readonly');
      const objectStore = tx.objectStore('data');
      const request = write ? objectStore.put(data, key) : objectStore.get(key);
      tx.oncomplete = () => resolve(write ? data : request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('本地保存已中断'));
    });
  }
  async function defaults() {
    if (!bundled) bundled = fetch('./templates/particle-bundled.json').then(async response => {
      if (!response.ok) throw new Error('内置模板读取失败');
      const data = await response.json();
      if (!Array.isArray(data) || !data.length) throw new Error('内置模板为空');
      return data;
    }).catch(error => { bundled = null; throw error; });
    return structuredClone(await bundled);
  }
  async function templates() {
    if (!initialization) initialization = (async () => {
      let data = await store('templates');
      if (!Array.isArray(data)) {
        try { data = JSON.parse(root.localStorage.getItem('particle-editor-templates-v1') || 'null'); } catch (_) {}
        const base = await defaults();
        const existing = Array.isArray(data) ? data : [];
        const ids = new Set(existing.map(item => item.id));
        data = [...existing, ...base.filter(item => !ids.has(item.id))];
        await store('templates', data, true);
      }
      initialized = true;
      return data;
    })().catch(error => { initialization = null; throw error; });
    await initialization;
    return await store('templates');
  }
  const fail = error => ({ ok: false, error: String(error.message || error) });
  api.loadUserData = async key => {
    try {
      if (key === 'templates') return { ok: true, data: await templates() };
      if (previousLoad) return await previousLoad(key);
      return { ok: true, data: await store(String(key)) };
    } catch (error) { return fail(error); }
  };
  api.saveUserData = async payload => {
    try {
      // React writes its initial empty state before its asynchronous load ends.
      if (payload.key === 'templates' && !initialized) return { ok: true, skipped: true };
      if (payload.key !== 'templates' && previousSave) return await previousSave(payload);
      await store(String(payload.key), payload.data, true);
      return { ok: true };
    } catch (error) { return fail(error); }
  };
  api.templatesResetToBundled = async () => {
    try {
      await templates();
      const data = await defaults();
      await store('templates', data, true);
      return { ok: true, data };
    } catch (error) { return fail(error); }
  };
})(window);
