(function (root) {
  'use strict';
  const runtime = root.NovaFlowWebRuntime;
  if (!runtime || !root.document) return;
  function mount() {
    if (document.getElementById('novaflow-compute-select')) return true;
    const host = document.getElementById('novaflow-topbar-ai-runtime-status');
    if (!host) return false;
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-right:8px;flex-shrink:0;white-space:nowrap';
    const label = document.createElement('label');
    label.textContent = '算力'; label.htmlFor = 'novaflow-compute-select';
    const select = document.createElement('select');
    select.id = 'novaflow-compute-select';
    select.setAttribute('aria-label', '选择算力');
    select.style.cssText = 'background:#222;color:#ddd;border:1px solid #444;border-radius:5px;padding:4px 6px;font-size:12px';
    for (const [value, text] of [['local', '本机算力'], ['shared', '共享算力']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option);
    }
    select.value = runtime.computeMode;
    const note = document.createElement('span');
    note.setAttribute('role', 'status');
    note.style.cssText = 'font-size:11px;color:#a0a0a0;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const update = () => { select.value = runtime.computeMode; note.textContent = runtime.computeMode === 'local' ? '仅使用本机' : ''; };
    root.addEventListener('novaflow-compute-changed', update);
    select.addEventListener('change', async () => {
      select.disabled = true;
      try { await runtime.setComputeMode(select.value); update(); }
      catch (e) { select.value = runtime.computeMode; note.textContent = '连接本机助手'; note.title = e.message; }
      finally { select.disabled = false; }
    });
    wrap.append(label, select, note); host.prepend(wrap); update();
    if (runtime.computeMode === 'local') {
      const bind = document.createElement('button');
      bind.textContent = '绑定此账号'; bind.title = '登录后将本机算力绑定到自己的账号';
      bind.style.cssText = 'background:#333;color:#ddd;border:0;border-radius:5px;padding:5px 8px;font-size:12px';
      bind.addEventListener('click', async () => {
        if (!runtime.session?.token) { root.NovaFlowWebAccount?.open(); note.textContent = '登录后点击绑定此账号'; return; }
        bind.disabled = true;
        try { const result = await runtime.localControl('POST', '/local/bind-account', { token: runtime.session.token }); note.textContent = '已绑定 ' + result.account.account; }
        catch (e) { note.textContent = '绑定未完成'; note.title = e.message; }
        finally { bind.disabled = false; }
      });
      wrap.appendChild(bind);
      runtime.localControl('GET', '/local/license').then(s => {
        if (runtime.computeMode !== 'local') return;
        note.textContent = s.status === 'licensed' && !s.locked ? '本机已授权' : '本机待授权';
        note.title = '本机设备授权请在本地助手查看或导入；账号绑定用于管理自己的算力节点';
      }).catch(e => { note.textContent = '本机未连接'; note.title = e.message; });
    }
    return true;
  }
  let attempts = 0;
  const timer = setInterval(() => { if (mount() || ++attempts > 120) clearInterval(timer); }, 500);
})(globalThis);
