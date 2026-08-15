"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");
const sharp = require("sharp");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;

const {
  EXPORT_SCHEMA,
  IPC_CHANNELS,
  buildExportPlan,
  createVideoCompositorExportService,
  parseSourceProbeJson,
  replaceOutputFileSafely,
  registerVideoCompositorExportIpc,
  validateExportManifest
} = require("../main/video-compositor-export");

function makeTempRoot(t, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `novaflow-video-compositor-${label}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function commandResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
  return {
    ok: result.status === 0,
    code: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

function asyncCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const abort = () => {
      try { child.kill(); } catch { void 0; }
    };
    options.signal?.addEventListener?.("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => resolve({ ok: false, code: -1, stdout, stderr: String(error?.message || error) }));
    child.once("close", (code) => {
      options.signal?.removeEventListener?.("abort", abort);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function realSpawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    cwd: options.cwd,
    windowsHide: true,
    stdio: options.stdio || ["ignore", "pipe", "pipe"]
  });
}

async function terminateChild(child) {
  if (!child) return true;
  try { child.kill(); } catch { void 0; }
  return true;
}

function serviceForRoot(root, overrides = {}) {
  return createVideoCompositorExportService({
    fs,
    path,
    sharp,
    ffmpegPath: overrides.ffmpegPath || ffmpegPath,
    ffprobePath: overrides.ffprobePath || ffprobePath,
    runCommand: overrides.runCommand || asyncCommand,
    spawnCommand: overrides.spawnCommand || realSpawnCommand,
    terminateChild: overrides.terminateChild || terminateChild,
    createWorkDir(_category, prefix) {
      return fs.mkdtempSync(path.join(root, `${prefix}-`));
    },
    async cleanupWorkDir(dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: true };
    },
    assertEntitled: overrides.assertEntitled || (async () => void 0)
  });
}

function sourceProbe(overrides = {}) {
  const codec = overrides.codec || "h264";
  const webm = codec === "vp8" || codec === "vp9";
  return JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: codec,
        pix_fmt: overrides.pixFmt || "yuv420p",
        width: overrides.width || 64,
        height: overrides.height || 64,
        duration: String(overrides.duration || 1),
        avg_frame_rate: "30/1",
        r_frame_rate: "30/1",
        sample_aspect_ratio: "1:1",
        tags: overrides.alpha ? { alpha_mode: "1" } : {},
        side_data_list: overrides.rotation ? [{ rotation: overrides.rotation }] : []
      },
      ...(overrides.audio === false ? [] : [{
        codec_type: "audio",
        codec_name: webm ? "opus" : "aac",
        sample_rate: "48000",
        channels: 2
      }])
    ],
    format: {
      format_name: webm ? "matroska,webm" : "mov,mp4,m4a,3gp,3g2,mj2",
      duration: String(overrides.duration || 1)
    }
  });
}

async function whiteCoveragePng(width, height, alpha = 128) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 255;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = alpha;
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function baseManifest(sessionId, outputPath, layers, audio = { mode: "none", sourceLayerId: null }, format = "webm") {
  return {
    schema: EXPORT_SCHEMA,
    sessionId,
    jobId: `job_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    output: { filePath: outputPath, format, width: 64, height: 64, fps: 30 },
    layers,
    audio
  };
}

test("desktop main and preload expose only the frozen compositor IPC surface", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  assert.match(mainSource, /createVideoCompositorExportService/);
  assert.match(mainSource, /registerVideoCompositorExportIpc/);
  for (const method of [
    "videoCompositorOpenSession",
    "videoCompositorRegisterSource",
    "videoCompositorReleaseSource",
    "videoCompositorPutMask",
    "videoCompositorExport",
    "videoCompositorCancel",
    "videoCompositorCloseSession",
    "onVideoCompositorProgress"
  ]) {
    assert.match(preloadSource, new RegExp(`\\b${method}\\b`));
  }
  assert.doesNotMatch(preloadSource, /videoCompositor(?:FfmpegArgs|FilterComplex|RawCommand)/);
});

