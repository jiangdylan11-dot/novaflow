(function (root) {
  'use strict';

  const doc = root.document;
  const home = doc.getElementById('foart-home');
  const host = doc.getElementById('foart-editor-host');
  const status = doc.getElementById('foart-home-status');
  const surfaces = Object.freeze({ '骨骼动画':'animation', '音视频':'video', '特效制作':'effects',
    'UI 设计':'ui', '图片编辑':'drawing', '常用工具':'tools' });
  const allowed = new Set(Object.values(surfaces));
  let frame = null, frameReady = null, opening = false, queued = null, epoch = 0, lastEntry = null;

  function message(text) { status.textContent = String(text || ''); }
  function currentSurface() {
    const surface = new URL(root.location.href).searchParams.get('surface');
    return allowed.has(surface) ? surface : '';
  }
  function urlFor(surface) {
    const url = new URL(root.location.href);
    if (surface) url.searchParams.set('surface', surface); else url.searchParams.delete('surface');
    return url.pathname + url.search + url.hash;
  }
  function showHome({history = false} = {}) {
    epoch++;
    queued = null;
    if (history) root.history.pushState({foartHome:true}, '', urlFor(''));
    host.hidden = true; host.style.visibility = ''; home.hidden = false; message('');
    if (lastEntry?.isConnected) lastEntry.focus();
  }
  async function authenticated() {
    const check = root.electronAPI?.clientAuthStatus;
    if (typeof check !== 'function') { message('账户服务暂不可用，请稍后重试。'); return false; }
    try {
      const reply = await check();
      if (reply?.ok === true && reply.result?.authenticated === true) return true;
      home.hidden = true; host.hidden = true;
      await root.NovaFlowWebAccount?.guard?.();
      return false;
    } catch { message('账户状态暂时无法确认，请稍后重试。'); return false; }
  }
  function waitForEditor(surface) {
    if (frameReady) return frameReady;
    if (!frame) {
      frame = doc.createElement('iframe');
      frame.title = 'Foart 编辑器';
      const editorUrl = new URL('./editor.html', root.location.href);
      editorUrl.search = root.location.search;
      editorUrl.searchParams.set('surface', surface);
      editorUrl.hash = root.location.hash;
      frame.src = editorUrl.href;
      host.appendChild(frame);
    }
    frameReady = new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        try {
          const view = frame.contentWindow;
          if (view && view.location.origin === root.location.origin && typeof view.NovaFlowFoartTools?.open === 'function'
              && view.document.body?.classList?.contains('novaflow-boot-splash-active') !== true
              && view.document.querySelector('[data-novaflow-primary-entry="1"]')) return resolve(view);
        } catch { /* Frame navigation or a gate can still be loading. */ }
        if (Date.now() - started >= 30000) return reject(new Error('编辑器未能准备完成，请检查登录状态后重试。'));
        root.setTimeout(poll, 100);
      };
      root.setTimeout(poll, 100);
    });
    void frameReady.catch(() => { frameReady = null; });
    return frameReady;
  }
  async function openSurface(surface, {history = false} = {}) {
    if (!allowed.has(surface)) return false;
    if (opening) { epoch++; queued = {surface, history}; return false; }
    const selectedEpoch = ++epoch;
    opening = true; message('');
    try {
      if (!await authenticated() || selectedEpoch !== epoch) return false;
      // Layout-sensitive editor initialization must run in a visible viewport.
      const existing = !!frame; home.hidden = !existing; host.hidden = false; host.style.visibility = existing ? 'hidden' : '';
      const editor = await waitForEditor(surface);
      if (selectedEpoch !== epoch || !await authenticated() || selectedEpoch !== epoch) return false;
      const result = await editor.NovaFlowFoartTools.open(surface);
      if (selectedEpoch !== epoch) return false;
      if (result?.phase !== 'opened' || result?.surface !== surface) throw new Error('未能确认工作区已打开。');
      if (history) root.history.pushState({foartHome:false,surface}, '', urlFor(surface));
      host.style.visibility = ''; home.hidden = true; host.hidden = false; message(''); frame.focus();
      return true;
    } catch (error) {
      if (selectedEpoch === epoch) { host.hidden = true; host.style.visibility = ''; home.hidden = false; }
      if (selectedEpoch === epoch) message(String(error?.message || '工作区打开失败，请重试。'));
      return false;
    } finally {
      opening = false;
      if (queued) { const next = queued; queued = null; void openSurface(next.surface, {history:next.history}); }
    }
  }
  for (const button of doc.querySelectorAll('.card[data-name]')) {
    const surface = surfaces[button.dataset.name];
    if (!surface) { button.disabled = true; continue; }
    button.addEventListener('click', () => { lastEntry = button; void openSurface(surface, {history:true}); });
  }
  root.addEventListener('message', event => {
    if (event.origin !== root.location.origin || !frame || event.source !== frame.contentWindow || event.data?.type !== 'foart:return-home') return;
    showHome({history:true});
  });
  root.addEventListener('popstate', () => {
    const surface = currentSurface();
    if (surface) void openSurface(surface); else showHome();
  });
  root.addEventListener('beforeunload', event => {
    if (!frame) return;
    event.preventDefault(); event.returnValue = '';
  });
  void (async () => {
    if (!await authenticated()) return;
    home.hidden = false;
    const surface = currentSurface();
    if (surface) await openSurface(surface);
  })();
})(window);
