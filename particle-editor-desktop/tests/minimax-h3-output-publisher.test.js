"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const publisherPath = path.join(root, "particle-editor-desktop", "main", "minimax-h3-output-publisher.js");
const { createMiniMaxH3OutputPublisher } = require(publisherPath);

function createFixture(t, label, options = {}) {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), `novaflow-h3-publisher-${label}-`));
  const runtimeRoot = path.join(testRoot, "runtime");
  const generatedPath = path.join(runtimeRoot, "generated");
  const outputPath = path.join(generatedPath, "output");
  const warehouseDir = path.join(testRoot, "warehouse");
  fs.mkdirSync(outputPath, { recursive: true });
  fs.mkdirSync(warehouseDir, { recursive: true });
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

  const publisher = createMiniMaxH3OutputPublisher({
    fs,
    path,
    readRuntimeConfig: () => options.generatedOnly ? { ok: true, generatedPath } : { ok: true, outputPath, generatedPath },
    getWarehouseDir: () => warehouseDir,
    now: options.now || (() => 1_725_000_000_000),
    wait: async () => {},
    stabilityAttempts: 2,
  });
  return { testRoot, runtimeRoot, generatedPath, outputPath, warehouseDir, publisher };
}

function writeOutput(fixture, filename, content, subfolder = "video") {
  const outputDir = path.join(fixture.outputPath, subfolder);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, filename);
  fs.writeFileSync(outputFile, content);
  return outputFile;
}

test("publishes a stable H3 video into the warehouse and restores it from manifest", async (t) => {
  const fixture = createFixture(t, "publish");
  const sourcePath = writeOutput(fixture, "MiniMax_H3_t2v_00001_.mp4", "h3-video-one");
  const payload = {
    promptId: "prompt-h3-1",
    filename: "MiniMax_H3_t2v_00001_.mp4",
    subfolder: "video",
    type: "output",
    mediaDurationSec: 15.084,
    generationElapsedSec: 372.538,
  };

  const item = await fixture.publisher.publish(payload);
  assert.equal(item.id, "prompt-h3-1:output:video:MiniMax_H3_t2v_00001_.mp4");
  assert.equal(item.createdAt, 1_725_000_000_000);
  assert.equal(item.promptId, payload.promptId);
  assert.equal(item.filename, payload.filename);
  assert.equal(item.type, "local");
  assert.equal(item.sourceKind, "minimax_h3_output");
  assert.equal(item.runtimeKind, "minimax_h3_local");
  assert.equal(item.runtimeBaseUrl, "http://127.0.0.1:8189");
  assert.equal(item.sourceFilename, payload.filename);
  assert.equal(item.sourceSubfolder, "video");
  assert.equal(item.mediaDurationSec, 15.084);
  assert.equal(item.generationElapsedSec, 372.538);
  assert.equal(Object.isFrozen(item), true);
  assert.equal(fs.readFileSync(item.localPath, "utf8"), "h3-video-one");
  assert.equal(fs.existsSync(sourcePath), true, "publishing must never move or delete the H3 source");

  const restoredPublisher = createMiniMaxH3OutputPublisher({
    fs,
    path,
    readRuntimeConfig: () => ({ ok: true, outputPath: fixture.outputPath }),
    getWarehouseDir: () => fixture.warehouseDir,
    wait: async () => {},
    stabilityAttempts: 2,
  });
  const restored = await restoredPublisher.list();
  assert.equal(Object.isFrozen(restored), true);
  assert.equal(restored.length, 1);
  assert.equal(Object.isFrozen(restored[0]), true);
  assert.deepEqual(restored[0], item);
  assert.equal(await restoredPublisher.resolve(item.id), item.localPath);
  assert.equal(await restoredPublisher.resolve("unknown-id"), null);

  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.warehouseDir, "manifest.json"), "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.items.length, 1);
  assert.equal(manifest.items[0].mediaDurationSec, 15.084);
  assert.equal(manifest.items[0].generationElapsedSec, 372.538);
  assert.equal(fs.readdirSync(fixture.warehouseDir).some((name) => name.endsWith(".tmp")), false);
});

