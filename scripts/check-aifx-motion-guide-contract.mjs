import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadUmd(relativePath, globalName) {
  const file = path.join(root, relativePath);
  const sandbox = { module: { exports: {} }, console };
  runInNewContext(readFileSync(file, "utf8"), sandbox, { filename: file });
  assert.equal(
    sandbox[globalName],
    sandbox.module.exports,
    `${relativePath} must expose the same browser and CommonJS API`,
  );
  return sandbox.module.exports;
}

class FakeCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.operations = [];
    this.context = {
      imageSmoothingEnabled: true,
      fillStyle: "",
      createImageData: (imageWidth, imageHeight) => ({
        width: imageWidth,
        height: imageHeight,
        data: new Uint8ClampedArray(imageWidth * imageHeight * 4),
      }),
      putImageData: (image, x, y) => {
        assert.equal(x, 0);
        assert.equal(y, 0);
        assert.equal(image.data.length, this.pixels.length);
        this.pixels.set(image.data);
        this.operations.push(["putImageData", x, y]);
      },
      getImageData: () => ({
        width: this.width,
        height: this.height,
        data: new Uint8ClampedArray(this.pixels),
      }),
      clearRect: (...args) => this.operations.push(["clearRect", ...args]),
      fillRect: (...args) => this.operations.push(["fillRect", ...args]),
      drawImage: (...args) => this.operations.push(["drawImage", ...args]),
    };
  }

  getContext(kind) {
    return kind === "2d" ? this.context : null;
  }

  toDataURL() {
    return "data:image/png;base64,AA==";
  }
}

function canvasFactoryCollector() {
  const canvases = [];
  return {
    canvases,
    createCanvas(width, height) {
      const canvas = new FakeCanvas(width, height);
      canvases.push(canvas);
      return canvas;
    },
  };
}

function templateFrame(index, width = 20, height = 14) {
  const frame = {
    index,
    sequenceNumber: index,
    name: `frame_${String(index).padStart(3, "0")}.png`,
    width,
    height,
  };
  Object.defineProperty(frame, "canvas", {
    enumerable: false,
    get() {
      throw new Error("Motion-guide generation must not inspect template pixels.");
    },
  });
  return frame;
}

function grayValues(canvas) {
  const values = [];
  for (let offset = 0; offset < canvas.pixels.length; offset += 4) values.push(canvas.pixels[offset]);
  return values;
}

function alphaValues(canvas) {
  const values = [];
  for (let offset = 3; offset < canvas.pixels.length; offset += 4) values.push(canvas.pixels[offset]);
  return values;
}

function pixelValue(canvas, x, y) {
  return canvas.pixels[(y * canvas.width + x) * 4];
}

function findPeak(canvas) {
  let bestValue = -1;
  let best = { x: 0, y: 0 };
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const value = canvas.pixels[(y * canvas.width + x) * 4];
      if (value > bestValue) {
        bestValue = value;
        best = { x, y };
      }
    }
  }
  return { ...best, value: bestValue };
}

function activeBounds(canvas, ratio = 0.25) {
  const peak = findPeak(canvas).value;
  const threshold = peak * ratio;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (canvas.pixels[(y * canvas.width + x) * 4] < threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }
  return {
    width: Math.max(0, maxX - minX + 1),
    height: Math.max(0, maxY - minY + 1),
    count,
  };
}

const motionGuide = loadUmd(
  "particle-editor/aifx-motion-guide.resource.js",
  "NovaFlowAifxMotionGuideResource",
);
const templateResource = loadUmd(
  "particle-editor/aifx-template.resource.js",
  "NovaFlowAifxTemplateResource",
);

const frames = [templateFrame(0), templateFrame(1), templateFrame(2)];
const guides = [
  {
    center: { x: 5, y: 7 },
    axis: { x: 1, y: 0 },
    length: 12,
    width: 2,
    energy: 2,
    emission: { x: 1, y: 7 },
  },
  {
    center: { x: 14, y: 7 },
    axis: { x: 1, y: 0 },
    length: 12,
    width: 4,
    energy: 8,
    emission: { x: 8, y: 7 },
  },
  {
    center: { x: 10, y: 4 },
    axis: { x: 0, y: 1 },
    length: 8,
    width: 2,
    energy: 4,
    energyNorm: 0.5,
    origin: { x: 10, y: 1 },
  },
];

