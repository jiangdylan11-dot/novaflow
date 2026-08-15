import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, "particle-editor/aifx-export.workflow.js");

function loadWorkflow(globals = {}) {
  const sandbox = {
    module: { exports: {} },
    console,
    TextEncoder,
    atob,
    ...globals,
  };
  runInNewContext(readFileSync(workflowPath, "utf8"), sandbox, { filename: workflowPath });
  assert.equal(sandbox.NovaFlowAifxExportWorkflow, sandbox.module.exports);
  return sandbox.module.exports;
}

function dataUrl(bytes) {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function productWithNineFrames() {
  const frames = Array.from({ length: 9 }, (_, index) => ({
    name: `frames/frame_${String(index).padStart(3, "0")}.png`,
    dataUrl: dataUrl([index, index + 1, 255 - index]),
  }));
  return {
    status: "ready",
    frameCount: frames.length,
    files: {
      frames,
      atlas: { name: "atlas.png", dataUrl: dataUrl([9, 8, 7, 6, 5]) },
      atlasMetadata: { name: "atlas.json", text: '{"image":"atlas.png","label":"图集"}\n' },
      generationManifest: { name: "generation-manifest.json", text: '{"frameCount":9,"alphaMode":"straight"}\n' },
    },
  };
}

function productWithLargeBase64(base64Characters = 8192) {
  const payload = "A".repeat(Math.ceil(base64Characters / 4) * 4);
  const largeDataUrl = `data:image/png;base64,${payload}`;
  return {
    status: "ready",
    frameCount: 1,
    files: {
      frames: [{ name: "frames/frame_000.png", dataUrl: largeDataUrl }],
      atlas: { name: "atlas.png", dataUrl: largeDataUrl },
      atlasMetadata: { name: "atlas.json", text: "{}\n" },
      generationManifest: { name: "generation-manifest.json", text: "{}\n" },
    },
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseStoreZip(input) {
  const bytes = Buffer.from(input);
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const checksum = bytes.readUInt32LE(offset + 14);
    const size = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    assert.equal(flags, 0x0800);
    assert.equal(method, 0);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    assert.ok(dataEnd <= bytes.length);
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const data = bytes.subarray(dataStart, dataEnd);
    assert.equal(crc32(data), checksum, `CRC mismatch for ${name}`);
    entries.push({ name, data });
    offset = dataEnd;
  }
  const eocdOffset = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(eocdOffset), 0x06054b50);
  assert.equal(bytes.readUInt16LE(eocdOffset + 10), entries.length);
  assert.equal(bytes.readUInt32LE(eocdOffset + 16), offset);
  return entries;
}

const workflow = loadWorkflow();
const smallProduct = productWithNineFrames();
const estimate = workflow.estimateBrowserZipBudget(smallProduct);
assert.equal(estimate.schemaVersion, "novaflow-aifx-browser-zip-budget-v1");
assert.equal(estimate.withinBudget, true);
assert.equal(estimate.estimate.entryCount, 12);
assert.equal(estimate.estimate.dataUrlEntryCount, 10);
assert.equal(estimate.estimate.decodedBytes, 32);
assert.ok(estimate.estimate.textBytes > 0);
assert.equal(estimate.estimate.entryBytes, estimate.estimate.decodedBytes + estimate.estimate.textBytes);
assert.equal(estimate.estimate.blobBytes, estimate.estimate.zipBytes);
assert.ok(estimate.estimate.peakBytes >= estimate.estimate.zipAndBlobPeakBytes);
assert.equal(estimate.limits.safeMaximumArchiveBytes, 256 * 1024 * 1024);
assert.equal(estimate.limits.safeMaximumPeakBytes, 512 * 1024 * 1024);

const archive = workflow.buildBrowserZip(smallProduct, { fileName: "AIFX_Budget_Contract.zip" });
assert.equal(archive.entryCount, 12);
assert.equal(archive.byteLength, estimate.estimate.zipBytes);
assert.equal(archive.budget.estimate.zipBytes, archive.byteLength);
assert.equal(archive.budget.withinBudget, true);
assert.deepEqual(Array.from(archive.entryNames).slice(-3), [
  "atlas.png",
  "atlas.json",
  "generation-manifest.json",
]);
const parsed = parseStoreZip(archive.bytes);
assert.deepEqual(parsed.map((entry) => entry.name), Array.from(archive.entryNames));
assert.deepEqual(Array.from(parsed[0].data), [0, 1, 255]);
assert.deepEqual(Array.from(parsed[9].data), [9, 8, 7, 6, 5]);

let atobCalls = 0;
let uint8ArrayAllocations = 0;
const NativeUint8Array = Uint8Array;
class CountingUint8Array extends NativeUint8Array {
  constructor(...args) {
    uint8ArrayAllocations += 1;
    super(...args);
  }
}
const guardedWorkflow = loadWorkflow({
  Uint8Array: CountingUint8Array,
  atob(value) {
    atobCalls += 1;
    return atob(value);
  },
});
const largeProduct = productWithLargeBase64();
const guardedEstimate = guardedWorkflow.estimateBrowserZipBudget(largeProduct, {
  memoryBudgetBytes: 4096,
});
assert.equal(guardedEstimate.withinBudget, false);
assert.equal(atobCalls, 0, "budget estimation must not decode base64");
assert.equal(uint8ArrayAllocations, 0, "budget estimation must not allocate ZIP Uint8Array buffers");

assert.throws(
  () => guardedWorkflow.buildBrowserZip(largeProduct, { memoryBudgetBytes: 4096 }),
  (error) => {
    assert.equal(error?.code, "AIFX_EXPORT_ZIP_MEMORY_BUDGET_EXCEEDED");
    assert.match(String(error?.message || ""), /safe in-memory budget before base64 decoding/i);
    assert.equal(error?.details?.reason, "peak-memory");
    assert.equal(error?.details?.budget?.withinBudget, false);
    assert.ok(error?.details?.budget?.estimate?.peakBytes > 4096);
    return true;
  },
);
assert.equal(atobCalls, 0, "over-budget export must fail before atob");
assert.equal(uint8ArrayAllocations, 0, "over-budget export must fail before ZIP Uint8Array allocation");

assert.throws(
  () => guardedWorkflow.buildBrowserZip(largeProduct, {
    archiveBudgetBytes: 1024,
    memoryBudgetBytes: 1024 * 1024,
  }),
  (error) => {
    assert.equal(error?.code, "AIFX_EXPORT_ZIP_MEMORY_BUDGET_EXCEEDED");
    assert.match(String(error?.message || ""), /safe archive budget before base64 decoding/i);
    assert.equal(error?.details?.reason, "archive-size");
    return true;
  },
);
assert.equal(atobCalls, 0);
assert.equal(uint8ArrayAllocations, 0);

const capped = workflow.estimateBrowserZipBudget(smallProduct, {
  archiveBudgetBytes: Number.MAX_SAFE_INTEGER,
  memoryBudgetBytes: Number.MAX_SAFE_INTEGER,
});
assert.equal(capped.limits.maxArchiveBytes, capped.limits.safeMaximumArchiveBytes);
assert.equal(capped.limits.maxPeakBytes, capped.limits.safeMaximumPeakBytes);

assert.throws(
  () => workflow.estimateBrowserZipBudget(smallProduct, { memoryBudgetBytes: 0 }),
  (error) => {
    assert.equal(error?.code, "AIFX_EXPORT_ZIP_BUDGET_INVALID");
    assert.equal(error?.details?.optionName, "memoryBudgetBytes");
    return true;
  },
);

console.log("AIFX export budget contract passed.");
