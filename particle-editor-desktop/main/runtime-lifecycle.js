const fs = require("fs");
const path = require("path");

function defaultProcessAlive(pid) {
  const processId = Math.max(0, Math.round(Number(pid) || 0));
  if (!processId) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function createRuntimeStartCoordinator(options = {}) {
  const fsApi = options.fs || fs;
  const pathApi = options.path || path;
  const processId = Math.max(1, Math.round(Number(options.processId) || process.pid));
  const processAlive = typeof options.processAlive === "function" ? options.processAlive : defaultProcessAlive;
  const inspectProcess = typeof options.inspectProcess === "function" ? options.inspectProcess : null;
  const processStartedAt = Math.max(1, Math.round(Number(options.processStartedAt) || (Date.now() - process.uptime() * 1000)));
  const executablePath = pathApi.resolve(String(options.executablePath || process.execPath || "."));
  const now = typeof options.now === "function" ? options.now : Date.now;
  const wait = typeof options.wait === "function"
    ? options.wait
    : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

  function runtimeStartAbortError() {
    const error = new Error("runtime_start_aborted");
    error.code = "NOVAFLOW_RUNTIME_START_ABORTED";
    return error;
  }

  async function waitForLockPoll(delayMs, signal) {
    if (!signal) {
      await wait(delayMs);
      return;
    }
    if (signal.aborted) throw runtimeStartAbortError();
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        try { signal.removeEventListener("abort", onAbort); } catch { void 0; }
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => finish(runtimeStartAbortError());
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(wait(delayMs)).then(() => finish(), finish);
    });
  }

  async function isRecordedOwnerLive(owner) {
    const ownerPid = Math.max(0, Math.round(Number(owner && owner.pid) || 0));
    if (!ownerPid || !processAlive(ownerPid)) return false;
    if (!inspectProcess) return true;
    const recordedStartedAt = Number(owner && owner.processStartedAt);
    const recordedExecutablePath = String(owner && owner.executablePath || "").trim();
    if (!Number.isFinite(recordedStartedAt) || !recordedExecutablePath) return true;
    try {
      const identity = await inspectProcess(ownerPid);
      if (identity?.alive === false) return false;
      if (identity?.verified !== true) return true;
      const actualStartedAt = Number(identity.processStartedAt);
      const actualExecutablePathRaw = String(identity.executablePath || "").trim();
      if (!Number.isFinite(actualStartedAt) || !actualExecutablePathRaw) return true;
      const actualExecutablePath = pathApi.resolve(actualExecutablePathRaw);
      return Math.abs(actualStartedAt - recordedStartedAt) <= 5000
        && actualExecutablePath.toLowerCase() === pathApi.resolve(recordedExecutablePath).toLowerCase();
    } catch {
      return true;
    }
  }

  function readLockSnapshot(filePath) {
    try {
      const raw = String(fsApi.readFileSync(filePath, "utf8") || "");
      const stat = fsApi.statSync(filePath);
      return { raw, mtimeMs: Number(stat.mtimeMs || 0) };
    } catch {
      return null;
    }
  }

  function readLockToken(filePath) {
    try {
      return String(JSON.parse(String(fsApi.readFileSync(filePath, "utf8") || ""))?.token || "");
    } catch {
      return "";
    }
  }

  function recoverExpiredBreaker(breakerPath, staleMs = 10_000) {
    const observed = readLockSnapshot(breakerPath);
    if (!observed || Date.now() - observed.mtimeMs < staleMs) return false;
    const current = readLockSnapshot(breakerPath);
    if (!current || current.raw !== observed.raw || current.mtimeMs !== observed.mtimeMs) return false;
    try {
      fsApi.unlinkSync(breakerPath);
      return true;
    } catch {
      return false;
    }
  }

  function acquireStaleLockBreaker(lockPath) {
    const breakerPath = `${lockPath}.breaker`;
    const token = `${processId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const descriptor = fsApi.openSync(breakerPath, "wx");
        fsApi.writeFileSync(descriptor, JSON.stringify({ pid: processId, token, createdAt: Date.now() }), "utf8");
        return { breakerPath, descriptor, token };
      } catch (error) {
        if (!error || error.code !== "EEXIST") return null;
        if (attempt === 0 && recoverExpiredBreaker(breakerPath)) continue;
        return null;
      }
    }
    return null;
  }

  function releaseStaleLockBreaker(breaker) {
    try { fsApi.closeSync(breaker?.descriptor); } catch { void 0; }
    try {
      if (readLockToken(breaker?.breakerPath) === breaker?.token) fsApi.unlinkSync(breaker.breakerPath);
    } catch { void 0; }
  }

  function breakStaleLockIfUnchanged(lockPath, observedRaw) {
    if (typeof observedRaw !== "string") return false;
    const breaker = acquireStaleLockBreaker(lockPath);
    if (!breaker) return false;
    try {
      if (readLockToken(breaker.breakerPath) !== breaker.token) return false;
      const current = readLockSnapshot(lockPath);
      if (!current || current.raw !== observedRaw) return false;
      if (readLockToken(breaker.breakerPath) !== breaker.token) return false;
      fsApi.unlinkSync(lockPath);
      return true;
    } catch {
      return false;
    } finally {
      releaseStaleLockBreaker(breaker);
    }
  }

  async function acquireStartLock(generatedDir, lockOptions = {}) {
    const rawRoot = String(generatedDir || "").trim();
    if (!rawRoot) throw new Error("runtime_generated_dir_missing");
    const root = pathApi.resolve(rawRoot);
    fsApi.mkdirSync(root, { recursive: true });
    const lockPath = pathApi.join(root, "runtime.start.lock");
    const timeoutMs = Math.max(1000, Number(lockOptions.timeoutMs) || 135000);
    const pollMs = Math.max(5, Math.min(1000, Number(lockOptions.pollMs) || 120));
    const malformedGraceMs = Math.max(1000, Number(lockOptions.malformedGraceMs) || 5000);
    const staleAfterMs = Math.max(malformedGraceMs * 2, Number(lockOptions.staleAfterMs) || 60000);
    const signal = lockOptions.signal || null;
    const deadline = now() + timeoutMs;
    const token = `${processId}-${now()}-${Math.random().toString(16).slice(2)}`;

    while (true) {
      if (signal?.aborted) throw runtimeStartAbortError();
      try {
        const descriptor = fsApi.openSync(lockPath, "wx");
        const createdAt = now();
        fsApi.writeFileSync(descriptor, JSON.stringify({ pid: processId, token, createdAt, updatedAt: createdAt, processStartedAt, executablePath }), "utf8");
        return { descriptor, lockPath, token, createdAt, staleAfterMs };
      } catch (error) {
        if (!error || error.code !== "EEXIST") throw error;
      }

      let owner = null;
      let ownerRaw = null;
      let ageMs = 0;
      try {
        ownerRaw = String(fsApi.readFileSync(lockPath, "utf8") || "");
        owner = JSON.parse(ownerRaw);
      } catch {
        try { ageMs = Math.max(0, now() - Number(fsApi.statSync(lockPath).mtimeMs || 0)); } catch { ageMs = malformedGraceMs; }
      }
      const ownerPid = Math.max(0, Math.round(Number(owner && owner.pid) || 0));
      const heartbeatAt = Math.max(0, Number(owner && (owner.updatedAt || owner.createdAt)) || 0);
      const heartbeatExpired = heartbeatAt > 0 && now() - heartbeatAt >= staleAfterMs;
      let stale = ownerPid ? !processAlive(ownerPid) : ageMs >= malformedGraceMs;
      if (!stale && ownerPid && heartbeatExpired) stale = !(await isRecordedOwnerLive(owner));
      if (stale) {
        if (ownerRaw === null) {
          try { ownerRaw = String(fsApi.readFileSync(lockPath, "utf8") || ""); } catch { ownerRaw = null; }
        }
        if (breakStaleLockIfUnchanged(lockPath, ownerRaw)) continue;
      }
      if (now() >= deadline) {
        const timeoutError = new Error("runtime_start_lock_timeout");
        timeoutError.code = "NOVAFLOW_RUNTIME_START_LOCK_TIMEOUT";
        timeoutError.lockPath = lockPath;
        throw timeoutError;
      }
      await waitForLockPoll(pollMs, signal);
    }
  }

  function refreshStartLock(lock) {
    if (!lock) return false;
    try {
      const current = JSON.parse(String(fsApi.readFileSync(lock.lockPath, "utf8") || ""));
      if (!current || current.token !== lock.token) return false;
      const next = JSON.stringify({
        pid: processId,
        token: lock.token,
        createdAt: lock.createdAt,
        updatedAt: now(),
        processStartedAt,
        executablePath,
      });
      fsApi.ftruncateSync(lock.descriptor, 0);
      fsApi.writeSync(lock.descriptor, next, 0, "utf8");
      return true;
    } catch {
      return false;
    }
  }

  function releaseStartLock(lock) {
    if (!lock) return;
    try { fsApi.closeSync(lock.descriptor); } catch { void 0; }
    try {
      const current = JSON.parse(String(fsApi.readFileSync(lock.lockPath, "utf8") || ""));
      if (current && current.token === lock.token) fsApi.unlinkSync(lock.lockPath);
    } catch { void 0; }
  }

  function assertStartLockOwned(lock) {
    try {
      const current = JSON.parse(String(fsApi.readFileSync(lock.lockPath, "utf8") || ""));
      if (current && current.token === lock.token) return true;
    } catch { void 0; }
    const error = new Error("runtime_start_lock_lost");
    error.code = "NOVAFLOW_RUNTIME_START_LOCK_LOST";
    throw error;
  }

  async function withStartLock(generatedDir, action, lockOptions = {}) {
    if (typeof action !== "function") throw new TypeError("runtime start action must be a function");
    const lock = await acquireStartLock(generatedDir, lockOptions);
    const heartbeatMs = Math.max(250, Math.min(5000, Number(lockOptions.heartbeatMs) || Math.floor(lock.staleAfterMs / 4)));
    let heartbeatValid = true;
    const heartbeatTimer = setInterval(() => {
      if (!refreshStartLock(lock)) heartbeatValid = false;
    }, heartbeatMs);
    heartbeatTimer.unref?.();
    try {
      const guard = Object.freeze({
        assertOwned() {
          if (!heartbeatValid) {
            const error = new Error("runtime_start_lock_lost");
            error.code = "NOVAFLOW_RUNTIME_START_LOCK_LOST";
            throw error;
          }
          return assertStartLockOwned(lock);
        }
      });
      guard.assertOwned();
      const result = await action(guard);
      guard.assertOwned();
      return result;
    } finally {
      clearInterval(heartbeatTimer);
      releaseStartLock(lock);
    }
  }

  return Object.freeze({ withStartLock });
}

module.exports = { createRuntimeStartCoordinator };
