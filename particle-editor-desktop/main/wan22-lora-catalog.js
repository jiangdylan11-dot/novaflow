const crypto = require("node:crypto");
const fsDefault = require("node:fs");
const pathDefault = require("node:path");

const MAX_SAFETENSORS_HEADER_BYTES = 16 * 1024 * 1024;
const MIN_STEPS = 1;
const MAX_STEPS = 10_000;
const MODEL_FAMILY = "wan2.2_i2v_14b";
const WAN22_LORA_DIRECTORY = "wan2_2";
const VALID_ROLES = new Set(["high", "low", "shared"]);
const STANDARD_KIND = "standard";
const ACCELERATOR_KIND = "accelerator";
const STRENGTH_RANGE = Object.freeze({ min: 0, max: 2, default: 1, step: 0.05 });
const TRUSTED_WAN22_LORA_MANIFEST = Object.freeze([
  Object.freeze({
    name: "wan2_2/Sensual_fingering_v1_low_noise手扣.safetensors",
    headerFingerprint: "h1:306808448:f8a045d82f9eb89cc6db313fec7264ae69516e865077b372f466edd9d5a85c52",
    modelFamily: MODEL_FAMILY,
    role: "low",
    kind: STANDARD_KIND,
  }),
  Object.freeze({
    name: "wan2_2/wan22-i2v-rub-pussy-os-high摩擦阴部.safetensors",
    headerFingerprint: "h1:306807976:2d75b89c69097a5b220ce6be8ce9b316763779f2beea1c309f1dcaebdee4408d",
    modelFamily: MODEL_FAMILY,
    role: "high",
    kind: STANDARD_KIND,
  }),
  Object.freeze({
    name: "wan2_2/x-ray_i2v_high_v1.1切面.safetensors",
    headerFingerprint: "h1:306807976:2d75b89c69097a5b220ce6be8ce9b316763779f2beea1c309f1dcaebdee4408d",
    modelFamily: MODEL_FAMILY,
    role: "high",
    kind: STANDARD_KIND,
  }),
  Object.freeze({
    name: "wan2_2/Wan_2_2_I2V_A14B_HIGH_lightx2v_4step_lora_v1030_rank_64_bf16抽插4.safetensors",
    headerFingerprint: "h1:630697104:ac6777797c12a9ac05c8ecb2fcde25b37eb39a0a5564a3da1fa91deafa1e478e",
    modelFamily: MODEL_FAMILY,
    role: "high",
    kind: ACCELERATOR_KIND,
    requiredSteps: Object.freeze([4]),
  }),
]);
const DTYPE_BYTES = Object.freeze({
  BOOL: 1, I8: 1, U8: 1, F8_E4M3: 1, F8_E5M2: 1, F8_E8M0: 1,
  I16: 2, U16: 2, F16: 2, BF16: 2,
  I32: 4, U32: 4, F32: 4,
  I64: 8, U64: 8, F64: 8,
});

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
    const header = JSON.parse(headerBytes.toString("utf8").replace(/\s+$/u, ""));
    if (!header || typeof header !== "object" || Array.isArray(header)) {
      throw new Error("safetensors_header_invalid");
    }
    return {
      header,
      headerLength,
      headerHash: crypto.createHash("sha256").update(headerBytes).digest("hex"),
    };
  } finally {
    if (fd !== null) fsApi.closeSync(fd);
  }
}

function fingerprintFor(stat, headerHash) {
  return `v1:${Number(stat.size)}:${Number(stat.mtimeMs)}:${headerHash}`;
}

function headerFingerprintFor(stat, headerHash) {
  return `h1:${Number(stat.size)}:${headerHash}`;
}

function inspectSafetensors(fsApi, filePath) {
  const statBefore = fsApi.statSync(filePath);
  if (!statBefore.isFile()) throw new Error("safetensors_not_file");
  const parsed = readSafetensorsHeader(fsApi, filePath, statBefore);
  const statAfter = fsApi.statSync(filePath);
  if (statAfter.size !== statBefore.size || statAfter.mtimeMs !== statBefore.mtimeMs) {
    throw new Error("safetensors_changed_during_read");
  }
  return Object.freeze({
    ...parsed,
    stat: statAfter,
    tensorDataBytes: Number(statAfter.size) - 8 - parsed.headerLength,
    fingerprint: fingerprintFor(statAfter, parsed.headerHash),
    headerFingerprint: headerFingerprintFor(statAfter, parsed.headerHash),
  });
}

