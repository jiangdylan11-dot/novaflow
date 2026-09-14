const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const lifecyclePath = path.join(root, "particle-editor-desktop", "main", "minimax-h3-runtime-lifecycle.js");
const templateRoot = path.join(root, "tools", "ai-runtime-h3", "templates");
const {
  MINIMAX_H3_RUNTIME_HOST,
  MINIMAX_H3_RUNTIME_PORT,
  resolveMiniMaxH3RuntimePaths,
  readMiniMaxH3RuntimeConfig,
  createMiniMaxH3RuntimeLifecycle,
  defaultRunCommand,
} = require(lifecyclePath);

function createInstalledRuntime() {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-h3-runtime-test-"));
  const scriptsDir = path.join(runtimeRoot, "scripts");
  const referenceDir = path.join(runtimeRoot, 'custom_nodes', 'novaflow_h3_reference');
  fs.mkdirSync(referenceDir, { recursive: true });
  fs.copyFileSync(path.join(root, 'particle-editor-desktop/main/h3-reference-nodes.py'), path.join(referenceDir, '__init__.py'));
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, "start-runtime.bat"), "@exit /b 0\n", "utf8");
  fs.writeFileSync(path.join(scriptsDir, "stop-runtime.bat"), "@exit /b 0\n", "utf8");
  fs.writeFileSync(path.join(runtimeRoot, "runtime.json"), JSON.stringify({
    name: "NovaFlow AI Runtime H3",
    version: "test",
    engine: "comfyui-core",
    host: "127.0.0.1",
    port: 8189,
    installPath: runtimeRoot,
    assetsPath: path.join(runtimeRoot, "assets"),
    modelsPath: path.join(runtimeRoot, "models"),
    customNodesPath: path.join(runtimeRoot, "custom_nodes"),
  }), "utf8");
  return runtimeRoot;
}

function createNeverClosingChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

test('H3 node update preserves active generations and leaves loaded code unchanged', async () => {
  const runtimeRoot = createInstalledRuntime();
  const target = path.join(runtimeRoot, 'custom_nodes/novaflow_h3_reference/__init__.py');
  try {
    fs.writeFileSync(target, 'previous node code');
    const lifecycle = createMiniMaxH3RuntimeLifecycle({ runtimeRoot,
      probe: async () => ({ ok: true }), processAlive: () => true,
      fetch: async () => ({ ok: true, json: async () => ({ queue_running: [['active job']], queue_pending: [] }) }),
      runCommand: async () => { throw new Error('must not stop active generation'); },
    });
    const result = await lifecycle.start();
    assert.equal(result.ok, false);
    assert.match(result.error, /正在生成/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'previous node code');
  } finally { fs.rmSync(runtimeRoot, { recursive: true, force: true }); }
});

test("H3 Runtime defaults are isolated under ProgramData and fixed to 127.0.0.1:8189", () => {
  const paths = resolveMiniMaxH3RuntimePaths({ programData: "C:\\ProgramData" });
  assert.equal(MINIMAX_H3_RUNTIME_HOST, "127.0.0.1");
  assert.equal(MINIMAX_H3_RUNTIME_PORT, 8189);
  assert.equal(paths.runtimeRoot, path.resolve("C:\\ProgramData", "NovaFlow", "AI-Runtime-H3"));
  assert.equal(paths.generatedPath, path.join(paths.runtimeRoot, "generated"));
  assert.equal(paths.outputPath, path.join(paths.runtimeRoot, "generated", "output"));
  assert.doesNotMatch(paths.generatedPath, /AI-Runtime[\\/]runtime-generated$/i);
});

