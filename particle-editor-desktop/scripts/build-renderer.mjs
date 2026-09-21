import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const lockedRuntimeUrl = "http://127.0.0.1:4783/";

const args = new Set(process.argv.slice(2));
const mode = args.has("--dev")
  ? "dev"
  : args.has("--dev:renderer")
    ? "dev:renderer"
    : args.has("--dev:electron")
      ? "dev:electron"
      : "build";

if (mode !== "build") {
  console.error(`Entry locked: the only accepted runtime is ${lockedRuntimeUrl}`);
  console.error("Do not use build-renderer dev modes for validation or day-to-day editing.");
  console.error("Code changes must be verified against the live 4783 runtime chain.");
  process.exit(1);
}

const desktopDir = path.resolve(__dirname, "..");
const workspaceDir = path.resolve(desktopDir, "..");

function findRendererDir() {
  const candidates = [];
  const fromEnv = process.env.PARTICLE_EDITOR_RENDERER_DIR;
  if (fromEnv) {
    candidates.push(path.isAbsolute(fromEnv) ? fromEnv : path.resolve(desktopDir, fromEnv));
  }
  candidates.push(path.join(workspaceDir, "particle-editor"));
  candidates.push(path.join(workspaceDir, "translater", "particle-editor"));

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  }

  return null;
}