function normalizeMetadata(header) {
  const source = header?.__metadata__;
  if (!source || typeof source !== "object" || Array.isArray(source)) return Object.freeze({});
  const metadata = {};
  for (const [key, value] of Object.entries(source)) {
    metadata[String(key || "").trim().toLowerCase()] = String(value ?? "").trim();
  }
  return Object.freeze(metadata);
}

function normalizedPolicyToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return VALID_ROLES.has(role) ? role : "";
}

function normalizeKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return kind === STANDARD_KIND || kind === ACCELERATOR_KIND ? kind : "";
}

function explicitPolicy(metadata) {
  const family = normalizedPolicyToken(
    metadata.ss_wan_lora_base
    || metadata.novaflow_wan_lora_base
    || metadata.ss_base_model_version,
  );
  const role = String(metadata.ss_wan_lora_role || metadata.novaflow_wan_lora_role || "").trim().toLowerCase();
  const kind = String(metadata.ss_wan_lora_kind || metadata.novaflow_wan_lora_kind || "").trim().toLowerCase();
  if (family !== "wan22i2v14b" || !normalizeRole(role) || !normalizeKind(kind)) return null;
  return Object.freeze({ modelFamily: MODEL_FAMILY, role, kind });
}

function isAccelerator(metadata, runtimeName) {
  const hint = [
    runtimeName,
    metadata.ss_wan_lora_kind,
    metadata.ss_wan_lora_type,
    metadata.ss_wan_lora_required_steps,
    metadata.novaflow_required_steps,
  ].join(" ").toLowerCase();
  return /(?:accelerat|distill|lightx2v|lightning|turbo|\b\d{1,4}[_ .-]?steps?\b)/i.test(hint);
}

function samePolicy(left, right) {
  return !!left && !!right
    && left.modelFamily === right.modelFamily
    && left.role === right.role
    && left.kind === right.kind;
}

function manifestPolicy(manifest, file) {
  let policy = null;
  for (const raw of Array.isArray(manifest) ? manifest : []) {
    if (!raw || typeof raw !== "object") continue;
    const fingerprint = String(raw.headerFingerprint || raw.fingerprint || "").trim();
    if (fingerprint !== file.inspection.headerFingerprint && fingerprint !== file.inspection.fingerprint) continue;
    const name = String(raw.name || "").trim();
    if (name && runtimeNameKey(name) !== runtimeNameKey(file.runtimeName)) continue;
    const role = normalizeRole(raw.role);
    const kind = normalizeKind(raw.kind);
    if (normalizedPolicyToken(raw.modelFamily) !== "wan22i2v14b" || !role || !kind) continue;
    const candidate = Object.freeze({ modelFamily: MODEL_FAMILY, role, kind });
    if (policy && !samePolicy(policy, candidate)) return null;
    policy = candidate;
  }
  return policy;
}

function resolvePolicy(metadata, manifest, file) {
  const declared = explicitPolicy(metadata);
  const trusted = manifestPolicy(manifest, file);
  if (declared && trusted && !samePolicy(declared, trusted)) return null;
  return declared || trusted;
}

function legalTensor(value, tensorDataBytes, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const shape = value.shape;
  if (!Array.isArray(shape) || !shape.every((part) => Number.isInteger(part) && part >= 0)) return false;
  if (options.scalar === true && !(shape.length === 0 || (shape.length === 1 && shape[0] === 1))) return false;
  const bytesPerElement = DTYPE_BYTES[String(value.dtype || "").toUpperCase()];
  if (!bytesPerElement) return false;
  const elementCount = shape.reduce((product, part) => product * part, 1);
  if (!Number.isSafeInteger(elementCount)) return false;
  const offsets = value.data_offsets;
  return Array.isArray(offsets)
    && offsets.length === 2
    && offsets.every((part) => Number.isSafeInteger(part) && part >= 0)
    && offsets[0] <= offsets[1]
    && offsets[1] <= tensorDataBytes
    && offsets[1] - offsets[0] === elementCount * bytesPerElement;
}

function parsePairTensor(name) {
  const patterns = [
    /^(diffusion_model\..*)\.lora_(down|up)\.weight$/i,
    /^(diffusion_model\..*)\.lora_([ab])(?:\.default)?\.weight$/i,
    /^(diffusion_model\..*)\.lora\.(down|up)\.weight$/i,
  ];
  for (const regex of patterns) {
    const match = String(name || "").match(regex);
    if (!match) continue;
    return {
      key: match[1].toLowerCase(),
      stem: match[1],
      side: /^(?:down|a)$/i.test(match[2]) ? "down" : "up",
    };
  }
  return null;
}

