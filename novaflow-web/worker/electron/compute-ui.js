(() => {
  const api = window.foartCompute;
  const $ = id => document.getElementById(id);
  let current = {}, freeing = false;
  function tab(name) {
    document.querySelectorAll('.tab').forEach(button => {
      const active = button.dataset.tab === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    for (const key of ['status', 'logs']) $('tab-' + key).hidden = key !== name;
  }
  document.querySelectorAll('.tab').forEach(button => button.onclick = () => tab(button.dataset.tab));
  function render(value = current) {
    current = value;
    const connected = !!value.sharing;
    const online = connected && value.connected !== false;
    $('version').textContent = value.version ? 'v' + value.version : '';
    $('status').textContent = value.operation ? '正在启动…' : value.runtimeStarting ? '正在启动环境…' : online ? value.pendingApproval ? '等待后台开通' : value.policy?.enabled === false ? '后台已停用' : value.environmentError ? '环境未就绪' : '节点已连接' : connected ? '连接中断，正在重连…' : '正在连接…';
    $('statusDot').className = 'dot' + (online ? value.currentTaskId ? ' busy' : ' on' : value.lastError ? ' err' : '');
    $('activityBadge').textContent = value.operation ? '启动中' : value.pendingApproval ? '待审批' : value.runtimeStarting ? '准备中' : value.currentTaskId ? '工作中' : value.environmentError ? '待环境' : online ? '空闲' : '连接中';
    $('activityBadge').dataset.active = String(online);
    $('gpu').textContent = value.gpu?.name || '—';
    $('vram').textContent = value.gpu?.vramMb ? (value.gpu.vramMb / 1024).toFixed(1).replace(/\.0$/, '') + ' GB' : '—';
    $('task').textContent = value.currentTaskId ? '执行中' : '空闲';
    $('stats').textContent = (value.stats?.completed || 0) + ' / ' + (value.stats?.failed || 0);
    $('comfy').textContent = value.runtimeStarting ? '启动中' : value.runtimeReady === false ? '未就绪' : value.comfy ? value.comfy.image || value.comfy.video ? '已连接' : '未就绪' : '—';
    $('freeMemory').disabled = freeing || !online || value.runtimeReady === false || !!value.currentTaskId || (!value.comfy?.image && !value.comfy?.video);
    const policy = value.policy;
    const sharing = online && policy?.enabled && policy?.sharing_enabled;
    $('sharing').textContent = value.pendingApproval ? '待审批' : !policy ? '分享未开通' : !policy.enabled ? '节点已停用' : !policy.sharing_enabled ? '分享未开通' : sharing ? '算力分享中' : '分享已开通';
    $('sharing').dataset.active = String(!!sharing);
    $('policy').textContent = value.pendingApproval ? '设备已自动登记，等待管理员命名、分配账号和开通权限。' : !policy ? '算力节点自动连接，使用权限由后台开通。' : policy.enabled === false ? '后台已停用此节点，停止接收新任务' :
      '本人使用：' + (policy.owner_enabled ? '已开通' : '未开通') + '　对外分享：' + (policy.sharing_enabled ? policy.sharing_scope === 'selected' ? '指定用户' : '共享算力池' : '未开通');
    $('error').textContent = value.lastError || '';
    $('progress').hidden = !value.operation;
    if (value.operation) { $('progress').querySelector('progress').value = value.operation.percent || 0; $('progressText').textContent = value.operation.message || ''; }
  }
  async function openWebsite() {
    try { const result = await api.website(); if (result?.ok === false) throw new Error(result.error); }
    catch (error) { current = { ...current, lastError: error.message || String(error) }; render(); }
  }
  $('website').onclick = openWebsite;
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
  Promise.all([api.state(), api.getLogs()]).then(([state, logs]) => {
    for (const line of logs) appendLog(line);
    render(state);
  }).catch(error => { current.lastError = error.message || String(error); render(); });
})();
