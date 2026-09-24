const crypto = require("node:crypto");
const fsDefault = require("node:fs");
const pathDefault = require("node:path");

const MAX_SAFETENSORS_HEADER_BYTES = 16 * 1024 * 1024;
const MIN_STEPS = 1;
const MAX_STEPS = 10_000;
const STRENGTH_RANGE = Object.freeze({ min: 0, max: 2, default: 1, step: 0.05 });
const H3_LORA_DIRECTORY = "minimax_h3";
const MODE_ALIASES = Object.freeze({
  t2v: "t2v",
  text_video: "t2v",
  i2v: "i2v",
  image_video: "i2v",
  fl2v: "fl2v",
  first_last: "fl2v",
  r2v: "r2v",
  multi_reference: "r2v",
});
const FL2VA_MODES = new Set(["t2v", "i2v", "fl2v"]);
const REF2VA_MODES = new Set(["r2v"]);
const VALID_MODES = new Set([...FL2VA_MODES, ...REF2VA_MODES]);
const DTYPE_BYTES = Object.freeze({
  BOOL: 1, I8: 1, U8: 1, F8_E4M3: 1, F8_E5M2: 1, F8_E8M0: 1,
  I16: 2, U16: 2, F16: 2, BF16: 2,
  I32: 4, U32: 4, F32: 4,
  I64: 8, U64: 8, F64: 8,
});
// LoRAs are checked against the H3 model the animation panel loads in every mode (the renderer's
// ai-sequence-minimax-h3.workflow.js MODELS and worker/workflows/h3_i2v.json use this file), under
// the models root. Keep the two in step if the panel moves to another H3 build.
const H3_BASE_MODEL = Object.freeze(["diffusion_models", "Minimax_H3", "10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors"]);
// ComfyUI's LoRAAdapter pair spellings (down, up).
const PAIR_SUFFIXES = Object.freeze([
  [".lora_down.weight", ".lora_up.weight"],
  [".lora_A.weight", ".lora_B.weight"],
  [".lora_A.default.weight", ".lora_B.default.weight"],
  [".lora_linear_layer.down.weight", ".lora_linear_layer.up.weight"],
  [".lora.down.weight", ".lora.up.weight"],
  ["_lora.down.weight", "_lora.up.weight"],
  [".lora_A", ".lora_B"],
]);
const LORA_DTYPES = new Set(["F16", "BF16", "F32"]);

function normalizeMode(value) {
  const mode = MODE_ALIASES[String(value || "").trim().toLowerCase()] || "";
  return VALID_MODES.has(mode) ? mode : "";
}

function normalizeSteps(value) {
  const steps = Number(value);
  return Number.isInteger(steps) && steps >= MIN_STEPS && steps <= MAX_STEPS ? steps : 0;
}

function normalizeRuntimeName(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw || raw.startsWith("/") || /^[a-z]:\//i.test(raw)) return "";
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return "";
  return parts.join("/");
}

function runtimeNameKey(value) {
  return normalizeRuntimeName(value).toLowerCase();
}

function isSameOrInside(pathApi, targetPath, rootPath) {
  const relative = pathApi.relative(rootPath, targetPath);
  return relative === "" || (
    !!relative
    && relative !== ".."
    && !relative.startsWith(`..${pathApi.sep}`)
    && !pathApi.isAbsolute(relative)
  );
}

function isSameRealPath(pathApi, left, right) {
  const leftPath = pathApi.resolve(left);
  const rightPath = pathApi.resolve(right);
  return pathApi.sep === "\\"
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

function realpath(fsApi, value) {
  return typeof fsApi.realpathSync?.native === "function"
    ? fsApi.realpathSync.native(value)
    : fsApi.realpathSync(value);
}

function readExact(fsApi, fd, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const count = fsApi.readSync(fd, buffer, offset, buffer.length - offset, position + offset);
    if (!count) throw new Error("safetensors_unexpected_eof");
    offset += count;
  }
}

function readSafetensorsHeader(fsApi, filePath, statBefore) {
  let fd = null;
  try {
    fd = fsApi.openSync(filePath, "r");
    const lengthBytes = Buffer.allocUnsafe(8);
    readExact(fsApi, fd, lengthBytes, 0);
    const headerLengthBig = lengthBytes.readBigUInt64LE(0);
    if (headerLengthBig <= 0n || headerLengthBig > BigInt(MAX_SAFETENSORS_HEADER_BYTES)) {
      throw new Error("safetensors_header_size_invalid");
    }
    const headerLength = Number(headerLengthBig);
    if (8 + headerLength > Number(statBefore.size)) throw new Error("safetensors_header_truncated");

    const headerBytes = Buffer.allocUnsafe(headerLength);
    readExact(fsApi, fd, headerBytes, 8);
    const source = headerBytes.toString("utf8").replace(/\s+$/u, "");
    const header = JSON.parse(source);
    if (!header || typeof header !== "object" || Array.isArray(header)) {
      throw new Error("safetensors_header_invalid");
    }
    return {
      header,
      headerHash: crypto.createHash("sha256").update(headerBytes).digest("hex"),
      headerLength,
    };
  } finally {
    if (fd !== null) fsApi.closeSync(fd);
  }
}