function findModelWeight(header, stem) {
  const keys = [`model.${stem}.weight`, `${stem}.weight`];
  for (const key of keys) {
    const value = header?.[key];
    if (value && Array.isArray(value.shape)) return { key, value };
  }
  return null;
}

function isWan22LoraCompatible(lora, models) {
  const targetModels = Array.isArray(models) ? models.filter(Boolean) : [];
  if (!targetModels.length) return false;
  const pairs = new Map();
  const alphas = new Map();
  for (const [name, value] of Object.entries(lora.header || {})) {
    if (name === "__metadata__") continue;
    const pairTensor = parsePairTensor(name);
    if (pairTensor) {
      if (!legalTensor(value, lora.tensorDataBytes) || value.shape.length !== 2) return false;
      const pair = pairs.get(pairTensor.key) || { stem: pairTensor.stem };
      if (pair[pairTensor.side]) return false;
      pair[pairTensor.side] = { shape: value.shape, dtype: String(value.dtype).toUpperCase() };
      pairs.set(pairTensor.key, pair);
      continue;
    }
    const alpha = String(name).match(/^(diffusion_model\..*)\.alpha$/i);
    if (alpha) {
      const key = alpha[1].toLowerCase();
      if (alphas.has(key) || !legalTensor(value, lora.tensorDataBytes, { scalar: true })) return false;
      alphas.set(key, value);
      continue;
    }
    return false;
  }
  if (!pairs.size) return false;
  for (const alphaKey of alphas.keys()) if (!pairs.has(alphaKey)) return false;
  for (const pair of pairs.values()) {
    if (!pair.down || !pair.up || pair.down.dtype !== pair.up.dtype) return false;
    const rank = pair.down.shape[0];
    if (rank <= 0 || pair.up.shape[1] !== rank) return false;
    const expectedShape = [pair.up.shape[0], pair.down.shape[1]];
    for (const model of targetModels) {
      const target = findModelWeight(model.header, pair.stem);
      if (
        !target
        || target.value.shape.length !== 2
        || target.value.shape[0] !== expectedShape[0]
        || target.value.shape[1] !== expectedShape[1]
      ) return false;
    }
  }
  return true;
}

function extractRuntimeModelNames(value) {
  const directUnets = value?.unets;
  const directLoras = value?.loras;
  if (Array.isArray(directUnets) || Array.isArray(directLoras)) {
    return {
      unets: Array.isArray(directUnets) ? directUnets.filter((entry) => typeof entry === "string") : [],
      loras: Array.isArray(directLoras) ? directLoras.filter((entry) => typeof entry === "string") : [],
    };
  }
  const unets = value?.UNETLoader?.input?.required?.unet_name?.[0];
  const loras = value?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0];
  return {
    unets: Array.isArray(unets) ? unets.filter((entry) => typeof entry === "string") : [],
    loras: Array.isArray(loras) ? loras.filter((entry) => typeof entry === "string") : [],
  };
}

function runtimeNameMap(names) {
  const result = new Map();
  for (const original of Array.isArray(names) ? names : []) {
    const normalized = normalizeRuntimeName(original);
    if (normalized) result.set(normalized.toLowerCase(), String(original));
  }
  return result;
}

function scanCategory(fsApi, pathApi, categoryRoots, modelsRootReal, runtimeNames, runtimePrefix = "") {
  const files = new Map();
  const visitedDirectories = new Set();
  const normalizedPrefix = normalizeRuntimeName(runtimePrefix);

  function addFile(runtimeName, filePath) {
    const key = runtimeNameKey(runtimeName);
    const prior = files.get(key);
    if (prior && !isSameRealPath(pathApi, prior.filePath, filePath)) {
      files.set(key, null);
      return;
    }
    if (prior === null) return;
    files.set(key, Object.freeze({ runtimeName, filePath }));
  }

  function visit(directoryPath, rootReal, relativeParts) {
    let directoryReal;
    try {
      directoryReal = realpath(fsApi, directoryPath);
      if (!isSameOrInside(pathApi, directoryReal, rootReal) || !isSameOrInside(pathApi, directoryReal, modelsRootReal)) return;
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
        if (!isSameOrInside(pathApi, targetReal, rootReal) || !isSameOrInside(pathApi, targetReal, modelsRootReal)) continue;
        targetStat = fsApi.statSync(targetReal);
      } catch {
        continue;
      }
      if (targetStat.isDirectory()) {
        visit(candidate, rootReal, [...relativeParts, entry.name]);
        continue;
      }
      if (!targetStat.isFile() || !/\.safetensors$/i.test(entry.name)) continue;
      const relativeName = [normalizedPrefix, ...relativeParts, entry.name].filter(Boolean).join("/");
      const runtimeName = runtimeNames.get(runtimeNameKey(relativeName));
      if (runtimeName) addFile(runtimeName, targetReal);
    }
  }

  for (const categoryPath of categoryRoots) {
    let rootReal;
    try {
      rootReal = realpath(fsApi, categoryPath);
      if (!fsApi.statSync(rootReal).isDirectory() || !isSameOrInside(pathApi, rootReal, modelsRootReal)) continue;
    } catch {
      continue;
    }
    visit(categoryPath, rootReal, []);
  }
  return files;
}

