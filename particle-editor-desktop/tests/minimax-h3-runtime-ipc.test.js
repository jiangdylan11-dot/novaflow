const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const mainSource = fs.readFileSync(path.join(root, "particle-editor-desktop", "main.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "particle-editor-desktop", "preload.js"), "utf8");
const lifecycleSource = fs.readFileSync(
  path.join(root, "particle-editor-desktop", "main", "minimax-h3-runtime-lifecycle.js"),
  "utf8",
);

const IPC_CONTRACT = Object.freeze([
  Object.freeze({
    channel: "minimax-h3-runtime-get-status",
    preloadMethod: "minimaxH3RuntimeGetStatus",
    lifecycleMethod: "getStatus",
  }),
  Object.freeze({
    channel: "minimax-h3-runtime-ensure-started",
    preloadMethod: "minimaxH3RuntimeEnsureStarted",
    lifecycleMethod: "start",
  }),
  Object.freeze({
    channel: "minimax-h3-runtime-stop",
    preloadMethod: "minimaxH3RuntimeStop",
    lifecycleMethod: "stop",
  }),
]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

function mainHandlerBlock(channel) {
  const marker = new RegExp(`ipcMain\\.handle\\(["']${escapeRegExp(channel)}["']`);
  const match = marker.exec(mainSource);
  assert.ok(match, `main must register ${channel}`);
  const nextHandler = mainSource.indexOf("\nipcMain.handle(", match.index + match[0].length);
  return mainSource.slice(match.index, nextHandler === -1 ? mainSource.length : nextHandler);
}

function preloadMethodLine(methodName) {
  const match = new RegExp(`^\\s*${escapeRegExp(methodName)}\\s*:.*$`, "m").exec(preloadSource);
  assert.ok(match, `preload must expose electronAPI.${methodName}`);
  return match[0];
}

test("main owns one dedicated MiniMax H3 lifecycle instance", () => {
  assert.match(
    mainSource,
    /const\s*\{\s*createMiniMaxH3RuntimeLifecycle\s*\}\s*=\s*require\(["']\.\/main\/minimax-h3-runtime-lifecycle["']\);/,
  );

  const creation = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*createMiniMaxH3RuntimeLifecycle\(\{[\s\S]*?\n\}\);/.exec(mainSource);
  assert.ok(creation, "main must create the dedicated MiniMax H3 lifecycle");
  assert.equal(
    countMatches(mainSource, /createMiniMaxH3RuntimeLifecycle\s*\(\s*\{/g),
    1,
    "main must create exactly one MiniMax H3 lifecycle",
  );
  assert.doesNotMatch(
    creation[0],
    /\b8188\b|novaFlowRuntimeStartCoordinator|getNovaFlowRuntimeStatus|ensureNovaFlowRuntimeStarted|stopNovaFlowRuntime/,
    "the H3 lifecycle instance must not reuse the primary 8188 lifecycle",
  );
});

test("main registers exactly the three MiniMax H3 runtime IPC handlers", () => {
  const lifecycleCreation = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*createMiniMaxH3RuntimeLifecycle\(\{[\s\S]*?\n\}\);/.exec(mainSource);
  assert.ok(lifecycleCreation, "main must create the MiniMax H3 lifecycle before registering IPC");
  const lifecycleVariable = lifecycleCreation[1];

  const registeredChannels = Array.from(
    mainSource.matchAll(/ipcMain\.handle\(["'](minimax-h3-runtime-[^"']+)["']/g),
    (match) => match[1],
  );
  assert.deepEqual(
    registeredChannels.sort(),
    IPC_CONTRACT.map(({ channel }) => channel).sort(),
    "main must expose no additional MiniMax H3 runtime IPC surface",
  );

  for (const { channel, lifecycleMethod } of IPC_CONTRACT) {
    assert.equal(
      countMatches(mainSource, new RegExp(`ipcMain\\.handle\\(["']${escapeRegExp(channel)}["']`, "g")),
      1,
      `${channel} must be registered exactly once`,
    );
    const handler = mainHandlerBlock(channel);
    assert.match(
      handler,
      new RegExp(`\\b${escapeRegExp(lifecycleVariable)}\\.${escapeRegExp(lifecycleMethod)}\\s*\\(`),
      `${channel} must dispatch to ${lifecycleVariable}.${lifecycleMethod}()`,
    );
    assert.doesNotMatch(
      handler,
      /\b8188\b|getNovaFlowRuntimeStatus|ensureNovaFlowRuntimeStarted|stopNovaFlowRuntime|clientAuth|authorizationToken|credit|comfyWorkflow/i,
      `${channel} must remain independent of the primary runtime, auth, and credit paths`,
    );
  }
});

test("preload exposes only the three matching MiniMax H3 electronAPI methods", () => {
  const exposedMethods = Array.from(
    preloadSource.matchAll(/^\s*(minimaxH3Runtime[A-Za-z0-9_$]+)\s*:/gm),
    (match) => match[1],
  );
  assert.deepEqual(
    exposedMethods.sort(),
    IPC_CONTRACT.map(({ preloadMethod }) => preloadMethod).sort(),
    "preload must add only the three approved MiniMax H3 runtime methods",
  );

  for (const { channel, preloadMethod } of IPC_CONTRACT) {
    const line = preloadMethodLine(preloadMethod);
    assert.match(
      line,
      new RegExp(
        `^\\s*${escapeRegExp(preloadMethod)}\\s*:\\s*\\(payload\\)\\s*=>\\s*ipcRenderer\\.invoke\\(["']${escapeRegExp(channel)}["'],\\s*payload\\),?\\s*$`,
      ),
      `electronAPI.${preloadMethod} must invoke only ${channel}`,
    );
    assert.doesNotMatch(
      line,
      /\b8188\b|clientAuth|authorizationToken|credit|comfyWorkflow/i,
      `electronAPI.${preloadMethod} must not add auth or credit coupling`,
    );
  }
});

test("the H3 runtime IPC path is fixed to 8189 and has no auth or credit dependency", () => {
  assert.match(lifecycleSource, /const\s+MINIMAX_H3_RUNTIME_PORT\s*=\s*8189\s*;/);
  assert.doesNotMatch(lifecycleSource, /\b8188\b/, "the dedicated H3 lifecycle must never target port 8188");

  const requiredModules = Array.from(
    lifecycleSource.matchAll(/require\(["']([^"']+)["']\)/g),
    (match) => match[1],
  );
  assert.equal(
    requiredModules.some((moduleName) => /credit|auth|license|account/i.test(moduleName)),
    false,
    "the H3 lifecycle must not depend on credit, authentication, licensing, or account modules",
  );

  const h3MainSurface = IPC_CONTRACT.map(({ channel }) => mainHandlerBlock(channel)).join("\n");
  const h3PreloadSurface = IPC_CONTRACT.map(({ preloadMethod }) => preloadMethodLine(preloadMethod)).join("\n");
  assert.doesNotMatch(
    `${h3MainSurface}\n${h3PreloadSurface}`,
    /\b8188\b|ipc(?:Main\.handle|Renderer\.invoke)\(["']runtime-(?:get-status|ensure-started|stop)["']|clientAuth|authorizationToken|credit|comfyWorkflow/i,
    "the H3 IPC bridge must not fall back to the 8188 runtime or consume auth/credit APIs",
  );
});

test("desktop graceful quit stops the dedicated H3 sidecar", () => {
  const start = mainSource.indexOf("async function runNovaFlowGracefulQuit(reason)");
  const end = mainSource.indexOf("\nfunction requestNovaFlowGracefulQuit(reason)", start);
  assert.ok(start >= 0 && end > start, "main must retain the graceful-quit lifecycle boundary");
  const block = mainSource.slice(start, end);
  assert.match(
    block,
    /miniMaxH3RuntimeLifecycle\.stop\(\{\s*timeoutMs:\s*20_000,\s*scriptTimeoutMs:\s*30_000\s*\}\)/,
    "graceful quit must stop the dedicated H3 Runtime with bounded timeouts",
  );
  assert.match(block, /await\s+miniMaxH3RuntimeStopPromise/);
  assert.match(block, /minimax-h3-runtime-stop-incomplete/);
});