function normalizeMetadata(header) {
  const source = header?.__metadata__;
  if (!source || typeof source !== "object" || Array.isArray(source)) return Object.freeze({});
  const normalized = {};
  for (const [key, value] of Object.entries(source)) {
    normalized[String(key || "").trim().toLowerCase()] = String(value ?? "").trim();
  }
  return Object.freeze(normalized);
}

function parseBaseFamily(metadata) {
  const value = String(metadata.ss_h3_lora_base || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (value === "fl2va") return "fl2va";
  if (value === "ref2va") return "ref2va";
  if (/^minimaxh3fl2va[a-z0-9.]*$/.test(value)) return "fl2va";
  if (/^minimaxh3ref2va[a-z0-9.]*$/.test(value)) return "ref2va";
  return "";
}

// A stored tensor of any rank (an alpha is 0-D) whose byte range matches its shape and dtype.
function isStoredTensor(value, tensorDataBytes) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!Array.isArray(value.shape) || !value.shape.every((part) => Number.isInteger(part) && part >= 0)) return false;
  const bytesPerElement = DTYPE_BYTES[String(value.dtype || "").toUpperCase()];
  if (!bytesPerElement) return false;
  const elementCount = value.shape.reduce((product, part) => product * part, 1);
  const offsets = value.data_offsets;
  return Number.isSafeInteger(elementCount)
    && Array.isArray(offsets) && offsets.length === 2
    && offsets.every((part) => Number.isSafeInteger(part) && part >= 0)
    && offsets[0] <= offsets[1] && offsets[1] <= tensorDataBytes
    && offsets[1] - offsets[0] === elementCount * bytesPerElement;
}

// ComfyUI's key map for MiniMax H3: every 2-D weight of the model under diffusion_model.<name> and
// lora_unet_<name with _>. H3 runs on its own engine (AI-Runtime-H3, ComfyUI 0.31.1), whose lora.py
// has no H3 branch for bare names (0.37 added one), and neither version maps transformer. or
// lycoris_ names. A model file with a diffusion_model. prefix contributes only those weights; a name
// two weights would share is dropped.
function h3Targets(baseHeader) {
  const targets = new Map();
  const ambiguous = new Set();
  const keys = Object.keys(baseHeader || {}).filter((key) => key !== "__metadata__");
  const prefixed = keys.some((key) => /^(?:model\.)?diffusion_model\./.test(key));
  for (const key of keys) {
    const value = baseHeader[key];
    if (!key.endsWith(".weight") || !Array.isArray(value?.shape) || value.shape.length !== 2) continue;
    if (prefixed && !/^(?:model\.)?diffusion_model\./.test(key)) continue;
    const name = key.replace(/^(?:model\.)?diffusion_model\./, "").slice(0, -".weight".length);
    const target = { name, shape: value.shape };
    for (const alias of [`diffusion_model.${name}`, `lora_unet_${name.replace(/\./g, "_")}`]) {
      if (targets.has(alias) && targets.get(alias).name !== name) ambiguous.add(alias);
      targets.set(alias, target);
    }
  }
  for (const alias of ambiguous) targets.delete(alias);
  return targets;
}

// A LoRA fits the model when ComfyUI would apply all of it: every pair lands on a model weight of
// exactly its shape (a same-sized pair on another layout would be reshaped onto it silently), no
// weight is hit twice (the later would silently replace the earlier), and the file holds nothing
// else (DoRA scales, LoKr / LoHa parts, text-encoder keys). Which modules it trains is up to it: an
// attention-only LoRA, or one that also trains adaln_proj or condition_proj, is fine.
// The file as ComfyUI's loaders read it: when DynamicVRAM is off it falls back to safetensors'
// safe_open, which refuses gaps, overlaps or trailing bytes in the data and non-string metadata.
function isWholeSafetensors(header, entries, tensorDataBytes) {
  const metadata = header?.__metadata__;
  if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
    || !Object.values(metadata).every((value) => typeof value === "string"))) return false;
  if (!entries.every(([, value]) => isStoredTensor(value, tensorDataBytes))) return false;
  const spans = entries.map(([, value]) => value.data_offsets).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let end = 0;
  for (const [start, stop] of spans) {
    if (start !== end) return false;
    end = stop;
  }
  return end === tensorDataBytes;
}

