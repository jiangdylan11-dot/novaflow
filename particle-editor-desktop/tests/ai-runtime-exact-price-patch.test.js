const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { after, test } = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const patcherPath = path.join(root, "tools", "ai-runtime", "apply-runtime-patches.ps1");
const patchDefinitionPath = path.join(root, "tools", "ai-runtime", "patches", "comfy-partner-price-v1", "manifest.json");
const packageScriptPath = path.join(root, "tools", "ai-runtime", "build-ai-runtime-package.ps1");
const installerScriptPath = path.join(root, "tools", "ai-runtime", "build-ai-runtime-installer.ps1");
const fixtureRuntimeRoot = path.join(
  root,
  "_exports",
  "NovaFlow-AI-Runtime-Installer",
  "unpacked",
  "NovaFlow-AI-Runtime",
  "Runtime",
  "AI-Runtime",
);
const nodesRelativePath = path.join("engine", "ComfyUI", "comfy_api_nodes", "nodes_openai.py");
const clientRelativePath = path.join("engine", "ComfyUI", "comfy_api_nodes", "util", "client.py");
const expectedBaseHashes = Object.freeze({
  [nodesRelativePath]: "5B668FA3FF28D80FB39D407B2F24D0325DCE5EFD55407AAF9264B8F7CA49DCAE",
  [clientRelativePath]: "C589314EA798E3046B1C167ACE627DC8F0044FAEA4D71446F3014264C12F32F6",
});
const temporaryRoots = [];

after(() => {
  for (const temporaryRoot of temporaryRoots) {
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())), `refusing to remove non-temp path: ${resolved}`);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
}