test("uses generatedPath/output when the H3 config does not expose outputPath", async (t) => {
  const fixture = createFixture(t, "generated-fallback", { generatedOnly: true });
  writeOutput(fixture, "fallback.webm", "fallback-video");
  const item = await fixture.publisher.publish({
    promptId: "fallback-prompt",
    filename: "fallback.webm",
    subfolder: "video",
    type: "output",
  });
  assert.equal(fs.readFileSync(item.localPath, "utf8"), "fallback-video");
  assert.equal(Object.hasOwn(item, "mediaDurationSec"), false);
  assert.equal(Object.hasOwn(item, "generationElapsedSec"), false);
});

test("accepts old manifests without timing fields and drops manifest entries with invalid timing", async (t) => {
  const fixture = createFixture(t, "timing-compatibility");
  writeOutput(fixture, "legacy.mp4", "legacy-video");
  const legacy = await fixture.publisher.publish({
    promptId: "legacy-prompt",
    filename: "legacy.mp4",
    subfolder: "video",
    type: "output",
  });
  const manifestPath = path.join(fixture.warehouseDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(Object.hasOwn(manifest.items[0], "mediaDurationSec"), false);
  assert.equal(Object.hasOwn(manifest.items[0], "generationElapsedSec"), false);
  assert.deepEqual(await fixture.publisher.list(), [legacy]);

  manifest.items[0].generationElapsedSec = "not-a-number";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  assert.deepEqual(await fixture.publisher.list(), []);
});

test("rejects non-finite, out-of-range, and non-numeric timing metadata", async (t) => {
  const fixture = createFixture(t, "timing-validation");
  writeOutput(fixture, "timing.mp4", "timing-video");
  const base = {
    promptId: "timing-prompt",
    filename: "timing.mp4",
    subfolder: "video",
    type: "output",
  };
  for (const [field, value, code] of [
    ["mediaDurationSec", 0, "h3_output_media_duration_invalid"],
    ["mediaDurationSec", 60.001, "h3_output_media_duration_invalid"],
    ["mediaDurationSec", NaN, "h3_output_media_duration_invalid"],
    ["generationElapsedSec", -0.001, "h3_output_generation_elapsed_invalid"],
    ["generationElapsedSec", 86_400.001, "h3_output_generation_elapsed_invalid"],
    ["generationElapsedSec", "10", "h3_output_generation_elapsed_invalid"],
  ]) {
    await assert.rejects(fixture.publisher.publish({ ...base, [field]: value }), { code });
  }
  assert.deepEqual(await fixture.publisher.list(), []);
});

test("rejects path traversal, non-output types, non-video files, and non-basename filenames", async (t) => {
  const fixture = createFixture(t, "validation");
  writeOutput(fixture, "safe.mp4", "safe");

  await assert.rejects(
    fixture.publisher.publish({ promptId: "p", filename: "safe.mp4", subfolder: "../video", type: "output" }),
    { code: "h3_output_subfolder_invalid" },
  );
  await assert.rejects(
    fixture.publisher.publish({ promptId: "p", filename: "../safe.mp4", subfolder: "video", type: "output" }),
    { code: "h3_output_filename_invalid" },
  );
  await assert.rejects(
    fixture.publisher.publish({ promptId: "p", filename: "video/safe.mp4", subfolder: "", type: "output" }),
    { code: "h3_output_filename_invalid" },
  );
  await assert.rejects(
    fixture.publisher.publish({ promptId: "p", filename: "safe.png", subfolder: "video", type: "output" }),
    { code: "h3_output_video_extension_required" },
  );
  await assert.rejects(
    fixture.publisher.publish({ promptId: "p", filename: "safe.mp4", subfolder: "video", type: "temp" }),
    { code: "h3_output_type_invalid" },
  );
  assert.deepEqual(await fixture.publisher.list(), []);
});

test("rejects a source path that traverses a directory symlink or junction", async (t) => {
  const fixture = createFixture(t, "symlink-source");
  const outsideDir = path.join(fixture.testRoot, "outside");
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, "escaped.mp4"), "outside-video");
  const linkedDir = path.join(fixture.outputPath, "linked");
  try {
    fs.symlinkSync(outsideDir, linkedDir, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error && (error.code === "EPERM" || error.code === "EACCES")) {
      t.skip("this Windows environment does not allow creating a test junction");
      return;
    }
    throw error;
  }

  await assert.rejects(
    fixture.publisher.publish({
      promptId: "symlink-prompt",
      filename: "escaped.mp4",
      subfolder: "linked",
      type: "output",
    }),
    { code: "h3_output_symlink_forbidden" },
  );
  assert.equal(fs.readdirSync(fixture.warehouseDir).length, 0);
});

