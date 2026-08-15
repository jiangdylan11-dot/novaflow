const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const helperPath = path.join(root, "particle-editor-desktop", "main", "temp-session-lifecycle.js");
const mainPath = path.join(root, "particle-editor-desktop", "main.js");
const { createTempSessionLifecycle } = require(helperPath);

function makeTestRoot(t, label) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `novaflow-temp-session-${label}-`));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  return tempRoot;
}

function createManager(storageRoot, options = {}) {
  return createTempSessionLifecycle({
    storageRoot,
    processId: options.processId || 1001,
    processStartedAt: options.processStartedAt || 100_000,
    executablePath: options.executablePath || "C:\\Program Files\\NovaFlow\\NovaFlow.exe",
    profileKey: options.profileKey || "installed-test",
    sessionId: options.sessionId,
    processAlive: options.processAlive || (() => true),
    inspectProcess: options.inspectProcess,
    now: options.now,
    wait: options.wait,
    heartbeatIntervalMs: 60_000,
  });
}

test("all production work directories stay inside one NovaFlow session root", async (t) => {
  const testRoot = makeTestRoot(t, "layout");
  const storageRoot = path.join(testRoot, "NovaFlow");
  const manager = createManager(storageRoot, { sessionId: "layout-session" });
  await manager.register();

  const categories = [
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
  ];
  for (const category of categories) {
    const dir = manager.createWorkDir(category, `novaflow_${category}`);
    assert.equal(manager.isOwnedPath(dir, category), true, `${category} must stay in its session category`);
    assert.equal(manager.isRegisteredWorkDir(dir), true, `${category} must be server-registered`);
    assert.equal(path.relative(manager.sessionRoot, dir).startsWith(".."), false);
  }

  assert.throws(() => manager.getCategoryDir("../outside"), /temp_category_not_allowed/);
  assert.throws(() => manager.getCategoryDir("C:\\outside"), /temp_category_not_allowed/);
  await manager.close();
  assert.equal(fs.existsSync(manager.sessionRoot), false, "normal close removes the whole current session");
});

test("renderer cleanup can remove only server-created work directories", async (t) => {
  const testRoot = makeTestRoot(t, "ownership");
  const storageRoot = path.join(testRoot, "NovaFlow");
  const manager = createManager(storageRoot, { sessionId: "ownership-session" });
  await manager.register();
  const owned = manager.createWorkDir("export", "novaflow_export_");
  const sibling = path.join(manager.sessionRoot, "export", "forged");
  const external = path.join(testRoot, "user-export");
  fs.mkdirSync(sibling, { recursive: true });
  fs.mkdirSync(external, { recursive: true });

  assert.equal((await manager.cleanupWorkDir(sibling)).error, "temp_work_dir_not_owned");
  assert.equal((await manager.cleanupWorkDir(external)).error, "temp_work_dir_not_owned");
  assert.equal(fs.existsSync(sibling), true);
  assert.equal(fs.existsSync(external), true);
  assert.equal((await manager.cleanupWorkDir(owned)).ok, true);
  assert.equal(fs.existsSync(owned), false);
  await manager.close();
});

test("an unsettled temp job leaves its session for next-start recovery", async (t) => {
  const testRoot = makeTestRoot(t, "active-job");
  const storageRoot = path.join(testRoot, "NovaFlow");
  const manager = createManager(storageRoot, { sessionId: "active-job-session" });
  await manager.register();
  const workDir = manager.createWorkDir("rembg-job", "rembg");
  const closed = await manager.close({
    skipSessionCleanup: true,
    onLastOwner: async () => ({ ok: false, error: "active_temp_work_not_stopped" }),
  });
  assert.equal(closed.ok, false);
  assert.equal(closed.sessionCleanup.skipped, true);
  assert.equal(fs.existsSync(workDir), true, "live work must not be deleted while its job may still write");
  assert.equal(fs.existsSync(path.join(storageRoot, "RuntimeClients", "v1", "cleanup-pending.json")), true);
});

test("only the final live NovaFlow client runs shared Runtime cleanup", async (t) => {
  const testRoot = makeTestRoot(t, "leases");
  const storageRoot = path.join(testRoot, "NovaFlow");
  const alive = new Set([1101, 1102]);
  const processAlive = (pid) => alive.has(Number(pid));
  const first = createManager(storageRoot, { processId: 1101, sessionId: "client-a", processAlive });
  const second = createManager(storageRoot, { processId: 1102, sessionId: "client-b", processAlive });
  await first.register();
  await second.register();

  let firstLastOwnerCalls = 0;
  const firstClose = await first.close({ onLastOwner: async () => {
    firstLastOwnerCalls += 1;
    return { ok: true };
  } });
  alive.delete(1101);
  assert.equal(firstClose.lastOwner, false);
  assert.equal(firstLastOwnerCalls, 0, "closing A must not stop the Runtime used by B");

  let secondLastOwnerCalls = 0;
  const secondClose = await second.close({ onLastOwner: async () => {
    secondLastOwnerCalls += 1;
    return { ok: true };
  } });
  assert.equal(secondClose.lastOwner, true);
  assert.equal(secondLastOwnerCalls, 1, "closing final client B owns shared Runtime cleanup");
});