const guideCanvases = canvasFactoryCollector();
const result = await motionGuide.createGuideFrames(
  frames,
  guides,
  { maxIntensity: 232 },
  { createCanvas: guideCanvases.createCanvas },
);

assert.equal(result.schemaVersion, "novaflow-aifx-motion-guide-v1");
assert.equal(result.guideType, "neutral-soft-motion");
assert.equal(result.colorSpace, "neutral-grayscale");
assert.equal(result.background, "black");
assert.equal(result.alphaMode, "opaque-control-image");
assert.equal(result.frameCount, 3);
assert.equal(result.frames.length, frames.length);
assert.equal(guideCanvases.canvases.length, frames.length);

for (let index = 0; index < result.frames.length; index += 1) {
  const output = result.frames[index];
  const canvas = output.canvas;
  assert.equal(output.index, index);
  assert.equal(output.sequenceNumber, index);
  assert.equal(output.name, frames[index].name);
  assert.equal(output.width, frames[index].width);
  assert.equal(output.height, frames[index].height);
  assert.equal(output.image, output.canvas, "packFrames must receive the decoded guide canvas directly");
  assert.match(output.dataUrl, /^data:image\/png/);
  assert.ok(canvas.pixels.some((value, offset) => offset % 4 !== 3 && value > 0), "guide must contain a visible field");
  assert.ok(
    grayValues(canvas).every((_value, pixelIndex) => {
      const offset = pixelIndex * 4;
      return canvas.pixels[offset] === canvas.pixels[offset + 1]
        && canvas.pixels[offset + 1] === canvas.pixels[offset + 2];
    }),
    "guide colors must remain neutral grayscale",
  );
  assert.ok(alphaValues(canvas).every((value) => value === 255), "guide control images must use uniform opaque alpha");
  assert.ok(new Set(grayValues(canvas)).size > 5, "motion field must have a soft grayscale falloff");
}

const templateAlpha = Uint8ClampedArray.from(
  { length: frames[0].width * frames[0].height },
  (_value, index) => index % 3 === 0 ? 255 : index % 3 === 1 ? 96 : 0,
);
assert.notDeepEqual(
  alphaValues(result.frames[0].canvas),
  Array.from(templateAlpha),
  "motion-guide alpha must not copy the template alpha mask",
);
assert.notDeepEqual(
  grayValues(result.frames[0].canvas),
  Array.from(templateAlpha),
  "motion-guide intensity must be synthesized from guide geometry, not template alpha pixels",
);

assert.deepEqual(
  { ...result.frames[0].guide.center },
  { x: 5, y: 7 },
);
assert.deepEqual(
  { ...result.frames[1].guide.center },
  { x: 14, y: 7 },
);
assert.deepEqual(
  { ...result.frames[2].guide.emission },
  { x: 10, y: 1 },
);
assert.equal(result.frames[0].guide.energy, 0.25);
assert.equal(result.frames[1].guide.energy, 1);
assert.equal(result.frames[2].guide.energy, 0.5);

const peak0 = findPeak(result.frames[0].canvas);
const peak1 = findPeak(result.frames[1].canvas);
const peak2 = findPeak(result.frames[2].canvas);
assert.ok(Math.hypot(peak0.x - 5, peak0.y - 7) <= 1.5, "frame 0 peak must encode its center");
assert.ok(Math.hypot(peak1.x - 14, peak1.y - 7) <= 1.5, "frame 1 peak must encode its center");
assert.ok(Math.hypot(peak2.x - 10, peak2.y - 4) <= 1.5, "frame 2 peak must encode its center");
assert.ok(peak1.value > peak0.value * 3, "normalized energy must control guide intensity");