const desktopRenderer = path.join(desktopDir, "renderer");
const lockedRuntimeApp = path.join(desktopDir, "dist", "win-unpacked", "resources", "app");
const lockedRuntimeRenderer = path.join(desktopDir, "dist", "win-unpacked", "resources", "app", "renderer");
const defaultDevServerUrl = process.env.PARTICLE_EDITOR_DEV_SERVER_URL || lockedRuntimeUrl;
const copyDirScript = path.join(desktopDir, "scripts", "copy-dir.mjs");
const desktopAppShellFiles = [
  "main.js",
  "preload.js",
  "client-auth-direct.js",
  path.join("license-admin-gui", "admin-data.js"),
  path.join("license-admin-gui", "renderer.js")
];
const desktopAppShellDirs = ["admin-server", "main"];
const runtimeShellFiles = [
  "ui-render-trace.js",
  "comfyui-workflow-credit-cost.js",
  "art-generate-model.resource.js",
  "art-generate-lora.js",
  "art-generate-ideogram.workflow.js",
  "art-generate-provider.workflow.js",
  "art-generate-mode.tool.js",
  "art-generate-credit-pricing.tool.js",
  "art-generate-reference-drop.tool.js",
  "smart-ai-art-auto-intent.workflow.js",
  "runtime-fetch-proxy.js",
  "ai-sequence-frame-mode.js",
  "ai-sequence-minimax-h3.resource.js",
  "ai-sequence-minimax-h3-output.resource.js",
  "h3-prompt-format.js",
  "ai-sequence-minimax-h3-prompt.workflow.js",
  "ai-sequence-minimax-h3-reverse.workflow.js",
  "ai-sequence-minimax-h3.workflow.js",
  "ai-sequence-outpaint.workflow.js",
  "ai-sequence-credit-pricing.js",
  "proxy-electron-api.js",
  "runtime-detect-stabilizer.js",
  "spine-official-runtime.js",
  "ai-background-removal-runtime.js",
  "png-remove-black.tool.js",
  "spine-atlas-webp.tool.js",
  "mp4-compress.tool.js",
  "video-format-convert.tool.js",
  "spine-auto-mesh-core.js",
  "spine-auto-mesh.js",
  "spine-auto-mesh-attach.js",
  "spine-auto-bones.js",
  "spine-auto-weights.js",
  "spine-auto-weights.editor.js",
  "spine-bones.editor.js",
  "spine-auto-mesh.editor.js",
  "spine-auto-mesh.panel.js",
  "spine-auto-mesh.picker.js",
  "ai-sequence-green-screen-matting.js",
  "ai-sequence-matting-worker.js",
  "ai-sequence-cutout-pipeline.js",
  "ai-sequence-state-machine-runtime.js",
  "ai-sequence-video-merge.resource.js",
  "ai-sequence-video-merge.resource-bridge.js",
  "ai-sequence-video-merge.mask.tool.js",
  "ai-sequence-video-merge.preview.js",
  "ai-sequence-video-merge-export.workflow.js",
  "ai-sequence-video-merge.workspace.js",
  "ai-sequence-video-merge.tool.js",
  "split-inpaint-nsfw-pixels.helper.js",
  "split-inpaint-nsfw.workflow.js",
  "spine-split-runtime.js",
  "aifx-repaint-runtime.js",
  "aifx-v3-bridge.js",
  "ribbon-event-markers.js",
  "primary-entry-transition.preview.js",
  "primary-entry-transition.bridge.js",
  "novaflow-brand-runtime.js",
  "novaflow-source-upload-island-bridge.js",
  "novaflow-client-auth.js",
  "aifx-dom-prune.js",
  "aifx-inline-v4.js",
  "favicon.svg",
  "icons.svg",
  "robots.txt",
  "RUNTIME_SHELL_MANIFEST.md",
  "PROJECT_ENTRY_LOCK.md"
];
const runtimeShellDirs = ["aifx-v3", "assets", "debug-assets", "templates", "vendor"];
const requiredRuntimeShellFiles = new Set([
  "art-generate-ideogram.workflow.js",
  "art-generate-reference-drop.tool.js",
  "smart-ai-art-auto-intent.workflow.js",
  "split-inpaint-nsfw-pixels.helper.js",
  "split-inpaint-nsfw.workflow.js",
  "spine-split-runtime.js",
  "ai-background-removal-runtime.js",
  "png-remove-black.tool.js",
  "spine-atlas-webp.tool.js",
  "mp4-compress.tool.js",
  "video-format-convert.tool.js",
  "spine-auto-mesh-core.js",
  "spine-auto-mesh.js",
  "spine-auto-mesh-attach.js",
  "spine-auto-bones.js",
  "spine-auto-weights.js",
  "spine-auto-weights.editor.js",
  "spine-bones.editor.js",
  "spine-auto-mesh.editor.js",
  "spine-auto-mesh.panel.js",
  "spine-auto-mesh.picker.js",
  "ai-sequence-green-screen-matting.js",
  "ai-sequence-matting-worker.js",
  "ai-sequence-cutout-pipeline.js",
  "ai-sequence-state-machine-runtime.js",
  "ai-sequence-video-merge.resource.js",
  "ai-sequence-video-merge.resource-bridge.js",
  "ai-sequence-video-merge.mask.tool.js",
  "ai-sequence-video-merge.preview.js",
  "ai-sequence-video-merge-export.workflow.js",
  "ai-sequence-video-merge.workspace.js",
  "ai-sequence-video-merge.tool.js",
  "ai-sequence-frame-mode.js",
  "ai-sequence-minimax-h3.resource.js",
  "ai-sequence-minimax-h3-output.resource.js",
  "h3-prompt-format.js",
  "ai-sequence-minimax-h3-prompt.workflow.js",
  "ai-sequence-minimax-h3-reverse.workflow.js",
  "ai-sequence-minimax-h3.workflow.js",
  "ai-sequence-outpaint.workflow.js",
  "primary-entry-transition.preview.js",
  "primary-entry-transition.bridge.js"
]);
const legacyRuntimeShellFiles = [
  "comfy-fetch-proxy.js",
  "comfy-detect-stabilizer.js",
  "ai-sequence-cloud-workflow.js"
];

function printRendererNotFoundHelp() {
  console.error("未找到 renderer 工程目录。可选方案：");
  console.error("1) 设置环境变量 PARTICLE_EDITOR_RENDERER_DIR 指向 particle-editor 的目录");
  console.error(`2) 默认尝试：${path.join(workspaceDir, "particle-editor")}`);
  console.error(`3) 默认尝试：${path.join(workspaceDir, "translater", "particle-editor")}`);
}

