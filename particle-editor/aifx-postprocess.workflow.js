(function initNovaFlowAifxPostprocessWorkflow(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.NovaFlowAifxPostprocessWorkflow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAifxPostprocessWorkflow(root) {
  "use strict";

  const SCHEMA_VERSION = "novaflow-aifx-postprocess-v2";
  const SHAPE_SOURCE = "ai-generated-frame-matte";
  const MOTION_CONSTRAINT = "template-plan-only";
  const LUMINOUS_MATERIALS = Object.freeze(new Set([
    "fire",
    "lightning",
    "ice",
    "holy",
    "magic",
    "energy",
    "glow",
    "plasma",
  ]));
  const MATERIAL_ALIASES = Object.freeze({
    fire: "fire",
    flame: "fire",
    flames: "fire",
    "火": "fire",
    "火焰": "fire",
    lightning: "lightning",
    electric: "lightning",
    electricity: "lightning",
    thunder: "lightning",
    "雷": "lightning",
    "雷电": "lightning",
    holy: "holy",
    "圣光": "holy",
    magic: "magic",
    magical: "magic",
    "魔法": "magic",
    energy: "energy",
    "能量": "energy",
    glow: "glow",
    luminous: "glow",
    "发光": "glow",
    plasma: "plasma",
    "等离子": "plasma",
    ice: "ice",
    snow: "ice",
    "冰": "ice",
    "冰雪": "ice",
    water: "water",
    "水": "water",
    smoke: "smoke",
    "烟": "smoke",
    poison: "poison",
    "毒": "poison",
  });

  class AifxPostprocessError extends Error {
    constructor(code, message, details, recoverable) {
      super(message);
      this.name = "AifxPostprocessError";
      this.code = code;
      this.details = details && typeof details === "object" ? details : {};
      this.recoverable = Boolean(recoverable);
    }
  }

  function fail(code, message, details, recoverable) {
    throw new AifxPostprocessError(code, message, details, recoverable);
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : Number.NaN;
  }

  function normalizeMaterialType(value) {
    const key = String(value || "").trim().toLowerCase();
    return MATERIAL_ALIASES[key] || key || "unknown";
  }

  function isLuminousMaterial(value) {
    return LUMINOUS_MATERIALS.has(normalizeMaterialType(value));
  }

  function readSheetSize(sheet) {
    return {
      width: positiveInteger(sheet?.width ?? sheet?.naturalWidth ?? sheet?.videoWidth),
      height: positiveInteger(sheet?.height ?? sheet?.naturalHeight ?? sheet?.videoHeight),
    };
  }

  function validateGeneratedSheetGeometry(sheet, plan) {
    const expected = {
      width: positiveInteger(plan?.sheetSize?.width),
      height: positiveInteger(plan?.sheetSize?.height),
    };
    const frameCount = positiveInteger(plan?.frameCount);
    if (
      !Number.isInteger(expected.width)
      || !Number.isInteger(expected.height)
      || !Number.isInteger(frameCount)
      || !Array.isArray(plan?.frameRects)
      || plan.frameRects.length !== frameCount
    ) {
      fail("AIFX_POSTPROCESS_PLAN_INVALID", "A complete sprite-sheet plan is required before post-processing.");
    }
    const actual = readSheetSize(sheet);
    if (actual.width !== expected.width || actual.height !== expected.height) {
      fail(
        "AIFX_GENERATED_SHEET_GEOMETRY_MISMATCH",
        `Generated sheet geometry changed from ${expected.width}x${expected.height} to ${actual.width}x${actual.height}; cutting is forbidden.`,
        { expected, actual },
      );
    }
    plan.frameRects.forEach((entry, index) => {
      const rect = entry?.rect;
      if (
        entry?.index !== index
        || !Number.isInteger(rect?.x)
        || !Number.isInteger(rect?.y)
        || !Number.isInteger(rect?.width)
        || !Number.isInteger(rect?.height)
        || rect.x < 0
        || rect.y < 0
        || rect.width <= 0
        || rect.height <= 0
        || rect.x + rect.width > actual.width
        || rect.y + rect.height > actual.height
      ) {
        fail("AIFX_POSTPROCESS_PLAN_INVALID", `Generated-sheet frame rect ${index} is out of bounds.`, {
          index,
          rect,
          sheetSize: actual,
        });
      }
    });
    return Object.freeze({
      expected: Object.freeze(expected),
      actual: Object.freeze(actual),
      frameCount,
    });
  }

  function resolveTemplateResource(dependencies) {
    const resource = dependencies?.templateResource || root?.NovaFlowAifxTemplateResource;
    if (!resource || typeof resource.cutSpriteSheet !== "function") {
      fail(
        "AIFX_TEMPLATE_RESOURCE_UNAVAILABLE",
        "NovaFlowAifxTemplateResource.cutSpriteSheet() is required for post-processing.",
      );
    }
    return resource;
  }

  function resolveBackgroundRemoval(dependencies) {
    const removal = dependencies?.backgroundRemoval || root?.NovaFlowBackgroundRemoval;
    if (!removal || typeof removal.removeBlackBackgroundDataUrl !== "function") {
      fail(
        "AIFX_BACKGROUND_REMOVAL_UNAVAILABLE",
        "Luminous effects require NovaFlowBackgroundRemoval.removeBlackBackgroundDataUrl().",
      );
    }
    return removal;
  }

  function resolveRuntimeRmbg(dependencies) {
    const candidate = dependencies?.rmbg || root?.NovaFlowAifxRmbgBridge;
    if (typeof candidate === "function") return candidate;
    if (candidate && typeof candidate.removeBackgroundDataUrl === "function") {
      return (dataUrl, context) => candidate.removeBackgroundDataUrl(dataUrl, context);
    }
    if (candidate && typeof candidate.removeBackground === "function") {
      return (dataUrl, context) => candidate.removeBackground(dataUrl, context);
    }
    return null;
  }

  function resolveCanvasDependencies(dependencies) {
    return dependencies?.canvas || dependencies;
  }

  function assertPngDataUrl(value, code, context) {
    if (typeof value !== "string" || !/^data:image\/png(?:;[^,]*)?,/i.test(value)) {
      fail(code, "Background-removal output must be a PNG data URL.", context);
    }
    return value;
  }

  function normalizeProcessorResult(result, code, context) {
    const dataUrl = typeof result === "string" ? result : result?.dataUrl;
    assertPngDataUrl(dataUrl, code, context);
    if (result && typeof result === "object" && result.alphaMode && result.alphaMode !== "straight") {
      fail(code, "Background-removal output must use straight alpha.", {
        ...context,
        alphaMode: result.alphaMode,
      });
    }
    if (result && typeof result === "object" && result.pixelFormat && result.pixelFormat !== "rgba8") {
      fail(code, "Background-removal output must use rgba8 pixels.", {
        ...context,
        pixelFormat: result.pixelFormat,
      });
    }
    return {
      dataUrl,
      stats: result && typeof result === "object" ? result.stats || null : null,
    };
  }

  function frameContract(frame) {
    return Object.freeze({
      index: frame.index,
      name: frame.name,
      width: frame.width,
      height: frame.height,
      mimeType: "image/png",
      pixelFormat: "rgba8",
      alphaMode: "straight",
    });
  }

  function normalizeAiMatteMethod(value) {
    const method = String(value || "").trim();
    return method === "black-matte-remove-and-unmultiply" || method === "runtime-rmbg"
      ? method
      : SHAPE_SOURCE;
  }

  function assertAiGeneratedFrames(inputFrames, plan) {
    if (!Array.isArray(inputFrames) || !inputFrames.length) {
      fail("AIFX_AI_FRAMES_REQUIRED", "AI post-processing must produce at least one RGBA frame.");
    }
    const expectedCount = positiveInteger(plan?.frameCount);
    if (
      !Number.isInteger(expectedCount)
      || !Array.isArray(plan?.frameRects)
      || plan.frameRects.length !== expectedCount
      || inputFrames.length !== expectedCount
    ) {
      fail("AIFX_AI_FRAME_PLAN_MISMATCH", "AI-generated frames must match the source sprite-sheet plan.");
    }
    const frames = inputFrames.slice().sort((left, right) => Number(left?.index) - Number(right?.index));
    return Object.freeze(frames.map((frame, index) => {
      const sourceSize = plan.frameRects[index]?.sourceSize;
      const width = positiveInteger(frame?.width);
      const height = positiveInteger(frame?.height);
      if (
        Number(frame?.index) !== index
        || width !== positiveInteger(sourceSize?.width)
        || height !== positiveInteger(sourceSize?.height)
      ) {
        fail("AIFX_AI_FRAME_MISMATCH", `AI-generated frame ${index} changed source order or dimensions.`, {
          index,
          expected: sourceSize,
          actual: { index: frame?.index, width, height },
        });
      }
      const dataUrl = assertPngDataUrl(
        frame?.dataUrl,
        "AIFX_AI_FRAME_INVALID",
        { index, name: frame?.name },
      );
      if (frame?.pixelFormat && frame.pixelFormat !== "rgba8") {
        fail("AIFX_AI_FRAME_INVALID", "AI-generated frames must use rgba8 pixels.", { index });
      }
      if (frame?.alphaMode && frame.alphaMode !== "straight") {
        fail("AIFX_AI_FRAME_INVALID", "AI-generated frames must use straight alpha.", { index });
      }
      return Object.freeze({
        ...frame,
        index,
        name: String(frame.name || `frame_${String(index).padStart(3, "0")}.png`),
        width,
        height,
        dataUrl,
        mimeType: "image/png",
        pixelFormat: "rgba8",
        alphaMode: "straight",
        matteMethod: normalizeAiMatteMethod(frame.matteMethod),
        shapeSource: SHAPE_SOURCE,
        motionConstraint: MOTION_CONSTRAINT,
      });
    }));
  }

  function finalizeAiGeneratedFrames(input) {
    const source = input && typeof input === "object" ? input : {};
    const plan = source.plan;
    const materialType = normalizeMaterialType(source.materialType);
    const frames = assertAiGeneratedFrames(source.frames, plan);
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      status: "ready",
      materialType,
      matteMethod: normalizeAiMatteMethod(source.matteMethod),
      shapeSource: SHAPE_SOURCE,
      motionConstraint: MOTION_CONSTRAINT,
      preservesFrameOrder: true,
      preservesFrameDimensions: true,
      frameCount: frames.length,
      fps: plan.fps,
      lifecycle: plan.lifecycle,
      pixelFormat: "rgba8",
      alphaMode: "straight",
      frames,
    });
  }

  // Compatibility entrypoint for callers that have not moved to the explicit
  // AI-shape contract yet. It deliberately returns the new formal semantics.
  function finalizeGeometryLockedFrames(input) {
    return finalizeAiGeneratedFrames(input);
  }

  function createRmbgRequirement(rawFrames, materialType) {
    const normalizedMaterial = normalizeMaterialType(materialType);
    return Object.freeze({
      schemaVersion: "novaflow-aifx-rmbg-request-v1",
      type: "runtime-rmbg",
      reason: "non-luminous-material-needs-semantic-matte",
      materialType: normalizedMaterial,
      frameCount: rawFrames.length,
      expectedOutput: Object.freeze({
        mimeType: "image/png",
        pixelFormat: "rgba8",
        alphaMode: "straight",
        preserveFrameSize: true,
        shapeSource: SHAPE_SOURCE,
        motionConstraint: MOTION_CONSTRAINT,
      }),
      frames: Object.freeze(rawFrames.map((frame) => Object.freeze({
        ...frameContract(frame),
        inputDataUrl: frame.dataUrl,
      }))),
    });
  }

  async function processLuminousFrames(rawFrames, materialType, options, dependencies) {
    const removal = resolveBackgroundRemoval(dependencies);
    const removalOptions = options?.blackRemoval && typeof options.blackRemoval === "object"
      ? options.blackRemoval
      : {};
    const frames = [];
    for (const frame of rawFrames) {
      const result = await removal.removeBlackBackgroundDataUrl(frame.dataUrl, {
        ...removalOptions,
        materialType,
        index: frame.index,
        name: frame.name,
        preserveGlow: true,
        outputAlphaMode: "straight",
      });
      const normalized = normalizeProcessorResult(
        result,
        "AIFX_LUMINOUS_ALPHA_INVALID",
        { index: frame.index, name: frame.name },
      );
      const resultWidth = positiveInteger(result?.width ?? frame.width);
      const resultHeight = positiveInteger(result?.height ?? frame.height);
      if (resultWidth !== frame.width || resultHeight !== frame.height) {
        fail("AIFX_LUMINOUS_OUTPUT_SIZE_MISMATCH", "Black-matte removal changed the AI frame dimensions.", {
          index: frame.index,
          expected: { width: frame.width, height: frame.height },
          actual: { width: resultWidth, height: resultHeight },
        });
      }
      frames.push(Object.freeze({
        ...frameContract(frame),
        sourceName: frame.sourceName,
        dataUrl: normalized.dataUrl,
        stats: normalized.stats,
        matteMethod: "black-matte-remove-and-unmultiply",
        shapeSource: SHAPE_SOURCE,
        motionConstraint: MOTION_CONSTRAINT,
      }));
    }
    return Object.freeze(frames);
  }

  async function processRmbgFrames(rawFrames, materialType, processor, options) {
    const frames = [];
    for (const frame of rawFrames) {
      const result = await processor(frame.dataUrl, {
        schemaVersion: "novaflow-aifx-rmbg-frame-v1",
        materialType,
        index: frame.index,
        name: frame.name,
        width: frame.width,
        height: frame.height,
        signal: options?.signal || null,
        expectedOutput: {
          mimeType: "image/png",
          pixelFormat: "rgba8",
          alphaMode: "straight",
          preserveFrameSize: true,
        },
      });
      const normalized = normalizeProcessorResult(
        result,
        "AIFX_RMBG_OUTPUT_INVALID",
        { index: frame.index, name: frame.name },
      );
      const resultWidth = positiveInteger(result?.width ?? frame.width);
      const resultHeight = positiveInteger(result?.height ?? frame.height);
      if (resultWidth !== frame.width || resultHeight !== frame.height) {
        fail("AIFX_RMBG_OUTPUT_SIZE_MISMATCH", "Runtime RMBG changed the frame dimensions.", {
          index: frame.index,
          expected: { width: frame.width, height: frame.height },
          actual: { width: resultWidth, height: resultHeight },
        });
      }
      frames.push(Object.freeze({
        ...frameContract(frame),
        sourceName: frame.sourceName,
        dataUrl: normalized.dataUrl,
        stats: normalized.stats,
        matteMethod: "runtime-rmbg",
        shapeSource: SHAPE_SOURCE,
        motionConstraint: MOTION_CONSTRAINT,
      }));
    }
    return Object.freeze(frames);
  }

  function throwRmbgRequired(requirement) {
    fail(
      "AIFX_RMBG_REQUIRED",
      `Material \"${requirement.materialType}\" requires the Runtime RMBG bridge before it can become a final RGBA asset.`,
      {
        requirementType: requirement.type,
        materialType: requirement.materialType,
        frameCount: requirement.frameCount,
        expectedOutput: requirement.expectedOutput,
      },
      true,
    );
  }

  async function postprocessGeneratedSheet(input, dependencies) {
    const source = input && typeof input === "object" ? input : {};
    const plan = source.plan;
    const sheet = source.sheet;
    const materialType = normalizeMaterialType(source.materialType);

    // Geometry is deliberately validated before any canvas cutting or alpha work.
    validateGeneratedSheetGeometry(sheet, plan);
    const templateResource = resolveTemplateResource(dependencies);
    const rawFrames = await templateResource.cutSpriteSheet(
      sheet,
      plan,
      { renameFrames: true },
      resolveCanvasDependencies(dependencies),
    );

    if (isLuminousMaterial(materialType)) {
      const frames = await processLuminousFrames(rawFrames, materialType, source, dependencies);
      return Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        status: "ready",
        materialType,
        matteMethod: "black-matte-remove-and-unmultiply",
        shapeSource: SHAPE_SOURCE,
        motionConstraint: MOTION_CONSTRAINT,
        preservesFrameOrder: true,
        preservesFrameDimensions: true,
        frameCount: frames.length,
        fps: plan.fps,
        lifecycle: plan.lifecycle,
        pixelFormat: "rgba8",
        alphaMode: "straight",
        frames,
      });
    }

    const processor = resolveRuntimeRmbg(dependencies);
    const requirement = createRmbgRequirement(rawFrames, materialType);
    if (!processor) {
      if (source.rmbgFallback === "return-requirement") {
        return Object.freeze({
          schemaVersion: SCHEMA_VERSION,
          status: "requires-runtime-rmbg",
          materialType,
          shapeSource: SHAPE_SOURCE,
          motionConstraint: MOTION_CONSTRAINT,
          requirement,
        });
      }
      throwRmbgRequired(requirement);
    }

    const frames = await processRmbgFrames(rawFrames, materialType, processor, source);
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      status: "ready",
      materialType,
      matteMethod: "runtime-rmbg",
      shapeSource: SHAPE_SOURCE,
      motionConstraint: MOTION_CONSTRAINT,
      preservesFrameOrder: true,
      preservesFrameDimensions: true,
      frameCount: frames.length,
      fps: plan.fps,
      lifecycle: plan.lifecycle,
      pixelFormat: "rgba8",
      alphaMode: "straight",
      frames,
    });
  }

  return Object.freeze({
    version: SCHEMA_VERSION,
    AifxPostprocessError,
    normalizeMaterialType,
    isLuminousMaterial,
    validateGeneratedSheetGeometry,
    finalizeAiGeneratedFrames,
    finalizeGeometryLockedFrames,
    createRmbgRequirement,
    postprocessGeneratedSheet,
  });
});