test("dead client sessions recover on startup while an alive PID is never scavenged", async (t) => {
  const testRoot = makeTestRoot(t, "recovery");
  const storageRoot = path.join(testRoot, "NovaFlow");
  const leasesRoot = path.join(storageRoot, "RuntimeClients", "v1", "leases");
  const sessionsRoot = path.join(storageRoot, "sessions");
  fs.mkdirSync(leasesRoot, { recursive: true });
  fs.mkdirSync(path.join(sessionsRoot, "dead-client"), { recursive: true });
  fs.mkdirSync(path.join(sessionsRoot, "pid-reused-client"), { recursive: true });
  fs.writeFileSync(path.join(leasesRoot, "dead-client.json"), JSON.stringify({
    sessionId: "dead-client",
    pid: 2201,
    sessionRoot: path.join(sessionsRoot, "dead-client"),
    updatedAt: 1,
  }));
  fs.writeFileSync(path.join(leasesRoot, "pid-reused-client.json"), JSON.stringify({
    sessionId: "pid-reused-client",
    pid: 2202,
    sessionRoot: path.join(sessionsRoot, "pid-reused-client"),
    updatedAt: 1,
  }));

  let recoveryCalls = 0;
  const manager = createManager(storageRoot, {
    processId: 2203,
    sessionId: "new-client",
    processAlive: (pid) => Number(pid) === 2202 || Number(pid) === 2203,
  });
  const registration = await manager.register({ recoverOrphaned: async () => {
    recoveryCalls += 1;
    return { ok: true };
  } });
  assert.equal(registration.staleClients, 1);
  assert.equal(recoveryCalls, 0, "an identity-ambiguous alive PID keeps cleanup fail-safe");
  assert.equal(fs.existsSync(path.join(sessionsRoot, "dead-client")), false);
  assert.equal(fs.existsSync(path.join(sessionsRoot, "pid-reused-client")), true);
  await manager.close();
});

test("verified process identity recovers leases and locks after PID reuse", async (t) => {
  const testRoot = makeTestRoot(t, "pid-reuse");
  const storageRoot = path.join(testRoot, "NovaFlow");
  const coordinationRoot = path.join(storageRoot, "RuntimeClients", "v1");
  const leasesRoot = path.join(coordinationRoot, "leases");
  const sessionsRoot = path.join(storageRoot, "sessions");
  fs.mkdirSync(leasesRoot, { recursive: true });
  fs.mkdirSync(path.join(sessionsRoot, "reused-owner"), { recursive: true });
  const staleIdentity = {
    sessionId: "reused-owner",
    pid: 3301,
    processStartedAt: 1000,
    executablePath: "C:\\OldNovaFlow\\NovaFlow.exe",
    sessionRoot: path.join(sessionsRoot, "reused-owner"),
    updatedAt: 1000,
  };
  fs.writeFileSync(path.join(leasesRoot, "reused-owner.json"), JSON.stringify(staleIdentity));
  fs.writeFileSync(path.join(coordinationRoot, "lifecycle.lock"), JSON.stringify({
    ...staleIdentity,
    token: "old-lock",
    createdAt: 1000,
  }));

  let recoveryCalls = 0;
  const manager = createManager(storageRoot, {
    processId: 3302,
    sessionId: "replacement-client",
    processAlive: () => true,
    inspectProcess: async (pid) => Number(pid) === 3301
      ? { alive: true, verified: true, processStartedAt: 900_000, executablePath: "C:\\Other\\Other.exe" }
      : { alive: true, verified: true, processStartedAt: 100_000, executablePath: "C:\\Program Files\\NovaFlow\\NovaFlow.exe" },
  });
  const registration = await manager.register({ recoverOrphaned: async () => {
    recoveryCalls += 1;
    return { ok: true };
  } });
  assert.equal(registration.staleClients, 1);
  assert.equal(recoveryCalls, 1);
  assert.equal(fs.existsSync(path.join(sessionsRoot, "reused-owner")), false);
  await manager.close();
});