test("IPC session cleanup binds one destroyed listener per sender", async () => {
  const handlers = new Map();
  const closedOwners = [];
  let opened = 0;
  const service = {
    openSession: async () => ({ ok: true, sessionId: `session_${++opened}_abcdefgh` }),
    closeOwner: async (ownerId) => { closedOwners.push(ownerId); }
  };
  registerVideoCompositorExportIpc({
    service,
    handleIpc(channel, handler) { handlers.set(channel, handler); }
  });
  const sender = new EventEmitter();
  sender.id = 17;
  const openHandler = handlers.get(IPC_CHANNELS.sessionOpen);
  await openHandler({ sender }, {});
  await openHandler({ sender }, {});
  assert.equal(sender.listenerCount("destroyed"), 1);
  sender.emit("destroyed");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(closedOwners, [17]);
});

test("probe contract distinguishes ordinary sources and confirmed VP9 alpha metadata", () => {
  const mp4 = parseSourceProbeJson(sourceProbe(), "C:\\fixtures\\ordinary.mp4");
  assert.equal(mp4.container, "mp4");
  assert.equal(mp4.codec, "h264");
  assert.equal(mp4.hasAlpha, false);
  assert.equal(mp4.hasAudio, true);

  const alphaWebm = parseSourceProbeJson(sourceProbe({ codec: "vp9", alpha: true, audio: false }), "C:\\fixtures\\alpha.webm");
  assert.equal(alphaWebm.container, "webm");
  assert.equal(alphaWebm.codec, "vp9");
  assert.equal(alphaWebm.hasAlpha, true);
  assert.equal(alphaWebm.alphaMode, "1");
  assert.equal(alphaWebm.hasAudio, false);
});

test("strict manifest builds bottom-to-top coverage multiplication and transparent EOF", (t) => {
  const root = makeTempRoot(t, "plan");
  const outputPath = path.join(root, "output.webm");
  const sourceBottom = {
    id: "source_bottom_1",
    filePath: path.join(root, "bottom.mp4"),
    size: 1,
    mtimeMs: 1,
    meta: { ...JSON.parse(JSON.stringify(parseSourceProbeJson(sourceProbe({ duration: 2 }), "C:\\fixtures\\bottom.mp4"))), displayWidth: 64, displayHeight: 64 }
  };
  const sourceTop = {
    id: "source_alpha_2",
    filePath: path.join(root, "top.webm"),
    size: 1,
    mtimeMs: 1,
    meta: { ...parseSourceProbeJson(sourceProbe({ codec: "vp9", alpha: true, duration: 1, audio: false }), "C:\\fixtures\\top.webm"), displayWidth: 64, displayHeight: 64 }
  };
  fs.writeFileSync(sourceBottom.filePath, "x");
  fs.writeFileSync(sourceTop.filePath, "x");
  const statBottom = fs.statSync(sourceBottom.filePath);
  const statTop = fs.statSync(sourceTop.filePath);
  sourceBottom.size = statBottom.size;
  sourceBottom.mtimeMs = statBottom.mtimeMs;
  sourceTop.size = statTop.size;
  sourceTop.mtimeMs = statTop.mtimeMs;
  const mask = { id: "mask_alpha_top", sourceId: sourceTop.id, layerId: "top", filePath: path.join(root, "mask.png"), sha256: "abc" };
  const session = {
    id: "session_plan_1",
    fs,
    sources: new Map([[sourceBottom.id, sourceBottom], [sourceTop.id, sourceTop]]),
    masks: new Map([[mask.id, mask]])
  };
  const manifest = baseManifest(session.id, outputPath, [
    { layerId: "bottom", sourceId: sourceBottom.id, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } },
    { layerId: "top", sourceId: sourceTop.id, maskId: mask.id, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } }
  ]);
  const normalized = validateExportManifest(manifest, session, path);
  const plan = buildExportPlan(normalized);
  assert.equal(normalized.frameCount, 60);
  assert.equal(normalized.durationSec, 2);
  assert.match(plan.filterComplex, /alphaextract\[source_alpha_1\]/);
  assert.match(plan.filterComplex, /blend=all_mode=multiply:shortest=1/);
  assert.match(plan.filterComplex, /format=gray\[coverage_alpha_1\]/);
  assert.match(plan.filterComplex, /alphamerge=shortest=1/);
  assert.match(plan.filterComplex, /eof_action=pass:repeatlast=0/);
  assert.ok(plan.args.some((value, index) => value === "libvpx-vp9" && plan.args[index - 1] === "-c:v"));
  assert.throws(() => validateExportManifest({ ...manifest, layers: manifest.layers.slice(0, 1) }, session, path), /two_layers/);
  const opacityManifest = structuredClone(manifest);
  opacityManifest.layers[0].transform.opacity = 0.5;
  assert.throws(() => validateExportManifest(opacityManifest, session, path), /invalid_layer_transform:opacity/);
});

