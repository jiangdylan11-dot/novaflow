(() => {
  const api = window.foartCompute;
  const $ = id => document.getElementById(id);
  let current = {}, busy = false;
  function render(value = current) {
    current = value;
    const connected = !!value.sharing;
    const online = connected && value.connected !== false;
    $('version').textContent = value.version ? 'v' + value.version : '';
    $('status').textContent = value.operation ? '正在准备运行环境…' : online ? '节点已连接' : connected ? '连接中断，正在重连…' : value.paused ? '已暂停连接' : '节点未连接';
    $('connection').textContent = connected ? '暂停连接' : '连接节点';
    $('connection').disabled = busy || !!value.operation;
    $('save').disabled = busy || !!value.operation;
    $('hardware').textContent = [value.gpu?.name, value.gpu?.vramMb ? Math.round(value.gpu.vramMb / 1024) + ' GB 显存' : ''].filter(Boolean).join(' · ');
    const policy = value.policy;
    $('policy').textContent = !connected ? '' : !policy ? '等待平台返回使用权限' : policy.enabled === false ? '后台已停用此节点，停止接收新任务' :
      '本人使用：' + (policy.owner_enabled ? '已开通' : '未开通') + '　对外分享：' + (policy.sharing_enabled ? policy.sharing_scope === 'selected' ? '指定用户' : '共享算力池' : '未开通');
    $('activity').textContent = value.currentTaskId ? '正在执行任务' : online ? '等待任务' : connected ? '连接恢复后继续接收任务' : '';
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
  $('website').onclick = () => api.website();
  $('connection').onclick = () => run(() => current.sharing ? api.pause() : api.connect());
  $('save').onclick = () => run(async () => { const result = await api.save(Object.fromEntries(['workerName', 'modelsRoot', 'registrationCode'].map(key => [key, $(key).value]))); if (result?.ok) $('registrationCode').value = ''; return result; });
  $('folder').onclick = async () => { const folder = await api.models(); if (typeof folder === 'string' && folder) $('modelsRoot').value = folder; };
  $('logs').onclick = () => api.logs();
  api.onState(render);
  Promise.all([api.config(), api.state()]).then(([config, state]) => { for (const key of ['workerName', 'modelsRoot']) $(key).value = config[key] || ''; render(state); });
})();