function createFixtureRuntime(label) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), `novaflow-runtime-patch-${label}-`));
  temporaryRoots.push(runtimeRoot);
  for (const relativePath of [nodesRelativePath, clientRelativePath]) {
    const source = path.join(fixtureRuntimeRoot, relativePath);
    const destination = path.join(runtimeRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return runtimeRoot;
}

function runPatcher(runtimeRoot) {
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", patcherPath,
    "-RuntimeRoot", runtimeRoot,
    "-PythonExecutable", "python",
  ], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

function combinedOutput(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function runPython(code, args = [], options = {}) {
  return spawnSync("python", ["-c", code, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

const patchAssetsExist = fs.existsSync(patcherPath) && fs.existsSync(patchDefinitionPath);

test("staged Runtime patch assets exist", () => {
  assert.equal(fs.existsSync(patcherPath), true, "apply-runtime-patches.ps1 should exist");
  assert.equal(fs.existsSync(patchDefinitionPath), true, "the comfy partner patch manifest should exist");
});

if (patchAssetsExist) {
  const patchDefinition = JSON.parse(fs.readFileSync(patchDefinitionPath, "utf8"));

  test("patch definition pins the approved base hashes", () => {
    assert.equal(patchDefinition.patchId, "comfy-partner-price-v1");
    const filesByPath = new Map(patchDefinition.files.map((entry) => [path.normalize(entry.path), entry]));
    for (const [relativePath, expectedHash] of Object.entries(expectedBaseHashes)) {
      const entry = filesByPath.get(path.normalize(relativePath));
      assert.ok(entry, `${relativePath} should be registered`);
      assert.deepEqual(entry.baseSha256, [expectedHash]);
      assert.match(entry.patchedSha256, /^[A-F0-9]{64}$/);
      assert.ok(Array.isArray(entry.anchors) && entry.anchors.length > 0, `${relativePath} should declare exact anchors`);
    }
  });

  test("known Runtime base applies once, stays idempotent, and writes deterministic evidence", () => {
    const runtimeRoot = createFixtureRuntime("known");
    const sourceHashesBefore = Object.fromEntries(
      Object.keys(expectedBaseHashes).map((relativePath) => [relativePath, sha256(path.join(fixtureRuntimeRoot, relativePath))]),
    );
    assert.deepEqual(sourceHashesBefore, expectedBaseHashes, "read-only fixture must match the approved base");

    const first = runPatcher(runtimeRoot);
    assert.equal(first.status, 0, combinedOutput(first));

    const nodesPath = path.join(runtimeRoot, nodesRelativePath);
    const clientPath = path.join(runtimeRoot, clientRelativePath);
    const evidencePath = path.join(runtimeRoot, "novaflow-runtime-patches.json");
    const nodesSource = fs.readFileSync(nodesPath, "utf8");
    const clientSource = fs.readFileSync(clientPath, "utf8");
    assert.match(nodesSource, /input_tokens_details/);
    assert.match(nodesSource, /image_tokens\s*\*\s*8\.0/);
    assert.match(nodesSource, /text_tokens\s*\*\s*5\.0/);
    assert.match(nodesSource, /output_tokens\s*\*\s*30\.0/);
    assert.match(nodesSource, /image_tokens\s*\+\s*text_tokens\s*!=\s*input_tokens/);
    assert.match(clientSource, /from decimal import Decimal, ROUND_HALF_UP/);
    assert.match(clientSource, /Decimal\(str\(price\)\)\s*\*\s*Decimal\("211"\)/);
    assert.match(clientSource, /ROUND_HALF_UP/);
    assert.match(clientSource, /NovaFlow-Price-Exact:/);
    assert.match(clientSource, /Price:/, "the human Comfy Price line must remain");
    assert.equal(fs.readFileSync(nodesPath).subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), false);
    assert.equal(fs.readFileSync(clientPath).subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), false);
    assert.equal(fs.existsSync(evidencePath), true, "runtime-root patch evidence should be written");

    const firstHashes = [sha256(nodesPath), sha256(clientPath)];
    const firstEvidence = fs.readFileSync(evidencePath, "utf8");
    const evidence = JSON.parse(firstEvidence);
    assert.equal(evidence.schemaVersion, 1);
    assert.deepEqual(evidence.patches.map((entry) => entry.patchId), ["comfy-partner-price-v1"]);
    assert.deepEqual(evidence.patches[0].files.map((entry) => path.normalize(entry.path)), [nodesRelativePath, clientRelativePath]);

    const second = runPatcher(runtimeRoot);
    assert.equal(second.status, 0, combinedOutput(second));
    assert.deepEqual([sha256(nodesPath), sha256(clientPath)], firstHashes, "reapplying must not rewrite patched files");
    assert.equal(fs.readFileSync(evidencePath, "utf8"), firstEvidence, "patch evidence must be byte-stable");
    assert.deepEqual(
      Object.fromEntries(Object.keys(expectedBaseHashes).map((relativePath) => [relativePath, sha256(path.join(fixtureRuntimeRoot, relativePath))])),
      sourceHashesBefore,
      "the unpacked input fixture must remain read-only",
    );
  });

  test("patched GPT Image 2 pricing requires modality details and uses the corrected formula", () => {
    const runtimeRoot = createFixtureRuntime("formula");
    const patched = runPatcher(runtimeRoot);
    assert.equal(patched.status, 0, combinedOutput(patched));
    const nodesPath = path.join(runtimeRoot, nodesRelativePath);
    const harness = String.raw`
import ast, pathlib, sys
from types import SimpleNamespace
source_path = pathlib.Path(sys.argv[1])
tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "calculate_tokens_price_image_2_0")
namespace = {"OpenAIImageGenerationResponse": object}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(source_path), "exec"), namespace)
calculate = namespace["calculate_tokens_price_image_2_0"]
details = SimpleNamespace(image_tokens=1024, text_tokens=26)
usage = SimpleNamespace(input_tokens=1050, output_tokens=397, input_tokens_details=details)
print(f"{calculate(SimpleNamespace(usage=usage)):.6f}")
print(calculate(SimpleNamespace(usage=SimpleNamespace(input_tokens=1050, output_tokens=397))))
bad_details = SimpleNamespace(image_tokens=1024, text_tokens=25)
bad_usage = SimpleNamespace(input_tokens=1050, output_tokens=397, input_tokens_details=bad_details)
print(calculate(SimpleNamespace(usage=bad_usage)))
`;
    const result = runPython(harness, [nodesPath]);
    assert.equal(result.status, 0, combinedOutput(result));
    assert.deepEqual(result.stdout.trim().split(/\r?\n/), ["0.020232", "None", "None"]);
  });

  test("patched client emits exact two-decimal-ledger text and preserves the human Price line", () => {
    const runtimeRoot = createFixtureRuntime("client");
    const patched = runPatcher(runtimeRoot);
    assert.equal(patched.status, 0, combinedOutput(patched));
    const clientPath = path.join(runtimeRoot, clientRelativePath);
    const harness = String.raw`
import ast, pathlib, sys
from decimal import Decimal, ROUND_HALF_UP
source_path = pathlib.Path(sys.argv[1])
tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_display_text")
class Server:
    def __init__(self): self.messages = []
    def send_progress_text(self, text, node_id): self.messages.append((text, node_id))
server = Server()
class PromptServer: instance = server
class IO: ComfyNode = object
namespace = {"Decimal": Decimal, "ROUND_HALF_UP": ROUND_HALF_UP, "PromptServer": PromptServer, "IO": IO, "get_node_id": lambda _: "node"}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(source_path), "exec"), namespace)
namespace["_display_text"](object, "done", price=0.020232)
print(server.messages[-1][0])
`;
    const result = runPython(harness, [clientPath]);
    assert.equal(result.status, 0, combinedOutput(result));
    assert.match(result.stdout, /NovaFlow-Price-Exact: 4\.270000 credits/);
    assert.match(result.stdout, /Price: 4\.3 credits/);
  });

  test("missing, unknown, and non-unique inputs fail closed before patching", () => {
    const missingRoot = createFixtureRuntime("missing");
    fs.unlinkSync(path.join(missingRoot, clientRelativePath));
    const missing = runPatcher(missingRoot);
    assert.notEqual(missing.status, 0);
    assert.match(combinedOutput(missing), /missing|required/i);
    assert.doesNotMatch(fs.readFileSync(path.join(missingRoot, nodesRelativePath), "utf8"), /input_tokens_details/);

    const unknownRoot = createFixtureRuntime("unknown");
    const unknownNodesPath = path.join(unknownRoot, nodesRelativePath);
    fs.writeFileSync(unknownNodesPath, `${fs.readFileSync(unknownNodesPath, "utf8")}\n# drift\n`, "utf8");
    const unknown = runPatcher(unknownRoot);
    assert.notEqual(unknown.status, 0);
    assert.match(combinedOutput(unknown), /unknown.*hash|hash.*unknown/i);
    assert.doesNotMatch(fs.readFileSync(path.join(unknownRoot, clientRelativePath), "utf8"), /NovaFlow-Price-Exact:/);

    const duplicateRoot = createFixtureRuntime("duplicate");
    const duplicateNodesPath = path.join(duplicateRoot, nodesRelativePath);
    const nodeDefinition = patchDefinition.files.find((entry) => path.normalize(entry.path) === nodesRelativePath);
    const anchor = nodeDefinition.anchors[0];
    const source = fs.readFileSync(duplicateNodesPath, "utf8");
    assert.equal(source.split(anchor).length - 1, 1, "test fixture should start with one exact anchor");
    fs.writeFileSync(duplicateNodesPath, source.replace(anchor, `${anchor}\n${anchor}`), "utf8");
    const duplicate = runPatcher(duplicateRoot);
    assert.notEqual(duplicate.status, 0);
    assert.match(combinedOutput(duplicate), /anchor.*exactly once|exactly once.*anchor/i);
    assert.doesNotMatch(fs.readFileSync(path.join(duplicateRoot, clientRelativePath), "utf8"), /NovaFlow-Price-Exact:/);
  });

  test("patcher refuses the installed ProgramData Runtime", { skip: !fs.existsSync("C:\\ProgramData\\NovaFlow\\AI-Runtime") }, () => {
    const result = runPatcher("C:\\ProgramData\\NovaFlow\\AI-Runtime");
    assert.notEqual(result.status, 0);
    assert.match(combinedOutput(result), /refusing.*installed.*ProgramData/i);
  });

  test("both Runtime builders invoke the patcher after copying their destination", () => {
    const packageSource = fs.readFileSync(packageScriptPath, "utf8");
    const installerSource = fs.readFileSync(installerScriptPath, "utf8");
    const packageCopy = packageSource.indexOf("Invoke-RobocopyChecked -Source $SourcePythonRoot -Destination $pythonDest");
    const packagePatch = packageSource.indexOf("apply-runtime-patches.ps1");
    assert.ok(packageCopy >= 0 && packagePatch > packageCopy, "package builder should patch only after destination copies exist");
    const installerCopy = installerSource.indexOf("Copy-DirectoryContents -Source $RuntimeSourcePath -Destination $runtimeDest");
    const installerPatch = installerSource.indexOf("apply-runtime-patches.ps1");
    assert.ok(installerCopy >= 0 && installerPatch > installerCopy, "installer builder should patch only its destination copy");
    assert.match(packageSource, /\[string\]\s+\$Version\s*=\s*"0\.2\.5"/, "patched Runtime packages should default to version 0.2.5");
    assert.match(installerSource, /\[string\]\s+\$Version\s*=\s*"0\.2\.5"/, "patched Runtime installers should default to version 0.2.5");
  });
}