test("concurrent stale lifecycle recovery cannot delete a newly acquired lock", async (t) => {
  const testRoot = makeTestRoot(t, "lifecycle-stale-race");
  const storageRoot = path.join(testRoot, "NovaFlow");
  const coordinationRoot = path.join(storageRoot, "RuntimeClients", "v1");
  fs.mkdirSync(coordinationRoot, { recursive: true });
  fs.writeFileSync(path.join(coordinationRoot, "lifecycle.lock"), JSON.stringify({
    pid: 5511,
    token: "stale-lifecycle-owner",
    sessionId: "stale-owner",
    processStartedAt: 1000,
    executablePath: "C:\\OldNovaFlow\\NovaFlow.exe",
    createdAt: 1000,
    updatedAt: 1000,
  }));

  let identityArrivals = 0;
  let releaseIdentityChecks = null;
  const identityChecksReady = new Promise((resolve) => { releaseIdentityChecks = resolve; });
  const inspectStaleOwner = async (pid) => {
    if (Number(pid) !== 5511) {
      return {
        alive: true,
        verified: true,
        processStartedAt: 100_000,
        executablePath: path.resolve("C:\\Program Files\\NovaFlow\\NovaFlow.exe"),
      };
    }
    identityArrivals += 1;
    if (identityArrivals === 2) releaseIdentityChecks();
    await identityChecksReady;
    return { alive: true, verified: true, processStartedAt: 900_000, executablePath: "C:\\Other\\Other.exe" };
  };
  const managerA = createManager(storageRoot, {
    processId: 5512,
    sessionId: "stale-race-a",
    now: () => 100_000,
    processAlive: () => true,
    inspectProcess: inspectStaleOwner,
  });
  const managerB = createManager(storageRoot, {
    processId: 5513,
    sessionId: "stale-race-b",
    now: () => 100_000,
    processAlive: () => true,
    inspectProcess: inspectStaleOwner,
  });
  let active = 0;
  let maxActive = 0;
  const runAction = (manager) => manager.withLifecycleLock(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 35));
    active -= 1;
  }, { timeoutMs: 2000, pollMs: 5 });

  await Promise.all([runAction(managerA), runAction(managerB)]);
  assert.equal(maxActive, 1, "stale lifecycle recovery must serialize all cleanup owners");
});

test("a stale lease cannot redirect cleanup into another live session", async (t) => {
  const testRoot = makeTestRoot(t, "lease-boundary");
  const storageRoot = path.join(testRoot, "NovaFlow");
  const leasesRoot = path.join(storageRoot, "RuntimeClients", "v1", "leases");
  const sessionsRoot = path.join(storageRoot, "sessions");
  const staleRoot = path.join(sessionsRoot, "stale-a");
  const liveRoot = path.join(sessionsRoot, "live-b");
  fs.mkdirSync(staleRoot, { recursive: true });
  fs.mkdirSync(liveRoot, { recursive: true });
  fs.mkdirSync(leasesRoot, { recursive: true });
  const staleLeasePath = path.join(leasesRoot, "stale-a.json");
  fs.writeFileSync(staleLeasePath, JSON.stringify({
    sessionId: "live-b",
    sessionRoot: liveRoot,
    pid: 4401,
  }));
  fs.utimesSync(staleLeasePath, new Date(0), new Date(0));
  fs.writeFileSync(path.join(leasesRoot, "live-b.json"), JSON.stringify({
    sessionId: "live-b",
    sessionRoot: liveRoot,
    pid: 4402,
  }));

  const manager = createManager(storageRoot, {
    processId: 4403,
    sessionId: "new-client",
    processAlive: (pid) => Number(pid) === 4402 || Number(pid) === 4403,
  });
  const registration = await manager.register();
  assert.equal(registration.staleClients, 1);
  assert.equal(fs.existsSync(staleRoot), false, "the stale lease may remove only the session named by its own filename");
  assert.equal(fs.existsSync(liveRoot), true, "a forged payload path must not remove another live session");
  await manager.close();
});

test("owned work cleanup rejects a Windows junction without touching its target", { skip: process.platform !== "win32" }, async (t) => {
  const testRoot = makeTestRoot(t, "junction-boundary");
  const storageRoot = path.join(testRoot, "NovaFlow");
  const sentinelRoot = path.join(testRoot, "outside-sentinel");
  const sentinelFile = path.join(sentinelRoot, "keep.txt");
  fs.mkdirSync(sentinelRoot, { recursive: true });
  fs.writeFileSync(sentinelFile, "keep", "utf8");

  const manager = createManager(storageRoot, { sessionId: "junction-session" });
  await manager.register();
  const workDir = manager.createWorkDir("export", "junction");
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.symlinkSync(sentinelRoot, workDir, "junction");

  const cleanup = await manager.cleanupWorkDir(workDir);
  assert.equal(cleanup.ok, false);
  assert.equal(cleanup.error, "temp_reparse_point_not_allowed");
  assert.equal(fs.readFileSync(sentinelFile, "utf8"), "keep", "junction cleanup must not traverse into external data");

  fs.rmSync(workDir, { force: true });
  await manager.close();
});

