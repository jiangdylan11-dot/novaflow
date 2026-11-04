// Best-effort idle relief for configured local Comfy services. This reserves
// Foart task acquisition but cannot lock clients outside Foart.
export function createIdleComfyReclaimer({isIdle, reserve, release, freeBytes, now = Date.now,
  pressureIdleMs = 120000, normalIdleMs = 900000, minFreeBytes = 8 * 1024 ** 3, retryMs = 300000, log = () => {},
  measure = async () => ({comfy:null,gpuUsedMiB:null}), schedule = setTimeout, cancel = clearTimeout}) {
  const armed = new Map(), suppressed = new Map(), baselines = new Map(), observers = new Set();
  let observationEpoch = 0;
  let lastActivity = now(), lastAttempt = 0, activityEpoch = 0;
  function noteActivity() { lastActivity = now(); activityEpoch += 1; }
  function watch(client, {manual = false} = {}) {
    if (!client || typeof client.queueState !== 'function' || typeof client.freeMemory !== 'function') return;
    let url; try { url = new URL(client.baseUrl); } catch { return; }
    if (!['http:','https:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return;
    // A configured client can be retargeted when the managed service starts.
    // Drop its stale key so one live endpoint is never released twice.
    for (const [key,existing] of armed) if (existing === client && key !== client.baseUrl) { armed.delete(key); baselines.delete(key); }
    for (const [key,existing] of suppressed) if (existing === client && key !== client.baseUrl) { suppressed.delete(key); baselines.delete(key); }
    // An idle tick is not new work. Explicit manual release and a newly queued
    // graph may re-arm an endpoint; repeated discovery alone must not.
    if (manual) suppressed.delete(client.baseUrl);
    if (!armed.has(client.baseUrl) && !suppressed.has(client.baseUrl)) { armed.set(client.baseUrl,client); noteActivity(); }
  }
  function noteGraph(client) {
    if (client) suppressed.delete(client.baseUrl);
    watch(client);
    noteActivity();
  }
  function cancelObservations() { observationEpoch += 1; for (const handle of observers) cancel(handle); observers.clear(); }
  async function baseline(client) {
    if (!isIdle()) return;
    const epoch=activityEpoch;
    try { const detail=await measure(client.baseUrl); if (epoch===activityEpoch && isIdle()) baselines.set(client.baseUrl,{at:now(),freeRamBytes:freeBytes(),...detail}); } catch { /* unknown */ }
  }
  function observe(client, before, manual = false) {
    const epoch=observationEpoch, delays=[1000,4000,10000];
    const next=(index)=>{
      if(index>=delays.length || epoch!==observationEpoch) return;
      const handle=schedule(async()=>{
        observers.delete(handle);
        if(epoch!==observationEpoch || !isIdle(false, manual)) return;
        try {
          const queue=await client.queueState({signal:AbortSignal.timeout(3000)});
          if(epoch!==observationEpoch || !isIdle(false, manual) || !Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending) || queue.queue_running.length || queue.queue_pending.length) return;
          const detail=await measure(client.baseUrl);
          if(epoch!==observationEpoch || !isIdle(false, manual)) return;
          log('idle memory observation',{endpoint:client.baseUrl,before,after:{at:now(),freeRamBytes:freeBytes(),...detail},verification:'snapshot-only; release not confirmed'});
          next(index+1);
        } catch { /* observation unavailable; no further releases */ }
      },delays[index]);
      handle?.unref?.(); observers.add(handle);
    };
    next(0);
  }
  async function poll() {
    if (!armed.size && !suppressed.size) return false;
    if (!isIdle()) { noteActivity(); return false; }
    if (!reserve()) { noteActivity(); return false; }
    const epoch = activityEpoch;
    try {
      const available = freeBytes();
      if (!Number.isFinite(available) || available < 0) { noteActivity(); return false; }
      const idleRequired = available < minFreeBytes ? pressureIdleMs : normalIdleMs;
      // Keep observing shared local queues after a release. A task seen from
      // another client is genuine new work; an empty discovery tick is not.
      for (const [key,client] of suppressed) {
        let queue;
        try { queue = await client.queueState({signal:AbortSignal.timeout(3000)}); } catch { noteActivity(); return false; }
        if (epoch !== activityEpoch || !isIdle(true) || !Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending)) { noteActivity(); return false; }
        if (queue.queue_running.length || queue.queue_pending.length) {
          suppressed.delete(key); armed.set(key,client); noteActivity(); return false;
        }
      }
      if (!armed.size) return false;
      // Periodic queue observation prevents a recently-finished outside job
      // from being mistaken for a continuously idle service.
      for (const client of armed.values()) {
        let queue;
        try { queue = await client.queueState({signal:AbortSignal.timeout(3000)}); } catch { noteActivity(); return false; }
        if (epoch !== activityEpoch || !isIdle(true) || !Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending)
            || queue.queue_running.length || queue.queue_pending.length) { noteActivity(); return false; }
      }
      if (now() - lastActivity < idleRequired || now() - lastAttempt < retryMs) return false;
      lastAttempt = now();
      for (const [key,client] of armed) {
        // Recheck immediately before each asynchronous request.
        if (epoch !== activityEpoch || !isIdle(true)) return false;
        let queue;
        try { queue = await client.queueState({signal:AbortSignal.timeout(3000)}); } catch { noteActivity(); return false; }
        if (epoch !== activityEpoch || !isIdle(true) || !Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending)
            || queue.queue_running.length || queue.queue_pending.length) { noteActivity(); return false; }
        try { await client.freeMemory({signal:AbortSignal.timeout(3000)}); } catch (error) {
          // The server may have accepted the request even when the response was lost.
          armed.delete(key); suppressed.set(key,client); log('idle memory release result unknown', {error:String(error?.message || error)}); return false;
        }
        armed.delete(key); suppressed.set(key,client);
        const prior=baselines.get(key);
        const before=prior && now()-prior.at<=60000 ? prior : {freeRamBytes:available,comfy:null,gpuUsedMiB:null};
        log('idle memory release requested', {endpoint:key, freeRamBytes:available,verification:'request accepted; asynchronous release unconfirmed'});
        observe(client,before);
      }
      return true;
    } finally { release(); for (const client of armed.values()) void baseline(client); }
  }
  // A user-triggered request uses the same task-claim reservation as the
  // idle timer, but does not wait for the automatic idle threshold. A local
  // Comfy queue check is still required immediately before each request.
  async function releaseNow() {
    if (!armed.size) return {ok:false,code:'runtime-unavailable',requested:0};
    if (!isIdle(false, true) || !reserve(true)) return {ok:false,code:'runtime-busy',requested:0};
    const epoch=activityEpoch;
    let requested=0;
    try {
      for (const client of armed.values()) {
        let queue;
        try { queue=await client.queueState({signal:AbortSignal.timeout(3000)}); }
        catch { return {ok:false,code:'queue-unknown',requested}; }
        if (epoch!==activityEpoch || !isIdle(true, true)) return {ok:false,code:'runtime-busy',requested};
        if (!Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending)) return {ok:false,code:'queue-unknown',requested};
        if (queue.queue_running.length || queue.queue_pending.length) return {ok:false,code:'runtime-busy',requested};
      }
      for (const [key,client] of armed) {
        let queue;
        try { queue=await client.queueState({signal:AbortSignal.timeout(3000)}); }
        catch { return {ok:false,code:'queue-unknown',requested}; }
        if (epoch!==activityEpoch || !isIdle(true, true)) return {ok:false,code:'runtime-busy',requested};
        if (!Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending)) return {ok:false,code:'queue-unknown',requested};
        if (queue.queue_running.length || queue.queue_pending.length) return {ok:false,code:'runtime-busy',requested};
        const prior=baselines.get(key);
        const before=prior && now()-prior.at<=60000 ? prior : {freeRamBytes:freeBytes(),comfy:null,gpuUsedMiB:null};
        try { await client.freeMemory({signal:AbortSignal.timeout(3000)}); }
        catch (error) {
          // A timeout may follow acceptance. Never retry that endpoint here.
          armed.delete(key); suppressed.set(key,client);
          log('manual memory release result unknown',{endpoint:key,error:String(error?.message || error)});
          return {ok:false,code:'release-unknown',requested};
        }
        requested+=1;
        armed.delete(key); suppressed.set(key,client);
        log('manual memory release requested',{endpoint:key,verification:'request accepted; asynchronous release unconfirmed'});
        observe(client,before,true);
      }
      return {ok:true,code:'release-requested',requested};
    } finally { release(); }
  }
  return {noteActivity,watch,noteGraph,poll,releaseNow,cancelObservations};
}