test("source tokens, canonical coverage PNGs, ownership, and session cleanup are enforced", async (t) => {
  const root = makeTempRoot(t, "tokens");
  const inputPath = path.join(root, "input.mp4");
  fs.writeFileSync(inputPath, Buffer.alloc(32, 1));
  const service = serviceForRoot(root, {
    runCommand: async () => ({ ok: true, stdout: sourceProbe({ audio: false }), stderr: "" })
  });
  const opened = await service.openSession("owner-1");
  const registered = await service.registerSource("owner-1", { sessionId: opened.sessionId, path: inputPath });
  assert.equal(registered.ok, true);
  assert.equal(registered.meta.displayWidth, 64);
  await assert.rejects(
    () => service.registerSource("owner-2", { sessionId: opened.sessionId, path: inputPath }),
    /session_owner_mismatch/
  );

  const maskBytes = await whiteCoveragePng(64, 64, 128);
  const mask = await service.putMask("owner-1", {
    sessionId: opened.sessionId,
    layerId: "top",
    sourceId: registered.sourceId,
    bytes: maskBytes.buffer.slice(maskBytes.byteOffset, maskBytes.byteOffset + maskBytes.byteLength)
  });
  assert.equal(mask.ok, true);
  assert.equal(mask.width, 64);
  assert.equal(mask.height, 64);
  const firstMaskPath = service.sessions.get(opened.sessionId).masks.get(mask.maskId).filePath;

  const dirtyRgb = Buffer.alloc(64 * 64 * 4, 255);
  dirtyRgb[0] = 0;
  dirtyRgb[1] = 0;
  dirtyRgb[2] = 0;
  dirtyRgb[3] = 0;
  const dirtyPng = await sharp(dirtyRgb, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
  const browserLikeMask = await service.putMask("owner-1", {
    sessionId: opened.sessionId,
    layerId: "top",
    sourceId: registered.sourceId,
    bytes: dirtyPng
  });
  const session = service.sessions.get(opened.sessionId);
  assert.equal(session.masks.size, 1);
  assert.equal(fs.existsSync(firstMaskPath), false);
  const canonicalPath = session.masks.get(browserLikeMask.maskId).filePath;
  const canonical = await sharp(canonicalPath).raw().toBuffer({ resolveWithObject: true });
  assert.equal(canonical.info.channels, 3);
  assert.equal(canonical.data[0], 0);
  assert.equal(canonical.data[3], 255);

  const released = await service.releaseSource("owner-1", { sessionId: opened.sessionId, sourceId: registered.sourceId });
  assert.equal(released.released, true);
  assert.equal(service.sessions.get(opened.sessionId).sources.size, 0);
  assert.equal(service.sessions.get(opened.sessionId).masks.size, 0);
  for (let index = 0; index < 20; index += 1) {
    const replacement = await service.registerSource("owner-1", { sessionId: opened.sessionId, path: inputPath });
    await service.releaseSource("owner-1", { sessionId: opened.sessionId, sourceId: replacement.sourceId });
  }

  const workDir = service.sessions.get(opened.sessionId).workDir;
  assert.equal(fs.existsSync(workDir), true);
  const closed = await service.closeSession("owner-1", { sessionId: opened.sessionId });
  assert.equal(closed.closed, true);
  assert.equal(fs.existsSync(workDir), false);
});

test("cancel terminates the tracked child and removes the partial output", async (t) => {
  const root = makeTempRoot(t, "cancel");
  const inputA = path.join(root, "a.mp4");
  const inputB = path.join(root, "b.mp4");
  fs.writeFileSync(inputA, Buffer.alloc(16, 1));
  fs.writeFileSync(inputB, Buffer.alloc(16, 2));
  let activeChild = null;
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    activeChild = child;
    return child;
  };
  const service = serviceForRoot(root, {
    runCommand: async () => ({ ok: true, stdout: sourceProbe({ audio: false }), stderr: "" }),
    spawnCommand: fakeSpawn,
    terminateChild: async (child) => {
      queueMicrotask(() => child.emit("close", null));
      return true;
    }
  });
  const opened = await service.openSession("owner");
  const sourceA = await service.registerSource("owner", { sessionId: opened.sessionId, path: inputA });
  const sourceB = await service.registerSource("owner", { sessionId: opened.sessionId, path: inputB });
  const outputPath = path.join(root, "partial.mp4");
  fs.writeFileSync(outputPath, "existing-user-video");
  const manifest = baseManifest(opened.sessionId, outputPath, [
    { layerId: "bottom", sourceId: sourceA.sourceId, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } },
    { layerId: "top", sourceId: sourceB.sourceId, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } }
  ], { mode: "none", sourceLayerId: null }, "mp4");
  const exportPromise = service.startExport("owner", manifest, () => void 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(activeChild);
  const canceled = await service.cancelExport("owner", { sessionId: opened.sessionId, jobId: manifest.jobId });
  assert.equal(canceled.canceled, true);
  await assert.rejects(exportPromise, /export_canceled/);
  assert.equal(fs.readFileSync(outputPath, "utf8"), "existing-user-video");
  assert.equal(fs.readdirSync(root).some((name) => name.includes(".partial.mp4")), false);
  assert.equal(service.jobs.size, 0);
  await service.closeSession("owner", { sessionId: opened.sessionId });
});

