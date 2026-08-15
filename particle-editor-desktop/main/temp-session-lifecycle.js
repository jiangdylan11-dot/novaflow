const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_CATEGORIES = Object.freeze([
  "ai-sequence-cache",
  "ai-sequence-head-tail",
  "ai-sequence-probe",
  "ai-sequence-trim",
  "cutout",
  "diagnostics",
  "export",
  "rembg-job",
  "sequence",
  "skeleton-video",
  "spine-split",
  "video",
]);

const DEFAULT_LEGACY_PREFIXES = Object.freeze([
  "novaflow_ais_probe_",
  "novaflow_ais_trim_",
  "novaflow_rembg_",
  "novaflow_seq_warm_",
  "novaflow_seq_",
  "novaflow_vid_",
  "novaflow_cutout_save_",
  "novaflow_skeleton_vid_",
  "novaflow_export_",
]);

const DEFAULT_LEGACY_DIRS = Object.freeze([
  "novaflow_spine_split_cache",
  "novaflow_ai_seq_cache",
  "novaflow-ai-seq",
]);

function isPathInside(targetPath, parentPath, pathApi = path) {
  const target = pathApi.resolve(String(targetPath || ""));
  const parent = pathApi.resolve(String(parentPath || ""));
  if (!target || !parent) return false;
  const relative = pathApi.relative(parent, target);
  return relative === "" || (!!relative && !relative.startsWith("..") && !pathApi.isAbsolute(relative));
}

function sanitizeSegment(value, fallback = "item") {
  const clean = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return clean || fallback;
}

