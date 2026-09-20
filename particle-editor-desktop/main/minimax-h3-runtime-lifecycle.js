const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { createRuntimeStartCoordinator } = require("./runtime-lifecycle");

const MINIMAX_H3_RUNTIME_NAME = "NovaFlow AI Runtime H3";
const MINIMAX_H3_RUNTIME_HOST = "127.0.0.1";
const MINIMAX_H3_RUNTIME_PORT = 8189;

// Node packages the app deploys into the H3 runtime's custom_nodes on start.
// novaflow_h3_v2v is what lets AI 特效 sample from the source clip instead of
// from noise; without it the panel's workflow will not even validate.
const H3_SHIPPED_NODE_PACKAGES = Object.freeze([
  ['h3-reference-nodes.py', 'novaflow_h3_reference'],
  ['h3-v2v-nodes.py', 'novaflow_h3_v2v'],
]);
const MINIMAX_H3_RUNTIME_DIR_PARTS = Object.freeze(["NovaFlow", "AI-Runtime-H3"]);
const MINIMAX_H3_RUNTIME_GENERATED_DIR_NAME = "generated";

function defaultProcessAlive(pid) {
  const processId = Math.max(0, Math.round(Number(pid) || 0));
  if (!processId) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function trimCommandOutput(value, limit = 64 * 1024) {
  const text = String(value || "");
  return text.length <= limit ? text : text.slice(text.length - limit);
}

function defaultKillProcessTree(child) {
  if (!child) return;
  const processId = Math.max(0, Math.round(Number(child.pid) || 0));
  if (process.platform === "win32" && processId) {
    try {
      const killer = spawn("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
        windowsHide: true,
        shell: false,
        stdio: "ignore",
      });
      killer.unref?.();
      return;
    } catch { void 0; }
  }
  try { child.kill(process.platform === "win32" ? undefined : "SIGKILL"); } catch { void 0; }
}

function defaultRunCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const spawnProcess = typeof options.spawn === "function" ? options.spawn : spawn;
    const killProcessTree = typeof options.killProcessTree === "function" ? options.killProcessTree : defaultKillProcessTree;
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let child = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { options.signal?.removeEventListener?.("abort", onAbort); } catch { void 0; }
      resolve({
        ok: result.ok === true,
        code: Number(result.code) || 0,
        timedOut,
        aborted,
        stdout: trimCommandOutput(stdout),
        stderr: trimCommandOutput(stderr),
        error: String(result.error || ""),
      });
    };

    const terminateAndFinish = (error) => {
      if (settled) return;
      try { killProcessTree(child); } catch { void 0; }
      finish({ ok: false, error });
    };
    const onAbort = () => {
      aborted = true;
      terminateAndFinish("runtime_command_aborted");
    };
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30_000);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateAndFinish("runtime_command_timeout");
    }, timeoutMs);
    timeout.unref?.();

    if (options.signal?.aborted) {
      aborted = true;
      finish({ ok: false, error: "runtime_command_aborted" });
      return;
    }

    try {
      child = spawnProcess(command, Array.isArray(args) ? args : [], {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      finish({ ok: false, error: error?.message || error });
      return;
    }

    options.signal?.addEventListener?.("abort", onAbort, { once: true });
    child.stdout?.on?.("data", (chunk) => { stdout = trimCommandOutput(stdout + String(chunk || "")); });
    child.stderr?.on?.("data", (chunk) => { stderr = trimCommandOutput(stderr + String(chunk || "")); });
    child.once("error", (error) => finish({ ok: false, error: error?.message || error }));
    const finishFromExit = (code) => finish({
      ok: !timedOut && !aborted && Number(code || 0) === 0,
      code,
      error: timedOut ? "runtime_command_timeout" : aborted ? "runtime_command_aborted" : "",
    });
    child.once("exit", finishFromExit);
    child.once("close", finishFromExit);
  });
}

function resolveMiniMaxH3RuntimePaths(options = {}) {
  const pathApi = options.path || path;
  const env = options.env || process.env;
  const programData = String(options.programData || env.ProgramData || "C:\\ProgramData").trim() || "C:\\ProgramData";
  const runtimeRoot = pathApi.resolve(String(options.runtimeRoot || pathApi.join(programData, ...MINIMAX_H3_RUNTIME_DIR_PARTS)));
  const generatedPath = pathApi.resolve(String(options.generatedPath || pathApi.join(runtimeRoot, MINIMAX_H3_RUNTIME_GENERATED_DIR_NAME)));
  return Object.freeze({
    runtimeRoot,
    runtimeJsonPath: pathApi.join(runtimeRoot, "runtime.json"),
    generatedPath,
    inputPath: pathApi.join(generatedPath, "input"),
    outputPath: pathApi.join(generatedPath, "output"),
    tempPath: pathApi.join(generatedPath, "temp-root"),
    userPath: pathApi.join(generatedPath, "user"),
    pidPath: pathApi.join(generatedPath, "runtime.pid"),
    logsPath: pathApi.join(runtimeRoot, "logs"),
  });
}

