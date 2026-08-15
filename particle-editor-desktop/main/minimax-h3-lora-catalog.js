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
const H3_NETWORK_MODULE = "networks.lora_minimax_h3";
const H3_TARGET_DIMENSIONS = Object.freeze({
  attn_out_proj: Object.freeze({ input: 7168, output: 5376 }),
  attn_qkv_proj: Object.freeze({ input: 5376, output: 21504 }),
  mlp_fc1: Object.freeze({ input: 5376, output: 28672 }),
  mlp_fc2: Object.freeze({ input: 14336, output: 5376 }),
});

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

function hasH3NetworkModule(metadata) {
  return String(metadata.ss_network_module || "").trim().toLowerCase() === H3_NETWORK_MODULE;
}

function isTensorEntry(value, tensorDataBytes) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!String(value.dtype || "").trim()) return false;
  if (!Array.isArray(value.shape) || value.shape.length < 2) return false;
  if (!value.shape.every((part) => Number.isInteger(part) && part > 0)) return false;
  const bytesPerElement = DTYPE_BYTES[String(value.dtype).toUpperCase()];
  if (!bytesPerElement) return false;
  const elementCount = value.shape.reduce((product, part) => product * part, 1);
  if (!Number.isSafeInteger(elementCount)) return false;
  const offsets = value.data_offsets;
  if (!(Array.isArray(offsets)
    && offsets.length === 2
    && offsets.every((part) => Number.isSafeInteger(part) && part >= 0)
    && offsets[0] <= offsets[1]
    && offsets[1] <= tensorDataBytes)) return false;
  return offsets[1] - offsets[0] === elementCount * bytesPerElement;
}

function parseH3TargetTensor(name) {
  const match = String(name || "").match(
    /^lora_unet_blocks_(\d+)_(attn_out_proj|attn_qkv_proj|mlp_fc1|mlp_fc2)\.lora_(down|up)\.weight$/i,
  );
  if (!match) return null;
  const block = Number(match[1]);
  if (!Number.isSafeInteger(block)) return null;
  const target = match[2].toLowerCase();
  return {
    key: `${block}:${target}`,
    side: match[3].toLowerCase(),
    dimensions: H3_TARGET_DIMENSIONS[target],
  };
}

function looksLikeLoraWeight(name) {
  return /(?:[._]lora_(?:a|b|down|up)(?:[._]default)?\.weight)$/i.test(String(name || ""));
}

function hasH3TensorSignature(header, tensorDataBytes) {
  const pairs = new Map();
  for (const [name, value] of Object.entries(header || {})) {
    if (name === "__metadata__") continue;
    const target = parseH3TargetTensor(name);
    if (!target) {
      if (looksLikeLoraWeight(name)) return false;
      continue;
    }
    if (!isTensorEntry(value, tensorDataBytes) || value.shape.length !== 2) return false;
    const current = pairs.get(target.key) || { dimensions: target.dimensions };
    if (current[target.side]) return false;
    current[target.side] = { shape: value.shape, dtype: String(value.dtype).toUpperCase() };
    pairs.set(target.key, current);
  }
  if (!pairs.size) return false;
  for (const pair of pairs.values()) {
    if (!pair.down || !pair.up || pair.down.dtype !== pair.up.dtype) return false;
    const rank = pair.down.shape[0];
    if (
      rank <= 0
      || pair.down.shape[1] !== pair.dimensions.input
      || pair.up.shape[0] !== pair.dimensions.output
      || pair.up.shape[1] !== rank
    ) return false;
  }
  return true;
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
    return { lorasPath: h3LorasRootReal, lorasRootReal: h3LorasRootReal, runtimeNames };
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

  function inspectFile(file, mode, steps) {
    try {
      const statBefore = fsApi.statSync(file.filePath);
      if (!statBefore.isFile()) return null;
      const parsed = readSafetensorsHeader(fsApi, file.filePath, statBefore);
      const statAfter = fsApi.statSync(file.filePath);
      if (statAfter.size !== statBefore.size || statAfter.mtimeMs !== statBefore.mtimeMs) return null;
      const tensorDataBytes = Number(statAfter.size) - 8 - parsed.headerLength;
      const metadata = normalizeMetadata(parsed.header);
      const modelFamily = parseBaseFamily(metadata);
      if (!modelFamily || !hasH3NetworkModule(metadata) || !supportsMode(modelFamily, mode)) return null;
      if (!hasH3TensorSignature(parsed.header, tensorDataBytes)) return null;
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
      .map((file) => inspectFile(file, mode, steps))
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