function createTempSessionLifecycle(options = {}) {
  const fsApi = options.fs || fs;
  const pathApi = options.path || path;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const wait = typeof options.wait === "function"
    ? options.wait
    : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
  const processAlive = typeof options.processAlive === "function"
    ? options.processAlive
    : (pid) => {
      try {
        process.kill(Number(pid), 0);
        return true;
      } catch (error) {
        return error && error.code === "EPERM";
      }
    };
  const inspectProcess = typeof options.inspectProcess === "function" ? options.inspectProcess : null;
  const log = typeof options.log === "function" ? options.log : () => {};
  const processId = Math.max(1, Math.round(Number(options.processId) || process.pid));
  const processStartedAt = Math.max(1, Math.round(Number(options.processStartedAt) || (now() - process.uptime() * 1000)));
  const executablePath = pathApi.resolve(String(options.executablePath || process.execPath || "."));
  const profileKey = sanitizeSegment(options.profileKey || "installed", "installed");
  const storageRoot = pathApi.resolve(String(options.storageRoot || pathApi.join(os.tmpdir(), "NovaFlow")));
  const sessionsRoot = pathApi.join(storageRoot, "sessions");
  const coordinationRoot = pathApi.join(storageRoot, "RuntimeClients", "v1");
  const leasesRoot = pathApi.join(coordinationRoot, "leases");
  const lifecycleLockPath = pathApi.join(coordinationRoot, "lifecycle.lock");
  const cleanupPendingPath = pathApi.join(coordinationRoot, "cleanup-pending.json");
  const persistentFallbackRoot = pathApi.join(storageRoot, "persistent-fallback");
  const categorySet = new Set((options.categories || DEFAULT_CATEGORIES).map((item) => sanitizeSegment(item)));
  const sessionId = sanitizeSegment(
    options.sessionId || `${processId}-${Math.round(processStartedAt)}-${crypto.randomBytes(5).toString("hex")}`,
    `${processId}-${Math.round(processStartedAt)}`,
  );
  const sessionRoot = pathApi.join(sessionsRoot, sessionId);
  const manifestPath = pathApi.join(sessionRoot, "session.json");
  const leasePath = pathApi.join(leasesRoot, `${sessionId}.json`);
  const registeredWorkDirs = new Set();
  const heartbeatIntervalMs = Math.max(1000, Number(options.heartbeatIntervalMs) || 5000);
  const malformedLeaseGraceMs = Math.max(2000, Number(options.malformedLeaseGraceMs) || 10_000);
  const orphanSessionGraceMs = Math.max(malformedLeaseGraceMs, Number(options.orphanSessionGraceMs) || 30_000);
  let heartbeatTimer = null;
  let registered = false;
  let closing = false;

  function emit(level, message, meta) {
    try { log(level, message, meta || {}); } catch { void 0; }
  }

  function ensureRoots() {
    fsApi.mkdirSync(sessionsRoot, { recursive: true });
    fsApi.mkdirSync(leasesRoot, { recursive: true });
  }

  function getCategoryDir(category, create = true) {
    const clean = sanitizeSegment(category, "");
    if (!clean || !categorySet.has(clean)) throw new Error("temp_category_not_allowed");
    const target = pathApi.join(sessionRoot, clean);
    if (!isPathInside(target, sessionRoot, pathApi)) throw new Error("temp_category_outside_session");
    if (create) fsApi.mkdirSync(target, { recursive: true });
    return target;
  }

  function createWorkDir(category, prefix = "job-") {
    const categoryDir = getCategoryDir(category, true);
    const cleanPrefix = `${sanitizeSegment(prefix, "job").slice(0, 40)}-`;
    const target = fsApi.mkdtempSync(pathApi.join(categoryDir, cleanPrefix));
    if (!isPathInside(target, categoryDir, pathApi)) throw new Error("temp_work_dir_outside_category");
    registeredWorkDirs.add(pathApi.resolve(target).toLowerCase());
    return target;
  }

  function isOwnedPath(targetPath, category) {
    const target = pathApi.resolve(String(targetPath || ""));
    if (!target || !isPathInside(target, sessionRoot, pathApi) || target === pathApi.resolve(sessionRoot)) return false;
    if (!category) return true;
    return isPathInside(target, getCategoryDir(category, false), pathApi);
  }

  function isRegisteredWorkDir(targetPath) {
    const target = pathApi.resolve(String(targetPath || "")).toLowerCase();
    return registeredWorkDirs.has(target) && isOwnedPath(targetPath);
  }

  async function removeDir(targetPath, removeOptions = {}) {
    const target = pathApi.resolve(String(targetPath || ""));
    try {
      if (typeof fsApi.lstatSync === "function" && fsApi.lstatSync(target).isSymbolicLink()) {
        return { ok: false, target, error: "temp_reparse_point_not_allowed" };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") return { ok: false, target, error: String(error?.message || error) };
    }
    const retries = Math.max(0, Math.min(8, Math.round(Number(removeOptions.retries) || 0)));
    const retryDelayMs = Math.max(0, Number(removeOptions.retryDelayMs) || 100);
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await fsApi.promises.rm(target, { recursive: true, force: true, maxRetries: 0 });
        return { ok: true, target, attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        if (attempt < retries) await wait(retryDelayMs * (attempt + 1));
      }
    }
    return { ok: false, target, attempts: retries + 1, error: String(lastError?.message || lastError || "remove_failed") };
  }

  async function cleanupWorkDir(targetPath, removeOptions = {}) {
    if (!isRegisteredWorkDir(targetPath)) return { ok: false, error: "temp_work_dir_not_owned" };
    const target = pathApi.resolve(targetPath);
    const result = await removeDir(target, removeOptions);
    if (result.ok) registeredWorkDirs.delete(target.toLowerCase());
    return result;
  }

  function leasePayload(state = closing ? "closing" : "active") {
    return {
      version: 1,
      sessionId,
      pid: processId,
      processStartedAt,
      executablePath,
      profileKey,
      sessionRoot,
      state,
      updatedAt: now(),
    };
  }

  function writeJsonAtomic(filePath, payload) {
    fsApi.mkdirSync(pathApi.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${processId}.${Math.random().toString(16).slice(2)}.tmp`;
    fsApi.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
    try {
      fsApi.renameSync(tempPath, filePath);
    } catch (error) {
      fsApi.copyFileSync(tempPath, filePath);
      try { fsApi.rmSync(tempPath, { force: true }); } catch { void 0; }
    }
  }

  function writeLease(state) {
    writeJsonAtomic(leasePath, leasePayload(state));
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      if (!registered) return;
      try { writeLease(closing ? "closing" : "active"); } catch (error) {
        emit("warn", "temp-session-heartbeat-failed", { sessionId, error: String(error?.message || error) });
      }
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function readJson(filePath) {
    try { return JSON.parse(String(fsApi.readFileSync(filePath, "utf8") || "")); } catch { return null; }
  }

  function listLeases() {
    ensureRoots();
    let names = [];
    try { names = fsApi.readdirSync(leasesRoot).filter((name) => name.endsWith(".json")); } catch { return []; }
    return names.map((name) => {
      const filePath = pathApi.join(leasesRoot, name);
      const rawSessionId = name.slice(0, -5);
      const canonicalSessionId = sanitizeSegment(rawSessionId, "");
      return {
        filePath,
        canonicalSessionId: canonicalSessionId === rawSessionId ? canonicalSessionId : "",
        value: readJson(filePath)
      };
    });
  }

  async function isRecordedOwnerLive(record) {
    const pid = Math.max(0, Math.round(Number(record?.pid) || 0));
    if (!pid || !processAlive(pid)) return false;
    if (!inspectProcess) return true;
    let identity = null;
    try { identity = await inspectProcess(pid); } catch { return true; }
    if (!identity || identity.alive === false) return identity?.alive !== false;
    if (identity.verified !== true) return true;
    const expectedStart = Number(record?.processStartedAt);
    const actualStart = Number(identity.processStartedAt);
    if (Number.isFinite(expectedStart) && Number.isFinite(actualStart) && Math.abs(expectedStart - actualStart) > 5000) return false;
    const expectedExecutable = String(record?.executablePath || "").trim();
    const actualExecutable = String(identity.executablePath || "").trim();
    if (expectedExecutable && actualExecutable && pathApi.resolve(expectedExecutable).toLowerCase() !== pathApi.resolve(actualExecutable).toLowerCase()) return false;
    return true;
  }

  async function purgeDeadLeases() {
    const stale = [];
    const live = [];
    for (const entry of listLeases()) {
      const value = entry.value;
      const pid = Math.max(0, Math.round(Number(value?.pid) || 0));
      const ownerSessionId = entry.canonicalSessionId;
      const payloadSessionId = sanitizeSegment(value?.sessionId || "", "");
      const canonicalSessionRoot = ownerSessionId ? pathApi.resolve(pathApi.join(sessionsRoot, ownerSessionId)) : "";
      const payloadSessionRoot = pathApi.resolve(String(value?.sessionRoot || ""));
      const payloadMatchesCanonical = !!ownerSessionId
        && payloadSessionId === ownerSessionId
        && payloadSessionRoot.toLowerCase() === canonicalSessionRoot.toLowerCase();
      let malformedAgeMs = 0;
      if (!value || !pid || !payloadMatchesCanonical) {
        try { malformedAgeMs = Math.max(0, now() - Number(fsApi.statSync(entry.filePath).mtimeMs || 0)); } catch { malformedAgeMs = malformedLeaseGraceMs; }
      }
      const ownerLive = value && pid && payloadMatchesCanonical ? await isRecordedOwnerLive(value) : malformedAgeMs < malformedLeaseGraceMs;
      if (!ownerLive) {
        stale.push(entry);
        try { fsApi.rmSync(entry.filePath, { force: true }); } catch { void 0; }
        if (ownerSessionId && isPathInside(canonicalSessionRoot, sessionsRoot, pathApi) && canonicalSessionRoot !== pathApi.resolve(sessionsRoot)) {
          await removeDir(canonicalSessionRoot, { retries: 2, retryDelayMs: 100 });
        }
      } else {
        live.push(payloadMatchesCanonical ? entry : {
          ...entry,
          value: { ...(value || {}), sessionId: ownerSessionId, sessionRoot: canonicalSessionRoot }
        });
      }
    }
    return { stale, live };
  }

  async function purgeOrphanSessions(liveLeases) {
    const liveSessionIds = new Set((liveLeases || [])
      .map((entry) => sanitizeSegment(entry?.value?.sessionId || "", ""))
      .filter(Boolean));
    let entries = [];
    try { entries = fsApi.readdirSync(sessionsRoot, { withFileTypes: true }); } catch { return []; }
    const removed = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || liveSessionIds.has(entry.name) || entry.name === sessionId) continue;
      const target = pathApi.resolve(pathApi.join(sessionsRoot, entry.name));
      if (!isPathInside(target, sessionsRoot, pathApi) || target === pathApi.resolve(sessionsRoot)) continue;
      const manifest = readJson(pathApi.join(target, "session.json"));
      if (manifest && await isRecordedOwnerLive(manifest)) continue;
      let ageMs = 0;
      try { ageMs = Math.max(0, now() - Number(fsApi.statSync(target).mtimeMs || 0)); } catch { ageMs = orphanSessionGraceMs; }
      if (ageMs < orphanSessionGraceMs) continue;
      const cleanup = await removeDir(target, { retries: 2, retryDelayMs: 100 });
      if (cleanup.ok) removed.push(target);
    }
    return removed;
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
      fsApi.rmSync(breakerPath, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  function acquireStaleLockBreaker() {
    const breakerPath = `${lifecycleLockPath}.breaker`;
    const token = `${sessionId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const descriptor = fsApi.openSync(breakerPath, "wx");
        fsApi.writeFileSync(descriptor, JSON.stringify({ pid: processId, token, sessionId, createdAt: Date.now() }), "utf8");
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
      if (readLockToken(breaker?.breakerPath) === breaker?.token) fsApi.rmSync(breaker.breakerPath, { force: true });
    } catch { void 0; }
  }

  function breakStaleLifecycleLockIfUnchanged(observedRaw) {
    if (typeof observedRaw !== "string") return false;
    const breaker = acquireStaleLockBreaker();
    if (!breaker) return false;
    try {
      if (readLockToken(breaker.breakerPath) !== breaker.token) return false;
      const current = readLockSnapshot(lifecycleLockPath);
      if (!current || current.raw !== observedRaw) return false;
      if (readLockToken(breaker.breakerPath) !== breaker.token) return false;
      fsApi.rmSync(lifecycleLockPath, { force: true });
      return true;
    } catch {
      return false;
    } finally {
      releaseStaleLockBreaker(breaker);
    }
  }

  async function acquireLifecycleLock(lockOptions = {}) {
    ensureRoots();
    const timeoutMs = Math.max(1000, Number(lockOptions.timeoutMs) || 20_000);
    const pollMs = Math.max(10, Math.min(1000, Number(lockOptions.pollMs) || 100));
    const staleAfterMs = Math.max(30_000, Number(lockOptions.staleAfterMs) || 120_000);
    const deadline = now() + timeoutMs;
    const token = `${sessionId}-${now()}-${Math.random().toString(16).slice(2)}`;
    while (true) {
      try {
        const descriptor = fsApi.openSync(lifecycleLockPath, "wx");
        const lock = { descriptor, token, createdAt: now(), updatedAt: now() };
        fsApi.writeFileSync(descriptor, JSON.stringify({ pid: processId, token, sessionId, processStartedAt, executablePath, createdAt: lock.createdAt, updatedAt: lock.updatedAt }), "utf8");
        return lock;
      } catch (error) {
        if (!error || error.code !== "EEXIST") throw error;
      }
      let ownerRaw = null;
      let owner = null;
      try {
        ownerRaw = String(fsApi.readFileSync(lifecycleLockPath, "utf8") || "");
        owner = JSON.parse(ownerRaw);
      } catch {
        owner = null;
      }
      const ownerPid = Math.max(0, Math.round(Number(owner?.pid) || 0));
      let malformedAgeMs = 0;
      if (!ownerPid) {
        try { malformedAgeMs = Math.max(0, now() - Number(fsApi.statSync(lifecycleLockPath).mtimeMs || 0)); } catch { malformedAgeMs = staleAfterMs; }
      }
      const stale = ownerPid ? !(await isRecordedOwnerLive(owner)) : malformedAgeMs > 5000;
      if (stale) {
        if (ownerRaw === null) {
          try { ownerRaw = String(fsApi.readFileSync(lifecycleLockPath, "utf8") || ""); } catch { ownerRaw = null; }
        }
        if (breakStaleLifecycleLockIfUnchanged(ownerRaw)) continue;
      }
      if (now() >= deadline) {
        const error = new Error("temp_lifecycle_lock_timeout");
        error.code = "NOVAFLOW_TEMP_LIFECYCLE_LOCK_TIMEOUT";
        throw error;
      }
      await wait(pollMs);
    }
  }

  function refreshLifecycleLock(lock) {
    try {
      const current = readJson(lifecycleLockPath);
      if (!current || current.token !== lock.token) return false;
      lock.updatedAt = now();
      const next = JSON.stringify({ pid: processId, token: lock.token, sessionId, processStartedAt, executablePath, createdAt: lock.createdAt, updatedAt: lock.updatedAt });
      fsApi.writeSync(lock.descriptor, next, 0, "utf8");
      fsApi.ftruncateSync(lock.descriptor, Buffer.byteLength(next, "utf8"));
      return true;
    } catch {
      return false;
    }
  }

  function releaseLifecycleLock(lock) {
    try { fsApi.closeSync(lock?.descriptor); } catch { void 0; }
    try {
      const current = readJson(lifecycleLockPath);
      if (current?.token === lock?.token) fsApi.rmSync(lifecycleLockPath, { force: true });
    } catch { void 0; }
  }

  async function withLifecycleLock(action, lockOptions = {}) {
    const lock = await acquireLifecycleLock(lockOptions);
    const timer = setInterval(() => refreshLifecycleLock(lock), 2000);
    timer.unref?.();
    try {
      return await action();
    } finally {
      clearInterval(timer);
      releaseLifecycleLock(lock);
    }
  }

  async function register(registerOptions = {}) {
    return await withLifecycleLock(async () => {
      const purge = await purgeDeadLeases();
      const orphanSessions = await purgeOrphanSessions(purge.live);
      const liveOthers = purge.live.filter((entry) => entry.value?.sessionId !== sessionId);
      const cleanupPending = fsApi.existsSync(cleanupPendingPath);
      let recovery = null;
      if (!liveOthers.length && (cleanupPending || purge.stale.length > 0 || orphanSessions.length > 0) && typeof registerOptions.recoverOrphaned === "function") {
        recovery = await registerOptions.recoverOrphaned({ cleanupPending, staleClients: purge.stale.length, orphanSessions: orphanSessions.length });
        if (recovery?.ok) {
          try { fsApi.rmSync(cleanupPendingPath, { force: true }); } catch { void 0; }
        }
      }
      fsApi.mkdirSync(sessionRoot, { recursive: true });
      writeJsonAtomic(manifestPath, leasePayload("active"));
      writeLease("active");
      registered = true;
      closing = false;
      startHeartbeat();
      emit("info", "temp-session-registered", { sessionId, sessionRoot, liveOthers: liveOthers.length, staleClients: purge.stale.length, orphanSessions: orphanSessions.length });
      return { ok: true, sessionId, sessionRoot, liveOthers: liveOthers.length, staleClients: purge.stale.length, orphanSessions: orphanSessions.length, cleanupPending, recovery };
    });
  }

  function markCleanupPending(reason, meta = {}) {
    try {
      writeJsonAtomic(cleanupPendingPath, { version: 1, reason: String(reason || "cleanup_failed"), at: now(), sessionId, ...meta });
      return true;
    } catch {
      return false;
    }
  }

  async function close(closeOptions = {}) {
    closing = true;
    stopHeartbeat();
    try { if (registered) writeLease("closing"); } catch { void 0; }
    const sessionCleanup = closeOptions.skipSessionCleanup === true
      ? { ok: false, skipped: true, error: "active_temp_jobs" }
      : await removeDir(sessionRoot, { retries: 3, retryDelayMs: 150 });
    let result = null;
    try {
      result = await withLifecycleLock(async () => {
        const purge = await purgeDeadLeases();
        const liveOthers = purge.live.filter((entry) => entry.value?.sessionId !== sessionId);
        const lastOwner = liveOthers.length === 0;
        let lastOwnerResult = null;
        if (lastOwner && typeof closeOptions.onLastOwner === "function") {
          try { lastOwnerResult = await closeOptions.onLastOwner(); } catch (error) {
            lastOwnerResult = { ok: false, error: String(error?.message || error) };
          }
          if (lastOwnerResult?.ok) {
            try { fsApi.rmSync(cleanupPendingPath, { force: true }); } catch { void 0; }
          } else {
            markCleanupPending(lastOwnerResult?.error || "last_owner_cleanup_failed", { lastOwnerResult });
          }
        }
        if (!sessionCleanup.ok) {
          markCleanupPending("session_cleanup_failed", { sessionCleanup });
        }
        try { fsApi.rmSync(leasePath, { force: true }); } catch { void 0; }
        registered = false;
        emit("info", "temp-session-closed", { sessionId, lastOwner, liveOthers: liveOthers.length, sessionCleanup, lastOwnerResult });
        return { ok: sessionCleanup.ok && (!lastOwner || lastOwnerResult?.ok !== false), lastOwner, liveOthers: liveOthers.length, sessionCleanup, lastOwnerResult };
      }, closeOptions.lockOptions || {});
    } catch (error) {
      markCleanupPending("lifecycle_lock_failed", { error: String(error?.message || error) });
      try { fsApi.rmSync(leasePath, { force: true }); } catch { void 0; }
      registered = false;
      result = { ok: false, lastOwner: false, sessionCleanup, error: String(error?.message || error) };
    }
    return result;
  }

  async function cleanupLegacyArtifacts(cleanupOptions = {}) {
    const legacyRoot = pathApi.resolve(String(cleanupOptions.legacyRoot || pathApi.dirname(storageRoot)));
    const requestedMinAgeMs = Number(cleanupOptions.minAgeMs);
    const minAgeMs = Number.isFinite(requestedMinAgeMs) && requestedMinAgeMs >= 0
      ? requestedMinAgeMs
      : 10 * 60 * 1000;
    const maxEntries = Math.max(1, Math.min(5000, Math.round(Number(cleanupOptions.maxEntries) || 500)));
    const timeBudgetMs = Math.max(250, Math.min(30_000, Number(cleanupOptions.timeBudgetMs) || 3000));
    const deadline = Date.now() + timeBudgetMs;
    const prefixSet = cleanupOptions.prefixes || DEFAULT_LEGACY_PREFIXES;
    const exactSet = new Set(cleanupOptions.exactDirs || DEFAULT_LEGACY_DIRS);
    let entries = [];
    try { entries = fsApi.readdirSync(legacyRoot, { withFileTypes: true }); } catch { return { ok: false, removed: 0, failed: 0 }; }
    let removed = 0;
    let failed = 0;
    let attempted = 0;
    let truncated = false;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const matchesLegacyWorkDir = prefixSet.some((prefix) => {
        if (!entry.name.startsWith(prefix)) return false;
        return /^[a-zA-Z0-9]{6}$/.test(entry.name.slice(prefix.length));
      });
      const matches = exactSet.has(entry.name) || matchesLegacyWorkDir;
      if (!matches) continue;
      const target = pathApi.resolve(pathApi.join(legacyRoot, entry.name));
      if (pathApi.dirname(target).toLowerCase() !== legacyRoot.toLowerCase()) continue;
      let ageMs = 0;
      try { ageMs = Math.max(0, now() - Number(fsApi.statSync(target).mtimeMs || 0)); } catch { ageMs = minAgeMs; }
      if (ageMs < minAgeMs) continue;
      if (attempted >= maxEntries || Date.now() >= deadline) {
        truncated = true;
        break;
      }
      attempted += 1;
      const cleanup = await removeDir(target, { retries: 2, retryDelayMs: 100 });
      if (cleanup.ok) removed += 1;
      else failed += 1;
    }
    emit(failed ? "warn" : "info", "legacy-temp-cleanup", { legacyRoot, removed, failed, attempted, truncated, minAgeMs });
    return { ok: failed === 0, removed, failed, attempted, truncated };
  }

  function getPersistentFallbackDir(name) {
    const clean = sanitizeSegment(name, "");
    if (!clean || !["rembg-env", "birefnet-env", "portable-profiles"].includes(clean)) {
      throw new Error("persistent_fallback_not_allowed");
    }
    const target = pathApi.join(persistentFallbackRoot, clean);
    fsApi.mkdirSync(target, { recursive: true });
    return target;
  }

  return Object.freeze({
    sessionId,
    storageRoot,
    sessionsRoot,
    sessionRoot,
    coordinationRoot,
    persistentFallbackRoot,
    register,
    close,
    getCategoryDir,
    createWorkDir,
    isOwnedPath,
    isRegisteredWorkDir,
    cleanupWorkDir,
    cleanupLegacyArtifacts,
    getPersistentFallbackDir,
    markCleanupPending,
    withLifecycleLock,
  });
}

module.exports = {
  DEFAULT_CATEGORIES,
  DEFAULT_LEGACY_DIRS,
  DEFAULT_LEGACY_PREFIXES,
  createTempSessionLifecycle,
  isPathInside,
  sanitizeSegment,
};
