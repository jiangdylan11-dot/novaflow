"use strict";

const crypto = require("node:crypto");
const nativeFs = require("node:fs");

const MANIFEST_VERSION = 1;
const MANIFEST_FILENAME = "manifest.json";
const RUNTIME_BASE_URL = "http://127.0.0.1:8189";
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);
const MAX_MEDIA_DURATION_SEC = 60;
const MAX_GENERATION_ELAPSED_SEC = 24 * 60 * 60;

function publisherError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createMiniMaxH3OutputPublisher(options = {}) {
  const fileSystem = options.fs || nativeFs;
  const pathApi = options.path || require("node:path");
  const promises = fileSystem.promises;
  const readRuntimeConfig = options.readRuntimeConfig;
  const getWarehouseDir = options.getWarehouseDir;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const randomBytes = typeof options.randomBytes === "function" ? options.randomBytes : crypto.randomBytes;
  const wait = typeof options.wait === "function"
    ? options.wait
    : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
  const stabilityAttempts = Math.max(2, Number(options.stabilityAttempts) || 3);
  const stabilityDelayMs = Math.max(0, Number(options.stabilityDelayMs) || 25);

  if (!promises || typeof promises.realpath !== "function") {
    throw publisherError("h3_output_publisher_fs_promises_required");
  }
  if (typeof readRuntimeConfig !== "function") {
    throw publisherError("h3_output_publisher_runtime_config_required");
  }
  if (typeof getWarehouseDir !== "function") {
    throw publisherError("h3_output_publisher_warehouse_dir_required");
  }

  let publishQueue = Promise.resolve();

  function randomToken() {
    const value = randomBytes(10);
    return Buffer.isBuffer(value) ? value.toString("hex") : String(value).replace(/[^a-zA-Z0-9_-]/g, "");
  }

  function isInside(rootPath, candidatePath, allowRoot = false) {
    const relative = pathApi.relative(rootPath, candidatePath);
    if (relative === "") return allowRoot;
    return relative !== ".."
      && !relative.startsWith(`..${pathApi.sep}`)
      && !pathApi.isAbsolute(relative);
  }

  function normalizeSubfolder(value) {
    if (value == null || value === "") return "";
    if (typeof value !== "string" || value.includes("\0") || pathApi.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) {
      throw publisherError("h3_output_subfolder_invalid");
    }
    const segments = value.split(/[\\/]+/);
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw publisherError("h3_output_subfolder_invalid");
    }
    return segments.join("/");
  }

  function validateFilename(value) {
    if (typeof value !== "string"
      || !value
      || value.includes("\0")
      || value !== pathApi.basename(value)
      || /[\\/]/.test(value)) {
      throw publisherError("h3_output_filename_invalid");
    }
    const extension = pathApi.extname(value).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(extension)) {
      throw publisherError("h3_output_video_extension_required");
    }
    return value;
  }

  function normalizeOptionalMetric(value, code, minimum, maximum, minimumInclusive) {
    if (value == null) return undefined;
    if (typeof value !== "number"
      || !Number.isFinite(value)
      || (minimumInclusive ? value < minimum : value <= minimum)
      || value > maximum) {
      throw publisherError(code);
    }
    return value;
  }

  function normalizeOptionalTiming(value) {
    const mediaDurationSec = normalizeOptionalMetric(
      value?.mediaDurationSec,
      "h3_output_media_duration_invalid",
      0,
      MAX_MEDIA_DURATION_SEC,
      false,
    );
    const generationElapsedSec = normalizeOptionalMetric(
      value?.generationElapsedSec,
      "h3_output_generation_elapsed_invalid",
      0,
      MAX_GENERATION_ELAPSED_SEC,
      true,
    );
    return {
      ...(mediaDurationSec === undefined ? {} : { mediaDurationSec }),
      ...(generationElapsedSec === undefined ? {} : { generationElapsedSec }),
    };
  }

  function enrichMissingTiming(item, input) {
    let changed = false;
    const enriched = { ...item };
    for (const field of ["mediaDurationSec", "generationElapsedSec"]) {
      if (input[field] === undefined || item[field] !== undefined) continue;
      enriched[field] = input[field];
      changed = true;
    }
    return changed ? Object.freeze(enriched) : item;
  }

  function validatePublishInput(input) {
    if (!isPlainObject(input) || input.type !== "output") {
      throw publisherError("h3_output_type_invalid");
    }
    const promptId = typeof input.promptId === "string" ? input.promptId.trim() : "";
    if (!promptId || promptId.includes("\0") || promptId.length > 1024) {
      throw publisherError("h3_output_prompt_id_invalid");
    }
    const filename = validateFilename(input.filename);
    const subfolder = normalizeSubfolder(input.subfolder);
    return { promptId, filename, subfolder, type: "output", ...normalizeOptionalTiming(input) };
  }

  async function pathExists(candidatePath) {
    try {
      await promises.lstat(candidatePath);
      return true;
    } catch (error) {
      if (error && error.code === "ENOENT") return false;
      throw error;
    }
  }

  async function assertDirectoryRoot(rootPath, errorCode) {
    let rootStat;
    try {
      rootStat = await promises.lstat(rootPath);
    } catch (error) {
      throw publisherError(errorCode, error);
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw publisherError(errorCode);
    }
    return promises.realpath(rootPath);
  }

  async function assertNoSymlinkTraversal(rootPath, candidatePath, finalKind) {
    const relative = pathApi.relative(rootPath, candidatePath);
    if (!relative || !isInside(rootPath, candidatePath)) {
      throw publisherError("h3_output_path_outside_root");
    }
    const parts = relative.split(pathApi.sep).filter(Boolean);
    let currentPath = rootPath;
    for (let index = 0; index < parts.length; index += 1) {
      currentPath = pathApi.join(currentPath, parts[index]);
      let stat;
      try {
        stat = await promises.lstat(currentPath);
      } catch (error) {
        throw publisherError("h3_output_source_missing", error);
      }
      if (stat.isSymbolicLink()) {
        throw publisherError("h3_output_symlink_forbidden");
      }
      const isFinal = index === parts.length - 1;
      if (!isFinal && !stat.isDirectory()) {
        throw publisherError("h3_output_source_missing");
      }
      if (isFinal && finalKind === "file" && !stat.isFile()) {
        throw publisherError("h3_output_source_not_file");
      }
    }
  }

  async function resolveSource(input) {
    let config;
    try {
      config = await readRuntimeConfig();
    } catch (error) {
      throw publisherError("h3_output_runtime_config_unavailable", error);
    }
    if (!isPlainObject(config) || config.ok === false) {
      throw publisherError("h3_output_runtime_config_unavailable");
    }
    const configuredOutput = typeof config.outputPath === "string" && config.outputPath.trim()
      ? config.outputPath
      : (typeof config.generatedPath === "string" && config.generatedPath.trim()
        ? pathApi.join(config.generatedPath, "output")
        : "");
    if (!configuredOutput) throw publisherError("h3_output_root_unavailable");

    const sourceRoot = pathApi.resolve(configuredOutput);
    const realSourceRoot = await assertDirectoryRoot(sourceRoot, "h3_output_root_invalid");
    const sourcePath = pathApi.resolve(sourceRoot, ...input.subfolder.split("/").filter(Boolean), input.filename);
    if (!isInside(sourceRoot, sourcePath)) throw publisherError("h3_output_path_outside_root");
    await assertNoSymlinkTraversal(sourceRoot, sourcePath, "file");

    let realSourcePath;
    try {
      realSourcePath = await promises.realpath(sourcePath);
    } catch (error) {
      throw publisherError("h3_output_source_missing", error);
    }
    if (!isInside(realSourceRoot, realSourcePath)) {
      throw publisherError("h3_output_path_outside_root");
    }
    return { sourcePath, realSourcePath };
  }

  async function resolveWarehouse() {
    let configuredPath;
    try {
      configuredPath = await getWarehouseDir();
    } catch (error) {
      throw publisherError("h3_warehouse_dir_unavailable", error);
    }
    if (typeof configuredPath !== "string" || !configuredPath.trim() || configuredPath.includes("\0")) {
      throw publisherError("h3_warehouse_dir_unavailable");
    }
    const warehouseDir = pathApi.resolve(configuredPath);
    try {
      await promises.mkdir(warehouseDir, { recursive: true });
    } catch (error) {
      throw publisherError("h3_warehouse_dir_unavailable", error);
    }
    const realWarehouseDir = await assertDirectoryRoot(warehouseDir, "h3_warehouse_dir_invalid");
    return {
      warehouseDir,
      realWarehouseDir,
      manifestPath: pathApi.join(warehouseDir, MANIFEST_FILENAME),
    };
  }

  function parseManifest(text) {
    let parsed;
    try {
      parsed = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    } catch (error) {
      throw publisherError("h3_warehouse_manifest_invalid", error);
    }
    if (!isPlainObject(parsed) || parsed.version !== MANIFEST_VERSION || !Array.isArray(parsed.items)) {
      throw publisherError("h3_warehouse_manifest_invalid");
    }
    return parsed.items;
  }

  async function readManifest(warehouse, { failClosed = false } = {}) {
    try {
      const manifestStat = await promises.lstat(warehouse.manifestPath);
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
        throw publisherError("h3_warehouse_manifest_invalid");
      }
      return parseManifest(await promises.readFile(warehouse.manifestPath, "utf8"));
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      if (failClosed) return null;
      if (error && error.code === "h3_warehouse_manifest_invalid") throw error;
      throw publisherError("h3_warehouse_manifest_invalid", error);
    }
  }

  function canonicalItem(rawItem) {
    if (!isPlainObject(rawItem)
      || typeof rawItem.id !== "string"
      || !rawItem.id
      || typeof rawItem.localPath !== "string"
      || !pathApi.isAbsolute(rawItem.localPath)
      || typeof rawItem.promptId !== "string"
      || typeof rawItem.filename !== "string"
      || rawItem.type !== "local"
      || rawItem.sourceKind !== "minimax_h3_output"
      || rawItem.runtimeKind !== "minimax_h3_local"
      || rawItem.runtimeBaseUrl !== RUNTIME_BASE_URL) {
      return null;
    }
    if (!VIDEO_EXTENSIONS.has(pathApi.extname(rawItem.localPath).toLowerCase())) return null;
    const createdAt = Number(rawItem.createdAt);
    if (!Number.isFinite(createdAt)) return null;
    let timing;
    try {
      timing = normalizeOptionalTiming(rawItem);
    } catch {
      return null;
    }
    return {
      id: rawItem.id,
      warehouseKey: typeof rawItem.warehouseKey === "string" ? rawItem.warehouseKey : "",
      createdAt,
      promptId: rawItem.promptId,
      filename: rawItem.filename,
      warehouseFilename: typeof rawItem.warehouseFilename === "string"
        ? rawItem.warehouseFilename
        : pathApi.basename(rawItem.localPath),
      localPath: pathApi.resolve(rawItem.localPath),
      type: "local",
      sourceKind: "minimax_h3_output",
      runtimeKind: "minimax_h3_local",
      runtimeBaseUrl: RUNTIME_BASE_URL,
      sourceFilename: typeof rawItem.sourceFilename === "string" ? rawItem.sourceFilename : rawItem.filename,
      sourceSubfolder: typeof rawItem.sourceSubfolder === "string" ? rawItem.sourceSubfolder : "",
      ...timing,
    };
  }

  async function validateStoredItem(rawItem, warehouse) {
    const item = canonicalItem(rawItem);
    if (!item || !isInside(warehouse.realWarehouseDir, item.localPath)) return null;
    try {
      await assertNoSymlinkTraversal(warehouse.realWarehouseDir, item.localPath, "file");
      const realItemPath = await promises.realpath(item.localPath);
      if (!isInside(warehouse.realWarehouseDir, realItemPath)) return null;
    } catch {
      return null;
    }
    return Object.freeze(item);
  }

  async function validManifestItems(rawItems, warehouse) {
    const results = [];
    const ids = new Set();
    for (const rawItem of rawItems) {
      const item = await validateStoredItem(rawItem, warehouse);
      if (item && !ids.has(item.id)) {
        ids.add(item.id);
        results.push(item);
      }
    }
    return results;
  }

  async function writeManifest(warehouse, items) {
    if (await pathExists(warehouse.manifestPath)) {
      const stat = await promises.lstat(warehouse.manifestPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw publisherError("h3_warehouse_manifest_invalid");
    }
    const temporaryPath = pathApi.join(warehouse.warehouseDir, `.manifest-${randomToken()}.tmp`);
    const data = `${JSON.stringify({ version: MANIFEST_VERSION, items }, null, 2)}\n`;
    let handle;
    try {
      handle = await promises.open(temporaryPath, "wx", 0o600);
      await handle.writeFile(data, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await promises.rename(temporaryPath, warehouse.manifestPath);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await promises.unlink(temporaryPath).catch(() => {});
      throw publisherError("h3_warehouse_manifest_write_failed", error);
    }
  }

  function sameFileSnapshot(left, right) {
    return left.isFile()
      && right.isFile()
      && left.size === right.size
      && left.mtimeMs === right.mtimeMs;
  }

  async function waitForStableSource(sourcePath) {
    let previous = null;
    for (let attempt = 0; attempt < stabilityAttempts; attempt += 1) {
      let current;
      try {
        current = await promises.stat(sourcePath);
      } catch (error) {
        throw publisherError("h3_output_source_missing", error);
      }
      if (!current.isFile()) throw publisherError("h3_output_source_not_file");
      if (previous && sameFileSnapshot(previous, current)) return current;
      previous = current;
      if (attempt < stabilityAttempts - 1) await wait(stabilityDelayMs);
    }
    throw publisherError("h3_output_source_unstable");
  }

  async function chooseDestination(warehouse, input, warehouseKey) {
    const extension = pathApi.extname(input.filename);
    const stem = pathApi.basename(input.filename, extension);
    const candidates = [
      input.filename,
      `${stem}-${warehouseKey.slice(0, 12)}${extension}`,
      `${stem}-${warehouseKey.slice(0, 12)}-${randomToken().slice(0, 10)}${extension}`,
    ];
    for (const candidateName of candidates) {
      const candidatePath = pathApi.join(warehouse.warehouseDir, candidateName);
      if (!isInside(warehouse.realWarehouseDir, candidatePath)) continue;
      if (!await pathExists(candidatePath)) return { destinationPath: candidatePath, warehouseFilename: candidateName };
    }
    throw publisherError("h3_warehouse_filename_conflict");
  }

  async function copyStableSource(sourcePath, destinationPath, warehouseKey) {
    const copyFlag = (fileSystem.constants && fileSystem.constants.COPYFILE_EXCL)
      || nativeFs.constants.COPYFILE_EXCL;
    for (let attempt = 0; attempt < stabilityAttempts; attempt += 1) {
      const stableStat = await waitForStableSource(sourcePath);
      const temporaryPath = pathApi.join(
        pathApi.dirname(destinationPath),
        `.h3-publish-${warehouseKey.slice(0, 16)}-${randomToken()}.tmp`,
      );
      try {
        await promises.copyFile(sourcePath, temporaryPath, copyFlag);
        const [sourceAfterCopy, copiedStat] = await Promise.all([
          promises.stat(sourcePath),
          promises.stat(temporaryPath),
        ]);
        if (!sameFileSnapshot(stableStat, sourceAfterCopy) || copiedStat.size !== sourceAfterCopy.size) {
          await promises.unlink(temporaryPath).catch(() => {});
          continue;
        }
        if (await pathExists(destinationPath)) {
          await promises.unlink(temporaryPath).catch(() => {});
          throw publisherError("h3_warehouse_filename_conflict");
        }
        await promises.rename(temporaryPath, destinationPath);
        return;
      } catch (error) {
        await promises.unlink(temporaryPath).catch(() => {});
        if (error && error.code === "h3_warehouse_filename_conflict") throw error;
        if (attempt === stabilityAttempts - 1) {
          throw publisherError("h3_output_copy_failed", error);
        }
      }
    }
    throw publisherError("h3_output_source_unstable");
  }

  async function publishUnlocked(rawInput) {
    const input = validatePublishInput(rawInput);
    const logicalId = `${input.promptId}:${input.type}:${input.subfolder}:${input.filename}`;
    const warehouseKey = crypto.createHash("sha256").update(logicalId).digest("hex");
    const warehouse = await resolveWarehouse();
    const rawItems = await readManifest(warehouse);
    const items = await validManifestItems(rawItems, warehouse);
    const existing = items.find((item) => item.id === logicalId);
    if (existing) {
      const enriched = enrichMissingTiming(existing, input);
      if (enriched !== existing) {
        await writeManifest(
          warehouse,
          items.map((item) => item.id === existing.id ? enriched : item),
        );
      }
      return enriched;
    }

    const source = await resolveSource(input);
    const destination = await chooseDestination(warehouse, input, warehouseKey);
    await copyStableSource(source.realSourcePath, destination.destinationPath, warehouseKey);

    const item = Object.freeze({
      id: logicalId,
      warehouseKey,
      createdAt: Number(now()),
      promptId: input.promptId,
      filename: input.filename,
      warehouseFilename: destination.warehouseFilename,
      localPath: destination.destinationPath,
      type: "local",
      sourceKind: "minimax_h3_output",
      runtimeKind: "minimax_h3_local",
      runtimeBaseUrl: RUNTIME_BASE_URL,
      sourceFilename: input.filename,
      sourceSubfolder: input.subfolder,
      ...normalizeOptionalTiming(input),
    });
    try {
      await writeManifest(warehouse, [...items, item]);
    } catch (error) {
      await promises.unlink(destination.destinationPath).catch(() => {});
      throw error;
    }
    return item;
  }

  function publish(input) {
    const operation = publishQueue.then(
      () => publishUnlocked(input),
      () => publishUnlocked(input),
    );
    publishQueue = operation.catch(() => {});
    return operation;
  }

  async function list() {
    try {
      const warehouse = await resolveWarehouse();
      const rawItems = await readManifest(warehouse, { failClosed: true });
      if (!rawItems) return Object.freeze([]);
      const items = await validManifestItems(rawItems, warehouse);
      return Object.freeze(items);
    } catch {
      return Object.freeze([]);
    }
  }

  async function resolve(id) {
    if (typeof id !== "string" || !id) return null;
    const items = await list();
    const item = items.find((candidate) => candidate.id === id);
    return item ? item.localPath : null;
  }

  return Object.freeze({ publish, list, resolve });
}

module.exports = { createMiniMaxH3OutputPublisher };
