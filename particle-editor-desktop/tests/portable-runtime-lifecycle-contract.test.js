const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const mainPath = path.join(root, "particle-editor-desktop", "main.js");
const policyPath = path.join(root, "particle-editor-desktop", "main", "single-instance-policy.js");
const runtimeLifecyclePath = path.join(root, "particle-editor-desktop", "main", "runtime-lifecycle.js");
const tempSessionLifecyclePath = path.join(root, "particle-editor-desktop", "main", "temp-session-lifecycle.js");
const preloadPath = path.join(root, "particle-editor-desktop", "preload.js");
const startRuntimeTemplatePath = path.join(root, "tools", "ai-runtime", "templates", "start-runtime.bat");
const stopRuntimeTemplatePath = path.join(root, "tools", "ai-runtime", "templates", "stop-runtime.bat");
const syncRuntimePath = path.join(root, "scripts", "sync-runtime.mjs");
const checkRuntimePath = path.join(root, "scripts", "check-runtime-sync.mjs");
const buildRendererPath = path.join(root, "particle-editor-desktop", "scripts", "build-renderer.mjs");
const electronBuilderPath = path.join(root, "particle-editor-desktop", "electron-builder.json");
const source = fs.readFileSync(mainPath, "utf8");
const preloadSource = fs.readFileSync(preloadPath, "utf8");

function extractNamedFunction(input, name) {
  const start = input.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const signatureEnd = input.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `${name} should have a body`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }
  throw new Error(`${name} body is incomplete`);
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function probeLoopbackPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForLoopbackPort(port, expectedOpen, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeLoopbackPort(port) === expectedOpen) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

test("portable instance profiles use the stable portable root while installed profiles remain separate", () => {
  assert.equal(fs.existsSync(policyPath), true, "single-instance-policy.js must provide a testable portable profile policy");
  const { resolveSingleInstanceProfile, decideSecondInstanceAction, preparePortableUserDataPath } = require(policyPath);

  const portableRoot = path.resolve("D:\\Portable\\NovaFlow-A");
  const fromLauncher = resolveSingleInstanceProfile({
    execPath: "C:\\Users\\jiang\\AppData\\Local\\Temp\\NovaFlow.exe",
    argv: [],
    env: { PORTABLE_EXECUTABLE_DIR: portableRoot },
  });
  assert.deepEqual(fromLauncher, {
    kind: "portable",
    portableRoot,
    userDataPath: path.join(portableRoot, "user-data"),
  });

  const unpacked = resolveSingleInstanceProfile({
    execPath: "D:\\AI_APP\\NovaFlow\\particle-editor-desktop\\dist\\win-unpacked\\NovaFlowPortable.exe",
    argv: [],
    env: {},
  });
  assert.equal(unpacked.kind, "portable");
  assert.equal(unpacked.portableRoot, path.dirname(unpacked.userDataPath));

  const installed = resolveSingleInstanceProfile({
    execPath: "C:\\Program Files\\NovaFlow\\NovaFlow.exe",
    argv: [],
    env: {},
  });
  assert.deepEqual(installed, { kind: "installed", portableRoot: "", userDataPath: "" });

  assert.equal(decideSecondInstanceAction({
    primaryKind: "portable",
    currentExecPath: "C:\\Temp\\portable-a\\NovaFlow.exe",
    candidateExecPath: "C:\\Temp\\portable-b\\NovaFlow.exe",
    candidateExists: true,
    wantsHandover: false,
  }), "focus", "portable launchers must focus instead of handing over to a temporary executable");
  assert.equal(decideSecondInstanceAction({
    primaryKind: "installed",
    currentExecPath: "C:\\Program Files\\NovaFlow\\NovaFlow.exe",
    candidateExecPath: "D:\\NovaFlow-New\\NovaFlow.exe",
    candidateExists: true,
    wantsHandover: false,
  }), "handover", "installed version handover must remain supported");

  const missingRoot = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "novaflow-portable-profile-test-"));
  fs.rmSync(missingRoot, { recursive: true, force: true });
  const prepared = preparePortableUserDataPath({
    kind: "portable",
    portableRoot: missingRoot,
    userDataPath: path.join(missingRoot, "user-data"),
  }, { appDataPath: path.join(require("node:os").tmpdir(), "novaflow-profile-fallback") });
  assert.equal(prepared.userDataPath, path.join(missingRoot, "user-data"));
  assert.equal(fs.existsSync(prepared.userDataPath), true, "fresh portable userData must exist before app.setPath");
  fs.rmSync(missingRoot, { recursive: true, force: true });

  const attemptedPaths = [];
  const fallbackProfile = preparePortableUserDataPath(fromLauncher, {
    appDataPath: "C:\\Users\\jiang\\AppData\\Roaming",
    fs: {
      mkdirSync(candidatePath) {
        attemptedPaths.push(candidatePath);
        if (candidatePath === fromLauncher.userDataPath) {
          const error = new Error("read only portable root");
          error.code = "EACCES";
          throw error;
        }
      },
    },
  });
  assert.equal(attemptedPaths[0], fromLauncher.userDataPath, "portable-local userData stays preferred");
  assert.notEqual(fallbackProfile.userDataPath, fromLauncher.userDataPath, "an unwritable portable root needs a stable isolated fallback");
  assert.match(fallbackProfile.userDataPath, /NovaFlowPortable/i);
});