test("refuses to publish an output whose size never becomes stable", async (t) => {
  const fixture = createFixture(t, "unstable-base");
  const sourcePath = writeOutput(fixture, "still-writing.mp4", "video-being-written");
  let reportedSize = 10;
  const unstableFs = {
    constants: fs.constants,
    promises: {
      ...fs.promises,
      stat: async (candidatePath) => {
        const actual = await fs.promises.stat(candidatePath);
        if (path.resolve(candidatePath) !== path.resolve(sourcePath)) return actual;
        reportedSize += 1;
        return {
          isFile: () => true,
          size: reportedSize,
          mtimeMs: actual.mtimeMs + reportedSize,
        };
      },
    },
  };
  const publisher = createMiniMaxH3OutputPublisher({
    fs: unstableFs,
    path,
    readRuntimeConfig: () => ({ ok: true, outputPath: fixture.outputPath }),
    getWarehouseDir: () => fixture.warehouseDir,
    wait: async () => {},
    stabilityAttempts: 3,
  });

  await assert.rejects(
    publisher.publish({
      promptId: "unstable-prompt",
      filename: "still-writing.mp4",
      subfolder: "video",
      type: "output",
    }),
    { code: "h3_output_source_unstable" },
  );
  assert.equal(fs.readdirSync(fixture.warehouseDir).length, 0);
});

test("publishing is idempotent and conflicting source filenames never overwrite an existing item", async (t) => {
  const fixture = createFixture(t, "idempotent");
  const sourcePath = writeOutput(fixture, "shared-name.mp4", "first-video");
  const firstPayload = {
    promptId: "first-prompt",
    filename: "shared-name.mp4",
    subfolder: "video",
    type: "output",
  };
  const first = await fixture.publisher.publish(firstPayload);

  fs.writeFileSync(sourcePath, "changed-source-that-must-not-replace-first");
  const duplicate = await fixture.publisher.publish(firstPayload);
  assert.deepEqual(duplicate, first);
  assert.equal(fs.readFileSync(first.localPath, "utf8"), "first-video");

  const second = await fixture.publisher.publish({ ...firstPayload, promptId: "second-prompt" });
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.localPath, first.localPath);
  assert.equal(fs.readFileSync(first.localPath, "utf8"), "first-video");
  assert.equal(fs.readFileSync(second.localPath, "utf8"), "changed-source-that-must-not-replace-first");
  assert.match(second.warehouseFilename, /^shared-name-[a-f0-9]{12}\.mp4$/);

  const items = await fixture.publisher.list();
  assert.equal(items.length, 2);
  assert.deepEqual(new Set(items.map((item) => item.id)), new Set([first.id, second.id]));
});

test("idempotent publish atomically fills missing timing without recopying or overwriting existing values", async (t) => {
  const fixture = createFixture(t, "idempotent-timing");
  writeOutput(fixture, "timed.mp4", "one-stable-video");
  const payload = {
    promptId: "timed-prompt",
    filename: "timed.mp4",
    subfolder: "video",
    type: "output",
  };
  const first = await fixture.publisher.publish(payload);
  const videoFilesBefore = fs.readdirSync(fixture.warehouseDir).filter((name) => /\.mp4$/i.test(name));
  assert.equal(videoFilesBefore.length, 1);
  assert.equal(Object.hasOwn(first, "mediaDurationSec"), false);
  assert.equal(Object.hasOwn(first, "generationElapsedSec"), false);

  const enriched = await fixture.publisher.publish({
    ...payload,
    mediaDurationSec: 15.084,
    generationElapsedSec: 372.538,
  });
  assert.equal(enriched.id, first.id);
  assert.equal(enriched.localPath, first.localPath);
  assert.equal(enriched.mediaDurationSec, 15.084);
  assert.equal(enriched.generationElapsedSec, 372.538);
  assert.equal(fs.readFileSync(enriched.localPath, "utf8"), "one-stable-video");
  assert.deepEqual(
    fs.readdirSync(fixture.warehouseDir).filter((name) => /\.mp4$/i.test(name)),
    videoFilesBefore,
  );

  const manifestPath = path.join(fixture.warehouseDir, "manifest.json");
  const enrichedManifestText = fs.readFileSync(manifestPath, "utf8");
  const conflicting = await fixture.publisher.publish({
    ...payload,
    mediaDurationSec: 14.5,
    generationElapsedSec: 400,
  });
  assert.equal(conflicting.mediaDurationSec, 15.084);
  assert.equal(conflicting.generationElapsedSec, 372.538);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), enrichedManifestText);
  assert.deepEqual(
    fs.readdirSync(fixture.warehouseDir).filter((name) => /\.mp4$/i.test(name)),
    videoFilesBefore,
  );

  const [restored] = await fixture.publisher.list();
  assert.equal(restored.mediaDurationSec, 15.084);
  assert.equal(restored.generationElapsedSec, 372.538);
});

