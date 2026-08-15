(function initNovaFlowAifxTemplateResource(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.NovaFlowAifxTemplateResource = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAifxTemplateResource(root) {
  "use strict";

  const SCHEMA_VERSION = "novaflow-aifx-template-v1";
  const DEFAULT_FPS = 12;
  const DEFAULT_CONTROL_GUTTER = 32;
  const DEFAULT_MAX_DIMENSION = 16384;
  const NATURAL_COLLATOR = typeof Intl === "object" && typeof Intl.Collator === "function"
    ? new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
    : null;

  class AifxTemplateError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "AifxTemplateError";
      this.code = code;
      this.details = details && typeof details === "object" ? details : {};
    }
  }

  function fail(code, message, details) {
    throw new AifxTemplateError(code, message, details);
  }

  function asArray(value) {
    return Array.isArray(value) ? value.slice() : Array.from(value || []);
  }

  function finiteInteger(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    const number = Number(value);
    return Number.isInteger(number) ? number : Number.NaN;
  }

  function readImageWidth(value) {
    return finiteInteger(value?.width ?? value?.naturalWidth ?? value?.videoWidth, Number.NaN);
  }

  function readImageHeight(value) {
    return finiteInteger(value?.height ?? value?.naturalHeight ?? value?.videoHeight, Number.NaN);
  }

  function readFrameWidth(frame) {
    return finiteInteger(
      frame?.width ?? frame?.naturalWidth ?? frame?.image?.naturalWidth ?? frame?.image?.width,
      Number.NaN,
    );
  }

  function readFrameHeight(frame) {
    return finiteInteger(
      frame?.height ?? frame?.naturalHeight ?? frame?.image?.naturalHeight ?? frame?.image?.height,
      Number.NaN,
    );
  }

  function cleanFrameName(frame, position) {
    const raw = frame?.name ?? frame?.fileName ?? frame?.filename ?? frame?.file?.name;
    const name = String(raw || "").trim().replace(/\\/g, "/").split("/").pop();
    if (name) return name;
    const explicit = finiteInteger(frame?.sequenceNumber ?? frame?.frameNumber ?? frame?.frameIndex, Number.NaN);
    if (Number.isInteger(explicit) && explicit >= 0) {
      return `frame_${String(explicit).padStart(3, "0")}.png`;
    }
    fail(
      "AIFX_TEMPLATE_FRAME_NAME_REQUIRED",
      `Template frame ${position} must have a numbered file name or an explicit frame index.`,
      { position },
    );
  }

  function extractSequenceNumber(frame, name, position) {
    const explicit = finiteInteger(frame?.sequenceNumber ?? frame?.frameNumber ?? frame?.frameIndex, Number.NaN);
    if (Number.isInteger(explicit)) {
      if (explicit < 0) {
        fail("AIFX_TEMPLATE_FRAME_NUMBER_INVALID", "Template frame numbers cannot be negative.", {
          position,
          name,
          value: explicit,
        });
      }
      return explicit;
    }
    const stem = String(name).replace(/\.[^.]+$/, "");
    const match = stem.match(/(\d+)(?!.*\d)/);
    if (!match) {
      fail(
        "AIFX_TEMPLATE_FRAME_NUMBER_REQUIRED",
        `Template frame \"${name}\" must end with a numeric sequence token.`,
        { position, name },
      );
    }
    return Number(match[1]);
  }

  function compareNatural(left, right) {
    if (left.sequenceNumber !== right.sequenceNumber) return left.sequenceNumber - right.sequenceNumber;
    if (NATURAL_COLLATOR) return NATURAL_COLLATOR.compare(left.name, right.name);
    return left.name.localeCompare(right.name);
  }

  function normalizeTemplateFrames(inputFrames) {
    const frames = asArray(inputFrames);
    if (!frames.length) {
      fail("AIFX_TEMPLATE_EMPTY", "At least one template frame is required.");
    }

    const normalized = frames.map((frame, position) => {
      if (!frame || typeof frame !== "object") {
        fail("AIFX_TEMPLATE_FRAME_INVALID", `Template frame ${position} is invalid.`, { position });
      }
      const name = cleanFrameName(frame, position);
      const sequenceNumber = extractSequenceNumber(frame, name, position);
      const width = readFrameWidth(frame);
      const height = readFrameHeight(frame);
      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        fail(
          "AIFX_TEMPLATE_FRAME_SIZE_INVALID",
          `Template frame \"${name}\" must expose a positive integer width and height.`,
          { position, name, width, height },
        );
      }
      return {
        ...frame,
        name,
        sequenceNumber,
        width,
        height,
        originalPosition: position,
      };
    }).sort(compareNatural);

    const seenNames = new Map();
    const seenNumbers = new Map();
    normalized.forEach((frame) => {
      const nameKey = frame.name.toLocaleLowerCase();
      if (seenNames.has(nameKey)) {
        fail("AIFX_TEMPLATE_DUPLICATE_NAME", `Duplicate template frame name: ${frame.name}.`, {
          name: frame.name,
          positions: [seenNames.get(nameKey), frame.originalPosition],
        });
      }
      seenNames.set(nameKey, frame.originalPosition);
      if (seenNumbers.has(frame.sequenceNumber)) {
        fail(
          "AIFX_TEMPLATE_DUPLICATE_FRAME",
          `Duplicate template frame number: ${frame.sequenceNumber}.`,
          {
            frameNumber: frame.sequenceNumber,
            names: [seenNumbers.get(frame.sequenceNumber), frame.name],
          },
        );
      }
      seenNumbers.set(frame.sequenceNumber, frame.name);
    });

    const firstNumber = normalized[0].sequenceNumber;
    normalized.forEach((frame, index) => {
      const expected = firstNumber + index;
      if (frame.sequenceNumber !== expected) {
        fail(
          "AIFX_TEMPLATE_MISSING_FRAME",
          `Template sequence is missing frame ${expected}.`,
          {
            expected,
            actual: frame.sequenceNumber,
            previous: normalized[index - 1]?.sequenceNumber ?? null,
          },
        );
      }
    });

    const expectedWidth = normalized[0].width;
    const expectedHeight = normalized[0].height;
    const mixed = normalized.find((frame) => frame.width !== expectedWidth || frame.height !== expectedHeight);
    if (mixed) {
      fail(
        "AIFX_TEMPLATE_MIXED_SIZE",
        "All template frames must have identical pixel dimensions; implicit stretching is forbidden.",
        {
          expected: { width: expectedWidth, height: expectedHeight },
          actual: { width: mixed.width, height: mixed.height },
          name: mixed.name,
        },
      );
    }

    return normalized.map((frame, index) => Object.freeze({ ...frame, index }));
  }

  function normalizeFps(value) {
    const fps = finiteInteger(value, DEFAULT_FPS);
    if (!Number.isInteger(fps) || fps < 1 || fps > 120) {
      fail("AIFX_TEMPLATE_FPS_INVALID", "Template FPS must be an integer between 1 and 120.", { value });
    }
    return fps;
  }

  function normalizeLifecycle(input, frameCount) {
    const source = input && typeof input === "object" && !Array.isArray(input)
      ? input
      : { mode: input };
    const rawMode = String(source.mode || source.type || "one-shot").trim().toLowerCase();
    const aliases = {
      once: "one-shot",
      oneshot: "one-shot",
      "one-shot": "one-shot",
      loop: "loop",
      looping: "loop",
      pingpong: "ping-pong",
      "ping-pong": "ping-pong",
    };
    const mode = aliases[rawMode];
    if (!mode) {
      fail("AIFX_TEMPLATE_LIFECYCLE_INVALID", `Unsupported template lifecycle mode: ${rawMode}.`, {
        value: input,
      });
    }

    const startFrame = finiteInteger(source.startFrame, 0);
    const endFrame = finiteInteger(source.endFrame, frameCount - 1);
    const peakFrame = source.peakFrame === undefined || source.peakFrame === null
      ? null
      : finiteInteger(source.peakFrame, Number.NaN);
    const assertFramePosition = (value, label) => {
      if (!Number.isInteger(value) || value < 0 || value >= frameCount) {
        fail("AIFX_TEMPLATE_LIFECYCLE_INVALID", `${label} must be inside the normalized frame sequence.`, {
          label,
          value,
          frameCount,
        });
      }
    };
    assertFramePosition(startFrame, "startFrame");
    assertFramePosition(endFrame, "endFrame");
    if (endFrame < startFrame) {
      fail("AIFX_TEMPLATE_LIFECYCLE_INVALID", "Lifecycle endFrame cannot precede startFrame.", {
        startFrame,
        endFrame,
      });
    }
    if (peakFrame !== null) assertFramePosition(peakFrame, "peakFrame");

    const phases = asArray(source.phases).map((phase, index) => {
      const name = String(phase?.name || `phase-${index + 1}`).trim();
      const phaseStart = finiteInteger(phase?.startFrame, Number.NaN);
      const phaseEnd = finiteInteger(phase?.endFrame, Number.NaN);
      assertFramePosition(phaseStart, `phases[${index}].startFrame`);
      assertFramePosition(phaseEnd, `phases[${index}].endFrame`);
      if (phaseEnd < phaseStart) {
        fail("AIFX_TEMPLATE_LIFECYCLE_INVALID", `Lifecycle phase \"${name}\" has an inverted range.`, {
          name,
          startFrame: phaseStart,
          endFrame: phaseEnd,
        });
      }
      return Object.freeze({ name, startFrame: phaseStart, endFrame: phaseEnd });
    });
    for (let index = 1; index < phases.length; index += 1) {
      if (phases[index].startFrame <= phases[index - 1].endFrame) {
        fail("AIFX_TEMPLATE_LIFECYCLE_INVALID", "Lifecycle phases must be ordered and non-overlapping.", {
          previous: phases[index - 1],
          current: phases[index],
        });
      }
    }

    return Object.freeze({ mode, startFrame, endFrame, peakFrame, phases: Object.freeze(phases) });
  }

  function freezeRect(rect) {
    return Object.freeze({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }

  function createSpriteSheetPlan(inputFrames, options) {
    const settings = options && typeof options === "object" ? options : {};
    const frames = normalizeTemplateFrames(inputFrames);
    const frameCount = frames.length;
    const frameWidth = frames[0].width;
    const frameHeight = frames[0].height;
    const columns = finiteInteger(settings.columns, Math.ceil(Math.sqrt(frameCount)));
    if (!Number.isInteger(columns) || columns < 1 || columns > frameCount) {
      fail("AIFX_SPRITESHEET_COLUMNS_INVALID", "Sprite-sheet columns must be between 1 and frameCount.", {
        columns,
        frameCount,
      });
    }
    const rows = Math.ceil(frameCount / columns);
    const gutter = finiteInteger(settings.gutter, DEFAULT_CONTROL_GUTTER);
    const padding = finiteInteger(settings.padding, 0);
    if (!Number.isInteger(gutter) || gutter < 0) {
      fail("AIFX_SPRITESHEET_GUTTER_INVALID", "Sprite-sheet gutter must be a non-negative integer.", {
        gutter,
      });
    }
    if (!Number.isInteger(padding) || padding < 0) {
      fail("AIFX_SPRITESHEET_PADDING_INVALID", "Sprite-sheet padding must be a non-negative integer.", {
        padding,
      });
    }
    const contentWidth = columns * frameWidth + Math.max(0, columns - 1) * gutter;
    const contentHeight = rows * frameHeight + Math.max(0, rows - 1) * gutter;
    const unalignedWidth = padding * 2 + contentWidth;
    const unalignedHeight = padding * 2 + contentHeight;
    const alignTo = finiteInteger(settings.alignTo, 1);
    if (!Number.isInteger(alignTo) || alignTo < 1 || alignTo > 256) {
      fail("AIFX_SPRITESHEET_ALIGNMENT_INVALID", "Sprite-sheet alignment must be an integer between 1 and 256.", {
        alignTo,
      });
    }
    const width = Math.ceil(unalignedWidth / alignTo) * alignTo;
    const height = Math.ceil(unalignedHeight / alignTo) * alignTo;
    const maxDimension = finiteInteger(settings.maxDimension, DEFAULT_MAX_DIMENSION);
    if (!Number.isInteger(maxDimension) || maxDimension < 1) {
      fail("AIFX_SPRITESHEET_MAX_DIMENSION_INVALID", "maxDimension must be a positive integer.", {
        maxDimension,
      });
    }
    if (width > maxDimension || height > maxDimension) {
      fail(
        "AIFX_SPRITESHEET_TOO_LARGE",
        `Sprite sheet ${width}x${height} exceeds the ${maxDimension}px canvas limit.`,
        { width, height, maxDimension },
      );
    }

    const cellRect = (cellIndex) => {
      const column = cellIndex % columns;
      const row = Math.floor(cellIndex / columns);
      return {
        column,
        row,
        x: padding + column * (frameWidth + gutter),
        y: padding + row * (frameHeight + gutter),
        width: frameWidth,
        height: frameHeight,
      };
    };
    const frameRects = frames.map((frame, index) => {
      const cell = cellRect(index);
      return Object.freeze({
        index,
        name: frame.name,
        sequenceNumber: frame.sequenceNumber,
        column: cell.column,
        row: cell.row,
        rect: freezeRect(cell),
        sourceSize: Object.freeze({ width: frameWidth, height: frameHeight }),
      });
    });
    const unusedCells = [];
    for (let index = frameCount; index < columns * rows; index += 1) {
      const cell = cellRect(index);
      unusedCells.push(Object.freeze({
        cellIndex: index,
        column: cell.column,
        row: cell.row,
        rect: freezeRect(cell),
      }));
    }

    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      order: "row-major",
      frameCount,
      firstSequenceNumber: frames[0].sequenceNumber,
      fps: normalizeFps(settings.fps),
      lifecycle: normalizeLifecycle(settings.lifecycle, frameCount),
      frameSize: Object.freeze({ width: frameWidth, height: frameHeight }),
      columns,
      rows,
      gutter,
      padding,
      alignTo,
      trailingPadding: Object.freeze({
        right: width - unalignedWidth,
        bottom: height - unalignedHeight,
      }),
      sheetSize: Object.freeze({ width, height }),
      contentRect: freezeRect({
        x: padding,
        y: padding,
        width: contentWidth,
        height: contentHeight,
      }),
      frameRects: Object.freeze(frameRects),
      unusedCells: Object.freeze(unusedCells),
    });
  }

  function assertSpriteSheetPlan(plan) {
    if (!plan || typeof plan !== "object" || plan.order !== "row-major") {
      fail("AIFX_SPRITESHEET_PLAN_INVALID", "A row-major sprite-sheet plan is required.");
    }
    const width = finiteInteger(plan.sheetSize?.width, Number.NaN);
    const height = finiteInteger(plan.sheetSize?.height, Number.NaN);
    const frameCount = finiteInteger(plan.frameCount, Number.NaN);
    if (width <= 0 || height <= 0 || frameCount <= 0 || !Array.isArray(plan.frameRects)) {
      fail("AIFX_SPRITESHEET_PLAN_INVALID", "Sprite-sheet plan geometry is incomplete.", {
        width,
        height,
        frameCount,
      });
    }
    if (plan.frameRects.length !== frameCount) {
      fail("AIFX_SPRITESHEET_PLAN_INVALID", "Sprite-sheet frameRects count does not match frameCount.", {
        frameCount,
        frameRects: plan.frameRects.length,
      });
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
        || rect.x + rect.width > width
        || rect.y + rect.height > height
      ) {
        fail("AIFX_SPRITESHEET_PLAN_INVALID", `Sprite-sheet frame rect ${index} is invalid.`, {
          index,
          rect,
          sheetSize: plan.sheetSize,
        });
      }
    });
    return plan;
  }

  function readSheetSize(sheet) {
    return {
      width: readImageWidth(sheet),
      height: readImageHeight(sheet),
    };
  }

  function validateSpriteSheetGeometry(sheet, plan) {
    assertSpriteSheetPlan(plan);
    const actual = readSheetSize(sheet);
    const expected = { width: plan.sheetSize.width, height: plan.sheetSize.height };
    if (
      !Number.isInteger(actual.width)
      || !Number.isInteger(actual.height)
      || actual.width !== expected.width
      || actual.height !== expected.height
    ) {
      fail(
        "AIFX_SPRITESHEET_GEOMETRY_MISMATCH",
        `Generated sprite sheet must be exactly ${expected.width}x${expected.height}; received ${actual.width}x${actual.height}.`,
        { expected, actual },
      );
    }
    return Object.freeze({ expected: Object.freeze(expected), actual: Object.freeze(actual) });
  }

  function defaultCanvasFactory(width, height) {
    let canvas = null;
    if (root?.document && typeof root.document.createElement === "function") {
      canvas = root.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    if (typeof root?.OffscreenCanvas === "function") return new root.OffscreenCanvas(width, height);
    fail(
      "AIFX_CANVAS_UNAVAILABLE",
      "Canvas is unavailable. Inject canvasFactory(width, height) for this environment.",
      { width, height },
    );
  }

  function createCanvas(width, height, dependencies) {
    const factory = dependencies?.canvasFactory || defaultCanvasFactory;
    const canvas = factory(width, height);
    if (!canvas || typeof canvas.getContext !== "function") {
      fail("AIFX_CANVAS_UNAVAILABLE", "canvasFactory did not return a Canvas-compatible object.", {
        width,
        height,
      });
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return canvas;
  }

  function getContext2d(canvas) {
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context || typeof context.drawImage !== "function") {
      fail("AIFX_CANVAS_CONTEXT_UNAVAILABLE", "A 2D Canvas context is required.");
    }
    if ("imageSmoothingEnabled" in context) context.imageSmoothingEnabled = false;
    return context;
  }

  async function canvasToDataUrl(canvas) {
    if (typeof canvas.toDataURL === "function") return canvas.toDataURL("image/png");
    if (typeof canvas.convertToBlob === "function") {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      if (typeof root?.FileReader !== "function") {
        fail("AIFX_CANVAS_SERIALIZE_UNAVAILABLE", "FileReader is required to serialize OffscreenCanvas.");
      }
      return new Promise((resolve, reject) => {
        const reader = new root.FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Canvas serialization failed."));
        reader.readAsDataURL(blob);
      });
    }
    fail("AIFX_CANVAS_SERIALIZE_UNAVAILABLE", "Canvas cannot be serialized as PNG.");
  }

  function sourceForFrame(frame) {
    return frame?.image ?? frame?.canvas ?? frame?.bitmap ?? frame?.dataUrl ?? frame?.url ?? frame?.src ?? frame?.file;
  }

  async function defaultImageLoader(source) {
    if (source && typeof source === "object" && readImageWidth(source) > 0 && readImageHeight(source) > 0) {
      return source;
    }
    if (typeof root?.createImageBitmap === "function" && typeof root?.Blob === "function" && source instanceof root.Blob) {
      return root.createImageBitmap(source);
    }
    if (typeof root?.Image === "function" && (typeof source === "string" || source)) {
      let url = source;
      let revoke = false;
      if (typeof root?.Blob === "function" && source instanceof root.Blob && root?.URL?.createObjectURL) {
        url = root.URL.createObjectURL(source);
        revoke = true;
      }
      try {
        return await new Promise((resolve, reject) => {
          const image = new root.Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("Template frame image failed to load."));
          image.src = String(url || "");
        });
      } finally {
        if (revoke) root.URL.revokeObjectURL(url);
      }
    }
    fail(
      "AIFX_IMAGE_LOADER_REQUIRED",
      "Frame pixels are not already decoded. Inject imageLoader(source, frame).",
    );
  }

  async function loadFrame(frame, dependencies) {
    const source = sourceForFrame(frame);
    const loader = dependencies?.imageLoader || defaultImageLoader;
    const image = await loader(source, frame);
    const width = readImageWidth(image);
    const height = readImageHeight(image);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      fail("AIFX_TEMPLATE_FRAME_SIZE_INVALID", "Decoded template frame has invalid dimensions.", {
        name: frame?.name,
        width,
        height,
      });
    }
    return { ...frame, image, width, height };
  }

  async function prepare(inputFrames, options, dependencies) {
    const settings = options && typeof options === "object" ? options : {};
    const frames = asArray(inputFrames);
    if (!frames.length) fail("AIFX_TEMPLATE_EMPTY", "At least one template frame is required.");
    const decoded = await Promise.all(frames.map((frame) => loadFrame(frame, dependencies)));
    const normalized = normalizeTemplateFrames(decoded);
    const plan = settings.plan ? assertSpriteSheetPlan(settings.plan) : createSpriteSheetPlan(normalized, settings);
    if (settings.plan) assertFramesMatchPlan(normalized, plan);
    return Object.freeze({ frames: Object.freeze(normalized), plan });
  }

  function assertFramesMatchPlan(frames, plan) {
    if (frames.length !== plan.frameCount) {
      fail("AIFX_SPRITESHEET_PLAN_MISMATCH", "Frame count does not match the supplied sprite-sheet plan.", {
        frames: frames.length,
        plan: plan.frameCount,
      });
    }
    frames.forEach((frame, index) => {
      const planned = plan.frameRects[index];
      if (
        frame.name !== planned.name
        || frame.sequenceNumber !== planned.sequenceNumber
        || frame.width !== planned.sourceSize.width
        || frame.height !== planned.sourceSize.height
      ) {
        fail("AIFX_SPRITESHEET_PLAN_MISMATCH", `Frame ${index} does not match the supplied plan.`, {
          frame: {
            name: frame.name,
            sequenceNumber: frame.sequenceNumber,
            width: frame.width,
            height: frame.height,
          },
          planned,
        });
      }
    });
  }

  async function packFrames(inputFrames, options, dependencies) {
    const settings = options && typeof options === "object" ? options : {};
    const prepared = await prepare(inputFrames, settings, dependencies);
    const plan = prepared.plan;
    const canvas = createCanvas(plan.sheetSize.width, plan.sheetSize.height, dependencies);
    const context = getContext2d(canvas);
    context.clearRect?.(0, 0, canvas.width, canvas.height);
    const background = settings.background;
    if (background && background !== "transparent") {
      context.fillStyle = background === "black" ? "rgb(0,0,0)" : String(background);
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    prepared.frames.forEach((frame, index) => {
      const rect = plan.frameRects[index].rect;
      context.drawImage(
        frame.image,
        0,
        0,
        frame.width,
        frame.height,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
      );
    });
    return Object.freeze({
      canvas,
      dataUrl: await canvasToDataUrl(canvas),
      plan,
      frames: prepared.frames,
    });
  }

  async function cutSpriteSheet(sheetSource, plan, options, dependencies) {
    const settings = options && typeof options === "object" ? options : {};
    const imageLoader = dependencies?.imageLoader || defaultImageLoader;
    const sheet = typeof sheetSource === "object" && readImageWidth(sheetSource) > 0
      ? sheetSource
      : await imageLoader(sheetSource, { name: "generated-sprite-sheet.png" });
    validateSpriteSheetGeometry(sheet, plan);
    const outputFrames = [];
    for (const entry of plan.frameRects) {
      const rect = entry.rect;
      const canvas = createCanvas(rect.width, rect.height, dependencies);
      const context = getContext2d(canvas);
      context.clearRect?.(0, 0, rect.width, rect.height);
      context.drawImage(
        sheet,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height,
      );
      outputFrames.push(Object.freeze({
        index: entry.index,
        sequenceNumber: entry.sequenceNumber,
        name: settings.renameFrames === false
          ? entry.name
          : `frame_${String(entry.index).padStart(3, "0")}.png`,
        sourceName: entry.name,
        width: rect.width,
        height: rect.height,
        canvas,
        dataUrl: await canvasToDataUrl(canvas),
      }));
    }
    return Object.freeze(outputFrames);
  }

  return Object.freeze({
    version: SCHEMA_VERSION,
    AifxTemplateError,
    normalizeTemplateFrames,
    normalizeLifecycle,
    createSpriteSheetPlan,
    assertSpriteSheetPlan,
    validateSpriteSheetGeometry,
    prepare,
    packFrames,
    cutSpriteSheet,
    canvasToDataUrl,
  });
});
