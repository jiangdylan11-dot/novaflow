(() => {
  const api = window.foartCompute;
  const $ = id => document.getElementById(id);
  let current = {}, busy = false, freeing = false;
  function tab(name) {
    document.querySelectorAll('.tab').forEach(button => {
      const active = button.dataset.tab === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    for (const key of ['status', 'settings', 'logs']) $('tab-' + key).hidden = key !== name;
  }
  document.querySelectorAll('.tab').forEach(button => button.onclick = () => tab(button.dataset.tab));
  function render(value = current) {
    current = value;
    const connected = !!value.sharing;
    const online = connected && value.connected !== false;
    $('version').textContent = value.version ? 'v' + value.version : '';
    $('status').textContent = value.operation ? '正在启动…' : online ? '节点已连接' : connected ? '连接中断，正在重连…' : value.paused ? '已暂停连接' : '未启动';
    $('statusDot').className = 'dot' + (online ? value.currentTaskId ? ' busy' : ' on' : value.lastError ? ' err' : '');
    $('activityBadge').textContent = value.operation ? '启动中' : value.currentTaskId ? '工作中' : online ? '空闲' : '待启动';
    $('activityBadge').dataset.active = String(online);
    $('connectionLabel').textContent = value.operation ? '正在处理…' : connected ? '暂停算力连接' : '连接算力节点';
    $('connection').disabled = busy || !!value.operation;
    $('save').disabled = busy || !!value.operation;
    $('gpu').textContent = value.gpu?.name || '—';
    $('vram').textContent = value.gpu?.vramMb ? (value.gpu.vramMb / 1024).toFixed(1).replace(/\.0$/, '') + ' GB' : '—';
    $('task').textContent = value.currentTaskId ? '执行中' : '空闲';
    $('stats').textContent = (value.stats?.completed || 0) + ' / ' + (value.stats?.failed || 0);
    $('comfy').textContent = value.comfy ? value.comfy.image || value.comfy.video ? '已连接' : '未就绪' : '—';
    $('freeMemory').disabled = freeing || busy || !online || !!value.currentTaskId;
    const policy = value.policy;
    const sharing = online && policy?.enabled && policy?.sharing_enabled;
    $('sharing').textContent = !policy ? '分享未开通' : !policy.enabled ? '节点已停用' : !policy.sharing_enabled ? '分享未开通' : sharing ? '算力分享中' : '分享已开通';
    $('sharing').dataset.active = String(!!sharing);
    $('policy').textContent = !policy ? '本人使用和对外分享权限由后台设置。' : policy.enabled === false ? '后台已停用此节点，停止接收新任务' :
      '本人使用：' + (policy.owner_enabled ? '已开通' : '未开通') + '　对外分享：' + (policy.sharing_enabled ? policy.sharing_scope === 'selected' ? '指定用户' : '共享算力池' : '未开通');
    $('registrationStatus').textContent = value.workerId ? '已接入节点：' + value.workerId : '首次接入后自动保存节点身份，以后启动自动连接';
    $('error').textContent = value.lastError || '';
    $('progress').hidden = !value.operation;
    if (value.operation) { $('progress').querySelector('progress').value = value.operation.percent || 0; $('progressText').textContent = value.operation.message || ''; }
  }
  async function run(action) {
    busy = true; render();
    try { const result = await action(); if (result?.state) render(result.state); if (result?.ok === false) current = { ...current, lastError: result.error || '操作失败' }; }
    catch (error) { current = { ...current, lastError: error.message || String(error) }; }
    finally { busy = false; render(); }
  }
  async function openWebsite() {
    try { const result = await api.website(); if (result?.ok === false) throw new Error(result.error); }
    catch (error) { current = { ...current, lastError: error.message || String(error) }; render(); }
  }
  $('website').onclick = openWebsite;
  $('websiteLink').onclick = event => { event.preventDefault(); void openWebsite(); };
  $('policyLink').onclick = event => { event.preventDefault(); tab('settings'); };
  $('connection').onclick = () => run(() => current.sharing ? api.pause() : api.connect());
  $('save').onclick = () => run(async () => { const result = await api.save(Object.fromEntries(['workerName', 'modelsRoot', 'registrationCode'].map(key => [key, $(key).value]))); if (result?.ok) { $('registrationCode').value = ''; tab('status'); } return result; });
  $('folder').onclick = async () => { const folder = await api.models(); if (typeof folder === 'string' && folder) $('modelsRoot').value = folder; };
  $('openLogs').onclick = () => api.logs();
  $('freeMemory').onclick = async () => {
    if (freeing) return; freeing = true; render();
    try { const result = await api.freeMemory(); if (result?.ok === false) current = { ...current, lastError: result.error || '释放失败' }; }
    catch (error) { current = { ...current, lastError: error.message || String(error) }; }
    finally { freeing = false; render(); }
  };
  const logLines = [];
  function appendLog(line) { logLines.push(String(line)); if (logLines.length > 400) logLines.shift(); $('logs').textContent = logLines.join('\n'); $('logs').scrollTop = $('logs').scrollHeight; }
  api.onLog(appendLog);
  api.onState(render);
  Promise.all([api.config(), api.state(), api.getLogs()]).then(([config, state, logs]) => {
    for (const key of ['workerName', 'modelsRoot']) $(key).value = config[key] || '';
    for (const line of logs) appendLog(line);
    render(state);
  }).catch(error => { current.lastError = error.message || String(error); render(); });
})();
