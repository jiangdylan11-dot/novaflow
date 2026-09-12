const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ALLOWED_ACTIONS,
  createPreviewLoraBridge,
} = require("../../tools/ai_sequence_lora_preview_bridge");

function makeBridge(calls) {
  return createPreviewLoraBridge({
    readMainConfig: () => ({ modelsPath: "X:/NovaFlow/models", port: 8188 }),
    readH3Config: () => ({ modelsPath: "X:/NovaFlow/models", port: 8189 }),
    h3Catalog: {
      catalog: async (payload) => {
        calls.push(["h3-catalog", payload]);
        return [{ name: "minimax_h3/example.safetensors" }];
      },
      validate: async (payload) => {
        calls.push(["h3-validate", payload]);
        return { ok: true, item: payload };
      },
    },
    wanCatalog: {
      catalog: async (payload) => {
        calls.push(["wan-catalog", payload]);
        return [{ name: "wan2_2/high.safetensors", role: "high" }];
      },
      validate: async (payload) => {
        calls.push(["wan-validate", payload]);
        return { ok: true, item: payload };
      },
    },
  });
}

test("preview bridge exposes only the five fixed LoRA actions", () => {
  assert.deepEqual([...ALLOWED_ACTIONS].sort(), [
    "minimax-h3-catalog",
    "minimax-h3-validate",
    "qwen-catalog",
    "wan22-catalog",
    "wan22-validate",
  ]);
});

test("locked preview server exposes a loopback-only bounded LoRA endpoint", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../tools/preview_runtime_server.py"), "utf8");
  assert.match(source, /AI_SEQUENCE_LORA_PATH\s*=\s*"\/__ai_sequence_lora"/);
  assert.match(source, /AI_SEQUENCE_LORA_MAX_BODY_BYTES\s*=\s*64\s*\*\s*1024/);
  assert.match(source, /ipaddress\.ip_address\(str\(self\.client_address\[0\]\)\)\.is_loopback/);
  assert.match(source, /\[node_executable,\s*str\(AI_SEQUENCE_LORA_BRIDGE\)\]/);
});

test("AI Sequence LoRA preview helper hides only its Windows Node console", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../tools/preview_runtime_server.py"), "utf8");
  const handlerStart = source.indexOf("    def _handle_ai_sequence_lora(self) -> None:");
  const handlerEnd = source.indexOf("    def _handle_prompt_assistant", handlerStart);
  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(
    source,
    /AI_SEQUENCE_LORA_CREATION_FLAGS\s*=\s*\(\s*getattr\(subprocess,\s*"CREATE_NO_WINDOW",\s*0\)\s*if\s+os\.name\s*==\s*"nt"\s*else\s*0\s*\)/s,
  );
  assert.match(handler, /creationflags\s*=\s*AI_SEQUENCE_LORA_CREATION_FLAGS/);
  assert.doesNotMatch(handler, /\bshell\s*=/);
  assert.doesNotMatch(handler, /CREATE_NEW_CONSOLE|DETACHED_PROCESS/);
});

test("preview bridge routes H3 catalog and validation without arbitrary paths", async () => {
  const calls = [];
  const bridge = makeBridge(calls);
  const catalog = await bridge.handle({
    action: "minimax-h3-catalog",
    payload: { mode: "t2v", steps: 4, modelsPath: "C:/forbidden" },
  });
  const validation = await bridge.handle({
    action: "minimax-h3-validate",
    payload: { mode: "t2v", steps: 4, name: "minimax_h3/example.safetensors", fingerprint: "proof", strength: 0.5 },
  });
  assert.equal(catalog.ok, true);
  assert.equal(validation.ok, true);
  assert.deepEqual(calls[0], ["h3-catalog", { mode: "t2v", steps: 4 }]);
  assert.equal("modelsPath" in calls[0][1], false);
});

test("preview bridge preserves Wan role during final validation", async () => {
  const calls = [];
  const bridge = makeBridge(calls);
  const context = {
    highName: "high.safetensors",
    lowName: "low.safetensors",
    steps: 20,
  };
  const catalog = await bridge.handle({ action: "wan22-catalog", payload: context });
  const validation = await bridge.handle({
    action: "wan22-validate",
    payload: {
      ...context,
      name: "wan2_2/high.safetensors",
      role: "high",
      fingerprint: "lora-proof",
      highFingerprint: "high-proof",
      lowFingerprint: "low-proof",
      strength: 0.7,
    },
  });
  assert.equal(catalog.items[0].role, "high");
  assert.equal(validation.item.role, "high");
  assert.equal(calls.at(-1)[1].role, "high");
});

test("preview bridge rejects unsupported actions and closes catalog failures", async () => {
  const bridge = makeBridge([]);
  assert.deepEqual(await bridge.handle({ action: "read-file", payload: { path: "C:/secret" } }), {
    ok: false,
    error: "unsupported_action",
  });
  const failed = createPreviewLoraBridge({
    h3Catalog: { catalog: async () => { throw new Error("catalog offline"); } },
    wanCatalog: {},
  });
  assert.deepEqual(await failed.handle({ action: "minimax-h3-catalog" }), {
    ok: false,
    items: [],
    error: "catalog offline",
  });
});


test("Qwen preview forwards only the route, never a caller-selected directory", async () => {
  const calls = [];
  const bridge = createPreviewLoraBridge({ qwenCatalog: { catalog: async payload => { calls.push(payload); return [{ name: 'qwen/example.safetensors' }]; } } });
  const result = await bridge.handle({ action: 'qwen-catalog', payload: { nsfw: true, root: 'C:/forbidden', modelsPath: 'C:/forbidden' } });
  assert.deepEqual(calls, [{ nsfw: true }]);
  assert.deepEqual(result, { ok: true, items: [{ name: 'qwen/example.safetensors' }] });
});