function h3LoraFits(header, tensorDataBytes, targets) {
  const entries = Object.entries(header || {}).filter(([name]) => name !== "__metadata__");
  if (!entries.length || !isWholeSafetensors(header, entries, tensorDataBytes)) return false;
  const consumed = new Set();
  const hit = new Set();
  let pairs = 0;
  for (const [name, down] of entries) {
    if (consumed.has(name)) continue;
    const suffix = PAIR_SUFFIXES.find(([downSuffix]) => name.endsWith(downSuffix));
    if (!suffix) continue;
    const prefix = name.slice(0, -suffix[0].length);
    const upName = prefix + suffix[1];
    const up = header[upName];
    const target = targets.get(prefix);
    if (!up || !target || hit.has(target.name)) return false;
    const [output, input] = target.shape;
    if (down.shape.length !== 2 || up.shape.length !== 2 || down.shape[0] < 1 || down.shape[0] !== up.shape[1]
      || down.shape[1] !== input || up.shape[0] !== output) return false;
    if (!LORA_DTYPES.has(String(down.dtype).toUpperCase()) || !LORA_DTYPES.has(String(up.dtype).toUpperCase())) return false;
    hit.add(target.name);
    consumed.add(name);
    consumed.add(upName);
    // One value, in a dtype the H3 engine's loader reads (its DynamicVRAM table has no F8_E8M0).
    const alpha = header[`${prefix}.alpha`];
    if (alpha) {
      if (alpha.shape.reduce((product, part) => product * part, 1) !== 1 || !LORA_DTYPES.has(String(alpha.dtype).toUpperCase())) return false;
      consumed.add(`${prefix}.alpha`);
    }
    pairs += 1;
  }
  return pairs > 0 && entries.every(([name]) => consumed.has(name));
}

function parseStepList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(Number).filter((step) => normalizeSteps(step) === step))].sort((a, b) => a - b);
  }
  const source = String(value ?? "").trim();
  if (!source) return [];
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return parseStepList(parsed);
  } catch { void 0; }
  return [...new Set(
    source.split(/[,|/\s]+/).map(Number).filter((step) => normalizeSteps(step) === step),
  )].sort((a, b) => a - b);
}

function inferRequiredSteps(metadata, name) {
  const metadataKeys = [
    "ss_h3_lora_required_steps",
    "ss_h3_lora_steps",
    "novaflow_required_steps",
  ];
  for (const key of metadataKeys) {
    const steps = parseStepList(metadata[key]);
    if (steps.length) return steps;
  }
  const matches = [...String(name || "").toLowerCase().matchAll(/(?:^|[_.-])(\d{1,4})[_.-]?steps?(?=$|[_.-])/g)];
  return [...new Set(matches.map((match) => Number(match[1])).filter((step) => normalizeSteps(step) === step))]
    .sort((a, b) => a - b);
}

function classifyKind(metadata, name, supportedSteps) {
  const hint = `${metadata.ss_h3_lora_kind || ""} ${metadata.ss_h3_lora_type || ""} ${name}`.toLowerCase();
  return supportedSteps.length || /(?:turbo|accelerat|lightx2v|lightning)/.test(hint)
    ? "accelerator"
    : "standard";
}

function isManagedTurbo(metadata, name) {
  const managed = String(metadata.novaflow_managed || metadata.ss_h3_lora_managed || "").trim().toLowerCase();
  if (["1", "true", "yes", "managed"].includes(managed)) return true;
  return /(?:^|[\\/])minimax_h3_fl2v_lightx2v_turbo_4step_v0\.1_comfy\.safetensors$/i.test(String(name || ""));
}

function supportsMode(modelFamily, mode) {
  if (modelFamily === "h3") return VALID_MODES.has(mode);
  return modelFamily === "fl2va" ? FL2VA_MODES.has(mode) : modelFamily === "ref2va" && REF2VA_MODES.has(mode);
}

function fingerprintFor(stat, headerHash) {
  return `v1:${Number(stat.size)}:${Number(stat.mtimeMs)}:${headerHash}`;
}

function extractRuntimeNames(value) {
  if (value instanceof Set) return [...value].map(String);
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
  const direct = value?.names;
  if (Array.isArray(direct)) return direct.filter((entry) => typeof entry === "string");
  const objectInfoNames = value?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0];
  return Array.isArray(objectInfoNames) ? objectInfoNames.filter((entry) => typeof entry === "string") : [];
}