function createWan22LoraCatalog(options = {}) {
  const fsApi = options.fs || fsDefault;
  const pathApi = options.path || pathDefault;
  const readConfig = options.readConfig;
  const expectedModelsPath = options.expectedModelsPath;
  const listRuntimeModelNames = options.listRuntimeModelNames;
  const trustedManifest = Array.isArray(options.trustedManifest)
    ? options.trustedManifest
    : TRUSTED_WAN22_LORA_MANIFEST;
  if (typeof readConfig !== "function") throw new TypeError("readConfig must be a function");
  if (typeof expectedModelsPath !== "function") throw new TypeError("expectedModelsPath must be a function");
  if (typeof listRuntimeModelNames !== "function") throw new TypeError("listRuntimeModelNames must be a function");

  async function resolveContext(input) {
    const steps = normalizeSteps(input.steps);
    const highName = String(input.highName || "").trim();
    const lowName = String(input.lowName || "").trim();
    const highKey = runtimeNameKey(highName);
    const lowKey = runtimeNameKey(lowName);
    if (!steps || !highKey || !lowKey || highKey === lowKey) return null;
    if (!pathApi.basename(highName).toLowerCase().includes("high")) return null;
    if (!pathApi.basename(lowName).toLowerCase().includes("low")) return null;

    let config;
    let runtime;
    try {
      config = await Promise.resolve(readConfig());
      runtime = extractRuntimeModelNames(await Promise.resolve(listRuntimeModelNames()));
    } catch {
      return null;
    }
    const configuredModelsPath = String(config?.modelsPath || "").trim();
    if (!configuredModelsPath || config?.ok === false) return null;
    let modelsRootReal;
    let lorasRootReal;
    let wan22LorasRootReal;
    try {
      modelsRootReal = realpath(fsApi, pathApi.resolve(configuredModelsPath));
      const expected = String(await Promise.resolve(expectedModelsPath(config)) || "").trim();
      if (!expected) return null;
      const expectedRootReal = realpath(fsApi, pathApi.resolve(expected));
      if (!fsApi.statSync(modelsRootReal).isDirectory() || !fsApi.statSync(expectedRootReal).isDirectory()) return null;
      if (!isSameRealPath(pathApi, modelsRootReal, expectedRootReal)) return null;
      lorasRootReal = realpath(fsApi, pathApi.join(modelsRootReal, "loras"));
      wan22LorasRootReal = realpath(fsApi, pathApi.join(modelsRootReal, "loras", WAN22_LORA_DIRECTORY));
      if (!fsApi.statSync(lorasRootReal).isDirectory() || !fsApi.statSync(wan22LorasRootReal).isDirectory()) return null;
      if (!isSameOrInside(pathApi, lorasRootReal, modelsRootReal)) return null;
      if (!isSameOrInside(pathApi, wan22LorasRootReal, lorasRootReal)) return null;
    } catch {
      return null;
    }

    const unetRuntimeNames = runtimeNameMap(runtime.unets);
    const loraRuntimeNames = runtimeNameMap(runtime.loras);
    if (!unetRuntimeNames.has(highKey) || !unetRuntimeNames.has(lowKey)) return null;
    const unetFiles = scanCategory(
      fsApi,
      pathApi,
      [pathApi.join(modelsRootReal, "unet"), pathApi.join(modelsRootReal, "diffusion_models")],
      modelsRootReal,
      unetRuntimeNames,
    );
    const highFile = unetFiles.get(highKey);
    const lowFile = unetFiles.get(lowKey);
    if (!highFile || !lowFile) return null;
    let highModel;
    let lowModel;
    try {
      highModel = inspectSafetensors(fsApi, highFile.filePath);
      lowModel = inspectSafetensors(fsApi, lowFile.filePath);
    } catch {
      return null;
    }
    const loraFiles = scanCategory(
      fsApi,
      pathApi,
      [wan22LorasRootReal],
      modelsRootReal,
      loraRuntimeNames,
      WAN22_LORA_DIRECTORY,
    );
    return { steps, highName, lowName, highModel, lowModel, loraFiles };
  }

  async function buildCatalog(input = {}) {
    const context = await resolveContext(input);
    if (!context) return null;
    const items = [];
    for (const file of context.loraFiles.values()) {
      if (!file) continue;
      let inspection;
      try {
        inspection = inspectSafetensors(fsApi, file.filePath);
      } catch {
        continue;
      }
      const metadata = normalizeMetadata(inspection.header);
      const withInspection = { ...file, inspection };
      const policy = resolvePolicy(metadata, trustedManifest, withInspection);
      if (!policy) continue;
      if (policy.kind !== STANDARD_KIND || isAccelerator(metadata, file.runtimeName)) continue;
      const compatibleModels = policy.role === "high"
        ? [context.highModel]
        : policy.role === "low"
          ? [context.lowModel]
          : [context.highModel, context.lowModel];
      if (!isWan22LoraCompatible(inspection, compatibleModels)) continue;
      items.push(Object.freeze({
        name: file.runtimeName,
        modelFamily: policy.modelFamily,
        role: policy.role,
        kind: policy.kind,
        supportedSteps: null,
        strengthRange: STRENGTH_RANGE,
        fingerprint: inspection.fingerprint,
        highFingerprint: context.highModel.fingerprint,
        lowFingerprint: context.lowModel.fingerprint,
      }));
    }
    items.sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
    return Object.freeze({
      items: Object.freeze(items),
      highFingerprint: context.highModel.fingerprint,
      lowFingerprint: context.lowModel.fingerprint,
    });
  }

  async function catalog(input = {}) {
    const result = await buildCatalog(input);
    return result ? result.items : Object.freeze([]);
  }

  async function validate(input = {}) {
    if (!normalizeSteps(input.steps)) return Object.freeze({ ok: false, error: "invalid_steps" });
    if (!runtimeNameKey(input.highName) || !runtimeNameKey(input.lowName)) {
      return Object.freeze({ ok: false, error: "invalid_model_name" });
    }
    if (!runtimeNameKey(input.name)) return Object.freeze({ ok: false, error: "invalid_name" });
    const role = normalizeRole(input.role);
    if (!role) return Object.freeze({ ok: false, error: "invalid_role" });
    const fingerprint = String(input.fingerprint || "").trim();
    const highFingerprint = String(input.highFingerprint || "").trim();
    const lowFingerprint = String(input.lowFingerprint || "").trim();
    if (!fingerprint || !highFingerprint || !lowFingerprint) {
      return Object.freeze({ ok: false, error: "invalid_fingerprint" });
    }
    const strength = Number(input.strength);
    if (!Number.isFinite(strength) || strength < STRENGTH_RANGE.min || strength > STRENGTH_RANGE.max) {
      return Object.freeze({ ok: false, error: "invalid_strength" });
    }
    const result = await buildCatalog(input);
    if (!result) return Object.freeze({ ok: false, error: "catalog_unavailable" });
    if (result.highFingerprint !== highFingerprint) {
      return Object.freeze({ ok: false, error: "high_model_fingerprint_mismatch" });
    }
    if (result.lowFingerprint !== lowFingerprint) {
      return Object.freeze({ ok: false, error: "low_model_fingerprint_mismatch" });
    }
    const nameKey = runtimeNameKey(input.name);
    const item = result.items.find((entry) => runtimeNameKey(entry.name) === nameKey);
    if (!item) return Object.freeze({ ok: false, error: "lora_not_available" });
    if (item.role !== role) return Object.freeze({ ok: false, error: "role_mismatch" });
    if (item.fingerprint !== fingerprint) return Object.freeze({ ok: false, error: "fingerprint_mismatch" });
    return Object.freeze({ ok: true, item, strength });
  }

  return Object.freeze({ catalog, validate });
}

module.exports = Object.freeze({
  MAX_SAFETENSORS_HEADER_BYTES,
  MIN_STEPS,
  MAX_STEPS,
  MODEL_FAMILY,
  WAN22_LORA_DIRECTORY,
  STRENGTH_RANGE,
  TRUSTED_WAN22_LORA_MANIFEST,
  createWan22LoraCatalog,
});
