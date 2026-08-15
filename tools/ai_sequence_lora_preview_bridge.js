"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  createMiniMaxH3LoraCatalog,
} = require("../particle-editor-desktop/main/minimax-h3-lora-catalog");
const {
  createWan22LoraCatalog,
} = require("../particle-editor-desktop/main/wan22-lora-catalog");

const DEFAULT_RUNTIME_JSON = "C:\\ProgramData\\NovaFlow\\AI-Runtime\\runtime.json";
const DEFAULT_H3_RUNTIME_JSON = "C:\\ProgramData\\NovaFlow\\AI-Runtime-H3\\runtime.json";
const REQUEST_TIMEOUT_MS = 8_000;
const ALLOWED_ACTIONS = new Set([
  "minimax-h3-catalog",
  "minimax-h3-validate",
  "wan22-catalog",
  "wan22-validate",
]);

function readJsonFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("runtime_config_invalid");
  }
  return value;
}

function normalizeBaseUrl(config, fallbackPort) {
  const configured = String(config?.baseUrl || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const port = Number(config?.port || fallbackPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("runtime_port_invalid");
  }
  return `http://127.0.0.1:${port}`;
}

async function fetchObjectInfo(baseUrl, pathName = "/object_info") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(pathName, `${baseUrl}/`).toString(), {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function createPreviewLoraBridge(options = {}) {
  const runtimeJsonPath = path.resolve(String(
    options.runtimeJsonPath
      || process.env.NOVAFLOW_AI_RUNTIME_JSON
      || DEFAULT_RUNTIME_JSON,
  ));
  const h3RuntimeJsonPath = path.resolve(String(
    options.h3RuntimeJsonPath
      || process.env.NOVAFLOW_AI_RUNTIME_H3_JSON
      || DEFAULT_H3_RUNTIME_JSON,
  ));
  const readMainConfig = options.readMainConfig || (() => readJsonFile(runtimeJsonPath));
  const readH3Config = options.readH3Config || (() => readJsonFile(h3RuntimeJsonPath));
  const objectInfo = options.fetchObjectInfo || fetchObjectInfo;

  const getMainObjectInfo = async () => {
    const config = await Promise.resolve(readMainConfig());
    return await objectInfo(normalizeBaseUrl(config, 8188), "/object_info");
  };

  const h3Catalog = options.h3Catalog || createMiniMaxH3LoraCatalog({
    readConfig: readH3Config,
    expectedModelsPath: async () => String((await Promise.resolve(readMainConfig()))?.modelsPath || ""),
    // Both runtimes use NovaFlow's authoritative models root. The locked browser
    // preview only needs ComfyUI's registered LoRA names, so it can use 8188
    // without starting or changing the isolated H3 process.
    listRuntimeLoraNames: getMainObjectInfo,
  });

  const wanCatalog = options.wanCatalog || createWan22LoraCatalog({
    readConfig: readMainConfig,
    expectedModelsPath: async () => String((await Promise.resolve(readMainConfig()))?.modelsPath || ""),
    listRuntimeModelNames: getMainObjectInfo,
  });

  async function handle(request = {}) {
    const action = String(request?.action || "").trim();
    const payload = request?.payload && typeof request.payload === "object" && !Array.isArray(request.payload)
      ? request.payload
      : {};
    if (!ALLOWED_ACTIONS.has(action)) {
      return Object.freeze({ ok: false, error: "unsupported_action" });
    }
    try {
      if (action === "minimax-h3-catalog") {
        const items = await h3Catalog.catalog({ mode: payload.mode, steps: payload.steps });
        return Object.freeze({ ok: true, items });
      }
      if (action === "minimax-h3-validate") {
        return await h3Catalog.validate({
          mode: payload.mode,
          steps: payload.steps,
          name: payload.name,
          fingerprint: payload.fingerprint,
          strength: payload.strength,
        });
      }
      if (action === "wan22-catalog") {
        const items = await wanCatalog.catalog({
          highName: payload.highName,
          lowName: payload.lowName,
          steps: payload.steps,
        });
        return Object.freeze({ ok: true, items });
      }
      return await wanCatalog.validate({
        highName: payload.highName,
        lowName: payload.lowName,
        steps: payload.steps,
        name: payload.name,
        role: payload.role,
        fingerprint: payload.fingerprint,
        highFingerprint: payload.highFingerprint,
        lowFingerprint: payload.lowFingerprint,
        strength: payload.strength,
      });
    } catch (error) {
      return Object.freeze({
        ok: false,
        items: action.endsWith("-catalog") ? Object.freeze([]) : undefined,
        error: String(error?.message || error || "preview_lora_bridge_failed"),
      });
    }
  }

  return Object.freeze({ handle });
}

async function runCli() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > 64 * 1024) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
  const request = JSON.parse(text || "{}");
  const response = await createPreviewLoraBridge().handle(request);
  process.stdout.write(JSON.stringify(response));
}

if (require.main === module) {
  runCli().catch((error) => {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: String(error?.message || error || "preview_lora_bridge_failed"),
    }));
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  ALLOWED_ACTIONS,
  createPreviewLoraBridge,
  readJsonFile,
});
