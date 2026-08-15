const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const previewPath = path.resolve(__dirname, "../../tools/preview_runtime_server.py");
const source = fs.readFileSync(previewPath, "utf8");

function handlerBlock(name, nextName) {
  const start = source.indexOf(`    def ${name}`);
  const end = source.indexOf(`    def ${nextName}`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

test("locked preview exposes one fixed bounded H3 output namespace", () => {
  assert.match(source, /AI_SEQUENCE_H3_OUTPUT_PATH\s*=\s*"\/__ai_sequence_h3_output"/);
  assert.match(source, /AI_SEQUENCE_H3_OUTPUT_ACTIONS\s*=\s*frozenset\(\{"publish",\s*"list"\}\)/);
  assert.match(source, /AI_SEQUENCE_H3_OUTPUT_MAX_BODY_BYTES\s*=\s*64\s*\*\s*1024/);
  assert.match(source, /AI_SEQUENCE_H3_OUTPUT_TIMEOUT_SEC\s*=\s*30/);
  assert.match(source, /AI_SEQUENCE_H3_RUNTIME_JSON\s*=\s*Path\(r"C:\\ProgramData\\NovaFlow\\AI-Runtime-H3\\runtime\.json"\)/);
  assert.match(source, /Path\(tempfile\.gettempdir\(\)\)\s*\/\s*"NovaFlow"\s*\/\s*"preview-ai-sequence-warehouse"/);
});

test("preview H3 output publisher receives fixed server-owned roots and hides its Windows console", () => {
  const handler = handlerBlock("_run_ai_sequence_h3_output_publisher", "_handle_ai_sequence_h3_output");
  assert.match(source, /AI_SEQUENCE_H3_OUTPUT_CREATION_FLAGS\s*=\s*\(\s*getattr\(subprocess,\s*"CREATE_NO_WINDOW",\s*0\)\s*if\s+os\.name\s*==\s*"nt"\s*else\s*0\s*\)/s);
  assert.match(handler, /env\["NOVAFLOW_H3_RUNTIME_JSON"\]\s*=\s*str\(AI_SEQUENCE_H3_RUNTIME_JSON\)/);
  assert.match(handler, /env\["NOVAFLOW_H3_WAREHOUSE_DIR"\]\s*=\s*str\(AI_SEQUENCE_H3_WAREHOUSE_DIR\)/);
  assert.match(handler, /\[node_executable,\s*"-e",\s*AI_SEQUENCE_H3_OUTPUT_NODE_RUNNER\]/);
  assert.match(handler, /creationflags\s*=\s*AI_SEQUENCE_H3_OUTPUT_CREATION_FLAGS/);
  assert.doesNotMatch(handler, /\bshell\s*=/);
  assert.doesNotMatch(handler, /CREATE_NEW_CONSOLE|DETACHED_PROCESS/);
});

test("renderer payload cannot choose a runtime root, warehouse, or absolute source path", () => {
  const handler = handlerBlock("_handle_ai_sequence_h3_output", "_handle_ai_sequence_h3_output_view");
  assert.match(handler, /action\s+not\s+in\s+AI_SEQUENCE_H3_OUTPUT_ACTIONS/);
  assert.match(handler, /_h3_output_payload_contains_forbidden_path\(payload\)/);
  assert.match(handler, /_normalize_ai_sequence_h3_output_publish_payload\(raw_payload\)/);
  assert.match(source, /AI_SEQUENCE_H3_OUTPUT_PUBLISH_FIELDS\s*=\s*frozenset\(\{[\s\S]*"mediaDurationSec"[\s\S]*"generationElapsedSec"[\s\S]*\}\)/);
  assert.match(source, /"mediaDurationSec":\s*\(0\.0,\s*60\.0,\s*False\)/);
  assert.match(source, /"generationElapsedSec":\s*\(0\.0,\s*86400\.0,\s*True\)/);
  assert.match(source, /"runtimeconfigpath"/);
  assert.match(source, /"warehousedir"/);
  assert.match(source, /"sourcepath"/);
  assert.match(source, /"outputpath"/);
  assert.match(source, /"localpath"/);
});

test("inline runner adapts the production publisher without accepting dependency paths from the browser", () => {
  assert.match(source, /publisherModule\.createMiniMaxH3OutputPublisher/);
  assert.match(source, /readMiniMaxH3RuntimeConfig\s*\}\s*=\s*require\(path\.join\(/);
  assert.match(source, /readRuntimeConfig:\s*\(\)\s*=>\s*readMiniMaxH3RuntimeConfig\(\{\s*runtimeRoot:\s*path\.dirname\(process\.env\.NOVAFLOW_H3_RUNTIME_JSON\)/s);
  assert.match(source, /getWarehouseDir:\s*\(\)\s*=>\s*process\.env\.NOVAFLOW_H3_WAREHOUSE_DIR/);
  assert.match(source, /result\s*=\s*\{\s*ok:\s*Boolean\(resolvedPath\),\s*path:\s*resolvedPath\s*\|\|\s*""\s*\}/);
});

test("view reads only a manifest id resolved inside the fixed warehouse", () => {
  const handler = handlerBlock("_handle_ai_sequence_h3_output_view", "_handle_ai_sequence_lora");
  assert.match(handler, /parsed\.path\.rstrip\("\/"\)\s*!=\s*f"\{AI_SEQUENCE_H3_OUTPUT_PATH\}\/view"/);
  assert.match(handler, /set\(query\)\s*!=\s*\{"id"\}/);
  assert.match(handler, /len\(item_id\)\s*>\s*2048/);
  assert.match(handler, /_run_ai_sequence_h3_output_publisher\("resolve",\s*item_id=item_id\)/);
  assert.match(handler, /AI_SEQUENCE_H3_WAREHOUSE_DIR\.resolve\(strict=True\)/);
  assert.match(handler, /os\.path\.commonpath/);
  assert.doesNotMatch(handler, /query\.get\("path"\)|query\.get\("root"\)/);
  assert.match(handler, /Accept-Ranges/);
  assert.match(handler, /Content-Range/);
});

test("publish and list expose same-origin playback URLs without leaking local paths", () => {
  assert.match(source, /view_url\s*=\s*f"\{AI_SEQUENCE_H3_OUTPUT_PATH\}\/view\?id=/);
  assert.match(source, /clean\["viewUrl"\]\s*=\s*view_url/);
  assert.match(source, /clean\["objectUrl"\]\s*=\s*view_url/);
  assert.match(source, /"warehousePath"/);
  assert.match(source, /"absolutePath"/);
  assert.match(source, /"localPath"/);
});

test("preview publish timing whitelist preserves legacy payloads and fails closed", () => {
  const probe = String.raw`
import importlib.util
import math
import sys

spec = importlib.util.spec_from_file_location("novaflow_h3_output_preview_contract", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

legacy = {
    "promptId": "legacy-prompt",
    "filename": "legacy.mp4",
    "subfolder": "video",
    "type": "output",
}
normalized, error = module._normalize_ai_sequence_h3_output_publish_payload(legacy)
assert error == ""
assert normalized == legacy

timed = dict(legacy, mediaDurationSec=15.083333, generationElapsedSec=372.538)
normalized, error = module._normalize_ai_sequence_h3_output_publish_payload(timed)
assert error == ""
assert normalized["mediaDurationSec"] == 15.083333
assert normalized["generationElapsedSec"] == 372.538

for key, invalid_values in {
    "mediaDurationSec": [0, -1, 60.001, True, "15", None, math.nan, math.inf],
    "generationElapsedSec": [-1, 86400.001, True, "372", None, math.nan, math.inf],
}.items():
    for value in invalid_values:
        normalized, error = module._normalize_ai_sequence_h3_output_publish_payload(dict(legacy, **{key: value}))
        assert normalized is None
        assert error == f"invalid_{key}"

for valid_payload in (
    dict(legacy, mediaDurationSec=60, generationElapsedSec=0),
    dict(legacy, mediaDurationSec=0.001, generationElapsedSec=86400),
):
    normalized, error = module._normalize_ai_sequence_h3_output_publish_payload(valid_payload)
    assert error == ""
    assert normalized == valid_payload

normalized, error = module._normalize_ai_sequence_h3_output_publish_payload(dict(legacy, sourcePath="C:/forbidden.mp4"))
assert normalized is None
assert error == "unsupported_publish_payload_fields"

clean = module.PreviewRuntimeHandler._sanitize_h3_output_item({
    "id": "prompt:output:video:file.mp4",
    "localPath": "C:/must-not-leak/file.mp4",
    "warehousePath": "C:/must-not-leak",
    "mediaDurationSec": 15.083333,
    "generationElapsedSec": 372.538,
})
assert "localPath" not in clean
assert "warehousePath" not in clean
assert clean["mediaDurationSec"] == 15.083333
assert clean["generationElapsedSec"] == 372.538
assert clean["viewUrl"].startswith(module.AI_SEQUENCE_H3_OUTPUT_PATH + "/view?id=")
`;
  const result = spawnSync("python", ["-c", probe, previewPath], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
