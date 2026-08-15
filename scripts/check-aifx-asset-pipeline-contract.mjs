import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadUmd(relativePath, globalName, globals = {}) {
  const file = path.join(root, relativePath);
  const sandbox = { module: { exports: {} }, console, ...globals };
  runInNewContext(readFileSync(file, "utf8"), sandbox, { filename: file });
  assert.equal(
    sandbox[globalName],
    sandbox.module.exports,
    `${relativePath} must expose the same browser and CommonJS API`,
  );
  return sandbox.module.exports;
}

const templateResource = loadUmd(
  "particle-editor/aifx-template.resource.js",
  "NovaFlowAifxTemplateResource",
);
const postprocessWorkflow = loadUmd(
  "particle-editor/aifx-postprocess.workflow.js",
  "NovaFlowAifxPostprocessWorkflow",
  { NovaFlowAifxTemplateResource: templateResource },
);
const exportWorkflow = loadUmd(
  "particle-editor/aifx-export.workflow.js",
  "NovaFlowAifxExportWorkflow",
  {
    NovaFlowAifxTemplateResource: templateResource,
    TextEncoder,
    atob,
  },
);

const PNG_DATA_URL = "data:image/png;base64,AA==";
const plain = (value) => JSON.parse(JSON.stringify(value));

function zipCrc32(bytes) {
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
    const localOffset = offset;
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const checksum = bytes.readUInt32LE(offset + 14);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const size = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    assert.equal(flags, 0x0800, "ZIP entries must declare UTF-8 names without data descriptors");
    assert.equal(method, 0, "browser fallback must use dependency-free store mode");
    assert.equal(compressedSize, size);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    assert.ok(dataEnd <= bytes.length, "ZIP local entry must stay inside the archive");
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const data = bytes.subarray(dataStart, dataEnd);
    assert.equal(zipCrc32(data), checksum, `ZIP CRC must match ${name}`);
    entries.push({ name, data, checksum, size, localOffset });
    offset = dataEnd;
  }

  const centralOffset = offset;
  const eocdOffset = bytes.length - 22;
  assert.ok(eocdOffset >= centralOffset, "ZIP must contain an end-of-central-directory record");
  assert.equal(bytes.readUInt32LE(eocdOffset), 0x06054b50);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  assert.equal(bytes.readUInt32LE(eocdOffset + 16), centralOffset);
  assert.equal(entryCount, entries.length);
  assert.equal(centralOffset + centralSize, eocdOffset);

  let centralCursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(bytes.readUInt32LE(centralCursor), 0x02014b50);
    assert.equal(bytes.readUInt16LE(centralCursor + 8), 0x0800);
    assert.equal(bytes.readUInt16LE(centralCursor + 10), 0);
    const nameLength = bytes.readUInt16LE(centralCursor + 28);
    const extraLength = bytes.readUInt16LE(centralCursor + 30);
    const commentLength = bytes.readUInt16LE(centralCursor + 32);
    const name = bytes.subarray(centralCursor + 46, centralCursor + 46 + nameLength).toString("utf8");
    assert.equal(name, entries[index].name);
    assert.equal(bytes.readUInt32LE(centralCursor + 42), entries[index].localOffset);
    assert.equal(bytes.readUInt32LE(centralCursor + 16), entries[index].checksum);
    centralCursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(centralCursor, eocdOffset);
  return entries;
}