function createMiniMaxH3LoraCatalog(options = {}) {
  const fsApi = options.fs || fsDefault;
  const pathApi = options.path || pathDefault;
  const readConfig = options.readConfig;
  const listRuntimeLoraNames = options.listRuntimeLoraNames;
  const expectedModelsPath = options.expectedModelsPath;
  const baseModelParts = Array.isArray(options.baseModel) ? options.baseModel : H3_BASE_MODEL;
  let baseCache = null;
  if (typeof readConfig !== "function") throw new TypeError("readConfig must be a function");
  if (typeof listRuntimeLoraNames !== "function") throw new TypeError("listRuntimeLoraNames must be a function");
  if (expectedModelsPath != null && typeof expectedModelsPath !== "function") {
    throw new TypeError("expectedModelsPath must be a function");
  }

  async function resolveContext() {
    let config;
    try {
      config = await Promise.resolve(readConfig());
    } catch {
      return null;
    }
    const modelsPath = String(config?.modelsPath || "").trim();
    if (!modelsPath || config?.ok === false) return null;
    let modelsRootReal;
    let expectedModelsRootReal;
    let lorasRootReal;
    let h3LorasRootReal;
    try {
      modelsRootReal = realpath(fsApi, pathApi.resolve(modelsPath));
      if (!fsApi.statSync(modelsRootReal).isDirectory()) return null;
      if (expectedModelsPath) {
        const expected = String(await Promise.resolve(expectedModelsPath(config)) || "").trim();
        if (!expected) return null;
        expectedModelsRootReal = realpath(fsApi, pathApi.resolve(expected));
        if (!fsApi.statSync(expectedModelsRootReal).isDirectory()) return null;
        if (!isSameRealPath(pathApi, modelsRootReal, expectedModelsRootReal)) return null;
      }
      const lorasPath = pathApi.join(modelsRootReal, "loras");
      lorasRootReal = realpath(fsApi, lorasPath);
      if (!fsApi.statSync(lorasRootReal).isDirectory()) return null;
      if (!isSameOrInside(pathApi, lorasRootReal, modelsRootReal)) return null;
      const h3LorasPath = pathApi.join(modelsRootReal, "loras", H3_LORA_DIRECTORY);
      h3LorasRootReal = realpath(fsApi, h3LorasPath);
      if (!fsApi.statSync(h3LorasRootReal).isDirectory()) return null;
      if (!isSameOrInside(pathApi, h3LorasRootReal, lorasRootReal)) return null;
    } catch {
      return null;
    }

    // Without the model the panel loads there is nothing to check against: an empty list.
    let targets;
    try {
      const baseReal = realpath(fsApi, pathApi.join(modelsRootReal, ...baseModelParts));
      if (!isSameOrInside(pathApi, baseReal, modelsRootReal)) return null;
      const baseStat = fsApi.statSync(baseReal);
      if (!baseStat.isFile()) return null;
      const stamp = `${baseReal}:${Number(baseStat.size)}:${Number(baseStat.mtimeMs)}`;
      if (baseCache?.stamp !== stamp) {
        baseCache = { stamp, targets: h3Targets(readSafetensorsHeader(fsApi, baseReal, baseStat).header) };
      }
      targets = baseCache.targets;
      if (!targets.size) return null;
    } catch {
      return null;
    }

    let names;
    try {
      names = extractRuntimeNames(await Promise.resolve(listRuntimeLoraNames()));
    } catch {
      return null;
    }
    const runtimeNames = new Map();
    for (const original of names) {
      const normalized = normalizeRuntimeName(original);
      if (!normalized) continue;
      runtimeNames.set(normalized.toLowerCase(), String(original));
    }
    return { lorasPath: h3LorasRootReal, lorasRootReal: h3LorasRootReal, runtimeNames, targets };
  }

  function scanFiles(context) {
    const files = [];
    const visitedDirectories = new Set();

    function visit(directoryPath, relativeParts) {
      let directoryReal;
      try {
        directoryReal = realpath(fsApi, directoryPath);
        if (!isSameOrInside(pathApi, directoryReal, context.lorasRootReal)) return;
        const key = pathApi.sep === "\\" ? directoryReal.toLowerCase() : directoryReal;
        if (visitedDirectories.has(key)) return;
        visitedDirectories.add(key);
      } catch {
        return;
      }

      let entries;
      try {
        entries = fsApi.readdirSync(directoryPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const candidate = pathApi.join(directoryPath, entry.name);
        let targetReal;
        let targetStat;
        try {
          targetReal = realpath(fsApi, candidate);
          if (!isSameOrInside(pathApi, targetReal, context.lorasRootReal)) continue;
          targetStat = fsApi.statSync(targetReal);
        } catch {
          continue;
        }
        if (targetStat.isDirectory()) {
          visit(candidate, [...relativeParts, entry.name]);
          continue;
        }
        if (!targetStat.isFile() || !/\.safetensors$/i.test(entry.name)) continue;
        const relativeName = [H3_LORA_DIRECTORY, ...relativeParts, entry.name].join("/");
        const runtimeName = context.runtimeNames.get(runtimeNameKey(relativeName));
        if (!runtimeName) continue;
        files.push({ filePath: targetReal, runtimeName });
      }
    }

    visit(context.lorasPath, []);
    return files;
  }

  function inspectFile(file, mode, steps, targets) {
    try {
      const statBefore = fsApi.statSync(file.filePath);
      if (!statBefore.isFile()) return null;
      const parsed = readSafetensorsHeader(fsApi, file.filePath, statBefore);
      const statAfter = fsApi.statSync(file.filePath);
      if (statAfter.size !== statBefore.size || statAfter.mtimeMs !== statBefore.mtimeMs) return null;
      const tensorDataBytes = Number(statAfter.size) - 8 - parsed.headerLength;
      const metadata = normalizeMetadata(parsed.header);
      if (!h3LoraFits(parsed.header, tensorDataBytes, targets)) return null;
      // A declared base still decides the modes (FL2VA: t2v / i2v / fl2v, Ref2VA: r2v); one that
      // cannot be read hides the file; none means any mode.
      const declaredFamily = parseBaseFamily(metadata);
      if (metadata.ss_h3_lora_base && !declaredFamily) return null;
      const modelFamily = declaredFamily || "h3";
      if (!supportsMode(modelFamily, mode)) return null;
      if (isManagedTurbo(metadata, file.runtimeName)) return null;

      const supportedSteps = inferRequiredSteps(metadata, file.runtimeName);
      const kind = classifyKind(metadata, file.runtimeName, supportedSteps);
      // Acceleration profiles are owned by NovaFlow's sampler policy. They are
      // never exposed as user LoRAs, even when their declared step count fits.
      if (kind !== "standard") return null;
      return Object.freeze({
        name: file.runtimeName,
        modelFamily,
        kind,
        supportedSteps: supportedSteps.length ? Object.freeze([...supportedSteps]) : null,
        strengthRange: STRENGTH_RANGE,
        fingerprint: fingerprintFor(statAfter, parsed.headerHash),
      });
    } catch {
      return null;
    }
  }

  async function catalog(input = {}) {
    const mode = normalizeMode(input.mode);
    const steps = normalizeSteps(input.steps);
    if (!mode || !steps) return Object.freeze([]);
    const context = await resolveContext();
    if (!context) return Object.freeze([]);
    const items = scanFiles(context)
      .map((file) => inspectFile(file, mode, steps, context.targets))
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
    return Object.freeze(items);
  }

  async function validate(input = {}) {
    const mode = normalizeMode(input.mode);
    if (!mode) return Object.freeze({ ok: false, error: "invalid_mode" });
    const steps = normalizeSteps(input.steps);
    if (!steps) return Object.freeze({ ok: false, error: "invalid_steps" });
    const name = String(input.name || "");
    const key = runtimeNameKey(name);
    if (!key) return Object.freeze({ ok: false, error: "invalid_name" });
    const fingerprint = String(input.fingerprint || "");
    if (!fingerprint) return Object.freeze({ ok: false, error: "invalid_fingerprint" });
    const strength = Number(input.strength);
    if (!Number.isFinite(strength) || strength < STRENGTH_RANGE.min || strength > STRENGTH_RANGE.max) {
      return Object.freeze({ ok: false, error: "invalid_strength" });
    }

    const items = await catalog({ mode, steps });
    const item = items.find((entry) => runtimeNameKey(entry.name) === key);
    if (!item) return Object.freeze({ ok: false, error: "lora_not_available" });
    if (item.fingerprint !== fingerprint) return Object.freeze({ ok: false, error: "fingerprint_mismatch" });
    return Object.freeze({ ok: true, item, strength });
  }

  return Object.freeze({ catalog, validate });
}

module.exports = Object.freeze({
  MAX_SAFETENSORS_HEADER_BYTES,
  MIN_STEPS,
  MAX_STEPS,
  H3_LORA_DIRECTORY,
  STRENGTH_RANGE,
  createMiniMaxH3LoraCatalog,
});