function findRuntimeScript(fsApi, pathApi, installPath, fileName) {
  const candidates = [
    pathApi.join(installPath, fileName),
    pathApi.join(installPath, "scripts", fileName),
    pathApi.join(installPath, "bin", fileName),
  ];
  return candidates.find((candidate) => {
    try { return fsApi.existsSync(candidate); } catch { return false; }
  }) || candidates[0];
}

function isSameOrInsidePath(pathApi, targetPath, rootPath) {
  const target = pathApi.resolve(String(targetPath || ""));
  const root = pathApi.resolve(String(rootPath || ""));
  const relative = pathApi.relative(root, target);
  return relative === "" || (!!relative && !relative.startsWith("..") && !pathApi.isAbsolute(relative));
}

function readMiniMaxH3RuntimeConfig(options = {}) {
  const fsApi = options.fs || fs;
  const pathApi = options.path || path;
  const paths = resolveMiniMaxH3RuntimePaths(options);
  const base = {
    name: MINIMAX_H3_RUNTIME_NAME,
    port: MINIMAX_H3_RUNTIME_PORT,
    host: MINIMAX_H3_RUNTIME_HOST,
    baseUrl: `http://${MINIMAX_H3_RUNTIME_HOST}:${MINIMAX_H3_RUNTIME_PORT}`,
    ...paths,
    installPath: paths.runtimeRoot,
  };
  if (!fsApi.existsSync(paths.runtimeJsonPath)) {
    return { ...base, ok: false, installed: false, status: "missing", error: "runtime_json_missing" };
  }

  try {
    const rawConfig = String(fsApi.readFileSync(paths.runtimeJsonPath, "utf8") || "").replace(/^\uFEFF/, "");
    const data = JSON.parse(rawConfig);
    const configuredPort = Math.round(Number(data.port) || 0);
    const configuredHost = String(data.host || data.listenHost || MINIMAX_H3_RUNTIME_HOST).trim();
    if (configuredPort !== MINIMAX_H3_RUNTIME_PORT) throw new Error("runtime_port_must_be_8189");
    if (configuredHost !== MINIMAX_H3_RUNTIME_HOST) throw new Error("runtime_host_must_be_127.0.0.1");
    const installPath = pathApi.resolve(String(data.installPath || paths.runtimeRoot));
    const assetsPath = pathApi.resolve(String(data.assetsPath || pathApi.join(installPath, "assets")));
    const modelsPath = pathApi.resolve(String(data.modelsPath || pathApi.join(installPath, "models")));
    const customNodesPath = pathApi.resolve(String(data.customNodesPath || pathApi.join(installPath, "custom_nodes")));
    if (installPath.toLowerCase() !== paths.runtimeRoot.toLowerCase()) throw new Error("runtime_install_path_must_match_h3_root");
    if (!isSameOrInsidePath(pathApi, assetsPath, installPath)) throw new Error("runtime_assets_path_must_be_inside_h3_root");
    if (!isSameOrInsidePath(pathApi, modelsPath, installPath)) throw new Error("runtime_models_path_must_be_inside_h3_root");
    if (!isSameOrInsidePath(pathApi, customNodesPath, installPath)) throw new Error("runtime_custom_nodes_path_must_be_inside_h3_root");
    return {
      ...base,
      ok: true,
      installed: true,
      status: "installed",
      name: String(data.name || MINIMAX_H3_RUNTIME_NAME),
      version: String(data.version || ""),
      engine: String(data.engine || "comfyui-core"),
      installPath,
      assetsPath,
      modelsPath,
      customNodesPath,
      startScriptPath: findRuntimeScript(fsApi, pathApi, installPath, "start-runtime.bat"),
      stopScriptPath: findRuntimeScript(fsApi, pathApi, installPath, "stop-runtime.bat"),
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      installed: true,
      status: "invalid",
      error: "runtime_json_invalid",
      detail: String(error?.message || error),
    };
  }
}

function readRuntimePid(fsApi, config) {
  try {
    const text = String(fsApi.readFileSync(config.pidPath, "utf8") || "").trim();
    return /^\d+$/.test(text) ? Number(text) || 0 : 0;
  } catch {
    return 0;
  }
}