test("cancel during deferred entitlement prevents FFmpeg from starting", async (t) => {
  const root = makeTempRoot(t, "cancel-before-entitlement");
  const inputA = path.join(root, "a.mp4");
  const inputB = path.join(root, "b.mp4");
  const outputPath = path.join(root, "must-not-exist.mp4");
  fs.writeFileSync(inputA, Buffer.alloc(16, 1));
  fs.writeFileSync(inputB, Buffer.alloc(16, 2));
  let resolveEntitlement;
  const entitlement = new Promise((resolve) => { resolveEntitlement = resolve; });
  let spawnCalls = 0;
  const service = serviceForRoot(root, {
    runCommand: async () => ({ ok: true, stdout: sourceProbe({ audio: false }), stderr: "" }),
    assertEntitled: () => entitlement,
    spawnCommand: () => {
      spawnCalls += 1;
      throw new Error("FFmpeg must not start after cancellation");
    }
  });
  const opened = await service.openSession("owner");
  const sourceA = await service.registerSource("owner", { sessionId: opened.sessionId, path: inputA });
  const sourceB = await service.registerSource("owner", { sessionId: opened.sessionId, path: inputB });
  const manifest = baseManifest(opened.sessionId, outputPath, [
    { layerId: "bottom", sourceId: sourceA.sourceId, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } },
    { layerId: "top", sourceId: sourceB.sourceId, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } }
  ], { mode: "none", sourceLayerId: null }, "mp4");
  const exportPromise = service.startExport("owner", manifest, () => void 0);
  const exportFailure = assert.rejects(exportPromise, /export_canceled/);
  assert.equal(service.jobs.has(manifest.jobId), true);
  const canceled = await service.cancelExport("owner", { sessionId: opened.sessionId, jobId: manifest.jobId });
  assert.equal(canceled.canceled, true);
  resolveEntitlement();
  await exportFailure;
  assert.equal(spawnCalls, 0);
  assert.equal(fs.existsSync(outputPath), false);
  assert.equal(service.jobs.size, 0);
  await service.closeSession("owner", { sessionId: opened.sessionId });
});