function expectCode(run, code) {
  assert.throws(run, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

async function expectCodeAsync(run, code) {
  await assert.rejects(run, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

function sourceFrame(number, width = 16, height = 8) {
  return {
    name: `frame_${String(number).padStart(3, "0")}.png`,
    width,
    height,
    image: { width, height, id: number },
    dataUrl: PNG_DATA_URL,
  };
}

function finalFrame(index, width = 16, height = 8) {
  return {
    index,
    name: `frame_${String(index).padStart(3, "0")}.png`,
    width,
    height,
    pixelFormat: "rgba8",
    alphaMode: "straight",
    dataUrl: PNG_DATA_URL,
  };
}

function createFakeCanvasDependencies() {
  const canvases = [];
  const canvasFactory = (width, height) => {
    const operations = [];
    const context = {
      imageSmoothingEnabled: true,
      clearRect: (...args) => operations.push(["clearRect", ...args]),
      fillRect: (...args) => operations.push(["fillRect", ...args]),
      drawImage: (...args) => operations.push(["drawImage", ...args]),
      fillStyle: "",
    };
    const canvas = {
      width,
      height,
      operations,
      getContext: (kind) => kind === "2d" ? context : null,
      toDataURL: () => PNG_DATA_URL,
    };
    canvases.push(canvas);
    return canvas;
  };
  return {
    canvases,
    canvasFactory,
    imageLoader: async (_source, frame) => ({
      width: frame.width,
      height: frame.height,
      id: frame.name,
    }),
  };
}

const unorderedFrames = [sourceFrame(2), sourceFrame(0), sourceFrame(1)];
const normalized = templateResource.normalizeTemplateFrames(unorderedFrames);
assert.deepEqual(plain(normalized.map((frame) => frame.sequenceNumber)), [0, 1, 2]);
assert.deepEqual(plain(normalized.map((frame) => frame.name)), [
  "frame_000.png",
  "frame_001.png",
  "frame_002.png",
]);

const plan = templateResource.createSpriteSheetPlan(unorderedFrames, {
  columns: 2,
  gutter: 4,
  padding: 2,
  fps: 24,
  lifecycle: {
    mode: "one-shot",
    peakFrame: 1,
    phases: [
      { name: "appear", startFrame: 0, endFrame: 0 },
      { name: "impact", startFrame: 1, endFrame: 1 },
      { name: "decay", startFrame: 2, endFrame: 2 },
    ],
  },
});
assert.equal(plan.order, "row-major");
assert.equal(plan.frameCount, 3);
assert.equal(plan.columns, 2);
assert.equal(plan.rows, 2);
assert.deepEqual(plain(plan.sheetSize), { width: 40, height: 24 });
assert.deepEqual(plain(plan.contentRect), { x: 2, y: 2, width: 36, height: 20 });
assert.deepEqual(plain(plan.frameRects.map((entry) => entry.rect)), [
  { x: 2, y: 2, width: 16, height: 8 },
  { x: 22, y: 2, width: 16, height: 8 },
  { x: 2, y: 14, width: 16, height: 8 },
]);
assert.deepEqual(plain(plan.unusedCells.map((entry) => entry.rect)), [
  { x: 22, y: 14, width: 16, height: 8 },
]);
assert.equal(plan.fps, 24);
assert.equal(plan.lifecycle.mode, "one-shot");
assert.equal(plan.lifecycle.peakFrame, 1);
assert.deepEqual(plain(plan.lifecycle.phases.map((phase) => phase.name)), ["appear", "impact", "decay"]);

const alignedPlan = templateResource.createSpriteSheetPlan(unorderedFrames, {
  columns: 2,
  gutter: 3,
  padding: 1,
  alignTo: 16,
});
assert.deepEqual(plain(alignedPlan.sheetSize), { width: 48, height: 32 });
assert.equal(alignedPlan.alignTo, 16);
assert.deepEqual(plain(alignedPlan.trailingPadding), { right: 11, bottom: 11 });
assert.deepEqual(plain(alignedPlan.frameRects.map((entry) => entry.rect)), [
  { x: 1, y: 1, width: 16, height: 8 },
  { x: 20, y: 1, width: 16, height: 8 },
  { x: 1, y: 12, width: 16, height: 8 },
]);
expectCode(
  () => templateResource.createSpriteSheetPlan(unorderedFrames, { alignTo: 0 }),
  "AIFX_SPRITESHEET_ALIGNMENT_INVALID",
);

expectCode(
  () => templateResource.normalizeTemplateFrames([sourceFrame(0), { ...sourceFrame(1), sequenceNumber: 0 }]),
  "AIFX_TEMPLATE_DUPLICATE_FRAME",
);
expectCode(
  () => templateResource.normalizeTemplateFrames([sourceFrame(0), sourceFrame(2)]),
  "AIFX_TEMPLATE_MISSING_FRAME",
);
expectCode(
  () => templateResource.normalizeTemplateFrames([sourceFrame(0), sourceFrame(1, 32, 8)]),
  "AIFX_TEMPLATE_MIXED_SIZE",
);

const packCanvas = createFakeCanvasDependencies();
const packed = await templateResource.packFrames(
  unorderedFrames,
  { plan, background: "black" },
  packCanvas,
);
assert.equal(packed.dataUrl, PNG_DATA_URL);
assert.equal(packCanvas.canvases.length, 1);
assert.equal(packCanvas.canvases[0].width, 40);
assert.equal(packCanvas.canvases[0].height, 24);
const packDraws = packCanvas.canvases[0].operations.filter(([operation]) => operation === "drawImage");
assert.equal(packDraws.length, 3);
assert.deepEqual(packDraws.map((operation) => operation.slice(-4)), [
  [2, 2, 16, 8],
  [22, 2, 16, 8],
  [2, 14, 16, 8],
]);

const cutCanvas = createFakeCanvasDependencies();
const cutFrames = await templateResource.cutSpriteSheet(
  { width: 40, height: 24, id: "sheet" },
  plan,
  {},
  cutCanvas,
);
assert.equal(cutFrames.length, 3);
assert.deepEqual(plain(cutFrames.map((frame) => frame.name)), [
  "frame_000.png",
  "frame_001.png",
  "frame_002.png",
]);
assert.deepEqual(
  cutCanvas.canvases.map((canvas) => canvas.operations.find(([operation]) => operation === "drawImage").slice(2, 6)),
  [
    [2, 2, 16, 8],
    [22, 2, 16, 8],
    [2, 14, 16, 8],
  ],
);

expectCode(
  () => postprocessWorkflow.validateGeneratedSheetGeometry({ width: 39, height: 24 }, plan),
  "AIFX_GENERATED_SHEET_GEOMETRY_MISMATCH",
);
assert.equal(postprocessWorkflow.isLuminousMaterial("火焰"), true);
assert.equal(postprocessWorkflow.isLuminousMaterial("雷电"), true);
assert.equal(postprocessWorkflow.isLuminousMaterial("冰雪"), true);

const rawFrames = [finalFrame(0), finalFrame(1), finalFrame(2)];
const aiFrameResult = postprocessWorkflow.finalizeAiGeneratedFrames({
  frames: rawFrames,
  plan,
  materialType: "fire",
});
assert.equal(aiFrameResult.status, "ready");
assert.equal(aiFrameResult.matteMethod, "ai-generated-frame-matte");
assert.equal(aiFrameResult.shapeSource, "ai-generated-frame-matte");
assert.equal(aiFrameResult.motionConstraint, "template-plan-only");
assert.equal(aiFrameResult.preservesFrameOrder, true);
assert.equal(aiFrameResult.preservesFrameDimensions, true);
assert.equal(aiFrameResult.frames.length, 3);
assert.ok(aiFrameResult.frames.every((frame) => frame.alphaMode === "straight"));
assert.ok(aiFrameResult.frames.every((frame) => frame.shapeSource === "ai-generated-frame-matte"));
assert.ok(aiFrameResult.frames.every((frame) => frame.motionConstraint === "template-plan-only"));
assert.equal("geometryLock" in aiFrameResult, false);
assert.doesNotMatch(JSON.stringify(aiFrameResult), /template-alpha-geometry-lock/);
const compatibilityResult = postprocessWorkflow.finalizeGeometryLockedFrames({
  frames: rawFrames.map((frame) => ({ ...frame, matteMethod: "template-alpha-geometry-lock" })),
  plan,
  materialType: "fire",
  matteMethod: "template-alpha-geometry-lock",
});
assert.equal(compatibilityResult.shapeSource, "ai-generated-frame-matte");
assert.equal(compatibilityResult.motionConstraint, "template-plan-only");
assert.equal(compatibilityResult.matteMethod, "ai-generated-frame-matte");
assert.ok(compatibilityResult.frames.every((frame) => frame.matteMethod === "ai-generated-frame-matte"));
assert.doesNotMatch(JSON.stringify(compatibilityResult), /template-alpha-geometry-lock/);
expectCode(
  () => postprocessWorkflow.finalizeAiGeneratedFrames({
    frames: [finalFrame(0), finalFrame(1, 15, 8), finalFrame(2)],
    plan,
    materialType: "fire",
  }),
  "AIFX_AI_FRAME_MISMATCH",
);
const aiFrameDataUrls = [
  "data:image/png;base64,AA==",
  "data:image/png;base64,AQ==",
  "data:image/png;base64,Ag==",
];
const aiCutFrames = rawFrames.map((frame, index) => ({
  ...frame,
  sourceName: `ai-sheet-cell-${index}`,
  dataUrl: aiFrameDataUrls[index],
}));
const postTemplateStub = {
  cutSpriteSheet: async () => aiCutFrames,
};
let luminousCalls = 0;
const luminousInputs = [];
const luminousResult = await postprocessWorkflow.postprocessGeneratedSheet(
  { sheet: { width: 40, height: 24 }, plan, materialType: "fire" },
  {
    templateResource: postTemplateStub,
    backgroundRemoval: {
      removeBlackBackgroundDataUrl: async (dataUrl, context) => {
        luminousCalls += 1;
        luminousInputs.push({ dataUrl, index: context.index, name: context.name });
        return {
          dataUrl,
          width: 16,
          height: 8,
          pixelFormat: "rgba8",
          alphaMode: "straight",
          stats: { activeCoverage: 0.25 },
        };
      },
    },
  },
);
assert.equal(luminousResult.status, "ready");
assert.equal(luminousResult.alphaMode, "straight");
assert.equal(luminousResult.pixelFormat, "rgba8");
assert.equal(luminousResult.matteMethod, "black-matte-remove-and-unmultiply");
assert.equal(luminousResult.shapeSource, "ai-generated-frame-matte");
assert.equal(luminousResult.motionConstraint, "template-plan-only");
assert.equal(luminousCalls, 3);
assert.ok(luminousResult.frames.every((frame) => frame.alphaMode === "straight"));
assert.deepEqual(plain(luminousInputs.map((entry) => entry.dataUrl)), aiFrameDataUrls);
assert.deepEqual(plain(luminousInputs.map((entry) => entry.index)), [0, 1, 2]);
assert.deepEqual(plain(luminousResult.frames.map((frame) => frame.dataUrl)), aiFrameDataUrls);
assert.deepEqual(plain(luminousResult.frames.map((frame) => frame.sourceName)), [
  "ai-sheet-cell-0",
  "ai-sheet-cell-1",
  "ai-sheet-cell-2",
]);
assert.ok(luminousResult.frames.every((frame) => frame.shapeSource === "ai-generated-frame-matte"));

await expectCodeAsync(
  () => postprocessWorkflow.postprocessGeneratedSheet(
    { sheet: { width: 40, height: 24 }, plan, materialType: "fire" },
    {
      templateResource: postTemplateStub,
      backgroundRemoval: {
        removeBlackBackgroundDataUrl: async (dataUrl) => ({
          dataUrl,
          width: 15,
          height: 8,
          pixelFormat: "rgba8",
          alphaMode: "straight",
        }),
      },
    },
  ),
  "AIFX_LUMINOUS_OUTPUT_SIZE_MISMATCH",
);

let iceBlackMatteCalls = 0;
const iceResult = await postprocessWorkflow.postprocessGeneratedSheet(
  { sheet: { width: 40, height: 24 }, plan, materialType: "ice" },
  {
    templateResource: postTemplateStub,
    backgroundRemoval: {
      removeBlackBackgroundDataUrl: async (dataUrl) => {
        iceBlackMatteCalls += 1;
        return { dataUrl, stats: { activeCoverage: 0.3 } };
      },
    },
  },
);
assert.equal(iceResult.status, "ready");
assert.equal(iceResult.matteMethod, "black-matte-remove-and-unmultiply");
assert.equal(iceResult.shapeSource, "ai-generated-frame-matte");
assert.equal(iceResult.motionConstraint, "template-plan-only");
assert.equal(iceBlackMatteCalls, 3);
assert.deepEqual(plain(iceResult.frames.map((frame) => frame.dataUrl)), aiFrameDataUrls);

await expectCodeAsync(
  () => postprocessWorkflow.postprocessGeneratedSheet(
    { sheet: { width: 40, height: 24 }, plan, materialType: "water" },
    { templateResource: postTemplateStub },
  ),
  "AIFX_RMBG_REQUIRED",
);
const rmbgRequirement = await postprocessWorkflow.postprocessGeneratedSheet(
  {
    sheet: { width: 40, height: 24 },
    plan,
    materialType: "water",
    rmbgFallback: "return-requirement",
  },
  { templateResource: postTemplateStub },
);
assert.equal(rmbgRequirement.status, "requires-runtime-rmbg");
assert.equal(rmbgRequirement.requirement.type, "runtime-rmbg");
assert.equal(rmbgRequirement.requirement.expectedOutput.pixelFormat, "rgba8");
assert.equal(rmbgRequirement.requirement.expectedOutput.alphaMode, "straight");
assert.equal(rmbgRequirement.requirement.frameCount, 3);
let rmbgCalls = 0;
const rmbgResult = await postprocessWorkflow.postprocessGeneratedSheet(
  { sheet: { width: 40, height: 24 }, plan, materialType: "water" },
  {
    templateResource: postTemplateStub,
    rmbg: async (_dataUrl, context) => {
      rmbgCalls += 1;
      assert.equal(context.expectedOutput.alphaMode, "straight");
      assert.equal(context.expectedOutput.preserveFrameSize, true);
      return {
        dataUrl: PNG_DATA_URL,
        width: context.width,
        height: context.height,
        alphaMode: "straight",
      };
    },
  },
);
assert.equal(rmbgResult.status, "ready");
assert.equal(rmbgResult.matteMethod, "runtime-rmbg");
assert.equal(rmbgResult.alphaMode, "straight");
assert.equal(rmbgResult.shapeSource, "ai-generated-frame-matte");
assert.equal(rmbgResult.motionConstraint, "template-plan-only");
assert.equal(rmbgCalls, 3);

const exportFrames = [finalFrame(0), finalFrame(1), finalFrame(2)];
const exportPlan = templateResource.createSpriteSheetPlan(exportFrames, {
  columns: 2,
  gutter: 2,
  padding: 2,
  fps: 24,
  lifecycle: "one-shot",
});
const promptHash = "0123456789abcdef".repeat(4);
const sequencePlanTrace = [
  { index: 1, phase: "peak", energy: 1, centerX: 0.55, centerY: 0.48, directionDeg: 35, occupancy: 0.72 },
  { index: 0, phase: "onset", energy: -0.2, centerX: 1.2, centerY: 0.45, directionDeg: 540, occupancy: 0.1 },
  { index: 2, phase: "decay", energy: 0.35, centerX: 0.62, centerY: 0.52, directionDeg: 42.12349, occupancy: 1.4 },
];
const sequenceQualityDiagnostics = {
  version: "aifx-sequence-quality-v1",
  frameCount: 3,
  width: 16,
  height: 8,
  exactAlphaFrameRatio: 0,
  minimumExactMaskRatio: 0.1,
  maximumExactMaskRatio: 0.2,
  minimumCompensatedTemplateIou: 0.61234567,
  minimumAreaCorrelation: 0.81234567,
  maximumAreaNormalizedMae: 0.12345678,
  maximumPeakFrameDelta: 1,
  minimumTemplateIouMedian: 0.55,
  maximumCentroidDriftMedian: 0.03123456,
  maximumCentroidDriftP95: 0.07123456,
  minimumBodyAdjacentMedian: 0.58,
  minimumBodyAdjacentIou: 0.41,
  maximumResidualVelocityP95: 0.04123456,
  maximumResidualAccelerationP95: 0.08123456,
  minimumSupportF1Median: 0.81234567,
  minimumSupportF1: 0.71234567,
  minimumSupportDilatedIouMedian: 0.61234567,
  maximumDirectionErrorP90Deg: 12.345678,
  maximumDirectionEndpointMeanErrorDeg: 10.123456,
  minimumPoseEvolutionRetention: 0.83456789,
  minimumPoseEvolutionCorrelation: 0.73456789,
  minimumTailChangeRetention: 0.91234567,
  maximumGeneratedTailIou: 0.18345678,
  perThreshold: [{ deliberatelyOmittedFromSummary: true }],
  ignoredNonFiniteMetric: Number.POSITIVE_INFINITY,
};
sequenceQualityDiagnostics.self = sequenceQualityDiagnostics;
const sequenceQualityTrace = {
  version: "aifx-sequence-quality-v1",
  passed: true,
  code: null,
  failures: [],
  warnings: [{ code: "AIFX_SEQUENCE_CORE_TEMPLATE_WEAK", message: "summary only keeps the code" }],
  diagnostics: sequenceQualityDiagnostics,
};
sequenceQualityTrace.self = sequenceQualityTrace;
const controlGuidanceTrace = {
  type: "soft-motion-control",
  source: "motion-guide-resource",
  guideType: "neutral-soft-motion",
  strength: 0.523456,
  startPercent: -0.5,
  endPercent: 0.70129,
  enabled: true,
  ignoredBigInt: 1n,
};
controlGuidanceTrace.self = controlGuidanceTrace;
const temporalCorrectionTrace = {
  schemaVersion: "novaflow-aifx-temporal-conform-v1",
  mode: "ai-alpha-translate-uniform-scale-lifecycle-envelope",
  trigger: "anchor-sequence-generation",
  anchorInputMode: "explicit-candidates",
  attempt: 3,
  templatePixelsUsed: false,
  templateMaskUsed: false,
  nonUniformDeformationUsed: false,
  rotationUsed: false,
  adjacentBlendUsed: true,
  anchorCount: 3,
  plannedPeakIndex: 1,
  generatedPeakIndex: 1004,
  generatedPeakCandidateIndex: 1,
  generatedPeakSourceIndex: 42,
  generatedPeakGlobalIndex: 1004,
  anchors: [
    {
      role: "onset", candidateIndex: 0, sourceIndex: 22, globalIndex: 1002, timelineIndex: 0, outputIndex: 0,
      phase: "onset", compatibilityToPeak: 0.71234567, areaRatio: 0.12, alphaMassRatio: 0.08,
      requiredScale: 0.3456789, boundaryClipped: false, maximumEdgeSideCoverage: 0.01234567,
    },
    {
      role: "peak", candidateIndex: 1, sourceIndex: 42, globalIndex: 1004, timelineIndex: 1, outputIndex: 1,
      phase: "peak", compatibilityToPeak: 1, areaRatio: 0.22, alphaMassRatio: 0.18,
      requiredScale: 1.1234567, boundaryClipped: false, maximumEdgeSideCoverage: 0.02123456,
    },
    {
      role: "decay", candidateIndex: 2, sourceIndex: 62, globalIndex: 1006, timelineIndex: 2, outputIndex: 2,
      phase: "decay", compatibilityToPeak: 0.62345678, areaRatio: 0.09, alphaMassRatio: 0.05,
      requiredScale: 0.2345678, boundaryClipped: false, maximumEdgeSideCoverage: 0.00987654,
    },
  ],
  transforms: [
    {
      index: 0,
      candidateIndices: [0], sourceIndices: [22], globalIndices: [1002],
      blend: [{ candidateIndex: 0, sourceIndex: 22, globalIndex: 1002, anchorRole: "onset", weight: 1 }],
      scale: 0.3456789, dx: -12.3456789, dy: 4.5678912, alphaGain: 0.41234567,
      sourceAreaRatio: 0.12, targetOccupancy: 0.1, requestedTargetOccupancy: 0.1, outputAreaRatio: 0.10123456,
      occupancyError: 0.00123456, centerErrorPx: 0.3456789, retainedAlphaMassRatio: 0.98765432,
      iterations: 4, converged: true,
    },
    {
      index: 1,
      candidateIndices: [0, 1], sourceIndices: [22, 42], globalIndices: [1002, 1004],
      blend: [
        { candidateIndex: 0, sourceIndex: 22, globalIndex: 1002, anchorRole: "onset", weight: 0.25 },
        { candidateIndex: 1, sourceIndex: 42, globalIndex: 1004, anchorRole: "peak", weight: 0.75 },
      ],
      scale: 1.12345678, dx: 2.3456789, dy: -1.2345678, alphaGain: 1,
      sourceAreaRatio: 0.2, targetOccupancy: 0.72, requestedTargetOccupancy: 0.74, outputAreaRatio: 0.71876543,
      occupancyError: 0.00123457, centerErrorPx: 0.4567891, retainedAlphaMassRatio: 0.97654321,
      iterations: 5, converged: true,
    },
    {
      index: 2,
      candidateIndices: [2], sourceIndices: [62], globalIndices: [1006],
      blend: [{ candidateIndex: 2, sourceIndex: 62, globalIndex: 1006, anchorRole: "decay", weight: 1 }],
      scale: 0.08345678, dx: 18.1234567, dy: 3.8765432, alphaGain: 0.21234567,
      sourceAreaRatio: 0.09, targetOccupancy: 0.01, requestedTargetOccupancy: 0.01, outputAreaRatio: 0.00987654,
      occupancyError: 0.00012346, centerErrorPx: null, retainedAlphaMassRatio: 0.9654321,
      iterations: 6, converged: true,
    },
  ],
  converged: true,
  peakDominance: {
    enforced: true,
    plannedPeakIndex: 1,
    plannedPeakArea: 0.71876543,
    maximumNonPeakArea: 0.10123456,
    margin: 0.61753087,
  },
  ignoredBigInt: 7n,
};
temporalCorrectionTrace.self = temporalCorrectionTrace;
temporalCorrectionTrace.anchors[0].self = temporalCorrectionTrace.anchors[0];
temporalCorrectionTrace.transforms[0].self = temporalCorrectionTrace.transforms[0];
temporalCorrectionTrace.transforms[1].blend[0].self = temporalCorrectionTrace.transforms[1].blend[0];
temporalCorrectionTrace.sourceIndices = temporalCorrectionTrace;
const traceabilityInput = {
  materialType: "Ice",
  sequencePlan: sequencePlanTrace,
  sequenceQuality: sequenceQualityTrace,
  shapeSource: "ai-generated-frame-matte",
  motionConstraint: "template-plan-only",
  controlGuidance: controlGuidanceTrace,
  temporalCorrection: temporalCorrectionTrace,
};
const structureTransferTrace = {
  schemaVersion: "aifx-template-materialize-v1",
  sourceMode: "per-template-frame-structure-materialization",
  frameCount: 3,
  materialType: "ice",
  seed: 123456,
  styleStrength: 0.86,
  contourVariation: 0.32,
  featureChannels: ["low-frequency-soft-envelope", "signed-distance-envelope", "component-fragments"],
  temporalNoise: "canonical-coordinate-continuous-harmonic-noise-3d",
  macroConstraint: "soft-signed-distance-envelope",
  highFrequencyTopology: "ice-specific",
  samePeakAffineReuse: false,
  uniformScaleOnly: false,
  exactStencilFrameRatio: 0,
  minimumMacroIou: 0.52,
  meanMacroIou: 0.74,
  frames: Array.from({ length: 3 }, (_, index) => ({
    sourceFrameIndex: index,
    directionDeg: -25 + index * 20,
    occupancy: 0.12 + index * 0.08,
    energy: 0.4 + index * 0.3,
    componentCount: index + 1,
    fragmentCount: index,
    macroIou: 0.62 + index * 0.04,
    exactMask: false,
    outputOccupancy: 0.1 + index * 0.07,
  })),
};
const atlasJson = exportWorkflow.buildAtlasMetadata({
  frames: exportFrames,
  plan: exportPlan,
  fps: 24,
  lifecycle: exportPlan.lifecycle,
  provider: "local",
  model: "qwen-image-edit-2511",
  promptHash,
});
assert.equal(atlasJson.image, "atlas.png");
assert.equal(atlasJson.imageCount, 1);
assert.equal(atlasJson.frameCount, 3);
assert.equal(atlasJson.alphaMode, "straight");
assert.equal(atlasJson.provider, "local");
assert.equal(atlasJson.model, "qwen-image-edit-2511");
assert.equal(atlasJson.promptHash, promptHash);
assert.deepEqual(plain(atlasJson.frames["frame_001.png"].rect), plain(exportPlan.frameRects[1].rect));
assert.deepEqual(plain(atlasJson.frames["frame_001.png"].sourceSize), { width: 16, height: 8 });

const manifest = exportWorkflow.buildGenerationManifest({
  frames: exportFrames,
  plan: exportPlan,
  fps: 24,
  lifecycle: exportPlan.lifecycle,
  provider: "local",
  model: "qwen-image-edit-2511",
  promptHash,
});
assert.equal(manifest.outputs.atlas.file, "atlas.png");
assert.equal(manifest.outputs.atlas.imageCount, 1);
assert.equal(manifest.outputs.frameFiles.length, 3);
assert.deepEqual(plain(manifest.outputs.frameFiles[2].atlasRect), plain(exportPlan.frameRects[2].rect));
assert.deepEqual(plain(manifest.outputs.frameFiles[2].sourceSize), { width: 16, height: 8 });
assert.equal(manifest.fps, 24);
assert.equal(manifest.frameCount, 3);
assert.equal(manifest.alphaMode, "straight");
assert.equal("materialType" in manifest, false, "legacy manifest calls must not gain optional trace fields");
assert.equal("sequencePlan" in manifest, false);
assert.equal("sequenceQuality" in manifest, false);
assert.equal("shapeSource" in manifest, false);
assert.equal("motionConstraint" in manifest, false);
assert.equal("controlGuidance" in manifest, false);
assert.equal("temporalCorrection" in manifest, false);

const tracedManifest = exportWorkflow.buildGenerationManifest({
  frames: exportFrames,
  plan: exportPlan,
  fps: 24,
  lifecycle: exportPlan.lifecycle,
  provider: "local",
  model: "qwen-image-edit-2511",
  promptHash,
  ...traceabilityInput,
});
assert.equal(tracedManifest.materialType, "ice");
assert.deepEqual(plain(tracedManifest.sequencePlan.map((entry) => entry.index)), [0, 1, 2]);
assert.deepEqual(plain(tracedManifest.sequencePlan.map((entry) => entry.phase)), ["onset", "peak", "decay"]);
assert.equal(tracedManifest.sequencePlan[0].energy, 0);
assert.equal(tracedManifest.sequencePlan[0].centerX, 1);
assert.equal(tracedManifest.sequencePlan[0].directionDeg, -180);
assert.equal(tracedManifest.sequencePlan[2].directionDeg, 42.123);
assert.equal(tracedManifest.sequencePlan[2].occupancy, 1);
assert.equal(tracedManifest.sequenceQuality.passed, true);
assert.equal(tracedManifest.sequenceQuality.minimumAreaCorrelation, 0.812346);
assert.equal(tracedManifest.sequenceQuality.maximumCentroidDriftP95, 0.071235);
assert.equal(tracedManifest.sequenceQuality.minimumSupportF1Median, 0.812346);
assert.equal(tracedManifest.sequenceQuality.maximumDirectionErrorP90Deg, 12.345678);
assert.equal(tracedManifest.sequenceQuality.minimumPoseEvolutionRetention, 0.834568);
assert.equal(tracedManifest.sequenceQuality.minimumTailChangeRetention, 0.912346);
assert.deepEqual(plain(tracedManifest.sequenceQuality.failureCodes), []);
assert.deepEqual(plain(tracedManifest.sequenceQuality.warningCodes), ["AIFX_SEQUENCE_CORE_TEMPLATE_WEAK"]);
assert.equal("diagnostics" in tracedManifest.sequenceQuality, false);
assert.equal("perThreshold" in tracedManifest.sequenceQuality, false);
assert.equal("self" in tracedManifest.sequenceQuality, false);
assert.equal(tracedManifest.shapeSource, "ai-generated-frame-matte");
assert.equal(tracedManifest.motionConstraint, "template-plan-only");
assert.equal(tracedManifest.controlGuidance.strength, 0.5235);
assert.equal(tracedManifest.controlGuidance.startPercent, 0);
assert.equal(tracedManifest.controlGuidance.endPercent, 0.7013);
assert.equal(tracedManifest.controlGuidance.enabled, true);
assert.equal("ignoredBigInt" in tracedManifest.controlGuidance, false);
assert.equal(tracedManifest.temporalCorrection.schemaVersion, "novaflow-aifx-temporal-conform-v1");
assert.equal(tracedManifest.temporalCorrection.anchorInputMode, "explicit-candidates");
assert.equal(tracedManifest.temporalCorrection.anchorCount, 3);
assert.equal(tracedManifest.temporalCorrection.plannedPeakIndex, 1);
assert.equal(tracedManifest.temporalCorrection.generatedPeakGlobalIndex, 1004);
assert.deepEqual(plain(tracedManifest.temporalCorrection.anchors.map((entry) => entry.role)), ["onset", "peak", "decay"]);
assert.equal(tracedManifest.temporalCorrection.anchors[0].compatibilityToPeak, 0.712346);
assert.equal(tracedManifest.temporalCorrection.anchors[2].timelineIndex, 2);
assert.equal(tracedManifest.temporalCorrection.anchors[1].requiredScale, 1.123457);
assert.equal(tracedManifest.temporalCorrection.transforms.length, 3);
assert.equal(tracedManifest.temporalCorrection.transforms[1].scale, 1.123457);
assert.equal(tracedManifest.temporalCorrection.transforms[1].dx, 2.345679);
assert.equal(tracedManifest.temporalCorrection.transforms[1].dy, -1.234568);
assert.equal(tracedManifest.temporalCorrection.transforms[1].alphaGain, 1);
assert.equal(tracedManifest.temporalCorrection.transforms[1].requestedTargetOccupancy, 0.74);
assert.equal(tracedManifest.temporalCorrection.peakDominance.enforced, true);
assert.equal(tracedManifest.temporalCorrection.peakDominance.margin, 0.617531);
assert.deepEqual(plain(tracedManifest.temporalCorrection.transforms[1].candidateIndices), [0, 1]);
assert.deepEqual(plain(tracedManifest.temporalCorrection.transforms[1].sourceIndices), [22, 42]);
assert.deepEqual(plain(tracedManifest.temporalCorrection.transforms[1].globalIndices), [1002, 1004]);
assert.deepEqual(
  plain(tracedManifest.temporalCorrection.transforms[1].blend.map((entry) => [entry.anchorRole, entry.weight])),
  [["onset", 0.25], ["peak", 0.75]],
);
assert.equal(tracedManifest.temporalCorrection.adjacentBlendUsed, true);
assert.equal(tracedManifest.temporalCorrection.templatePixelsUsed, false);
assert.equal(tracedManifest.temporalCorrection.templateMaskUsed, false);
assert.equal("self" in tracedManifest.temporalCorrection, false);
assert.equal("ignoredBigInt" in tracedManifest.temporalCorrection, false);
assert.equal("self" in tracedManifest.temporalCorrection.anchors[0], false);
assert.equal("self" in tracedManifest.temporalCorrection.transforms[0], false);
assert.equal("self" in tracedManifest.temporalCorrection.transforms[1].blend[0], false);
assert.doesNotThrow(() => JSON.stringify(tracedManifest), "trace metadata must be cycle-safe and JSON-safe");

const fourAnchorTemporalTrace = {
  ...temporalCorrectionTrace,
  rotationUsed: true,
  anchorCount: 4,
  anchors: [
    { ...temporalCorrectionTrace.anchors[0] },
    { ...temporalCorrectionTrace.anchors[1] },
    { ...temporalCorrectionTrace.anchors[2], role: "breakup", phase: "breakup" },
    { ...temporalCorrectionTrace.anchors[2], role: "dissipation", phase: "dissipation" },
  ],
  transforms: temporalCorrectionTrace.transforms.map((entry, index) => ({
    ...entry,
    blend: entry.blend.map((blend) => ({
      ...blend,
      anchorRole: index === 2 ? "dissipation" : blend.anchorRole,
    })),
    rotationDeg: index === 0 ? 45.1234567 : -12.3456789,
    rotationUsed: true,
    sourceDirectionDeg: index === 0 ? 0 : 57.5,
    targetDirectionDeg: index === 0 ? 45 : 45,
    outputDirectionDeg: index === 0 ? 44.75 : 45.2,
    residualDirectionDeg: index === 0 ? 0.25 : 0.2,
    directionAnisotropy: 0.81234567,
  })),
};
const fourAnchorManifest = exportWorkflow.buildGenerationManifest({
  frames: exportFrames,
  plan: exportPlan,
  fps: 24,
  lifecycle: exportPlan.lifecycle,
  provider: "local",
  model: "qwen-image-edit-2511",
  promptHash,
  ...traceabilityInput,
  temporalCorrection: fourAnchorTemporalTrace,
});
assert.equal(fourAnchorManifest.temporalCorrection.anchorCount, 4);
assert.deepEqual(
  plain(fourAnchorManifest.temporalCorrection.anchors.map((entry) => entry.role)),
  ["onset", "peak", "breakup", "dissipation"],
);
assert.equal(fourAnchorManifest.temporalCorrection.rotationUsed, true);
assert.equal(fourAnchorManifest.temporalCorrection.transforms[0].rotationUsed, true);
assert.equal(fourAnchorManifest.temporalCorrection.transforms[0].rotationDeg, 45.123457);
assert.equal(fourAnchorManifest.temporalCorrection.transforms[0].residualDirectionDeg, 0.25);
assert.equal(fourAnchorManifest.temporalCorrection.transforms[0].directionAnisotropy, 0.812346);

const structureManifest = exportWorkflow.buildGenerationManifest({
  frames: exportFrames,
  plan: exportPlan,
  fps: 24,
  lifecycle: exportPlan.lifecycle,
  provider: "local",
  model: "qwen-image-edit-2511",
  promptHash,
  materialType: "ice",
  sequencePlan: sequencePlanTrace,
  sequenceQuality: sequenceQualityTrace,
  shapeSource: "template-frame-structure-materialization",
  motionConstraint: "template-frame-structure-grammar",
  controlGuidance: controlGuidanceTrace,
  structureTransfer: structureTransferTrace,
});
assert.equal(structureManifest.structureTransfer.schemaVersion, "aifx-template-materialize-v1");
assert.equal(structureManifest.structureTransfer.frameCount, 3);
assert.equal(structureManifest.structureTransfer.samePeakAffineReuse, false);
assert.equal(structureManifest.structureTransfer.uniformScaleOnly, false);
assert.equal(structureManifest.structureTransfer.minimumMacroIou, 0.52);
assert.equal(structureManifest.structureTransfer.frames[2].sourceFrameIndex, 2);
assert.equal(structureManifest.structureTransfer.frames[2].fragmentCount, 2);
assert.equal(structureManifest.structureTransfer.frames[2].exactMask, false);
assert.equal("temporalCorrection" in structureManifest, false);
expectCode(
  () => exportWorkflow.buildGenerationManifest({
    frames: exportFrames,
    plan: exportPlan,
    fps: 24,
    provider: "local",
    model: "qwen-image-edit-2511",
    promptHash,
    temporalCorrection: temporalCorrectionTrace,
    structureTransfer: structureTransferTrace,
  }),
  "AIFX_EXPORT_TRACE_MODE_CONFLICT",
);

expectCode(
  () => exportWorkflow.buildGenerationManifest({
    frames: exportFrames,
    plan: exportPlan,
    fps: 24,
    provider: "local",
    model: "qwen-image-edit-2511",
    promptHash,
    sequencePlan: sequencePlanTrace.slice(0, 2),
  }),
  "AIFX_EXPORT_SEQUENCE_PLAN_INVALID",
);

const temporalManifestInput = (temporalCorrection) => ({
  frames: exportFrames,
  plan: exportPlan,
  fps: 24,
  provider: "local",
  model: "qwen-image-edit-2511",
  promptHash,
  temporalCorrection,
});
expectCode(
  () => exportWorkflow.buildGenerationManifest(temporalManifestInput({
    ...temporalCorrectionTrace,
    transforms: temporalCorrectionTrace.transforms.map((entry, index) => ({
      ...entry,
      scale: index === 1 ? Number.POSITIVE_INFINITY : entry.scale,
    })),
  })),
  "AIFX_EXPORT_TEMPORAL_CORRECTION_INVALID",
);
expectCode(
  () => exportWorkflow.buildGenerationManifest(temporalManifestInput({
    ...temporalCorrectionTrace,
    templatePixelsUsed: true,
  })),
  "AIFX_EXPORT_TEMPORAL_CORRECTION_INVALID",
);
expectCode(
  () => exportWorkflow.buildGenerationManifest(temporalManifestInput({
    ...temporalCorrectionTrace,
    transforms: temporalCorrectionTrace.transforms.map((entry, index) => ({
      ...entry,
      blend: index === 1
        ? entry.blend.map((blendEntry) => ({ ...blendEntry, weight: 0.2 }))
        : entry.blend,
    })),
  })),
  "AIFX_EXPORT_TEMPORAL_CORRECTION_INVALID",
);

expectCode(
  () => exportWorkflow.buildAtlasMetadata({
    frames: exportFrames,
    plan: exportPlan,
    fps: 24,
    provider: "local",
    model: "qwen-image-edit-2511",
    promptHash: "not-a-sha256",
  }),
  "AIFX_EXPORT_PROMPT_HASH_INVALID",
);

const exportCanvas = createFakeCanvasDependencies();
const product = await exportWorkflow.buildFinalProduct(
  {
    status: "ready",
    frames: exportFrames,
    fps: 24,
    lifecycle: "one-shot",
    pixelFormat: "rgba8",
    alphaMode: "straight",
    provider: "local",
    model: "qwen-image-edit-2511",
    promptHash,
    atlas: { columns: 2, gutter: 2, padding: 2 },
  },
  { templateResource, canvas: exportCanvas },
);
assert.equal(product.status, "ready");
assert.equal(product.files.atlas.name, "atlas.png");
assert.equal(product.files.atlas.dataUrl, PNG_DATA_URL);
assert.equal(product.files.frames.length, 3);
assert.equal(product.atlasJson.imageCount, 1);
assert.equal(product.manifest.outputs.atlas.imageCount, 1);
assert.equal(exportCanvas.canvases.length, 1, "final export must create one atlas texture page");
assert.equal(
  exportCanvas.canvases[0].operations.filter(([operation]) => operation === "drawImage").length,
  3,
  "the single atlas page must contain every processed frame",
);
assert.match(product.files.atlasMetadata.text, /"image": "atlas\.png"/);
assert.match(product.files.generationManifest.text, /"promptHash": "0123456789abcdef/);
assert.equal("materialType" in product, false, "legacy buildFinalProduct calls must remain compatible");
assert.equal("sequencePlan" in product.manifest, false);
assert.equal("temporalCorrection" in product.manifest, false);

const tracedExportCanvas = createFakeCanvasDependencies();
const tracedProduct = await exportWorkflow.buildFinalProduct(
  {
    status: "ready",
    frames: exportFrames,
    fps: 24,
    lifecycle: "one-shot",
    pixelFormat: "rgba8",
    alphaMode: "straight",
    provider: "local",
    model: "qwen-image-edit-2511",
    promptHash,
    atlas: { columns: 2, gutter: 2, padding: 2 },
    ...traceabilityInput,
  },
  { templateResource, canvas: tracedExportCanvas },
);
assert.equal(tracedProduct.materialType, "ice");
assert.equal(tracedProduct.shapeSource, "ai-generated-frame-matte");
assert.equal(tracedProduct.motionConstraint, "template-plan-only");
assert.deepEqual(plain(tracedProduct.sequencePlan), plain(tracedManifest.sequencePlan));
assert.deepEqual(plain(tracedProduct.sequenceQuality), plain(tracedManifest.sequenceQuality));
assert.deepEqual(plain(tracedProduct.controlGuidance), plain(tracedManifest.controlGuidance));
assert.deepEqual(plain(tracedProduct.temporalCorrection), plain(tracedManifest.temporalCorrection));
assert.deepEqual(plain(tracedProduct.manifest.sequencePlan), plain(tracedManifest.sequencePlan));
assert.deepEqual(plain(tracedProduct.manifest.sequenceQuality), plain(tracedManifest.sequenceQuality));
assert.deepEqual(plain(tracedProduct.manifest.temporalCorrection), plain(tracedManifest.temporalCorrection));
assert.equal(tracedProduct.files.atlas.dataUrl, product.files.atlas.dataUrl);
assert.deepEqual(plain(tracedProduct.atlasJson), plain(product.atlasJson), "trace metadata must not alter atlas metadata");
assert.deepEqual(
  plain(tracedProduct.files.frames.map((frame) => ({ name: frame.name, dataUrl: frame.dataUrl, index: frame.index }))),
  plain(product.files.frames.map((frame) => ({ name: frame.name, dataUrl: frame.dataUrl, index: frame.index }))),
  "trace metadata must not alter exported PNG frame files",
);
const tracedManifestFile = JSON.parse(tracedProduct.files.generationManifest.text);
assert.equal(tracedManifestFile.materialType, "ice");
assert.equal(tracedManifestFile.sequencePlan.length, 3);
assert.equal(tracedManifestFile.sequenceQuality.passed, true);
assert.equal(tracedManifestFile.controlGuidance.guideType, "neutral-soft-motion");
assert.equal(tracedManifestFile.temporalCorrection.anchorCount, 3);
assert.equal(tracedManifestFile.temporalCorrection.transforms[1].sourceIndices[1], 42);
assert.equal(tracedManifestFile.temporalCorrection.transforms[1].blend[1].weight, 0.75);
assert.equal("self" in tracedManifestFile.sequenceQuality, false);
assert.equal("self" in tracedManifestFile.temporalCorrection, false);

const browserZip = exportWorkflow.buildBrowserZip(product, {
  fileName: "NovaFlow_AIFX_Contract.zip",
});
assert.equal(browserZip.schemaVersion, "novaflow-aifx-browser-zip-v1");
assert.equal(browserZip.name, "NovaFlow_AIFX_Contract.zip");
assert.equal(browserZip.mimeType, "application/zip");
assert.equal(browserZip.compression, "store");
assert.equal(browserZip.entryCount, 6, "three frames plus atlas and two JSON files must be complete");
assert.equal(browserZip.byteLength, browserZip.bytes.length);
assert.deepEqual(Array.from(browserZip.entryNames), [
  "frames/frame_000.png",
  "frames/frame_001.png",
  "frames/frame_002.png",
  "atlas.png",
  "atlas.json",
  "generation-manifest.json",
]);

const parsedZip = parseStoreZip(browserZip.bytes);
assert.deepEqual(parsedZip.map((entry) => entry.name), Array.from(browserZip.entryNames));
const parsedFiles = new Map(parsedZip.map((entry) => [entry.name, entry.data]));
for (const name of [
  "frames/frame_000.png",
  "frames/frame_001.png",
  "frames/frame_002.png",
  "atlas.png",
]) {
  assert.deepEqual(Array.from(parsedFiles.get(name)), [0], `${name} bytes must survive ZIP packaging`);
}
assert.match(parsedFiles.get("atlas.json").toString("utf8"), /"image": "atlas\.png"/);
assert.match(parsedFiles.get("generation-manifest.json").toString("utf8"), /"promptHash": "0123456789abcdef/);

const deterministicZip = exportWorkflow.buildBrowserZip(product, {
  fileName: "NovaFlow_AIFX_Contract.zip",
});
assert.deepEqual(
  Array.from(deterministicZip.bytes),
  Array.from(browserZip.bytes),
  "store-mode browser ZIP must be deterministic for the same final product",
);

const nineFrameProduct = await exportWorkflow.buildFinalProduct(
  {
    status: "ready",
    frames: Array.from({ length: 9 }, (_, index) => finalFrame(index)),
    fps: 24,
    lifecycle: "one-shot",
    pixelFormat: "rgba8",
    alphaMode: "straight",
    provider: "local",
    model: "qwen-image-edit-2511",
    promptHash,
    atlas: { columns: 3, gutter: 2, padding: 2 },
  },
  { templateResource, canvas: createFakeCanvasDependencies() },
);
const nineFrameZip = exportWorkflow.buildBrowserZip(nineFrameProduct);
assert.equal(nineFrameZip.entryCount, 12, "nine-frame browser export must contain all 9 frames plus 3 product files");
assert.equal(parseStoreZip(nineFrameZip.bytes).length, 12);
assert.deepEqual(Array.from(nineFrameZip.entryNames).slice(-3), [
  "atlas.png",
  "atlas.json",
  "generation-manifest.json",
]);

expectCode(
  () => exportWorkflow.buildBrowserZip({
    ...product,
    files: { ...product.files, generationManifest: null },
  }),
  "AIFX_EXPORT_ZIP_INPUT_INVALID",
);

expectCode(
  () => exportWorkflow.buildBrowserZip({
    ...product,
    files: {
      ...product.files,
      frames: [
        product.files.frames[0],
        { ...product.files.frames[1], name: product.files.frames[0].name },
        product.files.frames[2],
      ],
    },
  }),
  "AIFX_EXPORT_ZIP_ENTRY_DUPLICATE",
);

expectCode(
  () => exportWorkflow.buildBrowserZip({
    ...product,
    files: {
      ...product.files,
      frames: [
        { ...product.files.frames[0], name: "../escaped.png" },
        product.files.frames[1],
        product.files.frames[2],
      ],
    },
  }),
  "AIFX_EXPORT_ZIP_ENTRY_INVALID",
);

console.log("AIFX asset pipeline contract passed.");