test("legacy scavenger uses an exact allowlist and persistent fallbacks stay outside sessions", async (t) => {
  const testRoot = makeTestRoot(t, "legacy");
  const storageRoot = path.join(testRoot, "NovaFlow");
  const manager = createManager(storageRoot, { sessionId: "legacy-session" });
  const knownPrefix = path.join(testRoot, "novaflow_ais_probe_Ab12Cd");
  const knownExact = path.join(testRoot, "novaflow_ai_seq_cache");
  const persistentLegacyFallback = path.join(testRoot, "novaflow_rembg_env_fallback");
  const unknown = path.join(testRoot, "novaflow_user_export_keep");
  fs.mkdirSync(knownPrefix, { recursive: true });
  fs.mkdirSync(knownExact, { recursive: true });
  fs.mkdirSync(persistentLegacyFallback, { recursive: true });
  fs.mkdirSync(unknown, { recursive: true });
  await manager.register();
  const cleanup = await manager.cleanupLegacyArtifacts({ minAgeMs: 0 });
  assert.equal(cleanup.ok, true);
  assert.equal(fs.existsSync(knownPrefix), false);
  assert.equal(fs.existsSync(knownExact), false);
  assert.equal(fs.existsSync(persistentLegacyFallback), true, "legacy persistent environments must never match a job prefix");
  assert.equal(fs.existsSync(unknown), true, "unknown/user data must never match the legacy sweep");

  const rembg = manager.getPersistentFallbackDir("rembg-env");
  assert.equal(rembg.startsWith(path.join(storageRoot, "persistent-fallback")), true);
  assert.equal(rembg.startsWith(manager.sessionRoot), false);
  await manager.close();
  assert.equal(fs.existsSync(rembg), true, "persistent dependencies survive app exit");
});

test("main routes every production temporary feature through the session manager", () => {
  const source = fs.readFileSync(mainPath, "utf8");
  assert.match(source, /require\("\.\/main\/temp-session-lifecycle"\)/);
  assert.doesNotMatch(source, /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\)/, "production jobs must not create top-level Temp directories");
  assert.doesNotMatch(source, /app\.getPath\("temp"\)/, "main must not resolve a second Electron temp root");
  for (const category of [
    "ai-sequence-head-tail",
    "ai-sequence-trim",
    "ai-sequence-probe",
    "rembg-job",
    "spine-split",
    "ai-sequence-cache",
  ]) {
    assert.match(source, new RegExp(category), `${category} must use the unified manager`);
  }
  assert.doesNotMatch(source, /cleanup-skipped[\s\S]{0,220}novaflow_cutout_save_/, "cutout production cleanup must not be disabled for diagnostics");
  assert.match(source, /config\.installed\s*&&\s*config\.ok\s*&&\s*config\.outputPath/, "warehouse must use the configured Runtime output path");
  assert.match(source, /\["input",\s*"output",\s*"temp-root"\]/, "last owner may clean only Runtime transient children");
  assert.match(source, /generatedRoot\.toLowerCase\(\)\s*!==\s*managedRoot\.toLowerCase\(\)/, "automatic cleanup must accept only the canonical managed Runtime temp root");
  assert.match(source, /fs\.lstatSync\(current\)\.isSymbolicLink\(\)/, "managed Runtime cleanup must reject junctions or symlinks in its path chain");
  assert.match(source, /if \(novaFlowAppShuttingDown\) throw new Error\("app_shutting_down"\)/, "new temp writes must be rejected after shutdown begins");
  assert.match(source, /handleNovaFlowTempIpc\("ai-seq-rembg-batch"/, "long temp jobs must participate in the shutdown barrier");
  assert.match(source, /waitForNovaFlowTempJobsToSettle\(8000\)/, "shutdown must wait for tracked temp jobs before deleting their session");
  assert.match(source, /quarantineNovaFlowRuntimeTransientDir/, "large Runtime trees must be isolated before recursive deletion");
  assert.doesNotMatch(source, /fs\.promises\.rm\(generatedPath/, "the Runtime generated root must never be recursively removed");
});