test("session close during deferred entitlement prevents FFmpeg from starting", async (t) => {
  const root = makeTempRoot(t, "close-before-entitlement");
  const inputA = path.join(root, "a.mp4");
  const inputB = path.join(root, "b.mp4");
  const outputPath = path.join(root, "must-not-exist.mp4");
  fs.writeFileSync(inputA, Buffer.alloc(16, 1));
  fs.writeFileSync(inputB, Buffer.alloc(16, 2));
  let resolveEntitlement;
  const entitlement = new Promise((resolve) => { resolveEntitlement = resolve; });
  let spawnCalls = 0;
  const service = serviceForRoot(root, {
    runCommand: async () => ({ ok: true, stdout: sourceProbe({ audio: false }), stderr: "" }),
    assertEntitled: () => entitlement,
    spawnCommand: () => {
      spawnCalls += 1;
      throw new Error("FFmpeg must not start after session close");
    }
  });
  const opened = await service.openSession("owner");
  const sourceA = await service.registerSource("owner", { sessionId: opened.sessionId, path: inputA });
  const sourceB = await service.registerSource("owner", { sessionId: opened.sessionId, path: inputB });
  const manifest = baseManifest(opened.sessionId, outputPath, [
    { layerId: "bottom", sourceId: sourceA.sourceId, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } },
    { layerId: "top", sourceId: sourceB.sourceId, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } }
  ], { mode: "none", sourceLayerId: null }, "mp4");
  const exportPromise = service.startExport("owner", manifest, () => void 0);
  const exportFailure = assert.rejects(exportPromise, /export_canceled/);
  assert.equal(service.jobs.has(manifest.jobId), true);
  const closePromise = service.closeSession("owner", { sessionId: opened.sessionId });
  resolveEntitlement();
  await exportFailure;
  const closed = await closePromise;
  assert.equal(closed.closed, true);
  assert.equal(spawnCalls, 0);
  assert.equal(fs.existsSync(outputPath), false);
  assert.equal(service.jobs.size, 0);
  assert.equal(service.sessions.has(opened.sessionId), false);
});

test("encoding failure removes only the generated partial and preserves an existing target", async (t) => {
  const root = makeTempRoot(t, "encode-failure");
  const inputA = path.join(root, "a.mp4");
  const inputB = path.join(root, "b.mp4");
  const outputPath = path.join(root, "existing.mp4");
  fs.writeFileSync(inputA, Buffer.alloc(16, 1));
  fs.writeFileSync(inputB, Buffer.alloc(16, 2));
  fs.writeFileSync(outputPath, "existing-user-video");
  const service = serviceForRoot(root, {
    runCommand: async () => ({ ok: true, stdout: sourceProbe({ audio: false }), stderr: "" }),
    spawnCommand: (_command, args) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      const partialPath = args.at(-1);
      fs.writeFileSync(partialPath, "broken-partial");
      queueMicrotask(() => {
        child.stderr.write("intentional ffmpeg failure");
        child.emit("close", 1);
      });
      return child;
    }
  });
  const opened = await service.openSession("owner");
  const sourceA = await service.registerSource("owner", { sessionId: opened.sessionId, path: inputA });
  const sourceB = await service.registerSource("owner", { sessionId: opened.sessionId, path: inputB });
  const manifest = baseManifest(opened.sessionId, outputPath, [
    { layerId: "bottom", sourceId: sourceA.sourceId, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } },
    { layerId: "top", sourceId: sourceB.sourceId, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } }
  ], { mode: "none", sourceLayerId: null }, "mp4");
  await assert.rejects(() => service.startExport("owner", manifest, () => void 0), /intentional ffmpeg failure/);
  assert.equal(fs.readFileSync(outputPath, "utf8"), "existing-user-video");
  assert.equal(fs.readdirSync(root).some((name) => name.includes(".partial.mp4")), false);
  await service.closeSession("owner", { sessionId: opened.sessionId });
});