test("a corrupt or symlinked manifest fails closed and is never silently replaced", async (t) => {
  const fixture = createFixture(t, "manifest-fail-closed");
  writeOutput(fixture, "safe.mp4", "safe-video");
  const manifestPath = path.join(fixture.warehouseDir, "manifest.json");
  const corruptText = "{ definitely-not-json";
  fs.writeFileSync(manifestPath, corruptText, "utf8");

  assert.deepEqual(await fixture.publisher.list(), []);
  assert.equal(await fixture.publisher.resolve("anything"), null);
  await assert.rejects(
    fixture.publisher.publish({ promptId: "p", filename: "safe.mp4", subfolder: "video", type: "output" }),
    { code: "h3_warehouse_manifest_invalid" },
  );
  assert.equal(fs.readFileSync(manifestPath, "utf8"), corruptText, "corrupt evidence must remain untouched");

  fs.unlinkSync(manifestPath);
  const externalManifest = path.join(fixture.testRoot, "external-manifest.json");
  fs.writeFileSync(externalManifest, JSON.stringify({ version: 1, items: [] }), "utf8");
  try {
    fs.symlinkSync(externalManifest, manifestPath, "file");
  } catch (error) {
    if (error && (error.code === "EPERM" || error.code === "EACCES")) return;
    throw error;
  }
  assert.deepEqual(await fixture.publisher.list(), []);
  await assert.rejects(
    fixture.publisher.publish({ promptId: "p", filename: "safe.mp4", subfolder: "video", type: "output" }),
    { code: "h3_warehouse_manifest_invalid" },
  );
});

test("list drops missing, outside-root, and symlinked manifest entries", async (t) => {
  const fixture = createFixture(t, "list-filter");
  writeOutput(fixture, "valid.mp4", "valid-video");
  const valid = await fixture.publisher.publish({
    promptId: "valid-prompt",
    filename: "valid.mp4",
    subfolder: "video",
    type: "output",
  });
  const manifestPath = path.join(fixture.warehouseDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const outsidePath = path.join(fixture.testRoot, "outside.mp4");
  fs.writeFileSync(outsidePath, "outside");
  const missingPath = path.join(fixture.warehouseDir, "missing.mp4");
  const copiedShape = {
    ...valid,
    id: "forged",
    promptId: "forged",
  };
  manifest.items.push({ ...copiedShape, id: "outside", localPath: outsidePath });
  manifest.items.push({ ...copiedShape, id: "missing", localPath: missingPath });

  const linkedPath = path.join(fixture.warehouseDir, "linked.mp4");
  let symlinkCreated = false;
  try {
    fs.symlinkSync(outsidePath, linkedPath, "file");
    symlinkCreated = true;
    manifest.items.push({ ...copiedShape, id: "linked", localPath: linkedPath });
  } catch (error) {
    if (!error || (error.code !== "EPERM" && error.code !== "EACCES")) throw error;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const listed = await fixture.publisher.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, valid.id);
  if (symlinkCreated) assert.equal(await fixture.publisher.resolve("linked"), null);
  assert.equal(await fixture.publisher.resolve("outside"), null);
  assert.equal(await fixture.publisher.resolve("missing"), null);
});