function commandLineOwnsMiniMaxH3Runtime(pathApi, config, commandLine) {
  const normalizedCommandLine = String(commandLine || "").trim().replace(/\//g, "\\").toLowerCase();
  if (!normalizedCommandLine) return false;
  const expectedMain = pathApi.join(config.installPath, "engine", "ComfyUI", "main.py")
    .replace(/\//g, "\\")
    .toLowerCase();
  return normalizedCommandLine.includes(expectedMain)
    && /(?:^|\s)--port(?:\s+|=)8189(?:\s|$)/i.test(normalizedCommandLine)
    && /(?:^|\s)--disable-api-nodes(?:\s|$)/i.test(normalizedCommandLine);
}

async function defaultProbe(baseUrl, timeoutMs = 2500, externalSignal = null) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener?.("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || 2500));
  timeout.unref?.();
  try {
    const response = await fetch(`${String(baseUrl).replace(/\/$/, "")}/system_stats`, {
      method: "GET",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, error: `HTTP ${response.status}`, raw: text };
    try {
      return { ok: true, status: response.status, data: JSON.parse(text) };
    } catch {
      return { ok: false, status: response.status, error: "invalid_json", raw: text };
    }
  } catch (error) {
    return { ok: false, error: error?.name === "AbortError" ? "timeout" : String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
    try { externalSignal?.removeEventListener?.("abort", onAbort); } catch { void 0; }
  }
}

function createMiniMaxH3RuntimeLifecycle(options = {}) {
  const fsApi = options.fs || fs;
  const pathApi = options.path || path;
  const processAlive = typeof options.processAlive === "function" ? options.processAlive : defaultProcessAlive;
  const inspectProcess = typeof options.inspectProcess === "function" ? options.inspectProcess : null;
  const probe = typeof options.probe === "function" ? options.probe : defaultProbe;
  const runCommand = typeof options.runCommand === "function"
    ? options.runCommand
    : (command, args, commandOptions) => defaultRunCommand(command, args, {
      ...commandOptions,
      spawn: options.spawn,
      killProcessTree: options.killProcessTree,
    });
  const wait = typeof options.wait === "function"
    ? options.wait
    : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
  const configOptions = {
    fs: fsApi,
    path: pathApi,
    env: options.env || process.env,
    programData: options.programData,
    runtimeRoot: options.runtimeRoot,
    generatedPath: options.generatedPath,
  };
  const coordinator = options.startCoordinator || createRuntimeStartCoordinator({
    fs: fsApi,
    path: pathApi,
    processAlive,
    inspectProcess: options.inspectProcess,
    processId: options.processId,
    processStartedAt: options.processStartedAt,
    executablePath: options.executablePath,
    now: options.now,
    wait,
  });
  let startPromise = null;
  let startAbortController = null;
  let lastStatus = null;

  const publish = (status) => {
    lastStatus = Object.freeze({ ...status });
    try { options.onStatus?.(lastStatus); } catch { void 0; }
    return lastStatus;
  };

  const readConfig = () => readMiniMaxH3RuntimeConfig(configOptions);

  async function canReuseRuntimeProcess(config, status) {
    if ((!status?.running && !status?.processRunning) || !inspectProcess) return false;
    const pid = readRuntimePid(fsApi, config);
    if (!pid || !processAlive(pid)) return false;
    try {
      const identity = await inspectProcess(pid);
      return identity?.alive !== false
        && identity?.verified === true
        && commandLineOwnsMiniMaxH3Runtime(pathApi, config, identity.commandLine);
    } catch {
      return false;
    }
  }

  async function getStatus(statusOptions = {}) {
    const config = readConfig();
    if (!config.ok || !config.installed) {
      return publish({ ...config, running: false, connected: false, processRunning: false });
    }
    const pid = readRuntimePid(fsApi, config);
    const processRunning = processAlive(pid);
    if (statusOptions.probe === false) {
      return publish({
        ...config,
        status: processRunning ? "starting" : "stopped",
        running: false,
        connected: false,
        processRunning,
        pid,
      });
    }
    const health = await probe(config.baseUrl, Number(statusOptions.timeoutMs) || 2500, statusOptions.signal || null);
    return publish({
      ...config,
      status: health?.ok ? "running" : processRunning ? "starting" : "stopped",
      running: health?.ok === true,
      connected: health?.ok === true,
      processRunning: health?.ok === true || processRunning,
      pid,
      health: health?.ok ? { ok: true } : { ok: false, error: health?.error || "not_running", status: Number(health?.status) || 0 },
      systemStats: health?.ok ? health.data : null,
    });
  }

  async function waitForState(config, wantedRunning, timeoutMs, signal = null) {
    const startedAt = Date.now();
    let lastProbe = null;
    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) return { ok: false, aborted: true, error: "runtime_start_aborted" };
      lastProbe = await probe(config.baseUrl, 1500, signal);
      if ((lastProbe?.ok === true) === wantedRunning) return { ok: true, probe: lastProbe };
      await wait(250);
    }
    return { ok: false, error: wantedRunning ? "runtime_health_timeout" : "runtime_port_still_listening", probe: lastProbe };
  }

  async function start(startOptions = {}) {
    if (startPromise) return startPromise;
    const abortController = new AbortController();
    startAbortController = abortController;
    const signal = abortController.signal;
    const promise = (async () => {
      const config = readConfig();
      if (!config.ok || !config.installed) return publish({ ...config, running: false, connected: false });
      // Ship node code with the app, not as an untracked runtime patch. A
      // running engine must reload changed node code before reuse, so collect
      // every stale package first and stop the runtime once for the whole set.
      const pending = [];
      for (const [fileName, packageName] of H3_SHIPPED_NODE_PACKAGES) {
        const source = pathApi.join(__dirname, fileName);
        if (!fsApi.existsSync(source)) continue;
        const target = pathApi.join(config.customNodesPath, packageName, '__init__.py');
        const sourceCode = fsApi.readFileSync(source, 'utf8');
        const previousCode = fsApi.existsSync(target) ? fsApi.readFileSync(target, 'utf8') : '';
        if (sourceCode !== previousCode) pending.push({ target, sourceCode });
      }
      if (pending.length) {
        const before = await getStatus({ timeoutMs: 1200 });
        if (before.running) {
          const response = await (options.fetch || fetch)(config.baseUrl + '/queue', { signal: AbortSignal.timeout(3000) });
          if (!response.ok) throw new Error('H3 node update could not check the active queue');
          const queue = await response.json();
          if (queue.queue_running?.length || queue.queue_pending?.length) {
            return publish({ ...before, ok: false, error: 'H3 正在生成，完成后再次生成即可加载节点更新' });
          }
          const stopped = await stopRuntime();
          if (!stopped.ok) return stopped;
        } else if (before.processRunning) {
          return publish({ ...before, ok: false, error: 'H3 正在启动，请就绪后再次生成以加载节点更新' });
        }
        for (const { target, sourceCode } of pending) {
          fsApi.mkdirSync(pathApi.dirname(target), { recursive: true });
          fsApi.writeFileSync(target, sourceCode, 'utf8');
        }
      }
      const current = await getStatus({ timeoutMs: 1200 });
      if (current.running && await canReuseRuntimeProcess(config, current)) return publish({ ...current, reused: true });
      if (!fsApi.existsSync(config.startScriptPath)) {
        return publish({ ...config, ok: false, status: "error", running: false, connected: false, error: "start_script_missing" });
      }
      try {
        return await coordinator.withStartLock(config.generatedPath, async (lock) => {
          const lockedCurrent = await getStatus({ timeoutMs: 1200 });
          if (await canReuseRuntimeProcess(config, lockedCurrent)) {
            if (lockedCurrent.running) return publish({ ...lockedCurrent, reused: true });
            // Python may still be importing models before opening 8189. It already owns
            // the log handles: wait for this verified process instead of launching again.
            const ready = await waitForState(config, true, Math.max(1000, Number(startOptions.timeoutMs) || 120_000), signal);
            const currentStatus = await getStatus({ probe: false });
            const running = ready.ok && !signal.aborted;
            const starting = !signal.aborted && !running && currentStatus.processRunning;
            return publish({
              ...currentStatus, ok: running || starting, reused: true,
              status: running ? "running" : starting ? "starting" : signal.aborted ? "stopped" : "error",
              running, connected: running,
              error: running || starting ? "" : signal.aborted ? "runtime_start_aborted" : ready.error,
            });
          }
          if (signal.aborted) return publish({ ...config, ok: false, status: "stopped", running: false, connected: false, error: "runtime_start_aborted" });
          lock.assertOwned();
          publish({ ...config, ok: true, status: "starting", running: false, connected: false, processRunning: lockedCurrent.processRunning === true, error: "" });
          const command = String(options.command || process.env.ComSpec || "cmd.exe");
          const script = await runCommand(command, ["/d", "/c", config.startScriptPath], {
            cwd: path.dirname(config.startScriptPath),
            env: {
              ...process.env,
              ...(options.env || {}),
              NOVAFLOW_AI_RUNTIME_H3_GENERATED_DIR: config.generatedPath,
            },
            timeoutMs: Math.max(1000, Number(startOptions.scriptTimeoutMs) || 30_000),
            signal,
          });
          lock.assertOwned();
          const ready = await waitForState(config, true, Math.max(1000, Number(startOptions.timeoutMs) || 120_000), signal);
          const pid = readRuntimePid(fsApi, config);
          const readyFromSuccessfulScript = ready.ok && script?.ok === true;
          const processRunning = readyFromSuccessfulScript || processAlive(pid);
          const aborted = signal.aborted || script?.aborted || ready?.aborted;
          const stillStarting = !aborted && !ready.ok && processRunning && (script?.ok || script?.timedOut);
          return publish({
            ...config,
            ok: readyFromSuccessfulScript || stillStarting,
            status: readyFromSuccessfulScript ? "running" : stillStarting ? "starting" : aborted ? "stopped" : "error",
            running: readyFromSuccessfulScript,
            connected: readyFromSuccessfulScript,
            processRunning,
            pid,
            reused: false,
            script,
            health: readyFromSuccessfulScript ? { ok: true } : { ok: false, error: ready.error || script?.error || "runtime_start_failed" },
            error: readyFromSuccessfulScript || stillStarting ? "" : aborted ? "runtime_start_aborted" : (ready.error || script?.error || script?.stderr || "runtime_start_failed"),
          });
        }, {
          timeoutMs: Math.max(1000, Number(startOptions.lockTimeoutMs) || 150_000),
          signal,
        });
      } catch (error) {
        return publish({
          ...config,
          ok: false,
          status: signal.aborted ? "stopped" : "error",
          running: false,
          connected: false,
          error: signal.aborted ? "runtime_start_aborted" : String(error?.code || error?.message || error),
        });
      }
    })();
    startPromise = promise;
    try {
      return await promise;
    } finally {
      if (startPromise === promise) startPromise = null;
      if (startAbortController === abortController) startAbortController = null;
    }
  }

  async function stop(stopOptions = {}) {
    try { startAbortController?.abort(); } catch { void 0; }
    if (startPromise) {
      try { await startPromise; } catch { void 0; }
    }
    return stopRuntime(stopOptions);
  }

  async function stopRuntime(stopOptions = {}) {
    const config = readConfig();
    if (!config.ok || !config.installed) return publish({ ...config, running: false, connected: false, stopped: false });
    if (!fsApi.existsSync(config.stopScriptPath)) {
      return publish({ ...config, ok: false, status: "error", running: false, connected: false, stopped: false, error: "stop_script_missing" });
    }
    try {
      return await coordinator.withStartLock(config.generatedPath, async (lock) => {
        lock.assertOwned();
        const command = String(options.command || process.env.ComSpec || "cmd.exe");
        const script = await runCommand(command, ["/d", "/c", config.stopScriptPath], {
          cwd: path.dirname(config.stopScriptPath),
          env: {
            ...process.env,
            ...(options.env || {}),
            NOVAFLOW_AI_RUNTIME_H3_GENERATED_DIR: config.generatedPath,
          },
          timeoutMs: Math.max(1000, Number(stopOptions.scriptTimeoutMs) || 30_000),
        });
        lock.assertOwned();
        const released = await waitForState(config, false, Math.max(1000, Number(stopOptions.timeoutMs) || 20_000));
        return publish({
          ...config,
          ok: script?.ok === true && released.ok,
          status: released.ok ? "stopped" : "error",
          running: !released.ok,
          connected: !released.ok,
          processRunning: !released.ok,
          stopped: released.ok,
          script,
          error: released.ok ? "" : (released.error || script?.error || script?.stderr || "runtime_stop_failed"),
        });
      }, { timeoutMs: Math.max(1000, Number(stopOptions.lockTimeoutMs) || 45_000) });
    } catch (error) {
      return publish({
        ...config,
        ok: false,
        status: "error",
        running: true,
        connected: false,
        stopped: false,
        error: String(error?.code || error?.message || error),
      });
    }
  }

  return Object.freeze({
    readConfig,
    getStatus,
    status: getStatus,
    start,
    stop,
    getLastStatus: () => lastStatus,
  });
}

module.exports = {
  MINIMAX_H3_RUNTIME_NAME,
  MINIMAX_H3_RUNTIME_HOST,
  MINIMAX_H3_RUNTIME_PORT,
  resolveMiniMaxH3RuntimePaths,
  readMiniMaxH3RuntimeConfig,
  createMiniMaxH3RuntimeLifecycle,
  defaultRunCommand,
};