const horizontalNarrow = activeBounds(result.frames[0].canvas);
const horizontalWide = activeBounds(result.frames[1].canvas);
const vertical = activeBounds(result.frames[2].canvas);
assert.ok(horizontalNarrow.width > horizontalNarrow.height, "horizontal axis must create a horizontal centerline");
assert.ok(vertical.height > vertical.width, "vertical axis must create a vertical centerline");
assert.ok(horizontalWide.count > horizontalNarrow.count, "rough width must affect the soft motion corridor");

const curvedGuide = {
  center: { x: 10, y: 7 },
  axis: { x: 1, y: 0 },
  length: 18,
  width: 2,
  energyNorm: 1,
  points: [
    { x: 3, y: 3 },
    { x: 6, y: 8 },
    { x: 10, y: 11 },
    { x: 14, y: 8 },
    { x: 17, y: 3 },
  ],
};
const curvedCanvases = canvasFactoryCollector();
const curvedResult = await motionGuide.createGuideFrames(
  [templateFrame(0)],
  [curvedGuide],
  {},
  { createCanvas: curvedCanvases.createCanvas },
);
const straightCanvases = canvasFactoryCollector();
const straightResult = await motionGuide.createGuideFrames(
  [templateFrame(0)],
  [{ ...curvedGuide, points: undefined }],
  {},
  { createCanvas: straightCanvases.createCanvas },
);
const curvedFrame = curvedResult.frames[0];
const straightFrame = straightResult.frames[0];
assert.equal(curvedFrame.guide.centerlineSource, "template-guide-polyline");
assert.equal(straightFrame.guide.centerlineSource, "principal-axis-fallback");
assert.deepEqual(
  JSON.parse(JSON.stringify(curvedFrame.guide.centerline)),
  curvedGuide.points,
  "the abstract guide polyline must remain the rendered centerline",
);
assert.ok(
  pixelValue(curvedFrame.canvas, 10, 11) > pixelValue(straightFrame.canvas, 10, 11) * 5,
  "an off-axis bend from guide.points must survive instead of collapsing to the principal-axis capsule",
);
assert.ok(
  pixelValue(curvedFrame.canvas, 6, 8) > pixelValue(straightFrame.canvas, 6, 8) * 1.35,
  "each abstract centerline bend must contribute to the soft trajectory",
);
assert.ok(
  curvedFrame.guide.centerline.length <= 24,
  "motion guides must keep only the bounded abstract polyline, never per-pixel contour data",
);

const sourceForPlan = frames.map((frame) => ({
  index: frame.index,
  sequenceNumber: frame.sequenceNumber,
  name: frame.name,
  width: frame.width,
  height: frame.height,
}));
const plan = templateResource.createSpriteSheetPlan(sourceForPlan, {
  columns: 2,
  gutter: 2,
  padding: 2,
});
const packCanvases = canvasFactoryCollector();
const packed = await templateResource.packFrames(
  result.frames,
  { plan, background: "black" },
  { canvasFactory: packCanvases.createCanvas },
);
assert.equal(packed.frames.length, result.frames.length);
assert.equal(
  packCanvases.canvases[0].operations.filter(([operation]) => operation === "drawImage").length,
  result.frames.length,
  "existing templateResource.packFrames(plan) must accept every generated guide frame",
);

await assert.rejects(
  () => motionGuide.createGuideFrames(frames, guides.slice(0, 2), {}, { createCanvas: guideCanvases.createCanvas }),
  (error) => {
    assert.equal(error?.code, "AIFX_MOTION_GUIDE_COUNT_MISMATCH");
    return true;
  },
);
await assert.rejects(
  () => motionGuide.createGuideFrames(
    [{ ...frames[0], width: 0 }],
    [guides[0]],
    {},
    { createCanvas: guideCanvases.createCanvas },
  ),
  (error) => {
    assert.equal(error?.code, "AIFX_MOTION_GUIDE_FRAME_SIZE_INVALID");
    return true;
  },
);

console.log("AIFX motion guide contract passed.");