test("failed final replacement restores the user's previous target from backup", (t) => {
  const root = makeTempRoot(t, "replace-restore");
  const outputPath = path.join(root, "output.mp4");
  const partialPath = path.join(root, ".output.random.partial.mp4");
  const backupPath = path.join(root, ".output.random.backup.mp4");
  fs.writeFileSync(outputPath, "old-video");
  fs.writeFileSync(partialPath, "new-video");
  let injected = false;
  const fsWithFailedReplacement = {
    ...fs,
    renameSync(from, to) {
      if (!injected && path.resolve(from) === path.resolve(partialPath) && path.resolve(to) === path.resolve(outputPath)) {
        injected = true;
        throw new Error("injected replacement failure");
      }
      return fs.renameSync(from, to);
    }
  };
  assert.throws(
    () => replaceOutputFileSafely(fsWithFailedReplacement, partialPath, outputPath, backupPath),
    /injected replacement failure/
  );
  assert.equal(fs.readFileSync(outputPath, "utf8"), "old-video");
  assert.equal(fs.existsSync(backupPath), false);
  assert.equal(fs.readFileSync(partialPath, "utf8"), "new-video");
});

test("packaged FFmpeg preserves VP9 source alpha times coverage through transparent WebM export", { timeout: 60_000 }, async (t) => {
  if (!ffmpegPath || !ffprobePath || !fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) return t.skip("packaged ffmpeg/ffprobe unavailable");
  const root = makeTempRoot(t, "alpha-integration");
  const ordinaryPath = path.join(root, "ordinary.mp4");
  const alphaPath = path.join(root, "alpha.webm");
  const outputPath = path.join(root, "composite.webm");
  let generated = commandResult(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:size=64x64:rate=30:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", ordinaryPath
  ], { cwd: root });
  assert.equal(generated.ok, true, generated.stderr);
  generated = commandResult(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=blue@0.5:size=64x64:rate=30:duration=1,format=yuva420p",
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0",
    "-metadata:s:v:0", "alpha_mode=1", alphaPath
  ], { cwd: root });
  assert.equal(generated.ok, true, generated.stderr);

  const service = serviceForRoot(root);
  const opened = await service.openSession("owner");
  const ordinary = await service.registerSource("owner", { sessionId: opened.sessionId, path: ordinaryPath });
  const alpha = await service.registerSource("owner", { sessionId: opened.sessionId, path: alphaPath, alphaSourceConfirmed: true });
  assert.equal(alpha.meta.hasAlpha, true);
  assert.equal(alpha.meta.decoder, "libvpx-vp9");
  const coverageBytes = await whiteCoveragePng(64, 64, 128);
  const coverage = await service.putMask("owner", {
    sessionId: opened.sessionId,
    layerId: "top",
    sourceId: alpha.sourceId,
    bytes: coverageBytes
  });
  const progress = [];
  const manifest = baseManifest(opened.sessionId, outputPath, [
    { layerId: "bottom", sourceId: ordinary.sourceId, maskId: null, visible: false, transform: { centerX: 32, centerY: 32, scale: 1 } },
    { layerId: "top", sourceId: alpha.sourceId, maskId: coverage.maskId, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } }
  ]);
  const exported = await service.startExport("owner", manifest, (event) => progress.push(event));
  assert.equal(exported.ok, true);
  assert.equal(exported.evidence.expected.frameCount, 30);
  assert.equal(exported.evidence.actual.alphaMode, "1");
  assert.ok(progress.some((event) => event.stage === "complete"));

  const counted = commandResult(ffprobePath, [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,nb_read_frames:stream_tags=alpha_mode",
    "-of", "json", outputPath
  ]);
  assert.equal(counted.ok, true, counted.stderr);
  const countedJson = JSON.parse(counted.stdout);
  assert.equal(Number(countedJson.streams[0].nb_read_frames), 30);
  const alphaModeEntry = Object.entries(countedJson.streams[0].tags || {})
    .find(([key]) => String(key).toLowerCase() === "alpha_mode");
  assert.equal(String(alphaModeEntry?.[1]), "1");

  const alphaStats = commandResult(ffmpegPath, [
    "-hide_banner", "-loglevel", "info", "-c:v", "libvpx-vp9", "-i", outputPath,
    "-vf", "alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-frames:v", "1", "-f", "null", "NUL"
  ]);
  assert.equal(alphaStats.ok, true, alphaStats.stderr);
  const alphaAverage = Number(alphaStats.stderr.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/)?.[1]);
  assert.ok(Number.isFinite(alphaAverage), alphaStats.stderr);
  assert.ok(alphaAverage >= 61 && alphaAverage <= 65, `expected source alpha x coverage near 63, got ${alphaAverage}`);
  await service.closeSession("owner", { sessionId: opened.sessionId });
});