test("main applies the portable profile before requesting a lock in every instance domain", () => {
  assert.match(source, /require\("\.\/main\/single-instance-policy"\)/, "main must consume the shared single-instance policy");
  const profileAt = source.indexOf("resolveSingleInstanceProfile(");
  const prepareUserDataAt = source.indexOf("preparePortableUserDataPath(", profileAt);
  const portableUserDataAt = source.indexOf('app.setPath("userData", INSTANCE_PROFILE.userDataPath)');
  const singleInstanceAt = source.indexOf("app.requestSingleInstanceLock(");
  assert.ok(profileAt >= 0 && prepareUserDataAt > profileAt, "main must create or select portable userData");
  assert.ok(portableUserDataAt > prepareUserDataAt, "portable userData must exist before app.setPath");
  assert.ok(singleInstanceAt > portableUserDataAt, "portable userData must define the per-directory lock domain before the lock request");
  const instanceInitBlock = source.slice(profileAt, source.indexOf("function safeJson", profileAt));
  assert.doesNotMatch(instanceInitBlock, /try\s*\{\s*app\.setPath\("userData"[\s\S]*?catch\s*\{/, "app.setPath failure must reach the fail-closed outer handler");
  assert.match(
    instanceInitBlock,
    /requestSingleInstanceLock\([\s\S]*?catch\s*\(error\)\s*\{[\s\S]*?app\.exit\(1\)/,
    "single-instance lock errors must fail closed instead of continuing unlocked",
  );
  assert.match(
    instanceInitBlock,
    /if\s*\(!gotLock\)\s*\{\s*INSTANCE_PROFILE_READY\s*=\s*false;\s*app\.quit\(\)/,
    "a secondary process must close the startup gate before quitting",
  );
  assert.doesNotMatch(source.slice(profileAt, source.indexOf("function safeJson", profileAt)), /if\s*\(!IS_PORTABLE\)\s*\{[\s\S]*?requestSingleInstanceLock\(/);
  assert.match(source, /decideSecondInstanceAction\(/, "second-instance handling must use the portable-safe action policy");
  const readyStart = source.indexOf("app.whenReady().then(async () => {");
  assert.match(
    source.slice(readyStart, readyStart + 180),
    /app\.whenReady\(\)\.then\(async \(\) => \{\s*if\s*\(!INSTANCE_PROFILE_READY\)\s*return;/,
    "the losing instance must not initialize windows, services, or license checks after app.whenReady resolves",
  );
});

test("desktop preload Node dependencies run in an explicitly unsandboxed isolated context", () => {
  assert.match(preloadSource, /require\("node:crypto"\)/, "the preload price observer currently depends on Node crypto");
  assert.match(preloadSource, /require\("ws"\)/, "the preload price observer currently depends on the ws package");
  const createWindowSource = extractNamedFunction(source, "createWindow");
  assert.match(createWindowSource, /contextIsolation:\s*true/, "renderer globals must remain context-isolated");
  assert.match(createWindowSource, /nodeIntegration:\s*false/, "renderer code must not gain direct Node integration");
  assert.match(
    createWindowSource,
    /if\s*\(!NF_ELECTRON_AB_NO_PRELOAD\)\s*\{[\s\S]*?webPreferences\.preload[\s\S]*?webPreferences\.sandbox\s*=\s*false/,
    "Electron 20+ sandboxes renderers by default, so this Node-backed preload must explicitly opt out",
  );
});

test("concurrent desktop instances serialize Runtime start and re-probe inside the shared lock", async (t) => {
  assert.equal(fs.existsSync(runtimeLifecyclePath), true, "runtime-lifecycle.js must provide cross-process Runtime start coordination");
  const { createRuntimeStartCoordinator } = require(runtimeLifecyclePath);
  const tempRoot = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "novaflow-runtime-lock-test-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const coordinator = createRuntimeStartCoordinator();
  let healthy = false;
  let starts = 0;
  const startOrReuse = () => coordinator.withStartLock(tempRoot, async () => {
    if (healthy) return "reused";
    starts += 1;
    await new Promise((resolve) => setTimeout(resolve, 35));
    healthy = true;
    return "started";
  }, { timeoutMs: 2000, pollMs: 5 });

  const results = await Promise.all([startOrReuse(), startOrReuse()]);
  assert.equal(starts, 1, "only one process may execute the destructive start path");
  assert.deepEqual(results.slice().sort(), ["reused", "started"]);
  assert.equal(fs.existsSync(path.join(tempRoot, "runtime.start.lock")), false, "the lock file must be released after startup");

  const serializedRoot = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "novaflow-runtime-cleanup-lock-test-"));
  t.after(() => fs.rmSync(serializedRoot, { recursive: true, force: true }));
  let releaseStart = null;
  let reportStartEntered = null;
  const startEntered = new Promise((resolve) => { reportStartEntered = resolve; });
  const order = [];
  const heldStart = coordinator.withStartLock(serializedRoot, async () => {
    order.push("start-enter");
    reportStartEntered();
    await new Promise((resolve) => { releaseStart = resolve; });
    order.push("start-exit");
  }, { timeoutMs: 2000, pollMs: 5 });
  await startEntered;
  let cleanupEntered = false;
  const queuedCleanup = coordinator.withStartLock(serializedRoot, async () => {
    cleanupEntered = true;
    order.push("cleanup-enter");
  }, { timeoutMs: 2000, pollMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(cleanupEntered, false, "cleanup must not enter while Runtime start owns the same lock");
  releaseStart();
  await Promise.all([heldStart, queuedCleanup]);
  assert.deepEqual(order, ["start-enter", "start-exit", "cleanup-enter"]);

  const abortRoot = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "novaflow-runtime-abort-lock-test-"));
  t.after(() => fs.rmSync(abortRoot, { recursive: true, force: true }));
  let releaseAbortOwner = null;
  let reportAbortOwnerEntered = null;
  const abortOwnerEntered = new Promise((resolve) => { reportAbortOwnerEntered = resolve; });
  const abortOwner = coordinator.withStartLock(abortRoot, async () => {
    reportAbortOwnerEntered();
    await new Promise((resolve) => { releaseAbortOwner = resolve; });
  }, { timeoutMs: 2000, pollMs: 5 });
  await abortOwnerEntered;
  const abortController = new AbortController();
  let abortedActionEntered = false;
  const abortedWaiter = coordinator.withStartLock(abortRoot, async () => {
    abortedActionEntered = true;
  }, { timeoutMs: 2000, pollMs: 5, signal: abortController.signal });
  abortController.abort();
  await assert.rejects(abortedWaiter, (error) => error?.code === "NOVAFLOW_RUNTIME_START_ABORTED");
  assert.equal(abortedActionEntered, false, "an aborted lock waiter must never enter the Runtime action");
  releaseAbortOwner();
  await abortOwner;
  assert.equal(fs.existsSync(path.join(abortRoot, "runtime.start.lock")), false, "aborting a waiter must not damage the active owner's lock");

  const reusedPidRoot = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "novaflow-runtime-reused-pid-test-"));
  t.after(() => fs.rmSync(reusedPidRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(reusedPidRoot, "runtime.start.lock"), JSON.stringify({
    pid: process.pid,
    token: "crashed-owner",
    createdAt: 1000,
    updatedAt: 1000,
    processStartedAt: 1000,
    executablePath: "C:\\OldNovaFlow\\NovaFlow.exe",
  }));
  const recoveredCoordinator = createRuntimeStartCoordinator({
    now: () => 20000,
    processAlive: () => true,
    inspectProcess: async () => ({
      alive: true,
      verified: true,
      processStartedAt: 900_000,
      executablePath: "C:\\Other\\Other.exe",
    }),
  });
  assert.equal(
    await recoveredCoordinator.withStartLock(reusedPidRoot, async () => "recovered", { staleAfterMs: 2000 }),
    "recovered",
    "a verified PID identity mismatch must recover a crashed owner's lock",
  );

  const staleRaceRoot = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "novaflow-runtime-stale-race-test-"));
  t.after(() => fs.rmSync(staleRaceRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(staleRaceRoot, "runtime.start.lock"), JSON.stringify({
    pid: 9911,
    token: "stale-race-owner",
    createdAt: 1000,
    updatedAt: 1000,
    processStartedAt: 1000,
    executablePath: "C:\\OldNovaFlow\\NovaFlow.exe",
  }));
  let identityArrivals = 0;
  let releaseIdentityChecks = null;
  const identityChecksReady = new Promise((resolve) => { releaseIdentityChecks = resolve; });
  const inspectStaleOwner = async () => {
    identityArrivals += 1;
    if (identityArrivals === 2) releaseIdentityChecks();
    await identityChecksReady;
    return { alive: true, verified: true, processStartedAt: 900_000, executablePath: "C:\\Other\\Other.exe" };
  };
  const staleRaceCoordinatorA = createRuntimeStartCoordinator({
    processId: 9912,
    now: () => 100_000,
    processAlive: () => true,
    inspectProcess: inspectStaleOwner,
  });
  const staleRaceCoordinatorB = createRuntimeStartCoordinator({
    processId: 9913,
    now: () => 100_000,
    processAlive: () => true,
    inspectProcess: inspectStaleOwner,
  });
  let staleRaceActive = 0;
  let staleRaceMaxActive = 0;
  const runStaleRaceAction = (coordinator) => coordinator.withStartLock(staleRaceRoot, async () => {
    staleRaceActive += 1;
    staleRaceMaxActive = Math.max(staleRaceMaxActive, staleRaceActive);
    await new Promise((resolve) => setTimeout(resolve, 35));
    staleRaceActive -= 1;
  }, { timeoutMs: 2000, pollMs: 5, staleAfterMs: 2000 });
  await Promise.all([
    runStaleRaceAction(staleRaceCoordinatorA),
    runStaleRaceAction(staleRaceCoordinatorB),
  ]);
  assert.equal(staleRaceMaxActive, 1, "concurrent stale recovery must never delete a newly acquired Runtime lock");

  const liveOwnerRoot = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "novaflow-runtime-live-owner-test-"));
  t.after(() => fs.rmSync(liveOwnerRoot, { recursive: true, force: true }));
  const liveOwnerExe = path.resolve("C:\\Program Files\\NovaFlow\\NovaFlow.exe");
  fs.writeFileSync(path.join(liveOwnerRoot, "runtime.start.lock"), JSON.stringify({
    pid: 7788,
    token: "live-owner",
    createdAt: 1000,
    updatedAt: 1000,
    processStartedAt: 5000,
    executablePath: liveOwnerExe,
  }));
  let fakeNow = 100_000;
  const liveOwnerCoordinator = createRuntimeStartCoordinator({
    now: () => fakeNow,
    wait: async (delayMs) => { fakeNow += delayMs; },
    processAlive: () => true,
    inspectProcess: async () => ({ alive: true, verified: true, processStartedAt: 5000, executablePath: liveOwnerExe }),
  });
  await assert.rejects(
    () => liveOwnerCoordinator.withStartLock(liveOwnerRoot, async () => "must-not-enter", { timeoutMs: 1000, pollMs: 100 }),
    (error) => error?.code === "NOVAFLOW_RUNTIME_START_LOCK_TIMEOUT",
    "an alive verified owner must never lose its lock merely because its heartbeat is old",
  );
  await assert.rejects(
    () => coordinator.withStartLock("", async () => "invalid"),
    /runtime_generated_dir_missing/,
    "an empty generated directory must never resolve to the repository cwd",
  );
});

test("desktop lifecycle keeps 8188 shared until the final registered client exits", () => {
  assert.match(source, /require\("\.\/main\/runtime-lifecycle"\)/, "main must consume the Runtime start coordinator");
  assert.match(source, /require\("\.\/main\/temp-session-lifecycle"\)/, "main must consume the shared temp session lifecycle");
  assert.equal(fs.existsSync(tempSessionLifecyclePath), true, "temp session lifecycle must be independently testable");

  const readyStart = source.indexOf("app.whenReady().then(async () => {");
  const readyEnd = source.indexOf('app.on("window-all-closed"', readyStart);
  assert.ok(readyEnd > readyStart, "app-ready lifecycle block must have a stable end marker");
  const readyBlock = source.slice(readyStart, readyEnd);
  assert.doesNotMatch(readyBlock, /stopNovaFlowRuntimeSync\(/, "app startup must not stop a healthy shared Runtime");
  assert.doesNotMatch(readyBlock, /cleanupNovaFlowRuntimeGeneratedDir\(/, "app startup must not recursively clean shared Runtime data");

  const ensureSource = extractNamedFunction(source, "ensureNovaFlowRuntimeStarted");
  assert.match(ensureSource, /novaFlowRuntimeStartCoordinator\.withStartLock\(/, "cross-process coordination must wrap the start path");
  assert.ok((ensureSource.match(/getNovaFlowRuntimeStatus\(/g) || []).length >= 2, "Runtime health must be probed before and again inside the shared lock");
  assert.match(
    ensureSource,
    /lockTimeoutMs[\s\S]*\(scriptTimeoutMs\s*\+\s*readinessTimeoutMs\)\s*\*\s*2\s*\+\s*20_000/,
    "lock waiters must cover both complete bounded launch and readiness attempts",
  );

  const beforeQuitStart = source.indexOf('app.on("before-quit", (event) => {');
  const beforeQuitEnd = source.indexOf("});", beforeQuitStart);
  const beforeQuitBlock = source.slice(beforeQuitStart, beforeQuitEnd + 3);
  assert.match(beforeQuitBlock, /event\.preventDefault\(\)/, "quit must wait for asynchronous owned-temp cleanup");
  assert.match(beforeQuitBlock, /requestNovaFlowGracefulQuit\("before-quit"\)/, "all quit paths must use one guarded lifecycle");

  const closeSource = extractNamedFunction(source, "runNovaFlowGracefulQuit");
  assert.match(closeSource, /getNovaFlowTempSessionLifecycle\(\)\.close\(/, "quit must leave its cross-profile client lease");
  assert.match(closeSource, /onLastOwner:/, "shared Runtime cleanup must be gated by final-owner status");
  const runtimeCleanupSource = extractNamedFunction(source, "stopAndClearNovaFlowRuntimeTransientData");
  assert.match(runtimeCleanupSource, /stopNovaFlowRuntime\(/, "the final owner may stop the verified shared Runtime");
  assert.match(runtimeCleanupSource, /novaFlowRuntimeStartCoordinator\.withStartLock\(generatedPath/, "Runtime cleanup must serialize with Runtime startup");
  assert.match(runtimeCleanupSource, /inspectNovaFlowRuntimeProcess\(config\)/, "pre-listen Runtime processes must be identity-checked before transient deletion");
  assert.ok(runtimeCleanupSource.indexOf("inspectNovaFlowRuntimeProcess(config)") < runtimeCleanupSource.indexOf("quarantineNovaFlowRuntimeTransientDir"), "process identity must be checked before transient directories are isolated");
  assert.match(runtimeCleanupSource, /identity\.alive\s*&&\s*identity\.verified\s*&&\s*!identity\.runtime[\s\S]*removeStaleNovaFlowRuntimePid/, "a reused stale PID must be removed instead of blocking cleanup forever");
  assert.match(runtimeCleanupSource, /scriptTimeoutMs:\s*4000/, "automatic Runtime stop must stay bounded");
  assert.match(runtimeCleanupSource, /timeoutMs:\s*2500/, "automatic port release wait must stay bounded");
  assert.match(runtimeCleanupSource, /\["input",\s*"output",\s*"temp-root"\]/, "only transient Runtime children may be cleared");

  const quitSource = extractNamedFunction(source, "requestNovaFlowGracefulQuit");
  assert.ok(quitSource.indexOf("novaFlowGracefulQuitPromise = Promise.resolve()") < quitSource.indexOf("BrowserWindow.getAllWindows()"), "the quit promise guard must exist before window destruction can re-enter before-quit");
  assert.ok(quitSource.indexOf("win.hide()") < quitSource.indexOf("novaFlowRuntimeStartAbortController?.abort()"), "windows must be hidden before Runtime child termination can delay shutdown");
  const gracefulSource = extractNamedFunction(source, "runNovaFlowGracefulQuit");
  assert.match(gracefulSource, /terminateNovaFlowCommandChildrenForShutdown\(\)[\s\S]*waitForNovaFlowTempJobsToSettle\(8000\)[\s\S]*terminateNovaFlowCommandChildrenForShutdown\(\)/, "quit must kill commands, drain temp jobs, then sweep late children again");
  assert.match(gracefulSource, /skipSessionCleanup:\s*!cleanupAllowed/, "unsettled temp work must fail closed instead of deleting live directories");
  const ensureSourceAgain = extractNamedFunction(source, "ensureNovaFlowRuntimeStarted");
  assert.match(ensureSourceAgain, /signal:\s*startSignal/, "Runtime lock waiting must be abortable");
  assert.match(ensureSourceAgain, /killTreeOnAbort:\s*true/, "an aborted Runtime start script must not leave its child tree behind");
  assert.match(ensureSourceAgain, /waitForNovaFlowRuntimeReady\([^;]+startSignal,\s*config\)/, "readiness polling must share the Runtime start abort signal and monitor the launched process");
  assert.match(ensureSourceAgain, /for \(let attempt = 1; attempt <= 2; attempt \+= 1\)/, "a dead Runtime launch may be retried once, never without a bound");
  assert.match(ensureSourceAgain, /retryableFailure[\s\S]*removeStaleNovaFlowRuntimePid[\s\S]*novaflow-runtime-start-retry/, "only a verified failed launch may clear its stale PID and retry");
  assert.match(ensureSourceAgain, /retryableFailure[\s\S]*started\?\.terminationVerified !== false/, "an unverified command termination must never permit a duplicate Runtime launch");
  assert.match(ensureSourceAgain, /retryableFailure[\s\S]*started\?\.timedOut !== true/, "a timed-out launcher tree must never permit a duplicate Runtime launch");
  const readinessSource = extractNamedFunction(source, "waitForNovaFlowRuntimeReady");
  assert.match(readinessSource, /readNovaFlowRuntimePid\(config\)[\s\S]*isProcessAlive\(pid\)[\s\S]*runtime_process_exited_early/, "readiness polling must fail early when the launched Runtime process exits");
  assert.match(ensureSourceAgain, /startLock\.assertOwned\(\)[\s\S]*runCmd\("cmd\.exe"/, "Runtime start must revalidate lock ownership before spawning");
  const runCmdStart = source.indexOf("const runCmd = (cmd, args, opts) => {");
  const runCmdEnd = source.indexOf("const SEE_THROUGH_REPAIR_STDIO_LIMIT", runCmdStart);
  const runCmdSource = source.slice(runCmdStart, runCmdEnd);
  assert.ok(runCmdSource.indexOf("abortSignal?.aborted") < runCmdSource.indexOf("spawn(cmd, args"), "an already-aborted command must never be spawned");
  assert.doesNotMatch(runCmdSource, /spawnSync\("taskkill\.exe"/, "abort and timeout termination must not synchronously block the Electron main thread");
  assert.match(runCmdSource, /terminateNovaFlowCommandChild\(child, killTree\)\.then\(\(terminationVerified\)/, "runCmd must report whether child close was actually observed");
  assert.match(runCmdSource, /if \(!child\?\.pid\)[\s\S]*terminationVerified:\s*true[\s\S]*terminateNovaFlowCommandChild\(child, true\)\.then\(\(terminationVerified\)/, "a PID-bearing child error must wait for verified termination; only spawn failure may settle immediately");
  const trackedChildSource = extractNamedFunction(source, "trackNovaFlowCommandChild");
  assert.match(trackedChildSource, /__novaflowCloseObserved\s*=\s*true/, "only the child close path may confirm command termination");
  assert.match(trackedChildSource, /releaseOnError[\s\S]*if \(!child\.pid\) release\(\)/, "a PID-bearing child must stay registered until close is observed");
  assert.doesNotMatch(trackedChildSource, /exitCode\s*!=\s*null[\s\S]*release\(\)/, "an error or parent exit code alone must not release a possibly live child tree");

  const tempLifecycleFactorySource = extractNamedFunction(source, "getNovaFlowTempSessionLifecycle");
  assert.match(tempLifecycleFactorySource, /inspectProcess:\s*inspectNovaFlowProcessIdentityAsync/, "temp lease identity checks must not synchronously block the Electron main thread");
  const asyncIdentitySource = extractNamedFunction(source, "inspectNovaFlowProcessIdentityAsync");
  assert.doesNotMatch(asyncIdentitySource, /spawnSync\(/, "async lease identity checks must never use a blocking process query");
  assert.match(asyncIdentitySource, /await runCmd\("powershell\.exe"[\s\S]*timeoutMs:\s*1500[\s\S]*killTreeOnTimeout:\s*true/, "async identity checks must remain bounded and terminate their query process");
  assert.match(asyncIdentitySource, /if \(!result\.ok\) return \{ alive: true, verified: false \}/, "identity query failures must fail closed and preserve the recorded owner");

  assert.doesNotMatch(source, /function cleanupNovaFlowRuntimeGeneratedDir\(/, "recursive shared Runtime cleanup must be removed from lifecycle code");
  assert.doesNotMatch(source, /app\.relaunch\([\s\S]{0,420}app\.exit\(0\)/, "handover must not bypass the shared temp lifecycle");
  assert.doesNotMatch(source, /spawn\(candidateExec,\s*\[SINGLE_INSTANCE_HANDOVER_ARG\]/, "handover fallback must not race a detached replacement against the old instance lock");
  assert.match(source, /ipcMain\.handle\("runtime-stop"[\s\S]*?stopNovaFlowRuntime\(/, "explicit Runtime stop must remain available");
  assert.match(source, /ipcMain\.handle\("runtime-restart"[\s\S]*?stopNovaFlowRuntime\(/, "explicit Runtime restart must remain available");
});

test("legacy migration scans asynchronously and remains fail-closed", () => {
  assert.match(source, /async function scanOtherNovaFlowMainProcesses\(/);
  const scanSource = extractNamedFunction(source, "scanOtherNovaFlowMainProcesses");
  assert.doesNotMatch(scanSource, /spawnSync\(/, "legacy discovery must not block Electron's main thread");
  assert.match(scanSource, /await runCmd\("powershell\.exe"[\s\S]*?timeoutMs:\s*2500/, "the async process scan must remain bounded");
  assert.match(scanSource, /Get-CimInstance Win32_Process -ErrorAction Stop/, "CIM discovery errors must not look like an empty process list");
  assert.match(scanSource, /catch \{ Write-Error \$_; exit 2 \}/, "CIM discovery failures must exit non-zero so cleanup remains fail-closed");
  const migrationSource = extractNamedFunction(source, "scheduleNovaFlowLegacyTempMigration");
  assert.ok((migrationSource.match(/await scanOtherNovaFlowMainProcesses\(\)/g) || []).length >= 2, "migration must check old clients before and again inside the lifecycle lock");
  assert.match(migrationSource, /!preflight\.ok\s*\|\|\s*preflight\.processes\.length\s*>\s*0/, "a failed preflight must skip migration");
  assert.match(migrationSource, /!lockedPreflight\.ok\s*\|\|\s*lockedPreflight\.processes\.length\s*>\s*0/, "a failed locked preflight must skip migration");
});

test("Runtime stop never kills a stale PID unless the configured listener command is verified", () => {
  const stopTemplate = fs.readFileSync(stopRuntimeTemplatePath, "utf8");
  assert.doesNotMatch(
    stopTemplate,
    /if \(-not \$targetPid\) \{ \$targetPid=\$pidValue \}/,
    "a stale or reused PID must never become an unverified taskkill target",
  );
  assert.match(
    stopTemplate,
    /if \(-not \$targetPid\) \{[^\r\n]*Remove-Item[^\r\n]*PID_FILE[^\r\n]*exit 0 \}/,
    "when no matching listener exists, stop must remove only the stale pid file and exit",
  );
  assert.doesNotMatch(
    stopTemplate,
    /if \(-not \$proc\) \{[^\r\n]*exit 0 \}/,
    "a dead PID must not exit before scanning for a verified Runtime listener",
  );
  assert.doesNotMatch(
    stopTemplate,
    /Invalid NovaFlow AI Runtime pid file/,
    "a malformed PID file must be treated as stale and still allow verified listener discovery",
  );
});

test("Runtime start reports an early launcher exit without waiting for full backend readiness", () => {
  const startTemplate = fs.readFileSync(startRuntimeTemplatePath, "utf8");
  const pidWriteIndex = startTemplate.indexOf("Set-Content -LiteralPath $env:PID_FILE -Value $proc.Id");
  const earlyCheckIndex = startTemplate.indexOf("Assert-RuntimeLauncherAlive $proc $stdout $stderr");
  const successIndex = startTemplate.indexOf("NovaFlow AI Runtime started. PID:");

  assert.notEqual(pidWriteIndex, -1, "the launcher PID contract used by the stop script must remain intact");
  assert.notEqual(earlyCheckIndex, -1, "the detached launcher must be checked during its early startup window");
  assert.ok(pidWriteIndex < earlyCheckIndex, "the PID must be recorded before early process checks begin");
  assert.ok(earlyCheckIndex < successIndex, "success must not be reported before the early process check passes");
  assert.match(startTemplate, /function Assert-RuntimeLauncherAlive[\s\S]*?\.Refresh\(\)[\s\S]*?\.HasExited/);
  assert.match(startTemplate, /Get-CompactLogTail[\s\S]*?ExitCode:[\s\S]*?Add-Content -LiteralPath \$stderrPath/);
  assert.match(startTemplate, /\$recordedPid -eq \[string\]\$process\.Id[\s\S]*?Remove-Item -LiteralPath \$env:PID_FILE/, "an early exit may remove only its own PID record");
  assert.match(startTemplate, /\$minimumAliveChecks=16[\s\S]*?\$i -lt 40[\s\S]*?Start-Sleep -Milliseconds 250/, "early observation must stay bounded within the existing startup loop");
  assert.match(startTemplate, /throw \$message/, "an early launcher exit must make the start script fail non-zero");
  assert.doesNotMatch(startTemplate, /Invoke-WebRequest|system_stats/, "the start script must leave full 8188 readiness polling to the main process");
});

test("Runtime start template executes its normal and early-exit paths", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-runtime-start-contract-"));
  const scriptsDir = path.join(fixtureRoot, "scripts");
  const pythonDir = path.join(fixtureRoot, "engine", "python");
  const comfyDir = path.join(fixtureRoot, "engine", "ComfyUI");
  const assetsDir = path.join(fixtureRoot, "assets");
  const modelsDir = path.join(assetsDir, "models");
  const customNodesDir = path.join(assetsDir, "custom_nodes");
  const generatedDir = path.join(fixtureRoot, "generated");
  const startPath = path.join(scriptsDir, "start-runtime.bat");
  const stopPath = path.join(scriptsDir, "stop-runtime.bat");
  const fakePythonPath = path.join(pythonDir, "python.exe");
  const fakeMainPath = path.join(comfyDir, "main.py");
  const pidPath = path.join(generatedDir, "runtime.pid");
  const stderrPath = path.join(fixtureRoot, "logs", "runtime.err.log");
  const port = await reserveLoopbackPort();
  const env = {
    ...process.env,
    NOVAFLOW_AI_RUNTIME_GENERATED_DIR: generatedDir,
    NOVAFLOW_RUNTIME_START_TEST_MODE: "serve",
  };

  try {
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(pythonDir, { recursive: true });
    fs.mkdirSync(comfyDir, { recursive: true });
    fs.mkdirSync(path.join(assetsDir, "input"), { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "input", ".keep"), "fixture", "utf8");
    fs.copyFileSync(startRuntimeTemplatePath, startPath);
    fs.copyFileSync(stopRuntimeTemplatePath, stopPath);
    fs.copyFileSync(process.execPath, fakePythonPath);
    fs.writeFileSync(fakeMainPath, `
const http = require("node:http");
if (process.env.NOVAFLOW_RUNTIME_START_TEST_MODE === "early-exit") {
  console.error("fixture early exit marker");
  process.exit(23);
}
const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end('{"ok":true}');
}).listen(port, "127.0.0.1");
`, "utf8");
    fs.writeFileSync(path.join(fixtureRoot, "runtime.json"), JSON.stringify({
      name: "NovaFlow AI Runtime Test",
      version: "test",
      engine: "contract-fixture",
      port,
      installPath: fixtureRoot,
      assetsPath: assetsDir,
      modelsPath: modelsDir,
      customNodesPath: customNodesDir,
    }, null, 2), "utf8");

    const started = spawnSync("cmd.exe", ["/d", "/c", startPath], { env, encoding: "utf8", timeout: 15000 });
    assert.equal(started.status, 0, `normal launcher should pass its bounded early window: ${started.stderr || started.stdout}`);
    assert.match(started.stdout, /NovaFlow AI Runtime started\. PID: \d+ Port:/);
    assert.equal(await waitForLoopbackPort(port, true), true, "the normal fixture process should remain alive after the script returns");
    assert.match(fs.readFileSync(pidPath, "utf8").trim(), /^\d+$/, "normal startup must retain the stop-compatible launcher PID");

    const stopped = spawnSync("cmd.exe", ["/d", "/c", stopPath], { env, encoding: "utf8", timeout: 10000 });
    assert.equal(stopped.status, 0, `fixture cleanup should use the canonical stop script: ${stopped.stderr || stopped.stdout}`);
    assert.equal(await waitForLoopbackPort(port, false), true, "the canonical stop script should release the fixture port");

    const failed = spawnSync("cmd.exe", ["/d", "/c", startPath], {
      env: { ...env, NOVAFLOW_RUNTIME_START_TEST_MODE: "early-exit" },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.notEqual(failed.status, 0, "an immediately exiting launcher must fail the start script");
    assert.match(`${failed.stdout}\n${failed.stderr}`, /launcher exited during early startup[\s\S]*ExitCode: 23/);
    assert.equal(fs.existsSync(pidPath), false, "an early exit must remove only its own stale PID record");
    assert.match(fs.readFileSync(stderrPath, "utf8"), /fixture early exit marker[\s\S]*NovaFlow Runtime launcher/, "the diagnostic log must preserve the child error and launcher summary");
  } finally {
    spawnSync("cmd.exe", ["/d", "/c", stopPath], { env, encoding: "utf8", timeout: 10000 });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("portable lifecycle helpers are copied and hash-checked with the packaged main process", () => {
  const helperNames = ["single-instance-policy.js", "runtime-lifecycle.js", "temp-session-lifecycle.js"];
  const syncRuntime = fs.readFileSync(syncRuntimePath, "utf8");
  const checkRuntime = fs.readFileSync(checkRuntimePath, "utf8");
  const buildRenderer = fs.readFileSync(buildRendererPath, "utf8");
  const electronBuilder = JSON.parse(fs.readFileSync(electronBuilderPath, "utf8"));
  for (const helperName of helperNames) {
    assert.match(syncRuntime, new RegExp(helperName.replaceAll(".", "\\.")), `sync:runtime must copy ${helperName}`);
    assert.match(checkRuntime, new RegExp(helperName.replaceAll(".", "\\.")), `check:runtime must hash-check ${helperName}`);
  }
  assert.match(buildRenderer, /desktopAppShellDirs\s*=\s*\[[^\]]*"main"/, "desktop packaging must copy the main helper directory");
  assert.match(buildRenderer, /desktopAppShellFiles\s*=\s*\[[\s\S]*?"client-auth-direct\.js"/, "locked win-unpacked rebuild must retain the direct auth backend required by main");
  assert.match(syncRuntime, /label:\s*'client-auth-direct\.js'/, "sync:runtime must copy the direct auth backend required by main");
  assert.match(checkRuntime, /name:\s*'client-auth-direct\.js'/, "check:runtime must hash-check the direct auth backend required by main");
  assert.equal(electronBuilder.files.includes("client-auth-direct.js"), true, "portable packaging must retain the direct auth backend required by main");
  assert.match(buildRenderer, /license-admin-gui["']?,\s*["']renderer\.js/, "locked win-unpacked rebuild must retain the admin renderer checked by runtime sync");
  assert.equal(electronBuilder.files.includes("license-admin-gui/renderer.js"), true, "portable packaging must retain the admin renderer checked by runtime sync");
});