function run(command, commandArgs, cwd, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", shell: options.shell ?? false });
  if (result.error) {
    console.error(result.error);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runNpmSync(npmArgs, cwd) {
  const npmExecPath = process.env.npm_execpath;
  const npmNodeExecPath = process.env.npm_node_execpath || process.execPath;
  if (npmExecPath) {
    run(npmNodeExecPath, [npmExecPath, ...npmArgs], cwd, { shell: false });
    return;
  }

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npmCmd, npmArgs, cwd, { shell: true });
}

function copyFileIfPresent(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirIfPresent(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function mergeDirIfPresent(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function syncDesktopAppShell() {
  for (const file of desktopAppShellFiles) {
    copyFileIfPresent(path.join(desktopDir, file), path.join(lockedRuntimeApp, file));
  }
  for (const dir of desktopAppShellDirs) {
    copyDirIfPresent(path.join(desktopDir, dir), path.join(lockedRuntimeApp, dir));
  }
}

function normalizeRendererIndexIcon(indexPath) {
  if (!fs.existsSync(indexPath)) return;
  const html = fs.readFileSync(indexPath, "utf8");
  const normalized = html.replace(
    /<link\s+rel="icon"[^>]*href="\.\/assets\/favicon[^"]*\.ico"[^>]*>/i,
    '<link rel="icon" type="image/x-icon" href="./assets/favicon.ico" />'
  );
  if (normalized !== html) fs.writeFileSync(indexPath, normalized);
}

function syncTrackedLockedRendererSnapshot() {
  const trackedRenderer = path.join(workspaceDir, "particle-editor");
  const trackedIndex = path.join(trackedRenderer, "index.html");
  const trackedAssets = path.join(trackedRenderer, "assets");
  if (!fs.existsSync(trackedIndex) || !fs.existsSync(trackedAssets)) return;

  copyFileIfPresent(trackedIndex, path.join(desktopRenderer, "index.html"));
  mergeDirIfPresent(trackedAssets, path.join(desktopRenderer, "assets"));
  copyRuntimeShell(trackedRenderer, desktopRenderer);
}

function syncRendererSnapshot(rendererDir) {
  const rendererDist = path.join(rendererDir, "dist");
  const distIndex = path.join(rendererDist, "index.html");
  if (fs.existsSync(distIndex)) {
    fs.copyFileSync(distIndex, path.join(rendererDir, "index.html"));
    normalizeRendererIndexIcon(path.join(rendererDir, "index.html"));
  }
  mergeDirIfPresent(path.join(rendererDist, "assets"), path.join(rendererDir, "assets"));
}

function copyRuntimeShell(rendererDir, targetDir) {
  for (const file of legacyRuntimeShellFiles) {
    try { fs.rmSync(path.join(targetDir, file), { force: true }); } catch {}
  }

  for (const file of runtimeShellFiles) {
    const src = path.join(rendererDir, file);
    if (requiredRuntimeShellFiles.has(file) && !fs.existsSync(src)) {
      console.error(`Required runtime shell file missing: ${src}`);
      process.exit(1);
    }
    copyFileIfPresent(src, path.join(targetDir, file));
  }

  for (const dir of runtimeShellDirs) {
    const src = path.join(rendererDir, dir);
    const dest = path.join(targetDir, dir);
    if (dir === "assets") {
      mergeDirIfPresent(src, dest);
    } else {
      copyDirIfPresent(src, dest);
    }
  }
}

function spawnNpm(npmArgs, cwd, env = {}) {
  const npmExecPath = process.env.npm_execpath;
  const npmNodeExecPath = process.env.npm_node_execpath || process.execPath;
  if (npmExecPath) {
    return spawn(npmNodeExecPath, [npmExecPath, ...npmArgs], {
      cwd,
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: false
    });
  }

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawn(npmCmd, npmArgs, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: true
  });
}

async function waitForUrl(url, { timeoutMs = 30_000, intervalMs = 300 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function spawnElectron(devServerUrl) {
  const require = createRequire(import.meta.url);
  let electronPath = "electron";
  try {
    const resolved = require("electron");
    if (typeof resolved === "string" && resolved.length) electronPath = resolved;
  } catch {}

  return spawn(electronPath, ["."], {
    cwd: desktopDir,
    stdio: "inherit",
    env: { ...process.env, PARTICLE_EDITOR_DEV_SERVER_URL: devServerUrl }
  });
}

if (mode === "build") {
  const allowSourceRendererBuild = process.env.NOVAFLOW_ALLOW_SOURCE_RENDERER_BUILD === "1";
  if (!allowSourceRendererBuild && fs.existsSync(path.join(desktopRenderer, "index.html"))) {
    syncTrackedLockedRendererSnapshot();
    normalizeRendererIndexIcon(path.join(desktopRenderer, "index.html"));
    run(process.execPath, [copyDirScript, desktopRenderer, lockedRuntimeRenderer], desktopDir, { shell: false });
    normalizeRendererIndexIcon(path.join(lockedRuntimeRenderer, "index.html"));
    syncDesktopAppShell();
    process.exit(0);
  }

  const rendererDir = findRendererDir();
  if (rendererDir) {
    const rendererDist = path.join(rendererDir, "dist");
    normalizeRendererIndexIcon(path.join(rendererDir, "index.html"));
    runNpmSync(["run", "build"], rendererDir);
    syncRendererSnapshot(rendererDir);
    run(process.execPath, [copyDirScript, rendererDist, desktopRenderer], desktopDir, { shell: false });
    copyRuntimeShell(rendererDir, desktopRenderer);
    normalizeRendererIndexIcon(path.join(desktopRenderer, "index.html"));
    syncDesktopAppShell();
    process.exit(0);
  }

  if (fs.existsSync(path.join(desktopRenderer, "index.html"))) {
    syncDesktopAppShell();
    process.exit(0);
  }

  printRendererNotFoundHelp();
  process.exit(1);
}

if (mode === "dev:electron") {
  const p = spawnElectron(defaultDevServerUrl);
  p.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => p.kill("SIGINT"));
  process.on("SIGTERM", () => p.kill("SIGTERM"));
  process.on("exit", () => p.kill());
  await new Promise(() => {});
}

const rendererDir = findRendererDir();
if (!rendererDir) {
  if (mode === "dev" && fs.existsSync(path.join(desktopRenderer, "index.html"))) {
    const p = spawnElectron("");
    p.on("exit", (code) => process.exit(code ?? 0));
    process.on("SIGINT", () => p.kill("SIGINT"));
    process.on("SIGTERM", () => p.kill("SIGTERM"));
    process.on("exit", () => p.kill());
    await new Promise(() => {});
  }

  printRendererNotFoundHelp();
  process.exit(1);
}

const rendererProc = spawnNpm(["run", "dev"], rendererDir);
rendererProc.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => rendererProc.kill("SIGINT"));
process.on("SIGTERM", () => rendererProc.kill("SIGTERM"));
process.on("exit", () => rendererProc.kill());

if (mode === "dev:renderer") {
  await new Promise(() => {});
}

try {
  await waitForUrl(defaultDevServerUrl);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  rendererProc.kill();
  process.exit(1);
}

const electronProc = spawnElectron(defaultDevServerUrl);
electronProc.on("exit", (code) => {
  rendererProc.kill();
  process.exit(code ?? 0);
});
process.on("SIGINT", () => electronProc.kill("SIGINT"));
process.on("SIGTERM", () => electronProc.kill("SIGTERM"));
process.on("exit", () => electronProc.kill());

await new Promise(() => {});