test("packaged FFmpeg MP4 fixture keeps z-order, drops the short top layer at EOF, and maps one audio stream", { timeout: 60_000 }, async (t) => {
  if (!ffmpegPath || !ffprobePath || !fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) return t.skip("packaged ffmpeg/ffprobe unavailable");
  const root = makeTempRoot(t, "mp4-integration");
  const bottomPath = path.join(root, "bottom.mp4");
  const topPath = path.join(root, "top.mp4");
  const outputPath = path.join(root, "composite.mp4");
  let generated = commandResult(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:size=64x64:rate=30:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", bottomPath
  ], { cwd: root });
  assert.equal(generated.ok, true, generated.stderr);
  generated = commandResult(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=blue:size=64x64:rate=30:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", topPath
  ], { cwd: root });
  assert.equal(generated.ok, true, generated.stderr);

  const service = serviceForRoot(root);
  const opened = await service.openSession("owner");
  const bottom = await service.registerSource("owner", { sessionId: opened.sessionId, path: bottomPath });
  const top = await service.registerSource("owner", { sessionId: opened.sessionId, path: topPath });
  const manifest = baseManifest(opened.sessionId, outputPath, [
    { layerId: "bottom", sourceId: bottom.sourceId, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } },
    { layerId: "top", sourceId: top.sourceId, maskId: null, visible: true, transform: { centerX: 32, centerY: 32, scale: 1 } }
  ], { mode: "single", sourceLayerId: "bottom" }, "mp4");
  const exported = await service.startExport("owner", manifest, () => void 0);
  assert.equal(exported.ok, true);
  assert.equal(exported.evidence.expected.frameCount, 60);
  assert.equal(exported.evidence.actual.audioStreamCount, 1);

  const counted = commandResult(ffprobePath, [
    "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", outputPath
  ]);
  assert.equal(counted.ok, true, counted.stderr);
  const countedJson = JSON.parse(counted.stdout);
  const video = countedJson.streams.find((stream) => stream.codec_type === "video");
  const audio = countedJson.streams.find((stream) => stream.codec_type === "audio");
  assert.equal(Number(video.nb_read_frames), 60);
  assert.equal(video.codec_name, "h264");
  assert.equal(audio.codec_name, "aac");

  function centerRgb(timeSec) {
    const sampled = spawnSync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-ss", String(timeSec), "-i", outputPath,
      "-frames:v", "1", "-vf", "crop=1:1:32:32,format=rgb24", "-f", "rawvideo", "pipe:1"
    ], { windowsHide: true, encoding: null, maxBuffer: 1024 * 1024 });
    assert.equal(sampled.status, 0, String(sampled.stderr || ""));
    return Array.from(Buffer.from(sampled.stdout).subarray(0, 3));
  }
  const early = centerRgb(0.5);
  const late = centerRgb(1.5);
  assert.ok(early[2] > early[0] * 2, `top layer should be blue early, got ${early}`);
  assert.ok(late[0] > late[2] * 2, `short top layer must disappear after EOF, got ${late}`);
  await service.closeSession("owner", { sessionId: opened.sessionId });
});
