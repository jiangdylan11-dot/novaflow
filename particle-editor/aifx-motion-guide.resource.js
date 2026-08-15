(function initNovaFlowAifxMotionGuideResource(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.NovaFlowAifxMotionGuideResource = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAifxMotionGuideResource(root) {
  "use strict";

  const SCHEMA_VERSION = "novaflow-aifx-motion-guide-v1";
  const GUIDE_TYPE = "neutral-soft-motion";
  const DEFAULT_MAX_INTENSITY = 232;

  class AifxMotionGuideError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "AifxMotionGuideError";
      this.code = code;
      this.details = details && typeof details === "object" ? details : {};
    }
  }

  function fail(code, message, details) {
    throw new AifxMotionGuideError(code, message, details);
  }

  function clamp(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : Number.NaN;
  }

  function finitePoint(value) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function frameSize(frame, index) {
    const width = positiveInteger(frame?.width ?? frame?.naturalWidth);
    const height = positiveInteger(frame?.height ?? frame?.naturalHeight);
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      fail("AIFX_MOTION_GUIDE_FRAME_SIZE_INVALID", `Template frame ${index} has invalid dimensions.`, {
        index,
        width: frame?.width,
        height: frame?.height,
      });
    }
    return { width, height };
  }

  function defaultCanvasFactory(width, height) {
    if (root?.document && typeof root.document.createElement === "function") {
      const canvas = root.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    if (typeof root?.OffscreenCanvas === "function") return new root.OffscreenCanvas(width, height);
    fail(
      "AIFX_MOTION_GUIDE_CANVAS_UNAVAILABLE",
      "Canvas is unavailable. Inject createCanvas(width, height) or canvasFactory(width, height).",
      { width, height },
    );
  }

  function createCanvas(width, height, dependencies) {
    const factory = dependencies?.createCanvas || dependencies?.canvasFactory || defaultCanvasFactory;
    const canvas = factory(width, height);
    if (!canvas || typeof canvas.getContext !== "function") {
      fail("AIFX_MOTION_GUIDE_CANVAS_UNAVAILABLE", "The injected canvas factory returned an invalid canvas.", {
        width,
        height,
      });
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return canvas;
  }

  function context2d(canvas) {
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (
      !context
      || typeof context.createImageData !== "function"
      || typeof context.putImageData !== "function"
    ) {
      fail("AIFX_MOTION_GUIDE_CONTEXT_UNAVAILABLE", "A pixel-addressable 2D canvas context is required.");
    }
    return context;
  }

  async function canvasToDataUrl(canvas) {
    if (typeof canvas.toDataURL === "function") return canvas.toDataURL("image/png");
    if (typeof canvas.convertToBlob === "function") {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      if (typeof root?.FileReader !== "function") {
        fail("AIFX_MOTION_GUIDE_SERIALIZE_UNAVAILABLE", "FileReader is required to serialize OffscreenCanvas.");
      }
      return new Promise((resolve, reject) => {
        const reader = new root.FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Motion-guide serialization failed."));
        reader.readAsDataURL(blob);
      });
    }
    fail("AIFX_MOTION_GUIDE_SERIALIZE_UNAVAILABLE", "Motion-guide canvas cannot be serialized as PNG.");
  }

  function trailingSequenceNumber(frame, index) {
    const explicit = Number(frame?.sequenceNumber ?? frame?.frameNumber ?? frame?.frameIndex);
    if (Number.isInteger(explicit) && explicit >= 0) return explicit;
    const match = String(frame?.name || frame?.fileName || "").match(/(\d+)(?=\.[^.]+$|$)/);
    return match ? Number(match[1]) : index;
  }

  function normalizeAxis(guide, centerlinePoints) {
    const firstPoint = centerlinePoints[0] || null;
    const lastPoint = centerlinePoints[centerlinePoints.length - 1] || null;
    let x = Number(guide?.axis?.x);
    let y = Number(guide?.axis?.y);
    if ((!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 0.0001) && firstPoint && lastPoint) {
      x = lastPoint.x - firstPoint.x;
      y = lastPoint.y - firstPoint.y;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 0.0001) {
      const angle = Number(guide?.angle);
      x = Math.cos(Number.isFinite(angle) ? angle : 0);
      y = Math.sin(Number.isFinite(angle) ? angle : 0);
    }
    const magnitude = Math.max(0.0001, Math.hypot(x, y));
    x /= magnitude;
    y /= magnitude;
    if (firstPoint && lastPoint && (lastPoint.x - firstPoint.x) * x + (lastPoint.y - firstPoint.y) * y < 0) {
      x *= -1;
      y *= -1;
    }
    return { x, y };
  }

  function normalizeCenterlinePoints(guide, canvasWidth, canvasHeight) {
    const input = Array.isArray(guide?.points) ? guide.points : [];
    const deduplicated = [];
    for (const value of input) {
      const point = finitePoint(value);
      if (!point) continue;
      const normalized = {
        x: clamp(point.x, 0, canvasWidth - 1),
        y: clamp(point.y, 0, canvasHeight - 1),
      };
      const previous = deduplicated[deduplicated.length - 1];
      if (!previous || Math.hypot(normalized.x - previous.x, normalized.y - previous.y) >= 0.5) {
        deduplicated.push(normalized);
      }
    }
    if (deduplicated.length <= 24) return deduplicated;
    return Array.from({ length: 24 }, (_value, index) => {
      const sourceIndex = Math.round((index / 23) * (deduplicated.length - 1));
      return deduplicated[sourceIndex];
    });
  }

  function centerlineLength(points) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }
    return total;
  }

  function normalizeGuide(frame, guide, index, maxRawEnergy) {
    const { width: canvasWidth, height: canvasHeight } = frameSize(frame, index);
    const centerInput = finitePoint(guide?.center);
    const center = {
      x: clamp(centerInput?.x ?? canvasWidth * 0.5, 0, canvasWidth - 1),
      y: clamp(centerInput?.y ?? canvasHeight * 0.5, 0, canvasHeight - 1),
    };
    const abstractPoints = normalizeCenterlinePoints(guide, canvasWidth, canvasHeight);
    const axis = normalizeAxis(guide, abstractPoints);
    const abstractLength = centerlineLength(abstractPoints);
    const diagonal = Math.hypot(canvasWidth, canvasHeight);
    const length = clamp(
      Number.isFinite(Number(guide?.length)) ? Number(guide.length) : abstractLength || Math.min(canvasWidth, canvasHeight) * 0.6,
      1,
      diagonal * 1.25,
    );
    const roughWidth = clamp(
      Number.isFinite(Number(guide?.width)) ? Number(guide.width) : Math.min(canvasWidth, canvasHeight) * 0.12,
      1,
      Math.min(canvasWidth, canvasHeight) * 0.5,
    );
    const normalizedEnergy = Number(guide?.energyNorm);
    const rawEnergy = Math.max(0, Number(guide?.energy) || 0);
    const energy = Number.isFinite(normalizedEnergy)
      ? clamp(normalizedEnergy, 0, 1)
      : clamp(rawEnergy / Math.max(1, maxRawEnergy), 0, 1);
    const centerline = abstractPoints.length >= 2
      ? abstractPoints
      : [
        { x: center.x - axis.x * length * 0.5, y: center.y - axis.y * length * 0.5 },
        { x: center.x + axis.x * length * 0.5, y: center.y + axis.y * length * 0.5 },
      ].map((point) => ({
        x: clamp(point.x, 0, canvasWidth - 1),
        y: clamp(point.y, 0, canvasHeight - 1),
      }));
    const emissionInput = finitePoint(guide?.emission)
      || finitePoint(guide?.origin)
      || finitePoint(guide?.start)
      || centerline[0];
    const emission = {
      x: clamp(emissionInput?.x ?? center.x - axis.x * length * 0.5, 0, canvasWidth - 1),
      y: clamp(emissionInput?.y ?? center.y - axis.y * length * 0.5, 0, canvasHeight - 1),
    };
    return Object.freeze({
      index,
      center: Object.freeze(center),
      emission: Object.freeze(emission),
      axis: Object.freeze(axis),
      centerline: Object.freeze(centerline.map((point) => Object.freeze(point))),
      centerlineSource: abstractPoints.length >= 2 ? "template-guide-polyline" : "principal-axis-fallback",
      length,
      width: roughWidth,
      energy,
      canvasWidth,
      canvasHeight,
    });
  }

  function distanceSquaredToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const t = denominator > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / denominator, 0, 1) : 0;
    const distanceX = px - (ax + dx * t);
    const distanceY = py - (ay + dy * t);
    return distanceX * distanceX + distanceY * distanceY;
  }

  function distanceToCenterline(px, py, points) {
    let nearestSquared = Number.POSITIVE_INFINITY;
    for (let index = 1; index < points.length; index += 1) {
      nearestSquared = Math.min(
        nearestSquared,
        distanceSquaredToSegment(
          px,
          py,
          points[index - 1].x,
          points[index - 1].y,
          points[index].x,
          points[index].y,
        ),
      );
    }
    return Math.sqrt(nearestSquared);
  }

  function gaussian(distance, radius) {
    const scaled = distance / Math.max(0.5, radius);
    return Math.exp(-0.5 * scaled * scaled);
  }

  function renderGuide(canvas, guide, options) {
    const context = context2d(canvas);
    const image = context.createImageData(canvas.width, canvas.height);
    const maxIntensity = Math.round(clamp(options?.maxIntensity ?? DEFAULT_MAX_INTENSITY, 1, 255));
    const lineRadius = Math.max(0.75, guide.width * 0.52);
    const centerRadius = Math.max(1, guide.width * 0.95);
    const emissionRadius = Math.max(1, guide.width * 0.7);

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const line = gaussian(distanceToCenterline(x, y, guide.centerline), lineRadius);
        const center = gaussian(Math.hypot(x - guide.center.x, y - guide.center.y), centerRadius);
        const emission = gaussian(Math.hypot(x - guide.emission.x, y - guide.emission.y), emissionRadius);
        const field = guide.energy * clamp(line * 0.62 + center * 0.28 + emission * 0.1, 0, 1);
        const value = field < 0.002 ? 0 : Math.round(field * maxIntensity);
        const offset = (y * canvas.width + x) * 4;
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }

  async function createGuideFrames(inputFrames, inputGuides, options, dependencies) {
    const frames = Array.isArray(inputFrames) ? inputFrames : [];
    const guides = Array.isArray(inputGuides) ? inputGuides : [];
    if (!frames.length) fail("AIFX_MOTION_GUIDE_FRAMES_REQUIRED", "At least one template frame is required.");
    if (guides.length !== frames.length) {
      fail("AIFX_MOTION_GUIDE_COUNT_MISMATCH", "Template frames and motion guides must have the same count.", {
        frameCount: frames.length,
        guideCount: guides.length,
      });
    }
    const maxRawEnergy = Math.max(1, ...guides.map((guide) => Math.max(0, Number(guide?.energy) || 0)));
    const outputFrames = [];
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      const guide = normalizeGuide(frame, guides[index], index, maxRawEnergy);
      const canvas = createCanvas(guide.canvasWidth, guide.canvasHeight, dependencies);
      renderGuide(canvas, guide, options);
      outputFrames.push(Object.freeze({
        index,
        sequenceNumber: trailingSequenceNumber(frame, index),
        name: String(frame?.name || frame?.fileName || `frame_${String(index).padStart(3, "0")}.png`),
        sourceName: String(frame?.sourceName || frame?.name || frame?.fileName || ""),
        width: guide.canvasWidth,
        height: guide.canvasHeight,
        canvas,
        image: canvas,
        dataUrl: await canvasToDataUrl(canvas),
        mimeType: "image/png",
        guideType: GUIDE_TYPE,
        guide,
      }));
    }
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      guideType: GUIDE_TYPE,
      frameCount: outputFrames.length,
      colorSpace: "neutral-grayscale",
      background: "black",
      alphaMode: "opaque-control-image",
      frames: Object.freeze(outputFrames),
    });
  }

  return Object.freeze({
    version: SCHEMA_VERSION,
    guideType: GUIDE_TYPE,
    AifxMotionGuideError,
    createGuideFrames,
  });
});
