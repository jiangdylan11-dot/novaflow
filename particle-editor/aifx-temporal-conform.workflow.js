(function initNovaFlowAifxTemporalConformWorkflow(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.NovaFlowAifxTemporalConformWorkflow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAifxTemporalConformWorkflow(root) {
  "use strict";

  const SCHEMA_VERSION = "novaflow-aifx-temporal-conform-v1";
  const MODE = "ai-alpha-translate-uniform-scale-lifecycle-envelope";
  const AI_SHAPE_SOURCE = "ai-generated-frame-matte";
  const MOTION_CONSTRAINT = "template-plan-only";
  const SEQUENCE_PHASES = Object.freeze([
    "onset",
    "growth",
    "peak",
    "follow-through",
    "decay",
    "breakup",
    "dissipation",
  ]);
  const EXPLICIT_ANCHOR_ROLES = Object.freeze(new Set([
    "onset",
    "peak",
    "decay",
    "breakup",
    "dissipation",
  ]));
  const CORRECTABLE_FAILURE_CODES = Object.freeze(new Set([
    "AIFX_SEQUENCE_LIFECYCLE_INCOHERENT",
    "AIFX_SEQUENCE_TEMPLATE_DIVERGED",
    "AIFX_SEQUENCE_POSITION_DRIFT",
    "AIFX_SEQUENCE_TEMPORAL_JITTER",
  ]));
  const FORBIDDEN_FAILURE_CODES = Object.freeze(new Set([
    "AIFX_SEQUENCE_INVALID_INPUT",
    "AIFX_SEQUENCE_TEMPLATE_STENCIL",
  ]));
  const FORBIDDEN_TEMPLATE_INPUT_KEYS = Object.freeze([
    "template",
    "templateFrame",
    "templateFrames",
    "templateCanvas",
    "templateMask",
    "templateMasks",
    "templateAlpha",
  ]);
  const DEFAULT_OPTIONS = Object.freeze({
    alphaThreshold: 0.05,
    minimumScale: 0.08,
    maximumScale: 2.4,
    maximumIterations: 8,
    occupancyRelativeTolerance: 0.08,
    explicitOccupancyRelativeTolerance: 0.02,
    explicitPeakDominanceRatio: 0.96,
    centerTolerancePx: 0.8,
    anchorCompatibilityMinimum: 0.24,
    anchorDuplicateMaximum: 0.92,
    anchorAppearanceDuplicateMinimum: 0.94,
    preserveThresholdSupport: false,
    directionAlignmentEnabled: false,
    directionAnisotropyMinimum: 0.08,
    maximumDirectionRotationDeg: 90,
  });

  class AifxTemporalConformError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "AifxTemporalConformError";
      this.code = code;
      this.details = details && typeof details === "object" ? details : {};
      this.retryable = false;
    }
  }

  function fail(code, message, details) {
    throw new AifxTemporalConformError(code, message, details);
  }

  function clamp(value, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum;
  }

  function plannedPeakIndexFor(sequencePlan) {
    const phasePeakIndex = sequencePlan.findIndex((entry) => (
      String(entry.phase || "").trim().toLowerCase() === "peak"
    ));
    if (phasePeakIndex >= 0) return phasePeakIndex;
    return sequencePlan.reduce((bestIndex, entry, index) => {
      const best = sequencePlan[bestIndex];
      if (entry.energy !== best.energy) return entry.energy > best.energy ? index : bestIndex;
      return entry.occupancy > best.occupancy ? index : bestIndex;
    }, 0);
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : Number.NaN;
  }

  function roundTrace(value) {
    return Number(Number(value).toFixed(6));
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function assertNoTemplatePixelInput(input) {
    for (const key of FORBIDDEN_TEMPLATE_INPUT_KEYS) {
      if (hasOwn(input, key)) {
        fail(
          "AIFX_TEMPORAL_CONFORM_TEMPLATE_INPUT_FORBIDDEN",
          `Temporal conform accepts sequencePlan semantics only; ${key} is forbidden.`,
          { key },
        );
      }
    }
  }

  function normalizeOptions(value) {
    const source = value && typeof value === "object" ? value : {};
    const minimumScale = clamp(source.minimumScale ?? DEFAULT_OPTIONS.minimumScale, 0.01, 1);
    const maximumScale = clamp(source.maximumScale ?? DEFAULT_OPTIONS.maximumScale, minimumScale, 8);
    const anchorCompatibilityMinimum = clamp(
      source.anchorCompatibilityMinimum ?? DEFAULT_OPTIONS.anchorCompatibilityMinimum,
      0,
      0.95,
    );
    return Object.freeze({
      alphaThreshold: clamp(source.alphaThreshold ?? DEFAULT_OPTIONS.alphaThreshold, 0.001, 0.999),
      minimumScale,
      maximumScale,
      maximumIterations: Math.round(clamp(
        source.maximumIterations ?? DEFAULT_OPTIONS.maximumIterations,
        1,
        20,
      )),
      occupancyRelativeTolerance: clamp(
        source.occupancyRelativeTolerance ?? DEFAULT_OPTIONS.occupancyRelativeTolerance,
        0.01,
        0.5,
      ),
      explicitOccupancyRelativeTolerance: clamp(
        source.explicitOccupancyRelativeTolerance ?? DEFAULT_OPTIONS.explicitOccupancyRelativeTolerance,
        0.005,
        0.08,
      ),
      explicitPeakDominanceRatio: clamp(
        source.explicitPeakDominanceRatio ?? DEFAULT_OPTIONS.explicitPeakDominanceRatio,
        0.8,
        0.995,
      ),
      centerTolerancePx: clamp(source.centerTolerancePx ?? DEFAULT_OPTIONS.centerTolerancePx, 0.1, 8),
      anchorCompatibilityMinimum,
      anchorDuplicateMaximum: clamp(
        source.anchorDuplicateMaximum ?? DEFAULT_OPTIONS.anchorDuplicateMaximum,
        Math.min(0.99, anchorCompatibilityMinimum + 0.01),
        0.999,
      ),
      anchorAppearanceDuplicateMinimum: clamp(
        source.anchorAppearanceDuplicateMinimum ?? DEFAULT_OPTIONS.anchorAppearanceDuplicateMinimum,
        0.5,
        0.999,
      ),
      preserveThresholdSupport: source.preserveThresholdSupport === true,
      directionAlignmentEnabled: source.directionAlignmentEnabled === true,
      directionAnisotropyMinimum: clamp(
        source.directionAnisotropyMinimum ?? DEFAULT_OPTIONS.directionAnisotropyMinimum,
        0,
        0.95,
      ),
      maximumDirectionRotationDeg: clamp(
        source.maximumDirectionRotationDeg ?? DEFAULT_OPTIONS.maximumDirectionRotationDeg,
        1,
        90,
      ),
    });
  }

  function normalizeSequencePlan(value, frameCount) {
    if (!Array.isArray(value) || value.length !== frameCount) {
      fail(
        "AIFX_TEMPORAL_CONFORM_SEQUENCE_PLAN_INVALID",
        "sequencePlan must contain exactly one normalized entry per AI frame.",
        { frameCount, sequencePlanLength: Array.isArray(value) ? value.length : null },
      );
    }
    return Object.freeze(value.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        fail("AIFX_TEMPORAL_CONFORM_SEQUENCE_PLAN_INVALID", `sequencePlan[${index}] must be an object.`);
      }
      const normalizedIndex = entry.index === undefined ? index : Number(entry.index);
      if (!Number.isInteger(normalizedIndex) || normalizedIndex !== index) {
        fail(
          "AIFX_TEMPORAL_CONFORM_SEQUENCE_PLAN_INVALID",
          `sequencePlan[${index}] must retain chronological index ${index}.`,
          { index: normalizedIndex },
        );
      }
      const requiredNumbers = ["energy", "centerX", "centerY", "occupancy"];
      for (const field of requiredNumbers) {
        if (!Number.isFinite(Number(entry[field]))) {
          fail(
            "AIFX_TEMPORAL_CONFORM_SEQUENCE_PLAN_INVALID",
            `sequencePlan[${index}].${field} must be finite.`,
          );
        }
      }
      return Object.freeze({
        index,
        phase: String(entry.phase || ""),
        energy: clamp(entry.energy, 0, 1),
        centerX: clamp(entry.centerX, 0, 1),
        centerY: clamp(entry.centerY, 0, 1),
        occupancy: clamp(entry.occupancy, 0, 1),
        directionDeg: Number.isFinite(Number(entry.directionDeg)) ? Number(entry.directionDeg) : 0,
      });
    }));
  }

  function readFrameImageData(frame, index) {
    const candidate = frame?.imageData || frame?.canvas || frame?.image || frame;
    const width = positiveInteger(frame?.width ?? candidate?.width);
    const height = positiveInteger(frame?.height ?? candidate?.height);
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      fail("AIFX_TEMPORAL_CONFORM_FRAME_INVALID", `AI frame ${index} has invalid dimensions.`, {
        width: frame?.width ?? candidate?.width,
        height: frame?.height ?? candidate?.height,
      });
    }
    if (frame?.pixelFormat && frame.pixelFormat !== "rgba8") {
      fail("AIFX_TEMPORAL_CONFORM_FRAME_INVALID", `AI frame ${index} must use rgba8 pixels.`);
    }
    if (frame?.alphaMode && frame.alphaMode !== "straight") {
      fail("AIFX_TEMPORAL_CONFORM_FRAME_INVALID", `AI frame ${index} must use straight alpha.`);
    }
    let imageData = null;
    if (candidate?.data && candidate.data.length >= width * height * 4) {
      imageData = { width, height, data: candidate.data };
    } else if (candidate && typeof candidate.getContext === "function") {
      const context = candidate.getContext("2d", { willReadFrequently: true });
      if (context && typeof context.getImageData === "function") {
        imageData = context.getImageData(0, 0, width, height);
      }
    }
    if (!imageData?.data || imageData.data.length < width * height * 4) {
      fail(
        "AIFX_TEMPORAL_CONFORM_FRAME_INVALID",
        `AI frame ${index} does not expose readable RGBA pixels.`,
      );
    }
    const sourceIndex = Number.isInteger(Number(frame?.index)) ? Number(frame.index) : index;
    const globalIndex = Number.isInteger(Number(frame?.globalIndex)) ? Number(frame.globalIndex) : sourceIndex;
    const timelineIndex = Number.isInteger(Number(frame?.timelineIndex)) ? Number(frame.timelineIndex) : null;
    return {
      frame,
      index,
      candidateIndex: index,
      sourceIndex,
      globalIndex,
      timelineIndex,
      anchorRole: String(frame?.anchorRole || "").trim().toLowerCase(),
      width,
      height,
      data: imageData.data,
    };
  }

  function analyzeImageData(image, alphaThreshold) {
    const pixelCount = image.width * image.height;
    let visiblePixels = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;
    let alphaMass = 0;
    let alphaX = 0;
    let alphaY = 0;
    let maximumAlpha = 0;
    let minX = image.width;
    let minY = image.height;
    let maxX = -1;
    let maxY = -1;
    let edgeContactPixels = 0;
    const edgeSidePixels = { top: 0, right: 0, bottom: 0, left: 0 };
    for (let index = 0; index < pixelCount; index += 1) {
      const alpha = image.data[index * 4 + 3] / 255;
      if (alpha <= 0) continue;
      const x = index % image.width;
      const y = Math.floor(index / image.width);
      alphaMass += alpha;
      alphaX += x * alpha;
      alphaY += y * alpha;
      maximumAlpha = Math.max(maximumAlpha, alpha);
      if (alpha < alphaThreshold) continue;
      visiblePixels += 1;
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumYY += y * y;
      sumXY += x * y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const touchesTop = y === 0;
      const touchesRight = x === image.width - 1;
      const touchesBottom = y === image.height - 1;
      const touchesLeft = x === 0;
      if (touchesTop || touchesRight || touchesBottom || touchesLeft) edgeContactPixels += 1;
      if (touchesTop) edgeSidePixels.top += 1;
      if (touchesRight) edgeSidePixels.right += 1;
      if (touchesBottom) edgeSidePixels.bottom += 1;
      if (touchesLeft) edgeSidePixels.left += 1;
    }
    const centroid = visiblePixels
      ? { x: sumX / visiblePixels, y: sumY / visiblePixels }
      : alphaMass > 0
        ? { x: alphaX / alphaMass, y: alphaY / alphaMass }
        : null;
    const covarianceXX = visiblePixels ? Math.max(0, sumXX / visiblePixels - centroid.x * centroid.x) : 0;
    const covarianceYY = visiblePixels ? Math.max(0, sumYY / visiblePixels - centroid.y * centroid.y) : 0;
    const covarianceXY = visiblePixels ? sumXY / visiblePixels - centroid.x * centroid.y : 0;
    const covarianceTrace = covarianceXX + covarianceYY;
    const covarianceSpread = Math.sqrt(Math.max(0, (covarianceXX - covarianceYY) ** 2 + 4 * covarianceXY ** 2));
    const majorVariance = Math.max(0, (covarianceTrace + covarianceSpread) * 0.5);
    const minorVariance = Math.max(0, (covarianceTrace - covarianceSpread) * 0.5);
    const principalAngle = visiblePixels
      ? 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY)
      : null;
    const edgeSideCoverage = {
      top: edgeSidePixels.top / Math.max(1, image.width),
      right: edgeSidePixels.right / Math.max(1, image.height),
      bottom: edgeSidePixels.bottom / Math.max(1, image.width),
      left: edgeSidePixels.left / Math.max(1, image.height),
    };
    const maximumEdgeSideCoverage = Math.max(...Object.values(edgeSideCoverage));
    const edgeContactRatio = edgeContactPixels / Math.max(1, visiblePixels);
    return {
      width: image.width,
      height: image.height,
      visiblePixels,
      areaRatio: visiblePixels / Math.max(1, pixelCount),
      alphaMass,
      alphaMassRatio: alphaMass / Math.max(1, pixelCount),
      maximumAlpha,
      edgeContactPixels,
      edgeContactRatio,
      edgeSideCoverage,
      maximumEdgeSideCoverage,
      boundaryClipped: maximumEdgeSideCoverage >= 0.08 || edgeContactRatio >= 0.08,
      centroid,
      principalAngle,
      anisotropy: majorVariance > 1e-9 ? clamp((majorVariance - minorVariance) / majorVariance, 0, 1) : 0,
      bbox: visiblePixels
        ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
        : null,
    };
  }

  function buildMaskRecord(image, alphaThreshold) {
    const geometry = analyzeImageData(image, alphaThreshold);
    const mask = new Uint8Array(image.width * image.height);
    for (let index = 0; index < mask.length; index += 1) {
      if (image.data[index * 4 + 3] / 255 >= alphaThreshold) mask[index] = 1;
    }
    return { ...geometry, mask };
  }

  function centroidCompensatedIou(reference, candidate) {
    if (!reference?.centroid || !candidate?.centroid) return 0;
    const shiftX = Math.round(reference.centroid.x - candidate.centroid.x);
    const shiftY = Math.round(reference.centroid.y - candidate.centroid.y);
    let intersection = 0;
    let union = 0;
    for (let y = 0; y < reference.height; y += 1) {
      const candidateY = y - shiftY;
      for (let x = 0; x < reference.width; x += 1) {
        const left = reference.mask[y * reference.width + x];
        const candidateX = x - shiftX;
        const right = candidateX >= 0
          && candidateX < candidate.width
          && candidateY >= 0
          && candidateY < candidate.height
          ? candidate.mask[candidateY * candidate.width + candidateX]
          : 0;
        if (left && right) intersection += 1;
        if (left || right) union += 1;
      }
    }
    return union ? intersection / union : 0;
  }

  function centroidCompensatedAppearanceSimilarity(referenceImage, referenceMask, candidateImage, candidateMask) {
    if (!referenceMask?.centroid || !candidateMask?.centroid) return 0;
    const shiftX = Math.round(referenceMask.centroid.x - candidateMask.centroid.x);
    const shiftY = Math.round(referenceMask.centroid.y - candidateMask.centroid.y);
    let difference = 0;
    let compared = 0;
    for (let y = 0; y < referenceImage.height; y += 1) {
      const candidateY = y - shiftY;
      for (let x = 0; x < referenceImage.width; x += 1) {
        const referenceMaskValue = referenceMask.mask[y * referenceImage.width + x];
        const candidateX = x - shiftX;
        const candidateInside = candidateX >= 0 && candidateX < candidateImage.width
          && candidateY >= 0 && candidateY < candidateImage.height;
        const candidateMaskValue = candidateInside
          ? candidateMask.mask[candidateY * candidateImage.width + candidateX]
          : 0;
        if (!referenceMaskValue && !candidateMaskValue) continue;
        const referenceOffset = (y * referenceImage.width + x) * 4;
        const candidateOffset = candidateInside
          ? (candidateY * candidateImage.width + candidateX) * 4
          : -1;
        const referenceAlpha = referenceImage.data[referenceOffset + 3] / 255;
        const candidateAlpha = candidateOffset >= 0 ? candidateImage.data[candidateOffset + 3] / 255 : 0;
        difference += Math.abs(referenceAlpha - candidateAlpha);
        for (let channel = 0; channel < 3; channel += 1) {
          const referenceValue = (referenceImage.data[referenceOffset + channel] / 255) * referenceAlpha;
          const candidateValue = candidateOffset >= 0
            ? (candidateImage.data[candidateOffset + channel] / 255) * candidateAlpha
            : 0;
          difference += Math.abs(referenceValue - candidateValue);
        }
        compared += 4;
      }
    }
    return compared ? clamp(1 - difference / compared, 0, 1) : 0;
  }

  function phaseRank(value) {
    const normalized = String(value || "").trim().toLowerCase();
    const rank = SEQUENCE_PHASES.indexOf(normalized);
    return rank >= 0 ? rank : 0;
  }

  function outputTimelineCoordinate(index, frameCount) {
    return frameCount <= 1 ? 0 : clamp(index / (frameCount - 1), 0, 1);
  }

  function selectAnchorLibrary(frames, sequencePlan, settings) {
    const records = frames.map((source, index) => ({
      source,
      index,
      mask: buildMaskRecord(source, settings.alphaThreshold),
    }));
    const visible = records.filter((entry) => entry.mask.visiblePixels > 0);
    if (!visible.length) {
      fail("AIFX_TEMPORAL_CONFORM_AI_ALPHA_EMPTY", "No AI anchor contains a visible alpha silhouette.");
    }
    const plannedPeakIndex = plannedPeakIndexFor(sequencePlan);
    const peakTargetOccupancy = sequencePlan[plannedPeakIndex].occupancy;
    const scaleNeededFor = (entry, targetOccupancy) => targetOccupancy <= 0
      ? settings.minimumScale
      : Math.sqrt(targetOccupancy / Math.max(1 / (entry.source.width * entry.source.height), entry.mask.areaRatio));
    const viablePeakCandidates = visible
      .map((entry) => ({ entry, requiredScale: scaleNeededFor(entry, peakTargetOccupancy) }))
      .filter(({ entry, requiredScale }) => !entry.mask.boundaryClipped && requiredScale <= settings.maximumScale)
      .sort((left, right) => (
        right.entry.mask.areaRatio - left.entry.mask.areaRatio
        || right.entry.mask.alphaMassRatio - left.entry.mask.alphaMassRatio
        || Math.max(0, left.requiredScale - 1) - Math.max(0, right.requiredScale - 1)
        || left.entry.index - right.entry.index
      ));
    if (!viablePeakCandidates.length) {
      const clippedViable = visible.some((entry) => (
        entry.mask.boundaryClipped && scaleNeededFor(entry, peakTargetOccupancy) <= settings.maximumScale
      ));
      fail(
        clippedViable
          ? "AIFX_TEMPORAL_CONFORM_ANCHOR_BOUNDARY_CLIPPED"
          : "AIFX_TEMPORAL_CONFORM_ANCHOR_INSUFFICIENT",
        clippedViable
          ? "The only AI anchors large enough for the planned peak already touch a cell boundary and appear clipped."
          : "No safe AI anchor can reach the planned peak occupancy within the uniform-scale limit.",
        { plannedPeakIndex, peakTargetOccupancy },
      );
    }
    const peak = viablePeakCandidates[0].entry;
    const peakRequiredScale = viablePeakCandidates[0].requiredScale;
    const decayPhaseRank = phaseRank("decay");
    const firstDecayIndex = sequencePlan.findIndex((entry, index) => (
      index > plannedPeakIndex && phaseRank(entry.phase) >= decayPhaseRank
    ));
    const decayOutputIndex = plannedPeakIndex < sequencePlan.length - 1
      ? firstDecayIndex >= 0 ? firstDecayIndex : sequencePlan.length - 1
      : null;
    const compatibleCandidate = (candidates, role, outputIndex, tieDirection) => {
      if (outputIndex === null) return null;
      const targetOccupancy = sequencePlan[outputIndex].occupancy;
      const ranked = candidates
        .filter((entry) => (
          entry.index !== peak.index
          && entry.mask.visiblePixels > 0
          && !entry.mask.boundaryClipped
        ))
        .map((entry) => ({
          entry,
          compatibility: centroidCompensatedIou(peak.mask, entry.mask),
          requiredScale: scaleNeededFor(entry, targetOccupancy),
        }))
        .filter((entry) => entry.requiredScale <= settings.maximumScale)
        .sort((left, right) => (
          right.compatibility - left.compatibility
          || Math.max(0, left.requiredScale - 1) - Math.max(0, right.requiredScale - 1)
          || tieDirection * (left.entry.index - right.entry.index)
        ));
      const best = ranked[0];
      if (!best || best.compatibility < settings.anchorCompatibilityMinimum) return null;
      return {
        ...best.entry,
        role,
        outputIndex,
        plan: sequencePlan[outputIndex],
        phaseCoordinate: outputTimelineCoordinate(outputIndex, frames.length),
        compatibilityToPeak: best.compatibility,
        requiredScale: best.requiredScale,
      };
    };
    const onsetPreferred = records.filter((entry) => entry.index < peak.index);
    const onsetPool = onsetPreferred.length ? onsetPreferred : records;
    const decayPreferred = records.filter((entry) => entry.index > peak.index);
    const decayPool = decayPreferred.length ? decayPreferred : records;
    const onset = compatibleCandidate(onsetPool, "onset", plannedPeakIndex > 0 ? 0 : null, 1);
    const decay = compatibleCandidate(decayPool, "decay", decayOutputIndex, -1);
    const anchors = [
      onset,
      {
        ...peak,
        role: "peak",
        outputIndex: plannedPeakIndex,
        plan: sequencePlan[plannedPeakIndex],
        phaseCoordinate: outputTimelineCoordinate(plannedPeakIndex, frames.length),
        compatibilityToPeak: 1,
        requiredScale: peakRequiredScale,
      },
      decay,
    ].filter(Boolean).sort((left, right) => left.phaseCoordinate - right.phaseCoordinate);
    return Object.freeze({
      inputMode: "sprite-sheet-fallback",
      plannedPeakIndex,
      generatedPeakIndex: peak.source.globalIndex,
      generatedPeakCandidateIndex: peak.source.candidateIndex,
      generatedPeakSourceIndex: peak.source.sourceIndex,
      generatedPeakGlobalIndex: peak.source.globalIndex,
      peakSource: peak.source,
      canonicalCenter: Object.freeze({ ...peak.mask.centroid }),
      anchors: Object.freeze(anchors.map((entry) => Object.freeze({
        ...entry,
        trace: Object.freeze({
          role: entry.role,
          candidateIndex: entry.source.candidateIndex,
          sourceIndex: entry.source.sourceIndex,
          globalIndex: entry.source.globalIndex,
          outputIndex: entry.outputIndex,
          phase: String(entry.plan.phase || ""),
          compatibilityToPeak: roundTrace(entry.compatibilityToPeak),
          areaRatio: roundTrace(entry.mask.areaRatio),
          alphaMassRatio: roundTrace(entry.mask.alphaMassRatio),
          requiredScale: roundTrace(entry.requiredScale),
          boundaryClipped: entry.mask.boundaryClipped,
          maximumEdgeSideCoverage: roundTrace(entry.mask.maximumEdgeSideCoverage),
        }),
      }))),
    });
  }

  function selectExplicitAnchorLibrary(frames, sequencePlan, settings) {
    if (frames.length < 2 || frames.length > 4) {
      fail(
        "AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_COUNT_INVALID",
        "Explicit anchor generation requires two to four AI candidates.",
        { candidateCount: frames.length },
      );
    }
    const roleMap = new Map();
    for (const source of frames) {
      if (!EXPLICIT_ANCHOR_ROLES.has(source.anchorRole)) {
        fail(
          "AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_ROLE_INVALID",
          `AI candidate ${source.candidateIndex} must declare a supported lifecycle anchorRole.`,
          { candidateIndex: source.candidateIndex, anchorRole: source.anchorRole },
        );
      }
      if (roleMap.has(source.anchorRole)) {
        fail(
          "AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_ROLE_DUPLICATE",
          `Explicit anchorRole ${source.anchorRole} may appear only once.`,
          { anchorRole: source.anchorRole },
        );
      }
      roleMap.set(source.anchorRole, source);
    }
    if (!roleMap.has("peak")) {
      fail(
        "AIFX_TEMPORAL_CONFORM_EXPLICIT_PEAK_REQUIRED",
        "Explicit anchor generation requires one AI candidate with anchorRole peak.",
      );
    }
    const postPeakRoles = ["decay", "breakup", "dissipation"];
    if (!postPeakRoles.some((role) => roleMap.has(role))) {
      fail(
        "AIFX_TEMPORAL_CONFORM_EXPLICIT_POST_PEAK_REQUIRED",
        "Explicit anchor generation requires at least one decay, breakup, or dissipation AI candidate after peak.",
      );
    }
    const plannedPeakIndex = plannedPeakIndexFor(sequencePlan);
    if (plannedPeakIndex >= sequencePlan.length - 1) {
      fail(
        "AIFX_TEMPORAL_CONFORM_EXPLICIT_POST_PEAK_OUTPUT_UNAVAILABLE",
        "The sequencePlan has no output position after its planned peak for a post-peak anchor.",
      );
    }
    const peakSource = roleMap.get("peak");
    const peakMask = buildMaskRecord(peakSource, settings.alphaThreshold);
    if (!peakMask.visiblePixels) {
      fail("AIFX_TEMPORAL_CONFORM_AI_ALPHA_EMPTY", "The explicit peak AI anchor has no visible alpha silhouette.");
    }
    if (peakMask.boundaryClipped) {
      fail(
        "AIFX_TEMPORAL_CONFORM_ANCHOR_BOUNDARY_CLIPPED",
        "The explicit peak AI anchor touches a cell boundary and appears clipped.",
        { candidateIndex: peakSource.candidateIndex, globalIndex: peakSource.globalIndex },
      );
    }
    const firstPhaseIndex = (role) => sequencePlan.findIndex((entry, index) => (
      index > plannedPeakIndex && String(entry.phase || "").trim().toLowerCase() === role
    ));
    const firstPostPeakIndex = sequencePlan.findIndex((entry, index) => index > plannedPeakIndex);
    const fallbackOutputIndex = (role) => {
      if (role === "onset") return plannedPeakIndex > 0 ? 0 : null;
      if (role === "peak") return plannedPeakIndex;
      const exactPhaseIndex = firstPhaseIndex(role);
      if (exactPhaseIndex >= 0) return exactPhaseIndex;
      if (role === "dissipation") return sequencePlan.length - 1;
      if (role === "breakup") return Math.max(plannedPeakIndex + 1, sequencePlan.length - 2);
      const firstDecayOrLater = sequencePlan.findIndex((entry, index) => (
        index > plannedPeakIndex && phaseRank(entry.phase) >= phaseRank("decay")
      ));
      return firstDecayOrLater >= 0 ? firstDecayOrLater : firstPostPeakIndex;
    };
    const outputIndexForRole = {};
    for (const role of EXPLICIT_ANCHOR_ROLES) {
      const source = roleMap.get(role);
      if (!source) continue;
      const explicitTimelineIndex = source.timelineIndex;
      const timelineIsValid = explicitTimelineIndex !== null
        && explicitTimelineIndex >= 0
        && explicitTimelineIndex < sequencePlan.length
        && (role === "onset" ? explicitTimelineIndex < plannedPeakIndex : role === "peak"
          ? explicitTimelineIndex === plannedPeakIndex
          : explicitTimelineIndex > plannedPeakIndex);
      outputIndexForRole[role] = timelineIsValid ? explicitTimelineIndex : fallbackOutputIndex(role);
    }
    const assignedIndices = Object.entries(outputIndexForRole)
      .filter(([, index]) => index !== null)
      .map(([role, index]) => ({ role, index }));
    const duplicateOutputIndex = assignedIndices.find((entry, index) => (
      assignedIndices.findIndex((candidate) => candidate.index === entry.index) !== index
    ));
    if (duplicateOutputIndex) {
      fail(
        "AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_TIMELINE_INVALID",
        "Explicit AI anchors must map to distinct chronological sequence positions.",
        { outputIndex: duplicateOutputIndex.index, roles: assignedIndices.filter((entry) => entry.index === duplicateOutputIndex.index).map((entry) => entry.role) },
      );
    }
    const postPeakEntries = assignedIndices.filter((entry) => postPeakRoles.includes(entry.role));
    if (postPeakEntries.some((entry) => entry.index <= plannedPeakIndex)) {
      fail(
        "AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_TIMELINE_INVALID",
        "Every post-peak AI anchor must map after the planned peak.",
        { plannedPeakIndex, anchors: postPeakEntries },
      );
    }
    const anchors = [];
    for (const role of EXPLICIT_ANCHOR_ROLES) {
      const source = roleMap.get(role);
      const outputIndex = outputIndexForRole[role];
      if (!source || outputIndex === null) continue;
      const mask = role === "peak" ? peakMask : buildMaskRecord(source, settings.alphaThreshold);
      if (!mask.visiblePixels) {
        fail(
          "AIFX_TEMPORAL_CONFORM_AI_ALPHA_EMPTY",
          `The explicit ${role} AI anchor has no visible alpha silhouette.`,
          { candidateIndex: source.candidateIndex, globalIndex: source.globalIndex },
        );
      }
      if (mask.boundaryClipped) {
        fail(
          "AIFX_TEMPORAL_CONFORM_ANCHOR_BOUNDARY_CLIPPED",
          `The explicit ${role} AI anchor touches a cell boundary and appears clipped.`,
          { candidateIndex: source.candidateIndex, globalIndex: source.globalIndex },
        );
      }
      const compatibilityToPeak = role === "peak" ? 1 : centroidCompensatedIou(peakMask, mask);
      const appearanceSimilarityToPeak = role === "peak"
        ? 1
        : centroidCompensatedAppearanceSimilarity(peakSource, peakMask, source, mask);
      if (role !== "peak" && compatibilityToPeak < settings.anchorCompatibilityMinimum) {
        fail(
          "AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_INCOMPATIBLE",
          `The explicit ${role} AI anchor does not share enough alpha topology with the peak anchor.`,
          {
            candidateIndex: source.candidateIndex,
            globalIndex: source.globalIndex,
            compatibilityToPeak,
          },
        );
      }
      if (
        role !== "peak"
        && compatibilityToPeak > settings.anchorDuplicateMaximum
        && appearanceSimilarityToPeak > settings.anchorAppearanceDuplicateMinimum
      ) {
        fail(
          "AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_DUPLICATE",
          `The explicit ${role} AI anchor copies too much of the peak alpha topology to represent a distinct lifecycle phase.`,
          {
            candidateIndex: source.candidateIndex,
            globalIndex: source.globalIndex,
            compatibilityToPeak,
            appearanceSimilarityToPeak,
            anchorDuplicateMaximum: settings.anchorDuplicateMaximum,
            anchorAppearanceDuplicateMinimum: settings.anchorAppearanceDuplicateMinimum,
          },
        );
      }
      const targetOccupancy = sequencePlan[outputIndex].occupancy;
      const requiredScale = targetOccupancy <= 0
        ? settings.minimumScale
        : Math.sqrt(targetOccupancy / Math.max(1 / (source.width * source.height), mask.areaRatio));
      if (requiredScale > settings.maximumScale) {
        fail(
          "AIFX_TEMPORAL_CONFORM_ANCHOR_INSUFFICIENT",
          `The explicit ${role} AI anchor cannot reach its output occupancy within the uniform-scale limit.`,
          { candidateIndex: source.candidateIndex, globalIndex: source.globalIndex, requiredScale },
        );
      }
      anchors.push(Object.freeze({
        source,
        index: source.candidateIndex,
        mask,
        role,
        outputIndex,
        plan: sequencePlan[outputIndex],
        phaseCoordinate: outputTimelineCoordinate(outputIndex, sequencePlan.length),
        compatibilityToPeak,
        appearanceSimilarityToPeak,
        requiredScale,
        trace: Object.freeze({
          role,
          candidateIndex: source.candidateIndex,
          sourceIndex: source.sourceIndex,
          globalIndex: source.globalIndex,
          timelineIndex: source.timelineIndex,
          outputIndex,
          phase: String(sequencePlan[outputIndex].phase || ""),
          compatibilityToPeak: roundTrace(compatibilityToPeak),
          appearanceSimilarityToPeak: roundTrace(appearanceSimilarityToPeak),
          areaRatio: roundTrace(mask.areaRatio),
          alphaMassRatio: roundTrace(mask.alphaMassRatio),
          requiredScale: roundTrace(requiredScale),
          boundaryClipped: false,
          maximumEdgeSideCoverage: roundTrace(mask.maximumEdgeSideCoverage),
        }),
      }));
    }
    anchors.sort((left, right) => left.phaseCoordinate - right.phaseCoordinate);
    return Object.freeze({
      inputMode: "explicit-candidates",
      plannedPeakIndex,
      generatedPeakIndex: peakSource.globalIndex,
      generatedPeakCandidateIndex: peakSource.candidateIndex,
      generatedPeakSourceIndex: peakSource.sourceIndex,
      generatedPeakGlobalIndex: peakSource.globalIndex,
      peakSource,
      canonicalCenter: Object.freeze({ ...peakMask.centroid }),
      anchors: Object.freeze(anchors),
    });
  }

  function samplePremultiplied(image, x, y, output) {
    output[0] = 0;
    output[1] = 0;
    output[2] = 0;
    output[3] = 0;
    if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return output;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(image.width - 1, x0 + 1);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fractionX = x - x0;
    const fractionY = y - y0;
    const coordinates = [
      [x0, y0, (1 - fractionX) * (1 - fractionY)],
      [x1, y0, fractionX * (1 - fractionY)],
      [x0, y1, (1 - fractionX) * fractionY],
      [x1, y1, fractionX * fractionY],
    ];
    for (const [sampleX, sampleY, weight] of coordinates) {
      if (weight <= 0) continue;
      const offset = (sampleY * image.width + sampleX) * 4;
      const alpha = image.data[offset + 3] / 255;
      const weightedAlpha = alpha * weight;
      output[0] += (image.data[offset] / 255) * weightedAlpha;
      output[1] += (image.data[offset + 1] / 255) * weightedAlpha;
      output[2] += (image.data[offset + 2] / 255) * weightedAlpha;
      output[3] += weightedAlpha;
    }
    return output;
  }

  const EXPLICIT_TOPOLOGY_WEIGHT_POWER = 2;
  const EXPLICIT_TAIL_TOPOLOGY_WEIGHT_POWER = 3;
  const EXPLICIT_DECAY_TO_BREAKUP_TOPOLOGY_WEIGHT_POWER = 5;
  const EXPLICIT_PEAK_TO_DECAY_EASING_EXPONENT = 1.65;

  function sharpenExplicitAnchorBlend(blend, power = EXPLICIT_TOPOLOGY_WEIGHT_POWER) {
    if (!Array.isArray(blend) || blend.length <= 1) return blend;
    const normalizedPower = clamp(Number(power) || EXPLICIT_TOPOLOGY_WEIGHT_POWER, 1, 12);
    const powered = blend.map((item) => Math.pow(clamp(Number(item.weight) || 0, 0, 1), normalizedPower));
    const total = powered.reduce((sum, weight) => sum + weight, 0);
    if (total <= 1e-12) return blend;
    return blend.map((item, index) => ({ ...item, weight: powered[index] / total }));
  }

  function adjacentAnchorBlend(anchorLibrary, targetIndex, frameCount) {
    const anchors = anchorLibrary.anchors;
    if (anchors.length === 1) return [{ anchor: anchors[0], weight: 1 }];
    const coordinate = outputTimelineCoordinate(targetIndex, frameCount);
    if (coordinate <= anchors[0].phaseCoordinate) return [{ anchor: anchors[0], weight: 1 }];
    if (coordinate >= anchors[anchors.length - 1].phaseCoordinate) {
      return [{ anchor: anchors[anchors.length - 1], weight: 1 }];
    }
    for (let index = 1; index < anchors.length; index += 1) {
      const right = anchors[index];
      if (coordinate > right.phaseCoordinate) continue;
      const left = anchors[index - 1];
      const range = Math.max(1e-8, right.phaseCoordinate - left.phaseCoordinate);
      const rawAmount = clamp((coordinate - left.phaseCoordinate) / range, 0, 1);
      if (rawAmount <= 1e-6) return [{ anchor: left, weight: 1 }];
      if (rawAmount >= 1 - 1e-6) return [{ anchor: right, weight: 1 }];
      const peakToBreakup = left.role === "peak" && right.role === "breakup";
      const peakToDecay = anchorLibrary.inputMode === "explicit-candidates"
        && left.role === "peak"
        && right.role === "decay";
      const decayToBreakup = left.role === "decay" && right.role === "breakup";
      const baseAmount = peakToBreakup
        ? clamp(rawAmount + 3.6 * rawAmount * (1 - rawAmount) * (0.65 - rawAmount), 0, 1)
        : decayToBreakup
          ? rawAmount - 0.6 * rawAmount * (1 - rawAmount)
          : peakToDecay
            ? 1 - Math.pow(1 - rawAmount, EXPLICIT_PEAK_TO_DECAY_EASING_EXPONENT)
            : rawAmount;
      const supportShoulder = peakToBreakup
        ? Math.max(0, rawAmount - 0.7) * (1 - rawAmount)
        : 0;
      const amount = clamp(baseAmount - supportShoulder, 0, 1);
      const blend = [
        { anchor: left, weight: 1 - amount },
        { anchor: right, weight: amount },
      ];
      const tailTopologyBridge = right.role === "breakup" || right.role === "dissipation";
      return anchorLibrary.inputMode === "explicit-candidates"
        ? sharpenExplicitAnchorBlend(
          blend,
          decayToBreakup
            ? EXPLICIT_DECAY_TO_BREAKUP_TOPOLOGY_WEIGHT_POWER
            : tailTopologyBridge
              ? EXPLICIT_TAIL_TOPOLOGY_WEIGHT_POWER
              : EXPLICIT_TOPOLOGY_WEIGHT_POWER,
        )
        : blend;
    }
    return [{ anchor: anchors[anchors.length - 1], weight: 1 }];
  }

  function composeAnchorSource(anchorLibrary, targetFrame, targetIndex, frameCount) {
    const blend = adjacentAnchorBlend(anchorLibrary, targetIndex, frameCount);
    const width = targetFrame.width;
    const height = targetFrame.height;
    const data = new Uint8ClampedArray(width * height * 4);
    const sample = [0, 0, 0, 0];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 0;
        for (const item of blend) {
          const center = item.anchor.mask.centroid;
          const sourceX = x - (anchorLibrary.canonicalCenter.x - center.x);
          const sourceY = y - (anchorLibrary.canonicalCenter.y - center.y);
          samplePremultiplied(item.anchor.source, sourceX, sourceY, sample);
          red += sample[0] * item.weight;
          green += sample[1] * item.weight;
          blue += sample[2] * item.weight;
          alpha += sample[3] * item.weight;
        }
        if (alpha <= 1e-8) continue;
        const offset = (y * width + x) * 4;
        data[offset] = Math.round(clamp(red / alpha, 0, 1) * 255);
        data[offset + 1] = Math.round(clamp(green / alpha, 0, 1) * 255);
        data[offset + 2] = Math.round(clamp(blue / alpha, 0, 1) * 255);
        data[offset + 3] = Math.round(clamp(alpha, 0, 1) * 255);
      }
    }
    const blendTrace = Object.freeze(blend.map((item) => Object.freeze({
      candidateIndex: item.anchor.source.candidateIndex,
      sourceIndex: item.anchor.source.sourceIndex,
      globalIndex: item.anchor.source.globalIndex,
      anchorRole: item.anchor.role,
      weight: roundTrace(item.weight),
    })));
    return {
      frame: targetFrame.frame,
      index: targetIndex,
      width,
      height,
      data,
      candidateIndices: Object.freeze(blendTrace.map((entry) => entry.candidateIndex)),
      sourceIndices: Object.freeze(blendTrace.map((entry) => entry.sourceIndex)),
      globalIndices: Object.freeze(blendTrace.map((entry) => entry.globalIndex)),
      blend: blendTrace,
    };
  }

  function publicGeometry(value) {
    return Object.freeze({
      width: value.width,
      height: value.height,
      visiblePixels: value.visiblePixels,
      areaRatio: value.areaRatio,
      alphaMass: value.alphaMass,
      alphaMassRatio: value.alphaMassRatio,
      maximumAlpha: value.maximumAlpha,
      edgeContactPixels: value.edgeContactPixels,
      edgeContactRatio: value.edgeContactRatio,
      edgeSideCoverage: Object.freeze({ ...value.edgeSideCoverage }),
      maximumEdgeSideCoverage: value.maximumEdgeSideCoverage,
      boundaryClipped: value.boundaryClipped,
      centroid: value.centroid ? Object.freeze({ ...value.centroid }) : null,
      principalAngle: value.principalAngle,
      principalAngleDeg: Number.isFinite(value.principalAngle) ? value.principalAngle * 180 / Math.PI : null,
      anisotropy: value.anisotropy,
      bbox: value.bbox ? Object.freeze({ ...value.bbox }) : null,
    });
  }

  function analyzeAiAlphaGeometry(frame, options) {
    const settings = normalizeOptions(options);
    const source = readFrameImageData(frame, Number(frame?.index) || 0);
    return publicGeometry(analyzeImageData(source, settings.alphaThreshold));
  }

  function defaultCreateCanvas(width, height) {
    if (root?.document && typeof root.document.createElement === "function") {
      const canvas = root.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    if (typeof root?.OffscreenCanvas === "function") return new root.OffscreenCanvas(width, height);
    fail(
      "AIFX_TEMPORAL_CONFORM_CANVAS_UNAVAILABLE",
      "A Canvas factory is required for temporal conform output.",
      { width, height },
    );
  }

  function createCanvas(width, height, dependencies) {
    const factory = dependencies?.createCanvas || dependencies?.canvasFactory || defaultCreateCanvas;
    const canvas = factory(width, height);
    if (!canvas || typeof canvas.getContext !== "function") {
      fail("AIFX_TEMPORAL_CONFORM_CANVAS_UNAVAILABLE", "Canvas factory returned an invalid canvas.");
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return canvas;
  }

  function putImageDataOnCanvas(canvas, imageData) {
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context || typeof context.putImageData !== "function") {
      fail("AIFX_TEMPORAL_CONFORM_CANVAS_UNAVAILABLE", "Canvas output needs a pixel-addressable 2D context.");
    }
    let output = imageData;
    if (typeof context.createImageData === "function") {
      output = context.createImageData(imageData.width, imageData.height);
      output.data.set(imageData.data);
    }
    context.putImageData(output, 0, 0);
    return output;
  }

  async function canvasToPngDataUrl(canvas, dependencies) {
    const encoder = dependencies?.canvasToDataUrl;
    const value = encoder
      ? await encoder(canvas, "image/png")
      : typeof canvas.toDataURL === "function"
        ? canvas.toDataURL("image/png")
        : null;
    if (typeof value !== "string" || !/^data:image\/png(?:;[^,]*)?,/i.test(value)) {
      fail(
        "AIFX_TEMPORAL_CONFORM_PNG_ENCODER_UNAVAILABLE",
        "Temporal conform output requires a PNG data URL encoder.",
      );
    }
    return value;
  }

  function renderUniformAffine(source, transform) {
    const output = {
      width: source.width,
      height: source.height,
      data: new Uint8ClampedArray(source.width * source.height * 4),
    };
    if (transform.alphaGain <= 0 || transform.scale <= 0) return output;
    const sourceData = source.data;
    const outputData = output.data;
    const anchorX = transform.targetX + transform.offsetX;
    const anchorY = transform.targetY + transform.offsetY;
    const inverseScale = 1 / transform.scale;
    const rotationRad = Number(transform.rotationRad) || 0;
    const rotationCos = Math.cos(rotationRad);
    const rotationSin = Math.sin(rotationRad);
    for (let y = 0; y < output.height; y += 1) {
      for (let x = 0; x < output.width; x += 1) {
        const scaledX = (x - anchorX) * inverseScale;
        const scaledY = (y - anchorY) * inverseScale;
        const sourceX = scaledX * rotationCos + scaledY * rotationSin + transform.sourceCenterX;
        const sourceY = -scaledX * rotationSin + scaledY * rotationCos + transform.sourceCenterY;
        if (sourceX < 0 || sourceY < 0 || sourceX > source.width - 1 || sourceY > source.height - 1) continue;
        const x0 = Math.floor(sourceX);
        const y0 = Math.floor(sourceY);
        const x1 = Math.min(source.width - 1, x0 + 1);
        const y1 = Math.min(source.height - 1, y0 + 1);
        const fractionX = sourceX - x0;
        const fractionY = sourceY - y0;
        const samples = [
          [x0, y0, (1 - fractionX) * (1 - fractionY)],
          [x1, y0, fractionX * (1 - fractionY)],
          [x0, y1, (1 - fractionX) * fractionY],
          [x1, y1, fractionX * fractionY],
        ];
        let alpha = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        for (const [sampleX, sampleY, weight] of samples) {
          if (weight <= 0) continue;
          const sourceOffset = (sampleY * source.width + sampleX) * 4;
          const sampleAlpha = sourceData[sourceOffset + 3] / 255;
          if (sampleAlpha <= 0) continue;
          const weightedAlpha = sampleAlpha * weight;
          alpha += weightedAlpha;
          red += (sourceData[sourceOffset] / 255) * weightedAlpha;
          green += (sourceData[sourceOffset + 1] / 255) * weightedAlpha;
          blue += (sourceData[sourceOffset + 2] / 255) * weightedAlpha;
        }
        if (alpha <= 1e-8) continue;
        const outputOffset = (y * output.width + x) * 4;
        outputData[outputOffset] = Math.round(clamp(red / alpha, 0, 1) * 255);
        outputData[outputOffset + 1] = Math.round(clamp(green / alpha, 0, 1) * 255);
        outputData[outputOffset + 2] = Math.round(clamp(blue / alpha, 0, 1) * 255);
        const outputAlpha = transform.preserveThresholdSupport === true
          && alpha >= transform.alphaThreshold
          ? transform.alphaThreshold + (alpha - transform.alphaThreshold) * transform.alphaGain
          : alpha * transform.alphaGain;
        outputData[outputOffset + 3] = Math.round(clamp(outputAlpha, 0, 1) * 255);
      }
    }
    return output;
  }

  function lifecycleAlphaGain(planEntry, sourceGeometry, settings) {
    if (planEntry.occupancy <= 0) return 0;
    const energyGain = 0.12 + 0.88 * Math.sqrt(clamp(planEntry.energy, 0, 1));
    const visibilityGain = sourceGeometry.maximumAlpha > 0
      ? settings.alphaThreshold / sourceGeometry.maximumAlpha + 0.015
      : 1;
    return clamp(Math.max(energyGain, visibilityGain), 0, 1);
  }

  function occupancyTolerance(target, width, height, settings) {
    const pixelRatio = 1 / Math.max(1, width * height);
    return Math.max(pixelRatio * 1.5, target * settings.occupancyRelativeTolerance);
  }

  function buildExplicitConformPlan(sequencePlan, plannedPeakIndex, settings) {
    const peakOccupancy = Number(sequencePlan[plannedPeakIndex]?.occupancy) || 0;
    const nonPeakMaximum = peakOccupancy * settings.explicitPeakDominanceRatio;
    return Object.freeze(sequencePlan.map((entry, index) => Object.freeze({
      ...entry,
      requestedOccupancy: entry.occupancy,
      occupancy: index === plannedPeakIndex || peakOccupancy <= 0
        ? entry.occupancy
        : Math.min(entry.occupancy, nonPeakMaximum),
    })));
  }

  function correctionScore(metrics, target, width, height) {
    const pixelRatio = 1 / Math.max(1, width * height);
    const occupancyError = Math.abs(metrics.areaRatio - target.occupancy);
    const normalizedOccupancyError = occupancyError / Math.max(pixelRatio, target.occupancy);
    const centerError = metrics.centroid
      ? Math.hypot(metrics.centroid.x - target.x, metrics.centroid.y - target.y) / Math.hypot(width, height)
      : target.occupancy > 0 ? 1 : 0;
    return normalizedOccupancyError + centerError * 2;
  }

  function normalizeAxisRotationDeg(targetDirectionDeg, sourceDirectionRad, maximumRotationDeg) {
    if (!Number.isFinite(sourceDirectionRad)) return 0;
    let difference = Number(targetDirectionDeg) - sourceDirectionRad * 180 / Math.PI;
    while (difference > 90) difference -= 180;
    while (difference < -90) difference += 180;
    return clamp(difference, -maximumRotationDeg, maximumRotationDeg);
  }

  function axisResidualDeg(targetDirectionDeg, outputDirectionRad) {
    if (!Number.isFinite(outputDirectionRad)) return null;
    let difference = Math.abs(Number(targetDirectionDeg) - outputDirectionRad * 180 / Math.PI) % 180;
    if (difference > 90) difference = 180 - difference;
    return difference;
  }

  function buildFrameCorrection(source, planEntry, settings) {
    const sourceGeometry = analyzeImageData(source, settings.alphaThreshold);
    if (!sourceGeometry.centroid || sourceGeometry.alphaMass <= 0) {
      if (planEntry.occupancy > 0) {
        fail(
          "AIFX_TEMPORAL_CONFORM_AI_ALPHA_EMPTY",
          `AI frame ${source.index} has no alpha silhouette to conform.`,
          { index: source.index, targetOccupancy: planEntry.occupancy },
        );
      }
    }
    const sourceCenter = sourceGeometry.centroid || { x: source.width * 0.5, y: source.height * 0.5 };
    const target = {
      x: planEntry.centerX * (source.width - 1),
      y: planEntry.centerY * (source.height - 1),
      occupancy: planEntry.occupancy,
    };
    const alphaGain = lifecycleAlphaGain(planEntry, sourceGeometry, settings);
    const rotationDeg = settings.directionAlignmentEnabled
      && sourceGeometry.anisotropy >= settings.directionAnisotropyMinimum
      ? normalizeAxisRotationDeg(
        planEntry.directionDeg,
        sourceGeometry.principalAngle,
        settings.maximumDirectionRotationDeg,
      )
      : 0;
    const rotationRad = rotationDeg * Math.PI / 180;
    let scale = planEntry.occupancy <= 0 || sourceGeometry.areaRatio <= 0
      ? settings.minimumScale
      : clamp(
        Math.sqrt(planEntry.occupancy / Math.max(1 / (source.width * source.height), sourceGeometry.areaRatio)),
        settings.minimumScale,
        settings.maximumScale,
      );
    let offsetX = 0;
    let offsetY = 0;
    let best = null;
    let previousScale = Number.NaN;
    let previousOffsetX = Number.NaN;
    let previousOffsetY = Number.NaN;

    for (let iteration = 1; iteration <= settings.maximumIterations; iteration += 1) {
      const transform = {
        scale,
        sourceCenterX: sourceCenter.x,
        sourceCenterY: sourceCenter.y,
        targetX: target.x,
        targetY: target.y,
        offsetX,
        offsetY,
        alphaGain,
        alphaThreshold: settings.alphaThreshold,
        preserveThresholdSupport: settings.preserveThresholdSupport === true,
        rotationRad,
      };
      const imageData = renderUniformAffine(source, transform);
      const outputGeometry = analyzeImageData(imageData, settings.alphaThreshold);
      const score = correctionScore(outputGeometry, target, source.width, source.height);
      const occupancyError = Math.abs(outputGeometry.areaRatio - target.occupancy);
      const centerErrorPx = outputGeometry.centroid
        ? Math.hypot(outputGeometry.centroid.x - target.x, outputGeometry.centroid.y - target.y)
        : target.occupancy > 0 ? Number.POSITIVE_INFINITY : 0;
      const candidate = {
        imageData,
        outputGeometry,
        scale,
        offsetX,
        offsetY,
        score,
        occupancyError,
        centerErrorPx,
        rotationDeg,
        iterations: iteration,
      };
      if (!best || candidate.score < best.score) best = candidate;
      const occupancyConverged = occupancyError <= occupancyTolerance(
        target.occupancy,
        source.width,
        source.height,
        settings,
      );
      const centerConverged = centerErrorPx <= settings.centerTolerancePx || target.occupancy <= 0;
      if (occupancyConverged && centerConverged) {
        best = candidate;
        break;
      }

      if (outputGeometry.centroid) {
        offsetX += target.x - outputGeometry.centroid.x;
        offsetY += target.y - outputGeometry.centroid.y;
      }
      if (target.occupancy > 0) {
        if (outputGeometry.areaRatio > 0) {
          const ratio = target.occupancy / outputGeometry.areaRatio;
          const step = clamp(Math.sqrt(ratio), 0.5, 2);
          scale = clamp(scale * step, settings.minimumScale, settings.maximumScale);
        } else {
          scale = clamp(scale * 1.6, settings.minimumScale, settings.maximumScale);
        }
      } else {
        scale = settings.minimumScale;
      }
      const unchanged = Math.abs(scale - previousScale) < 1e-6
        && Math.abs(offsetX - previousOffsetX) < 1e-6
        && Math.abs(offsetY - previousOffsetY) < 1e-6;
      if (unchanged) break;
      previousScale = scale;
      previousOffsetX = offsetX;
      previousOffsetY = offsetY;
    }

    const thresholdSupportMass = settings.preserveThresholdSupport === true
      ? sourceGeometry.visiblePixels * settings.alphaThreshold * (1 - alphaGain)
      : 0;
    const expectedAlphaMass = best.scale * best.scale * (
      sourceGeometry.alphaMass * alphaGain + thresholdSupportMass
    );
    const retainedAlphaMassRatio = expectedAlphaMass > 1e-8
      ? clamp(best.outputGeometry.alphaMass / expectedAlphaMass, 0, 1)
      : 1;
    const dx = target.x + best.offsetX - sourceCenter.x;
    const dy = target.y + best.offsetY - sourceCenter.y;
    const converged = best.occupancyError <= occupancyTolerance(
      target.occupancy,
      source.width,
      source.height,
      settings,
    ) && (best.centerErrorPx <= settings.centerTolerancePx || target.occupancy <= 0);
    return {
      imageData: best.imageData,
      sourceGeometry,
      outputGeometry: best.outputGeometry,
      trace: Object.freeze({
        index: source.index,
        candidateIndices: source.candidateIndices || Object.freeze([source.candidateIndex ?? source.index]),
        sourceIndices: source.sourceIndices || Object.freeze([source.sourceIndex ?? source.index]),
        globalIndices: source.globalIndices || Object.freeze([source.globalIndex ?? source.index]),
        blend: source.blend || Object.freeze([
          Object.freeze({
            candidateIndex: source.candidateIndex ?? source.index,
            sourceIndex: source.sourceIndex ?? source.index,
            globalIndex: source.globalIndex ?? source.index,
            anchorRole: source.anchorRole || "",
            weight: 1,
          }),
        ]),
        scale: roundTrace(best.scale),
        dx: roundTrace(dx),
        dy: roundTrace(dy),
        alphaGain: roundTrace(alphaGain),
        thresholdSupportPreserved: settings.preserveThresholdSupport === true,
        sourceDirectionDeg: Number.isFinite(sourceGeometry.principalAngle)
          ? roundTrace(sourceGeometry.principalAngle * 180 / Math.PI)
          : null,
        targetDirectionDeg: roundTrace(planEntry.directionDeg),
        rotationDeg: roundTrace(best.rotationDeg),
        rotationUsed: Math.abs(best.rotationDeg) > 1e-6,
        outputDirectionDeg: Number.isFinite(best.outputGeometry.principalAngle)
          ? roundTrace(best.outputGeometry.principalAngle * 180 / Math.PI)
          : null,
        residualDirectionDeg: Number.isFinite(best.outputGeometry.principalAngle)
          ? roundTrace(axisResidualDeg(planEntry.directionDeg, best.outputGeometry.principalAngle))
          : null,
        directionAnisotropy: roundTrace(sourceGeometry.anisotropy),
        sourceAreaRatio: roundTrace(sourceGeometry.areaRatio),
        targetOccupancy: roundTrace(target.occupancy),
        requestedTargetOccupancy: roundTrace(
          Number.isFinite(Number(planEntry.requestedOccupancy))
            ? Number(planEntry.requestedOccupancy)
            : target.occupancy,
        ),
        outputAreaRatio: roundTrace(best.outputGeometry.areaRatio),
        occupancyError: roundTrace(best.occupancyError),
        centerErrorPx: Number.isFinite(best.centerErrorPx) ? roundTrace(best.centerErrorPx) : null,
        retainedAlphaMassRatio: roundTrace(retainedAlphaMassRatio),
        iterations: best.iterations,
        converged,
      }),
    };
  }

  function qualityFailureCodes(quality) {
    const codes = [];
    if (quality?.code) codes.push(String(quality.code));
    if (Array.isArray(quality?.failures)) {
      for (const failure of quality.failures) {
        const code = String(failure?.code || "");
        if (code) codes.push(code);
      }
    }
    return [...new Set(codes)];
  }

  function canConformQualityFailure(quality) {
    if (!quality || quality.passed === true) return false;
    const codes = qualityFailureCodes(quality);
    if (!codes.length || codes.some((code) => FORBIDDEN_FAILURE_CODES.has(code))) return false;
    return codes.some((code) => CORRECTABLE_FAILURE_CODES.has(code));
  }

  async function conformFrames(input, dependencies) {
    const sourceInput = input && typeof input === "object" ? input : {};
    assertNoTemplatePixelInput(sourceInput);
    if (sourceInput.temporalCorrection || sourceInput.alreadyConformed === true) {
      fail(
        "AIFX_TEMPORAL_CONFORM_ALREADY_APPLIED",
        "Temporal conform is a one-shot fallback and cannot be applied recursively.",
      );
    }
    const trigger = String(sourceInput.trigger || "quality-fallback");
    if (!sourceInput.quality && trigger !== "anchor-sequence-generation") {
      fail(
        "AIFX_TEMPORAL_CONFORM_QUALITY_REQUIRED",
        "Temporal quality evidence is required unless explicit anchor-sequence generation is requested.",
        { trigger },
      );
    }
    if (sourceInput.quality && !canConformQualityFailure(sourceInput.quality)) {
      fail(
        "AIFX_TEMPORAL_CONFORM_FAILURE_NOT_ELIGIBLE",
        "The supplied quality failure is not eligible for affine temporal conform.",
        { failureCodes: qualityFailureCodes(sourceInput.quality) },
      );
    }
    if (!Array.isArray(sourceInput.frames) || !sourceInput.frames.length) {
      fail("AIFX_TEMPORAL_CONFORM_FRAMES_REQUIRED", "At least one AI-generated RGBA frame is required.");
    }
    const settings = normalizeOptions(sourceInput.options);
    const frames = sourceInput.frames.map((frame, index) => readFrameImageData(frame, index));
    const width = frames[0].width;
    const height = frames[0].height;
    frames.forEach((frame, index) => {
      if (frame.width !== width || frame.height !== height) {
        fail(
          "AIFX_TEMPORAL_CONFORM_FRAME_SIZE_MISMATCH",
          "Every AI frame must retain the same dimensions.",
          { index, expected: { width, height }, actual: { width: frame.width, height: frame.height } },
        );
      }
    });
    const requestedPlanLength = Array.isArray(sourceInput.sequencePlan) ? sourceInput.sequencePlan.length : 0;
    if (!requestedPlanLength) {
      fail("AIFX_TEMPORAL_CONFORM_SEQUENCE_PLAN_INVALID", "sequencePlan must contain at least one output frame.");
    }
    const sequencePlan = normalizeSequencePlan(sourceInput.sequencePlan, requestedPlanLength);
    const hasExplicitRoles = frames.some((frame) => Boolean(frame.anchorRole));
    if (!hasExplicitRoles && frames.length !== sequencePlan.length) {
      fail(
        "AIFX_TEMPORAL_CONFORM_FRAME_PLAN_MISMATCH",
        "Sprite-sheet fallback requires one AI source cell per sequencePlan output frame.",
        { candidateCount: frames.length, outputFrameCount: sequencePlan.length },
      );
    }
    const anchorLibrary = hasExplicitRoles
      ? selectExplicitAnchorLibrary(frames, sequencePlan, settings)
      : selectAnchorLibrary(frames, sequencePlan, settings);
    const conformPlan = hasExplicitRoles
      ? buildExplicitConformPlan(sequencePlan, anchorLibrary.plannedPeakIndex, settings)
      : sequencePlan;
    const correctionSettings = hasExplicitRoles
      ? Object.freeze({
        ...settings,
        occupancyRelativeTolerance: Math.min(
          settings.occupancyRelativeTolerance,
          settings.explicitOccupancyRelativeTolerance,
        ),
        preserveThresholdSupport: true,
      })
      : settings;
    const outputFrames = [];
    const transforms = [];
    for (let index = 0; index < sequencePlan.length; index += 1) {
      const targetFrame = hasExplicitRoles
        ? {
          frame: {
            index,
            name: `frame_${String(index).padStart(3, "0")}.png`,
            materialType: anchorLibrary.peakSource.frame?.materialType,
            matteMethod: anchorLibrary.peakSource.frame?.matteMethod,
            shapeSource: AI_SHAPE_SOURCE,
            motionConstraint: MOTION_CONSTRAINT,
          },
          index,
          width,
          height,
        }
        : frames[index];
      const source = composeAnchorSource(
        anchorLibrary,
        targetFrame,
        index,
        sequencePlan.length,
      );
      const correction = buildFrameCorrection(source, conformPlan[index], correctionSettings);
      const canvas = createCanvas(width, height, dependencies);
      const imageData = putImageDataOnCanvas(canvas, correction.imageData);
      const dataUrl = await canvasToPngDataUrl(canvas, dependencies);
      const trace = correction.trace;
      transforms.push(trace);
      outputFrames.push(Object.freeze({
        ...source.frame,
        index,
        name: String(source.frame?.name || `frame_${String(index).padStart(3, "0")}.png`),
        width,
        height,
        canvas,
        imageData,
        dataUrl,
        mimeType: "image/png",
        pixelFormat: "rgba8",
        alphaMode: "straight",
        shapeSource: AI_SHAPE_SOURCE,
        motionConstraint: MOTION_CONSTRAINT,
        candidateIndices: trace.candidateIndices,
        sourceIndices: trace.sourceIndices,
        globalIndices: trace.globalIndices,
        scale: trace.scale,
        dx: trace.dx,
        dy: trace.dy,
        alphaGain: trace.alphaGain,
        rotationDeg: trace.rotationDeg,
        temporalConform: trace,
      }));
    }
    const outputAreaCurve = Object.freeze(outputFrames.map((frame) => (
      analyzeImageData(frame.imageData, settings.alphaThreshold).areaRatio
    )));
    const plannedPeakArea = outputAreaCurve[anchorLibrary.plannedPeakIndex] || 0;
    const maximumNonPeakArea = outputAreaCurve.reduce((maximum, area, index) => (
      index === anchorLibrary.plannedPeakIndex ? maximum : Math.max(maximum, area)
    ), 0);
    if (hasExplicitRoles && plannedPeakArea <= maximumNonPeakArea) {
      fail(
        "AIFX_TEMPORAL_CONFORM_PEAK_DOMINANCE_FAILED",
        "The explicit anchor sequence could not keep the planned peak above every non-peak frame.",
        {
          plannedPeakIndex: anchorLibrary.plannedPeakIndex,
          plannedPeakArea,
          maximumNonPeakArea,
          outputAreaCurve,
        },
      );
    }
    const correction = Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      mode: MODE,
      trigger,
      anchorInputMode: anchorLibrary.inputMode,
      attempt: Number.isFinite(Number(sourceInput.attempt)) ? Math.max(1, Math.round(Number(sourceInput.attempt))) : null,
      templatePixelsUsed: false,
      templateMaskUsed: false,
      nonUniformDeformationUsed: false,
      thresholdSupportPreserved: anchorLibrary.inputMode === "explicit-candidates",
      rotationUsed: transforms.some((entry) => entry.rotationUsed),
      adjacentBlendUsed: transforms.some((entry) => entry.sourceIndices.length > 1),
      topologyWeightSharpened: anchorLibrary.inputMode === "explicit-candidates",
      topologyWeightPower: anchorLibrary.inputMode === "explicit-candidates" ? EXPLICIT_TOPOLOGY_WEIGHT_POWER : 1,
      tailTopologyWeightPower: anchorLibrary.inputMode === "explicit-candidates" ? EXPLICIT_TAIL_TOPOLOGY_WEIGHT_POWER : 1,
      decayToBreakupTopologyWeightPower: anchorLibrary.inputMode === "explicit-candidates"
        ? EXPLICIT_DECAY_TO_BREAKUP_TOPOLOGY_WEIGHT_POWER
        : 1,
      peakToDecayEasingExponent: anchorLibrary.inputMode === "explicit-candidates"
        ? EXPLICIT_PEAK_TO_DECAY_EASING_EXPONENT
        : 1,
      anchorCount: anchorLibrary.anchors.length,
      plannedPeakIndex: anchorLibrary.plannedPeakIndex,
      generatedPeakIndex: anchorLibrary.generatedPeakIndex,
      generatedPeakCandidateIndex: anchorLibrary.generatedPeakCandidateIndex,
      generatedPeakSourceIndex: anchorLibrary.generatedPeakSourceIndex,
      generatedPeakGlobalIndex: anchorLibrary.generatedPeakGlobalIndex,
      anchors: Object.freeze(anchorLibrary.anchors.map((entry) => entry.trace)),
      candidateIndices: Object.freeze(transforms.map((entry) => entry.candidateIndices)),
      sourceIndices: Object.freeze(transforms.map((entry) => entry.sourceIndices)),
      globalIndices: Object.freeze(transforms.map((entry) => entry.globalIndices)),
      transforms: Object.freeze(transforms),
      converged: transforms.every((entry) => entry.converged),
      peakDominance: Object.freeze({
        enforced: hasExplicitRoles,
        plannedPeakIndex: anchorLibrary.plannedPeakIndex,
        plannedPeakArea: roundTrace(plannedPeakArea),
        maximumNonPeakArea: roundTrace(maximumNonPeakArea),
        margin: roundTrace(plannedPeakArea - maximumNonPeakArea),
      }),
    });
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      status: "ready",
      mode: MODE,
      frameCount: outputFrames.length,
      width,
      height,
      pixelFormat: "rgba8",
      alphaMode: "straight",
      shapeSource: AI_SHAPE_SOURCE,
      motionConstraint: MOTION_CONSTRAINT,
      templatePixelsUsed: false,
      templateMaskUsed: false,
      preservesFrameOrder: true,
      preservesFrameDimensions: true,
      frames: Object.freeze(outputFrames),
      temporalCorrection: correction,
    });
  }

  return Object.freeze({
    version: SCHEMA_VERSION,
    mode: MODE,
    AifxTemporalConformError,
    DEFAULT_OPTIONS,
    EXPLICIT_TOPOLOGY_WEIGHT_POWER,
    EXPLICIT_TAIL_TOPOLOGY_WEIGHT_POWER,
    EXPLICIT_DECAY_TO_BREAKUP_TOPOLOGY_WEIGHT_POWER,
    EXPLICIT_PEAK_TO_DECAY_EASING_EXPONENT,
    sharpenExplicitAnchorBlend,
    analyzeAiAlphaGeometry,
    canConformQualityFailure,
    conformFrames,
  });
});
