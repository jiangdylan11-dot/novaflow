// A warm chat is still inside ONE owned withSession. Only its callback is kept
// open: inference never escapes that lifecycle or acquires an anonymous model.
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
  void promise.catch(() => {}); return { promise, resolve, reject }; };
const failure = (code, message) => Object.assign(new Error(message), { code, errorCode: code });
function untilAborted(promise, signal) {
  const work = Promise.resolve(promise);
  // Native audit/transport may settle late. Keep its rejection observed even
  // after the user-facing wait ends; release proof still comes from withSession.
  void work.catch(() => {});
  if (signal.aborted) return Promise.reject(signal.reason || failure('strata-aborted', '小桃对话已停止'));
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason || failure('strata-aborted', '小桃对话已停止')); };
    signal.addEventListener('abort', aborted, { once: true });
    work.then(value => { signal.removeEventListener('abort', aborted); resolve(value); },
      error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}
function guardedHandle(flash, signal) {
  const guarded = { ...flash };
  for (const name of ['infer', 'inferConversation']) if (typeof flash[name] === 'function') guarded[name] = (...args) => {
    const work = Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason || failure('strata-aborted', '小桃对话已停止');
      return flash[name](...args);
    });
    return untilAborted(work, signal);
  };
  return guarded;
}

export function createFlashChatResidency({ withSession, beforeOpen = async () => {}, startGuard = () => () => {},
  idleTimeoutMs = 120000, onSettled = () => {}, clock = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof withSession !== 'function' || !Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1 || idleTimeoutMs > 120000)
    throw failure('flash-chat-invalid-config', '小桃驻留会话配置无效');
  let current = null, fault = null;
  const snapshot = () => ({ state: fault ? 'fault' : current?.state || 'cold', modelLoaded: fault ? true : Boolean(current?.loaded),
    activeRequestId: current?.activeRequestId || '', idleTimeoutMs, idleExpiresAt: current?.idleExpiresAt || null });
  function clearIdle(cycle) {
    if (cycle.timer !== null) clearTimer(cycle.timer);
    cycle.timer = null; cycle.idleExpiresAt = null; cycle.idleVersion++;
  }
  function armIdle(cycle) {
    clearIdle(cycle);
    if (current !== cycle || cycle.closing || cycle.activeWork) return;
    cycle.state = 'warm'; cycle.idleExpiresAt = clock() + idleTimeoutMs;
    const version = cycle.idleVersion;
    cycle.timer = setTimer(() => {
      if (current === cycle && cycle.idleVersion === version && !cycle.activeWork) void closeCycle(cycle).catch(() => {});
    }, idleTimeoutMs);
    cycle.timer?.unref?.();
  }
  function begin() {
    const cycle = { abort: new AbortController(), ready: deferred(), end: deferred(), state: 'loading', loaded: false,
      startedAt: clock(), activeRequestId: '', activeWork: null, closing: false, closeWork: null, timer: null, idleExpiresAt: null,
      sessionStarted: false, outcome: null, idleVersion: 0 };
    current = cycle;
    cycle.completion = (async () => {
      let stopGuard = () => {}, outcome;
      try {
        await beforeOpen(cycle.abort.signal);
        if (cycle.abort.signal.aborted) throw cycle.abort.signal.reason;
        stopGuard = startGuard(cycle.abort);
        cycle.sessionStarted = true;
        const answer = await withSession(async flash => {
          cycle.loaded = true; cycle.flash = flash;
          cycle.state = cycle.closing ? 'releasing' : cycle.activeRequestId ? 'answering' : 'warm';
          cycle.ready.resolve(flash);
          await cycle.end.promise;
          return { chatResidency: true };
        }, { signal: cycle.abort.signal });
        if (answer?.resourcesReleased !== true) throw failure('strata-release-unconfirmed', '小桃驻留退出尚未确认模型资源已释放');
        outcome = { resourcesReleased: true, identity: answer.identity, timing: answer.timing };
      } catch (error) {
        const released = !cycle.sessionStarted || error?.resourcesReleased === true;
        outcome = { error, resourcesReleased: released, identity: error?.identity, timing: error?.timing };
        if (!released) fault = failure('strata-release-unconfirmed', '小桃驻留资源尚未确认释放');
        cycle.ready.reject(error);
      } finally {
        clearIdle(cycle); stopGuard(); cycle.end.resolve();
        if (!cycle.flash) cycle.ready.reject(outcome?.error || failure('strata-session-closed', '小桃驻留尚未就绪便已结束'));
        cycle.outcome = outcome;
        if (current === cycle) current = null;
        try { onSettled(outcome); } catch {}
      }
      return outcome;
    })();
    return cycle;
  }
  async function closeCycle(cycle, { cancel = false, reason } = {}) {
    clearIdle(cycle); cycle.closing = true; cycle.state = 'releasing';
    if (cancel && !cycle.abort.signal.aborted) cycle.abort.abort(reason || failure('strata-aborted', '小桃对话已停止'));
    if (!cycle.closeWork) cycle.closeWork = (async () => {
      // Graceful handoff lets the CURRENT answer finish. Cancellation uses the
      // owned session's signal, and still waits for its real cleanup below.
      if (!cancel) await cycle.activeWork?.catch(() => {});
      cycle.end.resolve();
      const outcome = await cycle.completion;
      if (!outcome?.resourcesReleased) throw fault || failure('strata-release-unconfirmed', '小桃模型退出尚未确认');
      return { released: true, resourcesReleased: true, generationReady: false, chatSession: snapshot() };
    })();
    return cycle.closeWork;
  }
  async function run({ requestId, task } = {}) {
    if (fault) throw fault;
    if (typeof requestId !== 'string' || typeof task !== 'function') throw failure('flash-chat-invalid-input', '小桃驻留请求无效');
    if (current?.closing) throw failure('flash-chat-closing', '小桃正在让出模型资源，请稍后再试');
    if (current?.activeWork) throw failure('prompt-assistant-busy', '小桃正在回复上一条消息');
    const reused = Boolean(current?.loaded), cycle = current || begin(), startedAt = clock();
    clearIdle(cycle); cycle.activeRequestId = requestId;
    let readyAt;
    const work = (async () => {
      const flash = await untilAborted(cycle.ready.promise, cycle.abort.signal);
      readyAt = clock();
      if (cycle.abort.signal.aborted) throw cycle.abort.signal.reason;
      cycle.state = cycle.closing ? 'releasing' : 'answering';
      return untilAborted(Promise.resolve().then(() => {
        if (cycle.abort.signal.aborted) throw cycle.abort.signal.reason;
        return task(guardedHandle(flash, cycle.abort.signal), cycle.abort.signal);
      }), cycle.abort.signal);
    })();
    cycle.activeWork = work;
    let value;
    try {
      value = await work;
      if (cycle.abort.signal.aborted) throw cycle.abort.signal.reason;
    } catch (error) {
      await closeCycle(cycle, { cancel: true, reason: error });
      Object.assign(error, { resourcesReleased: true, generationReady: false });
      throw error;
    } finally {
      if (cycle.activeWork === work) { cycle.activeWork = null; cycle.activeRequestId = ''; }
    }
    if (!cycle.closing && current === cycle) armIdle(cycle);
    return { value, identity: cycle.flash.identity, reused, resourcesReleased: false, generationReady: false,
      timing: { totalMs: clock() - startedAt, readyWaitMs: readyAt - startedAt, requestMs: clock() - readyAt,
        reusedSession: reused }, chatSession: snapshot() };
  }
  async function close(options) {
    if (current) return closeCycle(current, options);
    if (fault) throw fault;
    return { released: true, resourcesReleased: true, generationReady: false, idle: true, chatSession: snapshot() };
  }
  function cancel(requestId) {
    if (!current?.activeRequestId) return Promise.resolve({ idle: true, released: !current && !fault,
      resourcesReleased: !current && !fault, generationReady: false, chatSession: snapshot() });
    if (current.activeRequestId !== requestId) return Promise.resolve({ ok: false, errorCode: 'art-agent-not-current',
      error: '这条小桃消息已经结束，未停止其他任务' });
    return closeCycle(current, { cancel: true });
  }
  return { run, close, cancel, getStatus: snapshot,
    resetAfterRelease() { if (current) throw failure('flash-chat-closing', '小桃驻留尚未退出'); fault = null; } };
}