test("H3 Runtime config rejects a shared or externally rebound listener", () => {
  const runtimeRoot = createInstalledRuntime();
  try {
    const valid = readMiniMaxH3RuntimeConfig({ runtimeRoot });
    assert.equal(valid.ok, true);
    assert.equal(valid.baseUrl, "http://127.0.0.1:8189");
    assert.equal(valid.generatedPath, path.join(runtimeRoot, "generated"));

    const configPath = path.join(runtimeRoot, "runtime.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.port = 8188;
    fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
    const invalidPort = readMiniMaxH3RuntimeConfig({ runtimeRoot });
    assert.equal(invalidPort.ok, false);
    assert.match(invalidPort.detail, /8189/);

    config.port = 8189;
    config.host = "0.0.0.0";
    fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
    const invalidHost = readMiniMaxH3RuntimeConfig({ runtimeRoot });
    assert.equal(invalidHost.ok, false);
    assert.match(invalidHost.detail, /127\.0\.0\.1/);

    config.host = "127.0.0.1";
    config.modelsPath = path.join(path.dirname(runtimeRoot), "shared-models");
    fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
    const sharedModels = readMiniMaxH3RuntimeConfig({ runtimeRoot });
    assert.equal(sharedModels.ok, false);
    assert.match(sharedModels.detail, /models_path_must_be_inside_h3_root/);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("H3 Runtime config prefers root scripts over legacy scripts directory copies", () => {
  const runtimeRoot = createInstalledRuntime();
  try {
    const rootStart = path.join(runtimeRoot, "start-runtime.bat");
    const rootStop = path.join(runtimeRoot, "stop-runtime.bat");
    fs.writeFileSync(rootStart, "@echo root-start\n", "utf8");
    fs.writeFileSync(rootStop, "@echo root-stop\n", "utf8");

    const rootPreferred = readMiniMaxH3RuntimeConfig({ runtimeRoot });
    assert.equal(rootPreferred.ok, true);
    assert.equal(rootPreferred.startScriptPath, rootStart);
    assert.equal(rootPreferred.stopScriptPath, rootStop);

    fs.unlinkSync(rootStart);
    fs.unlinkSync(rootStop);
    const legacyFallback = readMiniMaxH3RuntimeConfig({ runtimeRoot });
    assert.equal(legacyFallback.startScriptPath, path.join(runtimeRoot, "scripts", "start-runtime.bat"));
    assert.equal(legacyFallback.stopScriptPath, path.join(runtimeRoot, "scripts", "stop-runtime.bat"));
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("H3 Runtime config accepts a UTF-8 BOM written by Windows deployment tooling", () => {
  const runtimeRoot = createInstalledRuntime();
  try {
    const configPath = path.join(runtimeRoot, "runtime.json");
    const configText = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(configPath, `\uFEFF${configText}`, "utf8");
    const config = readMiniMaxH3RuntimeConfig({ runtimeRoot });
    assert.equal(config.ok, true);
    assert.equal(config.installPath, runtimeRoot);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("H3 command timeout and abort settle even when a child never emits close", async () => {
  const exitedChild = createNeverClosingChild(5100);
  const exitedPromise = defaultRunCommand("fake-runtime", [], {
    timeoutMs: 30_000,
    spawn: () => exitedChild,
    killProcessTree: () => assert.fail("an exited command must not be killed"),
  });
  setImmediate(() => exitedChild.emit("exit", 0));
  const exited = await exitedPromise;
  assert.equal(exited.ok, true);
  assert.equal(exited.code, 0);
  assert.equal(exited.timedOut, false);

  let timeoutKills = 0;
  const timeoutStartedAt = Date.now();
  const timedOut = await defaultRunCommand("fake-runtime", [], {
    timeoutMs: 1000,
    spawn: () => createNeverClosingChild(5101),
    killProcessTree: () => { timeoutKills += 1; },
  });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.aborted, false);
  assert.equal(timedOut.error, "runtime_command_timeout");
  assert.equal(timeoutKills, 1);
  assert.ok(Date.now() - timeoutStartedAt < 2500, "timeout must not wait for a missing close event");

  let abortKills = 0;
  const controller = new AbortController();
  const abortedPromise = defaultRunCommand("fake-runtime", [], {
    timeoutMs: 30_000,
    signal: controller.signal,
    spawn: () => createNeverClosingChild(5102),
    killProcessTree: () => { abortKills += 1; },
  });
  controller.abort();
  const aborted = await abortedPromise;
  assert.equal(aborted.ok, false);
  assert.equal(aborted.timedOut, false);
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.error, "runtime_command_aborted");
  assert.equal(abortKills, 1);
});

test("H3 lifecycle exposes status/start/stop and serializes commands through its generated lock", async () => {
  const runtimeRoot = createInstalledRuntime();
  let running = false;
  const commands = [];
  try {
    const lifecycle = createMiniMaxH3RuntimeLifecycle({
      runtimeRoot,
      processAlive: () => false,
      wait: async () => {},
      probe: async () => running ? { ok: true, data: { system: "h3" } } : { ok: false, error: "not_running" },
      runCommand: async (command, args, options) => {
        commands.push({ command, args, options });
        const script = String(args.at(-1) || "").toLowerCase();
        if (script.endsWith("start-runtime.bat")) running = true;
        if (script.endsWith("stop-runtime.bat")) running = false;
        return { ok: true, code: 0, stdout: "ok", stderr: "" };
      },
    });

    assert.equal(typeof lifecycle.status, "function");
    assert.equal(typeof lifecycle.getStatus, "function");
    assert.equal(typeof lifecycle.start, "function");
    assert.equal(typeof lifecycle.stop, "function");
    const initial = await lifecycle.status();
    assert.equal(initial.status, "stopped");

    const [first, second] = await Promise.all([lifecycle.start(), lifecycle.start()]);
    assert.equal(first.status, "running");
    assert.equal(second.status, "running");
    assert.equal(commands.length, 1, "concurrent starts must share one command");
    assert.equal(commands[0].options.env.NOVAFLOW_AI_RUNTIME_H3_GENERATED_DIR, path.join(runtimeRoot, "generated"));
    assert.equal(fs.existsSync(path.join(runtimeRoot, "generated", "runtime.start.lock")), false, "start lock must be released");

    const stopped = await lifecycle.stop();
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.stopped, true);
    assert.equal(commands.length, 2);
    assert.equal(commands[1].options.env.NOVAFLOW_AI_RUNTIME_H3_GENERATED_DIR, path.join(runtimeRoot, "generated"));
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("H3 start reuses only a healthy PID whose inspected command owns the isolated listener", async (t) => {
  const scenarios = [
    {
      name: "pid zero",
      pid: 0,
      alive: false,
      identity: null,
      reused: false,
    },
    {
      name: "dead pid",
      pid: 4101,
      alive: false,
      identity: {
        alive: false,
        verified: true,
        commandLine: "",
      },
      reused: false,
    },
    {
      name: "foreign pid",
      pid: 4102,
      alive: true,
      identity: {
        alive: true,
        verified: true,
        commandLine: '"C:\\OtherRuntime\\python.exe" "C:\\OtherRuntime\\main.py" --port 8189 --disable-api-nodes',
      },
      reused: false,
    },
    {
      name: "verified H3 pid",
      pid: 4103,
      alive: true,
      identity: "owned",
      reused: true,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const runtimeRoot = createInstalledRuntime();
      let commandCount = 0;
      let inspectCount = 0;
      try {
        const generatedPath = path.join(runtimeRoot, "generated");
        fs.mkdirSync(generatedPath, { recursive: true });
        fs.writeFileSync(path.join(generatedPath, "runtime.pid"), String(scenario.pid), "utf8");
        const ownedCommandLine = [
          '"C:\\Program Files\\Python\\python.exe"',
          `"${path.join(runtimeRoot, "engine", "ComfyUI", "main.py")}"`,
          "--listen 127.0.0.1",
          "--port 8189",
          "--disable-api-nodes",
        ].join(" ");
        const lifecycle = createMiniMaxH3RuntimeLifecycle({
          runtimeRoot,
          processAlive: (pid) => Number(pid) === scenario.pid && scenario.alive,
          inspectProcess: async () => {
            inspectCount += 1;
            return scenario.identity === "owned"
              ? { alive: true, verified: true, commandLine: ownedCommandLine }
              : scenario.identity;
          },
          probe: async () => ({ ok: true, data: { system: "healthy-listener" } }),
          wait: async () => {},
          runCommand: async () => {
            commandCount += 1;
            return { ok: false, code: 1, stdout: "", stderr: "Port 8189 belongs to another process" };
          },
        });

        const result = await lifecycle.start();
        if (scenario.reused) {
          assert.equal(result.status, "running");
          assert.equal(result.reused, true);
          assert.equal(commandCount, 0, "a verified H3 listener must not invoke the start script");
          assert.equal(inspectCount, 1);
        } else {
          assert.equal(result.status, "error");
          assert.equal(result.reused, false);
          assert.equal(commandCount, 1, "an unverified healthy listener must be delegated to the rejecting start script");
          assert.equal(inspectCount, scenario.alive && scenario.pid > 0 ? 2 : 0);
        }
      } finally {
        fs.rmSync(runtimeRoot, { recursive: true, force: true });
      }
    });
  }
});

test("H3 templates bind locally, isolate generated files, disable API nodes, and permit CORS", () => {
  const runtime = JSON.parse(fs.readFileSync(path.join(templateRoot, "runtime.json"), "utf8"));
  const start = fs.readFileSync(path.join(templateRoot, "start-runtime.bat"), "utf8");
  const stop = fs.readFileSync(path.join(templateRoot, "stop-runtime.bat"), "utf8");

  assert.equal(runtime.port, 8189);
  assert.equal(runtime.host, "127.0.0.1");
  assert.equal(runtime.installPath, "C:\\ProgramData\\NovaFlow\\AI-Runtime-H3");
  assert.equal(runtime.generatedPath, "C:\\ProgramData\\NovaFlow\\AI-Runtime-H3\\generated");
  assert.match(start, /NOVAFLOW_AI_RUNTIME_H3_GENERATED_DIR/);
  assert.match(start, /--listen','127\.0\.0\.1'/);
  assert.match(start, /--port',\[string\]\$port/);
  assert.match(start, /--disable-api-nodes/);
  assert.match(start, /--enable-cors-header/);
  assert.match(start, /Quote-Arg '\*'/);
  assert.match(start, /Start-Process -FilePath \$env:PYTHON_EXE/);
  assert.match(start, /-RedirectStandardOutput \$stdout/);
  assert.match(start, /-RedirectStandardError \$stderr/);
  assert.match(start, /Archive-PreviousLog \$stdout/);
  assert.doesNotMatch(start, /Start-Process -FilePath \$env:ComSpec/);
  assert.doesNotMatch(start, /\$cmdLine=/);
  assert.match(start, /Join-Path \$assets 'custom_nodes'/);
  assert.match(start, /Join-Path \$env:COMFY_DIR 'user'/);
  assert.doesNotMatch(start, /--listen','0\.0\.0\.0'/);
  assert.match(stop, /--disable-api-nodes/);
  assert.match(stop, /--port\\s\+' \+ \$port/);
  assert.doesNotMatch(stop, /if \(-not \$targetPid\) \{ \$targetPid=\$pidValue \}/);
});

test("H3 waits for an owned process that is importing before its port opens", async () => {
  const runtimeRoot = createInstalledRuntime();
  try {
    fs.mkdirSync(path.join(runtimeRoot, "generated"), { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, "generated", "runtime.pid"), "4103");
    let probes = 0;
    const lifecycle = createMiniMaxH3RuntimeLifecycle({
      runtimeRoot,
      processAlive: () => true,
      inspectProcess: async () => ({ alive: true, verified: true,
        commandLine: `python.exe "${path.join(runtimeRoot, 'engine', 'ComfyUI', 'main.py')}" --port 8189 --disable-api-nodes` }),
      probe: async () => ({ ok: ++probes >= 4 }),
      wait: async () => {},
      runCommand: async () => assert.fail("must not relaunch Python or rotate its open logs"),
    });
    const result = await lifecycle.start();
    assert.equal(result.running, true);
    assert.equal(result.reused, true);
    assert.equal(result.pid, 4103);
    assert.equal(probes, 4);
  } finally { fs.rmSync(runtimeRoot, { recursive: true, force: true }); }
});

test("H3 log rotation uses a fresh log when Windows holds the previous file open", { skip: process.platform !== 'win32' }, () => {
  const { spawnSync } = require('node:child_process');
  const runtimeRoot = createInstalledRuntime();
  try {
    const start = fs.readFileSync(path.join(templateRoot, 'start-runtime.bat'), 'utf8');
    const rotation = start.match(/function Archive-PreviousLog.*?(?= }; \$stdout=)/)[0] + ' }';
    const script = `
$ErrorActionPreference='Stop'
$env:LOG_DIR=$env:NOVAFLOW_TEST_LOG_DIR
$archiveDir=Join-Path $env:LOG_DIR 'archive'
New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
$runId='test'
${rotation}
$source=Join-Path $env:LOG_DIR 'runtime.out.log'
[IO.File]::WriteAllText($source,'previous diagnostic')
$handle=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
try { $launch=Archive-PreviousLog $source; if ($launch -eq $source) { throw 'locked source reused' }; [IO.File]::WriteAllText($launch,'new diagnostic') } finally { $handle.Dispose() }
if ([IO.File]::ReadAllText($source) -ne 'previous diagnostic') { throw 'previous log lost' }
if ((Archive-PreviousLog $source) -ne $source) { throw 'unlocked log not archived' }
if (Test-Path -LiteralPath $source) { throw 'source still present' }
Write-Output 'PASS: locked log preserved, fresh log writable, unlocked log archived'
`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, encoding: 'utf8', env: { ...process.env, NOVAFLOW_TEST_LOG_DIR: runtimeRoot }, timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PASS/);
  } finally { fs.rmSync(runtimeRoot, { recursive: true, force: true }); }
});
