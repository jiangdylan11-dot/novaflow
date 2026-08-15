(function initNovaFlowAifxExportWorkflow(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.NovaFlowAifxExportWorkflow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAifxExportWorkflow(root) {
  "use strict";

  const SCHEMA_VERSION = "novaflow-aifx-export-v1";
  const ATLAS_SCHEMA_VERSION = "novaflow-aifx-atlas-v1";
  const MANIFEST_SCHEMA_VERSION = "novaflow-aifx-generation-manifest-v1";
  const BROWSER_ZIP_SCHEMA_VERSION = "novaflow-aifx-browser-zip-v1";
  const SHA256_RE = /^[a-f0-9]{64}$/i;
  const ZIP_UTF8_FLAG = 0x0800;
  const ZIP_STORE_METHOD = 0;
  const ZIP_DOS_TIME = 0;
  const ZIP_DOS_DATE = 33;
  const ZIP_MAX_UINT16 = 0xffff;
  const ZIP_MAX_UINT32 = 0xffffffff;
  const BROWSER_ZIP_BUDGET_SCHEMA_VERSION = "novaflow-aifx-browser-zip-budget-v1";
  const BROWSER_ZIP_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
  const BROWSER_ZIP_MAX_PEAK_BYTES = 512 * 1024 * 1024;
  const TRACE_STRING_MAX_LENGTH = 160;
  const SEQUENCE_PHASES = Object.freeze([
    "onset",
    "growth",
    "peak",
    "follow-through",
    "decay",
    "breakup",
    "dissipation",
  ]);
  const SEQUENCE_QUALITY_METRICS = Object.freeze([
    "exactAlphaFrameRatio",
    "minimumExactMaskRatio",
    "maximumExactMaskRatio",
    "minimumCompensatedTemplateIou",
    "minimumAreaCorrelation",
    "maximumAreaNormalizedMae",
    "maximumPeakFrameDelta",
    "minimumTemplateIouMedian",
    "maximumCentroidDriftMedian",
    "maximumCentroidDriftP95",
    "minimumBodyAdjacentMedian",
    "minimumBodyAdjacentIou",
    "maximumResidualVelocityP95",
    "maximumResidualAccelerationP95",
    "minimumSupportF1Median",
    "minimumSupportF1",
    "minimumSupportDilatedIouMedian",
    "maximumDirectionErrorP90Deg",
    "maximumDirectionEndpointMeanErrorDeg",
    "minimumPoseEvolutionRetention",
    "minimumPoseEvolutionCorrelation",
    "minimumTailChangeRetention",
    "maximumGeneratedTailIou",
  ]);

  class AifxExportError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "AifxExportError";
      this.code = code;
      this.details = details && typeof details === "object" ? details : {};
    }
  }

  function fail(code, message, details) {
    throw new AifxExportError(code, message, details);
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : Number.NaN;
  }

  function resolveTemplateResource(dependencies) {
    const resource = dependencies?.templateResource || root?.NovaFlowAifxTemplateResource;
    if (
      !resource
      || typeof resource.createSpriteSheetPlan !== "function"
      || typeof resource.packFrames !== "function"
    ) {
      fail(
        "AIFX_EXPORT_TEMPLATE_RESOURCE_UNAVAILABLE",
        "NovaFlowAifxTemplateResource is required to build a real single-page atlas.",
      );
    }
    return resource;
  }

  function resolveCanvasDependencies(dependencies) {
    return dependencies?.canvas || dependencies;
  }

  function validatePromptHash(value) {
    const hash = clean(value).toLowerCase();
    if (!SHA256_RE.test(hash)) {
      fail("AIFX_EXPORT_PROMPT_HASH_INVALID", "promptHash must be a 64-character SHA-256 hex digest.", {
        value,
      });
    }
    return hash;
  }

  async function sha256Text(value, dependencies) {
    if (typeof dependencies?.hashText === "function") {
      return validatePromptHash(await dependencies.hashText(String(value ?? "")));
    }
    const subtle = dependencies?.crypto?.subtle || root?.crypto?.subtle;
    const Encoder = dependencies?.TextEncoder || root?.TextEncoder;
    if (!subtle || typeof subtle.digest !== "function" || typeof Encoder !== "function") {
      fail(
        "AIFX_EXPORT_HASH_UNAVAILABLE",
        "WebCrypto and TextEncoder are unavailable. Inject hashText(prompt) or provide promptHash.",
      );
    }
    const bytes = new Encoder().encode(String(value ?? ""));
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function normalizeGenerationMetadata(input) {
    const provider = clean(input?.provider).toLowerCase();
    const model = clean(input?.model);
    const promptHash = validatePromptHash(input?.promptHash);
    if (!provider) fail("AIFX_EXPORT_PROVIDER_REQUIRED", "Final AIFX metadata requires a provider.");
    if (!model) fail("AIFX_EXPORT_MODEL_REQUIRED", "Final AIFX metadata requires a model identifier.");
    return Object.freeze({ provider, model, promptHash });
  }

  function optionalTraceString(value, field, lowerCase) {
    if (value === undefined || value === null || value === "") return undefined;
    let output = "";
    try {
      output = String(value).trim();
    } catch (cause) {
      fail("AIFX_EXPORT_TRACE_METADATA_INVALID", `${field} cannot be converted to text.`, { field, cause });
    }
    if (!output) return undefined;
    if (output.length > TRACE_STRING_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(output)) {
      fail("AIFX_EXPORT_TRACE_METADATA_INVALID", `${field} contains unsafe or excessive text.`, {
        field,
        length: output.length,
      });
    }
    return lowerCase ? output.toLowerCase() : output;
  }

  function traceNumber(value, field) {
    let number = Number.NaN;
    try {
      number = Number(value);
    } catch (cause) {
      fail("AIFX_EXPORT_TRACE_METADATA_INVALID", `${field} cannot be converted to a number.`, { field, cause });
    }
    return number;
  }

  function finiteTraceNumber(value, field, minimum, maximum, digits) {
    const number = traceNumber(value, field);
    if (!Number.isFinite(number)) {
      fail("AIFX_EXPORT_TRACE_METADATA_INVALID", `${field} must be a finite number.`, { field, value });
    }
    const clamped = Math.max(minimum, Math.min(maximum, number));
    return Number(clamped.toFixed(digits));
  }

  function normalizeDirectionDegrees(value, field) {
    const number = traceNumber(value, field);
    if (!Number.isFinite(number)) {
      fail("AIFX_EXPORT_TRACE_METADATA_INVALID", `${field} must be a finite number.`, { field, value });
    }
    const normalized = ((number % 360) + 540) % 360 - 180;
    return Number(normalized.toFixed(3));
  }

  function normalizeSequencePlan(value, frameCount) {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || value.length !== frameCount) {
      fail("AIFX_EXPORT_SEQUENCE_PLAN_INVALID", "sequencePlan must contain exactly one entry per exported frame.", {
        frameCount,
        sequencePlanLength: Array.isArray(value) ? value.length : null,
      });
    }
    const byIndex = new Map();
    value.forEach((entry, position) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        fail("AIFX_EXPORT_SEQUENCE_PLAN_INVALID", `sequencePlan[${position}] must be an object.`);
      }
      const index = entry.index === undefined ? position : traceNumber(entry.index, `sequencePlan[${position}].index`);
      if (!Number.isInteger(index) || index < 0 || index >= frameCount || byIndex.has(index)) {
        fail("AIFX_EXPORT_SEQUENCE_PLAN_INVALID", `sequencePlan[${position}] has an invalid or duplicate index.`, {
          position,
          index,
        });
      }
      const phase = optionalTraceString(entry.phase, `sequencePlan[${position}].phase`, true);
      if (!phase || !SEQUENCE_PHASES.includes(phase)) {
        fail("AIFX_EXPORT_SEQUENCE_PLAN_INVALID", `sequencePlan[${position}] has an unsupported phase.`, {
          position,
          phase,
        });
      }
      byIndex.set(index, Object.freeze({
        index,
        phase,
        energy: finiteTraceNumber(entry.energy, `sequencePlan[${position}].energy`, 0, 1, 4),
        centerX: finiteTraceNumber(entry.centerX, `sequencePlan[${position}].centerX`, 0, 1, 4),
        centerY: finiteTraceNumber(entry.centerY, `sequencePlan[${position}].centerY`, 0, 1, 4),
        directionDeg: normalizeDirectionDegrees(entry.directionDeg, `sequencePlan[${position}].directionDeg`),
        occupancy: finiteTraceNumber(entry.occupancy, `sequencePlan[${position}].occupancy`, 0, 1, 4),
      }));
    });
    const normalized = Array.from({ length: frameCount }, (_entry, index) => byIndex.get(index));
    const phaseRanks = new Map(SEQUENCE_PHASES.map((phase, index) => [phase, index]));
    for (let index = 1; index < normalized.length; index += 1) {
      if (phaseRanks.get(normalized[index].phase) < phaseRanks.get(normalized[index - 1].phase)) {
        fail("AIFX_EXPORT_SEQUENCE_PLAN_INVALID", "sequencePlan phases must progress chronologically.", { index });
      }
    }
    return Object.freeze(normalized);
  }

  function optionalFiniteSummaryNumber(value) {
    let number = Number.NaN;
    try {
      number = Number(value);
    } catch (_cause) {
      return undefined;
    }
    return Number.isFinite(number) ? Number(number.toFixed(6)) : undefined;
  }

  function optionalPositiveTraceInteger(value) {
    const number = optionalFiniteSummaryNumber(value);
    return Number.isInteger(number) && number > 0 ? number : Number.NaN;
  }

  function qualityCodes(value) {
    if (!Array.isArray(value)) return undefined;
    const codes = [];
    const seen = new Set();
    for (const entry of value.slice(0, 64)) {
      const code = optionalTraceString(
        entry && typeof entry === "object" ? entry.code : entry,
        "sequenceQuality.code",
        false,
      );
      if (!code || seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
    }
    return codes.length ? Object.freeze(codes) : Object.freeze([]);
  }

  function normalizeSequenceQuality(value) {
    if (value === undefined || value === null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("AIFX_EXPORT_SEQUENCE_QUALITY_INVALID", "sequenceQuality must be an object.");
    }
    const diagnostics = value.diagnostics && typeof value.diagnostics === "object" && !Array.isArray(value.diagnostics)
      ? value.diagnostics
      : value;
    const output = {};
    const version = optionalTraceString(value.version ?? diagnostics.version, "sequenceQuality.version", false);
    const code = optionalTraceString(value.code, "sequenceQuality.code", false);
    if (version !== undefined) output.version = version;
    if (typeof value.passed === "boolean") output.passed = value.passed;
    if (code !== undefined) output.code = code;
    const failureCodes = qualityCodes(value.failureCodes ?? value.failures);
    const warningCodes = qualityCodes(value.warningCodes ?? value.warnings);
    if (failureCodes !== undefined) output.failureCodes = failureCodes;
    if (warningCodes !== undefined) output.warningCodes = warningCodes;
    const frameCount = optionalPositiveTraceInteger(diagnostics.frameCount);
    const width = optionalPositiveTraceInteger(diagnostics.width);
    const height = optionalPositiveTraceInteger(diagnostics.height);
    if (Number.isInteger(frameCount)) output.frameCount = frameCount;
    if (Number.isInteger(width)) output.width = width;
    if (Number.isInteger(height)) output.height = height;
    for (const metric of SEQUENCE_QUALITY_METRICS) {
      const number = optionalFiniteSummaryNumber(diagnostics[metric]);
      if (number !== undefined) output[metric] = number;
    }
    return Object.freeze(output);
  }

  function normalizeControlGuidance(value) {
    if (value === undefined || value === null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("AIFX_EXPORT_CONTROL_GUIDANCE_INVALID", "controlGuidance must be an object.");
    }
    const output = {};
    for (const field of ["type", "source", "guideType", "controlType", "mode"]) {
      const text = optionalTraceString(value[field], `controlGuidance.${field}`, false);
      if (text !== undefined) output[field] = text;
    }
    for (const field of ["strength", "startPercent", "endPercent", "conditioningStrength"]) {
      if (value[field] === undefined || value[field] === null) continue;
      output[field] = finiteTraceNumber(value[field], `controlGuidance.${field}`, 0, 1, 4);
    }
    if (typeof value.enabled === "boolean") output.enabled = value.enabled;
    return Object.freeze(output);
  }

  function temporalCorrectionFail(message, details) {
    fail("AIFX_EXPORT_TEMPORAL_CORRECTION_INVALID", message, details);
  }

  function temporalTraceString(value, field, lowerCase) {
    try {
      return optionalTraceString(value, field, lowerCase);
    } catch (error) {
      if (error?.code !== "AIFX_EXPORT_TRACE_METADATA_INVALID") throw error;
      temporalCorrectionFail(error.message, { field });
    }
  }

  function temporalFiniteTraceNumber(value, field, minimum, maximum, digits) {
    let number = Number.NaN;
    try {
      number = Number(value);
    } catch (_cause) {
      temporalCorrectionFail(`${field} cannot be converted to a number.`, { field });
    }
    if (!Number.isFinite(number)) temporalCorrectionFail(`${field} must be a finite number.`, { field, value });
    const clamped = Math.max(minimum, Math.min(maximum, number));
    return Number(clamped.toFixed(digits));
  }

  function temporalTraceInteger(value, field, minimum, maximum, optional) {
    if ((value === undefined || value === null) && optional) return undefined;
    let number = Number.NaN;
    try {
      number = Number(value);
    } catch (_cause) {
      temporalCorrectionFail(`${field} cannot be converted to an integer.`, { field });
    }
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
      temporalCorrectionFail(`${field} must be a safe integer between ${minimum} and ${maximum}.`, {
        field,
        value,
      });
    }
    return number;
  }

  function normalizeTemporalRole(value, field) {
    const role = temporalTraceString(value, field, true);
    if (!role || !["onset", "peak", "decay", "breakup", "dissipation"].includes(role)) {
      temporalCorrectionFail(`${field} must be a supported lifecycle anchor role.`, { field, role });
    }
    return role;
  }

  function normalizeTemporalAnchor(value, position, frameCount) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      temporalCorrectionFail(`temporalCorrection.anchors[${position}] must be an object.`);
    }
    const field = `temporalCorrection.anchors[${position}]`;
    const role = normalizeTemporalRole(value.role, `${field}.role`);
    const phase = temporalTraceString(value.phase, `${field}.phase`, true);
    if (!phase || !SEQUENCE_PHASES.includes(phase)) {
      temporalCorrectionFail(`${field}.phase is unsupported.`, { phase });
    }
    const output = {
      role,
      candidateIndex: temporalTraceInteger(value.candidateIndex, `${field}.candidateIndex`, 0, frameCount - 1, false),
      sourceIndex: temporalTraceInteger(value.sourceIndex, `${field}.sourceIndex`, 0, Number.MAX_SAFE_INTEGER, false),
      globalIndex: temporalTraceInteger(value.globalIndex, `${field}.globalIndex`, 0, Number.MAX_SAFE_INTEGER, false),
      outputIndex: temporalTraceInteger(value.outputIndex, `${field}.outputIndex`, 0, frameCount - 1, false),
      phase,
      compatibilityToPeak: temporalFiniteTraceNumber(value.compatibilityToPeak, `${field}.compatibilityToPeak`, 0, 1, 6),
      areaRatio: temporalFiniteTraceNumber(value.areaRatio, `${field}.areaRatio`, 0, 1, 6),
      alphaMassRatio: temporalFiniteTraceNumber(value.alphaMassRatio, `${field}.alphaMassRatio`, 0, 1, 6),
      requiredScale: temporalFiniteTraceNumber(value.requiredScale, `${field}.requiredScale`, 0.01, 8, 6),
      maximumEdgeSideCoverage: temporalFiniteTraceNumber(
        value.maximumEdgeSideCoverage,
        `${field}.maximumEdgeSideCoverage`,
        0,
        1,
        6,
      ),
    };
    const timelineIndex = temporalTraceInteger(
      value.timelineIndex,
      `${field}.timelineIndex`,
      0,
      frameCount - 1,
      true,
    );
    if (timelineIndex !== undefined) output.timelineIndex = timelineIndex;
    if (typeof value.boundaryClipped !== "boolean") {
      temporalCorrectionFail(`${field}.boundaryClipped must be boolean.`);
    }
    output.boundaryClipped = value.boundaryClipped;
    return Object.freeze(output);
  }

  function normalizeTemporalBlend(value, transformIndex, frameCount) {
    const field = `temporalCorrection.transforms[${transformIndex}].blend`;
    if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
      temporalCorrectionFail(`${field} must contain one or two adjacent AI anchor contributions.`);
    }
    const normalized = value.map((entry, position) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        temporalCorrectionFail(`${field}[${position}] must be an object.`);
      }
      const entryField = `${field}[${position}]`;
      return Object.freeze({
        candidateIndex: temporalTraceInteger(entry.candidateIndex, `${entryField}.candidateIndex`, 0, frameCount - 1, false),
        sourceIndex: temporalTraceInteger(entry.sourceIndex, `${entryField}.sourceIndex`, 0, Number.MAX_SAFE_INTEGER, false),
        globalIndex: temporalTraceInteger(entry.globalIndex, `${entryField}.globalIndex`, 0, Number.MAX_SAFE_INTEGER, false),
        anchorRole: normalizeTemporalRole(entry.anchorRole, `${entryField}.anchorRole`),
        weight: temporalFiniteTraceNumber(entry.weight, `${entryField}.weight`, 0, 1, 6),
      });
    });
    const weightSum = normalized.reduce((sum, entry) => sum + entry.weight, 0);
    if (Math.abs(weightSum - 1) > 0.001) {
      temporalCorrectionFail(`${field} weights must sum to one.`, { weightSum });
    }
    return Object.freeze(normalized);
  }

  function optionalTemporalMetric(value, field, minimum, maximum) {
    if (value === undefined || value === null) return undefined;
    return temporalFiniteTraceNumber(value, field, minimum, maximum, 6);
  }

  function normalizeTemporalTransform(value, position, frameCount) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      temporalCorrectionFail(`temporalCorrection.transforms[${position}] must be an object.`);
    }
    const field = `temporalCorrection.transforms[${position}]`;
    const index = temporalTraceInteger(value.index ?? position, `${field}.index`, 0, frameCount - 1, false);
    if (index !== position) {
      temporalCorrectionFail(`${field}.index must preserve chronological output order.`, { index, position });
    }
    const blend = normalizeTemporalBlend(value.blend, position, frameCount);
    const output = {
      index,
      candidateIndices: Object.freeze(blend.map((entry) => entry.candidateIndex)),
      sourceIndices: Object.freeze(blend.map((entry) => entry.sourceIndex)),
      globalIndices: Object.freeze(blend.map((entry) => entry.globalIndex)),
      blend,
      scale: temporalFiniteTraceNumber(value.scale, `${field}.scale`, 0.01, 8, 6),
      dx: temporalFiniteTraceNumber(value.dx, `${field}.dx`, -1000000, 1000000, 6),
      dy: temporalFiniteTraceNumber(value.dy, `${field}.dy`, -1000000, 1000000, 6),
      alphaGain: temporalFiniteTraceNumber(value.alphaGain, `${field}.alphaGain`, 0, 1, 6),
    };
    for (const [metric, minimum, maximum] of [
      ["rotationDeg", -90, 90],
      ["sourceDirectionDeg", -1000000, 1000000],
      ["targetDirectionDeg", -1000000, 1000000],
      ["outputDirectionDeg", -1000000, 1000000],
      ["residualDirectionDeg", 0, 90],
      ["directionAnisotropy", 0, 1],
    ]) {
      const normalized = optionalTemporalMetric(value[metric], `${field}.${metric}`, minimum, maximum);
      if (normalized !== undefined) output[metric] = normalized;
    }
    if (value.rotationUsed !== undefined && typeof value.rotationUsed !== "boolean") {
      temporalCorrectionFail(`${field}.rotationUsed must be boolean.`);
    }
    output.rotationUsed = value.rotationUsed === true;
    for (const [metric, minimum, maximum] of [
      ["sourceAreaRatio", 0, 1],
      ["targetOccupancy", 0, 1],
      ["requestedTargetOccupancy", 0, 1],
      ["outputAreaRatio", 0, 1],
      ["occupancyError", 0, 1],
      ["centerErrorPx", 0, 1000000],
      ["retainedAlphaMassRatio", 0, 1],
    ]) {
      const normalized = optionalTemporalMetric(value[metric], `${field}.${metric}`, minimum, maximum);
      if (normalized !== undefined) output[metric] = normalized;
    }
    const iterations = temporalTraceInteger(value.iterations, `${field}.iterations`, 1, 100, true);
    if (iterations !== undefined) output.iterations = iterations;
    if (typeof value.converged === "boolean") output.converged = value.converged;
    return Object.freeze(output);
  }

  function normalizePeakDominance(value, plannedPeakIndex, frameCount) {
    if (value === undefined || value === null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      temporalCorrectionFail("temporalCorrection.peakDominance must be an object.");
    }
    const field = "temporalCorrection.peakDominance";
    if (typeof value.enforced !== "boolean") {
      temporalCorrectionFail(`${field}.enforced must be boolean.`);
    }
    const recordedPeakIndex = temporalTraceInteger(
      value.plannedPeakIndex,
      `${field}.plannedPeakIndex`,
      0,
      frameCount - 1,
      false,
    );
    if (recordedPeakIndex !== plannedPeakIndex) {
      temporalCorrectionFail(`${field}.plannedPeakIndex must match temporalCorrection.plannedPeakIndex.`);
    }
    const plannedPeakArea = temporalFiniteTraceNumber(
      value.plannedPeakArea,
      `${field}.plannedPeakArea`,
      0,
      1,
      6,
    );
    const maximumNonPeakArea = temporalFiniteTraceNumber(
      value.maximumNonPeakArea,
      `${field}.maximumNonPeakArea`,
      0,
      1,
      6,
    );
    const margin = temporalFiniteTraceNumber(value.margin, `${field}.margin`, -1, 1, 6);
    if (value.enforced && (plannedPeakArea <= maximumNonPeakArea || margin <= 0)) {
      temporalCorrectionFail(`${field} must prove a positive planned-peak area margin.`);
    }
    return Object.freeze({
      enforced: value.enforced,
      plannedPeakIndex: recordedPeakIndex,
      plannedPeakArea,
      maximumNonPeakArea,
      margin,
    });
  }

  function normalizeTemporalCorrection(value, frameCount) {
    if (value === undefined || value === null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      temporalCorrectionFail("temporalCorrection must be an object.");
    }
    const anchorsValue = value.anchors;
    const transformsValue = value.transforms;
    if (!Array.isArray(anchorsValue) || anchorsValue.length < 1 || anchorsValue.length > 4) {
      temporalCorrectionFail("temporalCorrection.anchors must contain between one and four AI anchors.");
    }
    if (!Array.isArray(transformsValue) || transformsValue.length !== frameCount) {
      temporalCorrectionFail("temporalCorrection.transforms must contain exactly one trace per exported frame.", {
        frameCount,
        transformCount: Array.isArray(transformsValue) ? transformsValue.length : null,
      });
    }
    const anchors = Object.freeze(anchorsValue.map((entry, index) => normalizeTemporalAnchor(entry, index, frameCount)));
    const roles = new Set();
    for (const anchor of anchors) {
      if (roles.has(anchor.role)) temporalCorrectionFail(`temporalCorrection anchor role ${anchor.role} is duplicated.`);
      roles.add(anchor.role);
    }
    if (!roles.has("peak")) temporalCorrectionFail("temporalCorrection must contain a peak AI anchor.");
    const transforms = Object.freeze(
      transformsValue.map((entry, index) => normalizeTemporalTransform(entry, index, frameCount)),
    );
    const output = {};
    for (const field of ["schemaVersion", "mode", "trigger", "anchorInputMode"]) {
      const text = temporalTraceString(value[field], `temporalCorrection.${field}`, false);
      if (text !== undefined) output[field] = text;
    }
    const attempt = temporalTraceInteger(value.attempt, "temporalCorrection.attempt", 1, 1000, true);
    if (attempt !== undefined) output.attempt = attempt;
    for (const field of ["templatePixelsUsed", "templateMaskUsed", "nonUniformDeformationUsed"]) {
      if (value[field] !== undefined && typeof value[field] !== "boolean") {
        temporalCorrectionFail(`temporalCorrection.${field} must be boolean.`);
      }
      if (value[field] === true) {
        temporalCorrectionFail(`temporalCorrection.${field} must remain false for safe AI-only affine output.`);
      }
      output[field] = false;
    }
    if (value.rotationUsed !== undefined && typeof value.rotationUsed !== "boolean") {
      temporalCorrectionFail("temporalCorrection.rotationUsed must be boolean.");
    }
    output.rotationUsed = value.rotationUsed === true;
    output.adjacentBlendUsed = transforms.some((entry) => entry.blend.length > 1);
    output.anchorCount = anchors.length;
    output.plannedPeakIndex = temporalTraceInteger(
      value.plannedPeakIndex,
      "temporalCorrection.plannedPeakIndex",
      0,
      frameCount - 1,
      false,
    );
    const peakDominance = normalizePeakDominance(value.peakDominance, output.plannedPeakIndex, frameCount);
    if (peakDominance !== undefined) output.peakDominance = peakDominance;
    for (const field of [
      "generatedPeakIndex",
      "generatedPeakCandidateIndex",
      "generatedPeakSourceIndex",
      "generatedPeakGlobalIndex",
    ]) {
      const number = temporalTraceInteger(value[field], `temporalCorrection.${field}`, 0, Number.MAX_SAFE_INTEGER, true);
      if (number !== undefined) output[field] = number;
    }
    output.anchors = anchors;
    output.candidateIndices = Object.freeze(transforms.map((entry) => entry.candidateIndices));
    output.sourceIndices = Object.freeze(transforms.map((entry) => entry.sourceIndices));
    output.globalIndices = Object.freeze(transforms.map((entry) => entry.globalIndices));
    output.transforms = transforms;
    output.converged = transforms.every((entry) => entry.converged !== false);
    return Object.freeze(output);
  }

  function normalizeStructureTransfer(value, frameCount) {
    if (value === undefined || value === null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("AIFX_EXPORT_STRUCTURE_TRANSFER_INVALID", "structureTransfer must be an object.");
    }
    const transferFrameCount = Number(value.frameCount);
    if (!Number.isSafeInteger(transferFrameCount) || transferFrameCount !== frameCount) {
      fail("AIFX_EXPORT_STRUCTURE_TRANSFER_INVALID", "structureTransfer.frameCount must match the exported sequence.", {
        frameCount,
        transferFrameCount,
      });
    }
    const output = { frameCount };
    for (const field of [
      "schemaVersion",
      "sourceMode",
      "materialType",
      "temporalNoise",
      "macroConstraint",
      "highFrequencyTopology",
    ]) {
      const text = optionalTraceString(value[field], `structureTransfer.${field}`, false);
      if (text !== undefined) output[field] = text;
    }
    const seed = Number(value.seed);
    if (!Number.isSafeInteger(seed) || seed < 0) {
      fail("AIFX_EXPORT_STRUCTURE_TRANSFER_INVALID", "structureTransfer.seed must be a non-negative safe integer.", { seed: value.seed });
    }
    output.seed = seed;
    for (const field of [
      "styleStrength",
      "contourVariation",
      "exactStencilFrameRatio",
      "minimumMacroIou",
      "meanMacroIou",
    ]) {
      const number = optionalFiniteSummaryNumber(value[field]);
      if (number === undefined || number < 0 || number > 1) {
        fail("AIFX_EXPORT_STRUCTURE_TRANSFER_INVALID", `structureTransfer.${field} must be between zero and one.`, {
          field,
          value: value[field],
        });
      }
      output[field] = number;
    }
    for (const field of ["samePeakAffineReuse", "uniformScaleOnly"]) {
      if (typeof value[field] !== "boolean") {
        fail("AIFX_EXPORT_STRUCTURE_TRANSFER_INVALID", `structureTransfer.${field} must be boolean.`, { field });
      }
      if (value[field]) {
        fail("AIFX_EXPORT_STRUCTURE_TRANSFER_INVALID", `structureTransfer.${field} must remain false for per-frame structure materialization.`, { field });
      }
      output[field] = false;
    }
    if (!Array.isArray(value.featureChannels) || !value.featureChannels.length || value.featureChannels.length > 32) {
      fail("AIFX_EXPORT_STRUCTURE_TRANSFER_INVALID", "structureTransfer.featureChannels must contain between one and 32 entries.");
    }
    output.featureChannels = Object.freeze(value.featureChannels.map((entry, index) => (
      optionalTraceString(entry, `structureTransfer.featureChannels[${index}]`, false)
    )));
    if (!Array.isArray(value.frames) || value.frames.length !== frameCount) {
      fail("AIFX_EXPORT_STRUCTURE_TRANSFER_INVALID", "structureTransfer.frames must contain one trace per exported frame.", {
        frameCount,
        traceFrameCount: Array.isArray(value.frames) ? value.frames.length : null,
      });
    }
    output.frames = Object.freeze(value.frames.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Number(entry.sourceFrameIndex) !== index) {
        fail("AIFX_EXPORT_STRUCTURE_TRANSFER_INVALID", "structureTransfer frame traces must preserve chronological source-frame order.", {
          index,
          sourceFrameIndex: entry?.sourceFrameIndex,
        });
      }
      const trace = { sourceFrameIndex: index };
      for (const field of ["occupancy", "energy", "macroIou", "outputOccupancy"]) {
        const number = optionalFiniteSummaryNumber(entry[field]);
        if (number !== undefined) trace[field] = number;
      }
      for (const field of ["componentCount", "fragmentCount"]) {
        const number = Number(entry[field]);
        if (Number.isSafeInteger(number) && number >= 0) trace[field] = number;
      }
      const directionDeg = optionalFiniteSummaryNumber(entry.directionDeg);
      if (directionDeg !== undefined) trace.directionDeg = directionDeg;
      if (typeof entry.exactMask === "boolean") trace.exactMask = entry.exactMask;
      return Object.freeze(trace);
    }));
    return Object.freeze(output);
  }

  function normalizeTraceability(input, frameCount) {
    const materialType = optionalTraceString(input?.materialType, "materialType", true);
    const shapeSource = optionalTraceString(input?.shapeSource, "shapeSource", false);
    const motionConstraint = optionalTraceString(input?.motionConstraint, "motionConstraint", false);
    const sequencePlan = normalizeSequencePlan(input?.sequencePlan, frameCount);
    const sequenceQuality = normalizeSequenceQuality(input?.sequenceQuality);
    const controlGuidance = normalizeControlGuidance(input?.controlGuidance);
    const temporalCorrection = normalizeTemporalCorrection(input?.temporalCorrection, frameCount);
    const structureTransfer = normalizeStructureTransfer(input?.structureTransfer, frameCount);
    if (temporalCorrection !== undefined && structureTransfer !== undefined) {
      fail("AIFX_EXPORT_TRACE_MODE_CONFLICT", "temporalCorrection and structureTransfer are mutually exclusive sequence synthesis modes.");
    }
    const output = {};
    if (materialType !== undefined) output.materialType = materialType;
    if (sequencePlan !== undefined) output.sequencePlan = sequencePlan;
    if (sequenceQuality !== undefined) output.sequenceQuality = sequenceQuality;
    if (shapeSource !== undefined) output.shapeSource = shapeSource;
    if (motionConstraint !== undefined) output.motionConstraint = motionConstraint;
    if (controlGuidance !== undefined) output.controlGuidance = controlGuidance;
    if (temporalCorrection !== undefined) output.temporalCorrection = temporalCorrection;
    if (structureTransfer !== undefined) output.structureTransfer = structureTransfer;
    return Object.freeze(output);
  }

  function assertReadyRgbaFrames(inputFrames) {
    if (!Array.isArray(inputFrames) || !inputFrames.length) {
      fail("AIFX_EXPORT_FRAMES_REQUIRED", "At least one processed RGBA frame is required.");
    }
    const frames = inputFrames.slice().sort((left, right) => Number(left?.index) - Number(right?.index));
    const expectedWidth = positiveInteger(frames[0]?.width);
    const expectedHeight = positiveInteger(frames[0]?.height);
    const names = new Set();
    frames.forEach((frame, index) => {
      if (!frame || typeof frame !== "object" || Number(frame.index) !== index) {
        fail("AIFX_EXPORT_FRAME_ORDER_INVALID", "Processed frames must have contiguous zero-based indices.", {
          expected: index,
          actual: frame?.index,
        });
      }
      const name = clean(frame.name);
      if (!name) fail("AIFX_EXPORT_FRAME_NAME_REQUIRED", `Processed frame ${index} has no name.`);
      const nameKey = name.toLocaleLowerCase();
      if (names.has(nameKey)) {
        fail("AIFX_EXPORT_DUPLICATE_FRAME_NAME", `Duplicate processed frame name: ${name}.`, { name });
      }
      names.add(nameKey);
      const width = positiveInteger(frame.width);
      const height = positiveInteger(frame.height);
      if (width !== expectedWidth || height !== expectedHeight) {
        fail("AIFX_EXPORT_MIXED_FRAME_SIZE", "Processed frames must have identical pixel dimensions.", {
          index,
          expected: { width: expectedWidth, height: expectedHeight },
          actual: { width, height },
        });
      }
      if (frame.pixelFormat && clean(frame.pixelFormat).toLowerCase() !== "rgba8") {
        fail("AIFX_EXPORT_PIXEL_FORMAT_INVALID", "Final AIFX frames must use rgba8 pixels.", {
          index,
          pixelFormat: frame.pixelFormat,
        });
      }
      if (frame.alphaMode && clean(frame.alphaMode).toLowerCase() !== "straight") {
        fail("AIFX_EXPORT_ALPHA_MODE_INVALID", "Final AIFX frames must use straight alpha.", {
          index,
          alphaMode: frame.alphaMode,
        });
      }
      if (typeof frame.dataUrl !== "string" || !/^data:image\/png(?:;[^,]*)?,/i.test(frame.dataUrl)) {
        fail("AIFX_EXPORT_FRAME_DATA_INVALID", `Processed frame ${index} must be a PNG data URL.`, {
          index,
        });
      }
    });
    return Object.freeze(frames.map((frame) => Object.freeze({
      ...frame,
      name: clean(frame.name),
      width: expectedWidth,
      height: expectedHeight,
      pixelFormat: "rgba8",
      alphaMode: "straight",
    })));
  }

  function atlasRectFor(entry) {
    return Object.freeze({
      x: entry.rect.x,
      y: entry.rect.y,
      width: entry.rect.width,
      height: entry.rect.height,
    });
  }

  function sourceSizeFor(entry) {
    return Object.freeze({
      width: entry.sourceSize.width,
      height: entry.sourceSize.height,
    });
  }

  function validatePlanAgainstFrames(plan, frames) {
    if (
      !plan
      || plan.order !== "row-major"
      || !Array.isArray(plan.frameRects)
      || plan.frameRects.length !== frames.length
      || Number(plan.frameCount) !== frames.length
    ) {
      fail("AIFX_EXPORT_ATLAS_PLAN_INVALID", "Atlas plan does not match the processed frame sequence.");
    }
    plan.frameRects.forEach((entry, index) => {
      const frame = frames[index];
      if (
        entry?.index !== index
        || entry?.name !== frame.name
        || entry?.sourceSize?.width !== frame.width
        || entry?.sourceSize?.height !== frame.height
      ) {
        fail("AIFX_EXPORT_ATLAS_PLAN_INVALID", `Atlas plan entry ${index} is not reversible.`, {
          entry,
          frame: { index, name: frame.name, width: frame.width, height: frame.height },
        });
      }
    });
  }

  function normalizeFps(value) {
    const fps = positiveInteger(value);
    if (!Number.isInteger(fps) || fps > 120) {
      fail("AIFX_EXPORT_FPS_INVALID", "Final AIFX FPS must be an integer between 1 and 120.", { value });
    }
    return fps;
  }

  function buildAtlasMetadata(input) {
    const source = input && typeof input === "object" ? input : {};
    const frames = assertReadyRgbaFrames(source.frames);
    const plan = source.plan;
    validatePlanAgainstFrames(plan, frames);
    const fps = normalizeFps(source.fps ?? plan.fps);
    const generation = normalizeGenerationMetadata(source);
    const frameMap = {};
    const sequence = [];
    plan.frameRects.forEach((entry, index) => {
      const frame = frames[index];
      const rect = atlasRectFor(entry);
      const sourceSize = sourceSizeFor(entry);
      frameMap[frame.name] = Object.freeze({
        index,
        rect,
        frame: Object.freeze({ x: rect.x, y: rect.y, w: rect.width, h: rect.height }),
        rotated: false,
        trimmed: false,
        spriteSourceSize: Object.freeze({ x: 0, y: 0, w: sourceSize.width, h: sourceSize.height }),
        sourceSize,
        durationMs: 1000 / fps,
      });
      sequence.push(frame.name);
    });

    return Object.freeze({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      image: "atlas.png",
      imageCount: 1,
      format: "RGBA8888",
      pixelFormat: "rgba8",
      alphaMode: "straight",
      size: Object.freeze({ width: plan.sheetSize.width, height: plan.sheetSize.height }),
      frameCount: frames.length,
      fps,
      lifecycle: source.lifecycle || plan.lifecycle,
      provider: generation.provider,
      model: generation.model,
      promptHash: generation.promptHash,
      order: "row-major",
      columns: plan.columns,
      rows: plan.rows,
      gutter: plan.gutter,
      padding: plan.padding,
      contentRect: Object.freeze({ ...plan.contentRect }),
      unusedCells: Object.freeze((plan.unusedCells || []).map((cell) => Object.freeze({
        cellIndex: cell.cellIndex,
        column: cell.column,
        row: cell.row,
        rect: atlasRectFor(cell),
      }))),
      sequence: Object.freeze(sequence),
      frames: Object.freeze(frameMap),
    });
  }

  function buildGenerationManifest(input) {
    const source = input && typeof input === "object" ? input : {};
    const frames = assertReadyRgbaFrames(source.frames);
    const plan = source.plan;
    validatePlanAgainstFrames(plan, frames);
    const fps = normalizeFps(source.fps ?? plan.fps);
    const generation = normalizeGenerationMetadata(source);
    const lifecycle = source.lifecycle || plan.lifecycle;
    const traceability = normalizeTraceability(source, frames.length);
    return Object.freeze({
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      assetType: "vfx-sequence",
      frameCount: frames.length,
      fps,
      lifecycle,
      pixelFormat: "rgba8",
      alphaMode: "straight",
      provider: generation.provider,
      model: generation.model,
      promptHash: generation.promptHash,
      generation: Object.freeze({ ...generation }),
      ...traceability,
      outputs: Object.freeze({
        atlas: Object.freeze({
          file: "atlas.png",
          metadataFile: "atlas.json",
          imageCount: 1,
          width: plan.sheetSize.width,
          height: plan.sheetSize.height,
          order: "row-major",
          columns: plan.columns,
          rows: plan.rows,
          gutter: plan.gutter,
          padding: plan.padding,
        }),
        frameDirectory: "frames",
        frameFiles: Object.freeze(frames.map((frame, index) => {
          const entry = plan.frameRects[index];
          return Object.freeze({
            index,
            file: `frames/${frame.name}`,
            atlasRect: atlasRectFor(entry),
            sourceSize: sourceSizeFor(entry),
            durationMs: 1000 / fps,
          });
        })),
      }),
    });
  }

  function stableJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  function normalizeZipEntryName(value) {
    const original = clean(value);
    const name = original.replace(/\\/g, "/");
    const parts = name.split("/");
    if (
      !name
      || name.startsWith("/")
      || /^[a-z]:/i.test(name)
      || parts.some((part) => !part || part === "." || part === "..")
      || /[\u0000-\u001f\u007f]/.test(name)
    ) {
      fail("AIFX_EXPORT_ZIP_ENTRY_INVALID", `Invalid browser ZIP entry name: ${original || "(empty)"}.`, {
        name: original,
      });
    }
    return name;
  }

  function normalizeZipFileName(value) {
    let name = clean(value) || "NovaFlow_AIFX_Final.zip";
    name = name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, "_");
    if (!/\.zip$/i.test(name)) name += ".zip";
    return name;
  }

  function utf8ByteLength(value) {
    const text = String(value ?? "");
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function isWhitespaceCode(code) {
    return (
      (code >= 0x0009 && code <= 0x000d)
      || code === 0x0020
      || code === 0x00a0
      || code === 0x1680
      || (code >= 0x2000 && code <= 0x200a)
      || code === 0x2028
      || code === 0x2029
      || code === 0x202f
      || code === 0x205f
      || code === 0x3000
      || code === 0xfeff
    );
  }

  function inspectBase64DataUrl(dataUrl, entryName) {
    const original = String(dataUrl || "");
    const value = original.trim();
    const match = value.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]+)$/i);
    if (!match) {
      fail("AIFX_EXPORT_ZIP_DATA_INVALID", `ZIP entry ${entryName} must use a base64 data URL.`, {
        entryName,
      });
    }
    const payload = match[2];
    let base64Characters = 0;
    let last = "";
    let previous = "";
    for (let index = 0; index < payload.length; index += 1) {
      const character = payload[index];
      if (isWhitespaceCode(payload.charCodeAt(index))) continue;
      base64Characters += 1;
      previous = last;
      last = character;
    }
    const padding = last === "=" ? (previous === "=" ? 2 : 1) : 0;
    const decodedBytes = Math.max(0, Math.floor((base64Characters * 3) / 4) - padding);
    return Object.freeze({
      value,
      base64Characters,
      decodedBytes,
      sourceStorageBytes: original.length * 2,
    });
  }

  function resolveBudgetLimit(value, safeMaximum, optionName) {
    if (value === undefined || value === null || value === "") return safeMaximum;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
      fail("AIFX_EXPORT_ZIP_BUDGET_INVALID", `${optionName} must be a positive safe integer.`, {
        optionName,
        value,
      });
    }
    return Math.min(number, safeMaximum);
  }

  function prepareBrowserZipBudget(product, options = {}) {
    const seen = new Set();
    let decodedBytes = 0;
    let textBytes = 0;
    let nameBytes = 0;
    let sourceStorageBytes = 0;
    let base64Characters = 0;
    let largestBase64Characters = 0;
    let largestDecodedEntryBytes = 0;
    let dataUrlEntryCount = 0;
    const sources = browserZipSourceEntries(product).map((source) => {
      const name = normalizeZipEntryName(source.name);
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) {
        fail("AIFX_EXPORT_ZIP_ENTRY_DUPLICATE", `Duplicate browser ZIP entry: ${name}.`, { name });
      }
      seen.add(key);
      const estimatedNameBytes = utf8ByteLength(name);
      if (estimatedNameBytes > ZIP_MAX_UINT16) {
        fail("AIFX_EXPORT_ZIP_ENTRY_INVALID", `Browser ZIP entry name is too long: ${name}.`, { name });
      }
      nameBytes += estimatedNameBytes;
      sourceStorageBytes += name.length * 2;

      if (source.kind === "text") {
        const value = String(source.value ?? "");
        const estimatedBytes = utf8ByteLength(value);
        textBytes += estimatedBytes;
        sourceStorageBytes += value.length * 2;
        return Object.freeze({ source, name, estimatedNameBytes, estimatedBytes, value });
      }

      const inspected = inspectBase64DataUrl(source.value, name);
      decodedBytes += inspected.decodedBytes;
      sourceStorageBytes += inspected.sourceStorageBytes;
      base64Characters += inspected.base64Characters;
      largestBase64Characters = Math.max(largestBase64Characters, inspected.base64Characters);
      largestDecodedEntryBytes = Math.max(largestDecodedEntryBytes, inspected.decodedBytes);
      dataUrlEntryCount += 1;
      return Object.freeze({
        source,
        name,
        estimatedNameBytes,
        estimatedBytes: inspected.decodedBytes,
        value: inspected.value,
      });
    });

    const entryCount = sources.length;
    const entryBytes = decodedBytes + textBytes;
    const zipBytes = entryBytes + entryCount * (30 + 46) + nameBytes * 2 + 22;
    const decodeScratchBytes = largestBase64Characters * 2 + largestDecodedEntryBytes * 2;
    const decodePeakBytes = sourceStorageBytes + entryBytes + decodeScratchBytes;
    const zipAndBlobPeakBytes = sourceStorageBytes + zipBytes * 2;
    const peakBytes = Math.max(decodePeakBytes, zipAndBlobPeakBytes);
    const maxArchiveBytes = resolveBudgetLimit(
      options.archiveBudgetBytes,
      BROWSER_ZIP_MAX_ARCHIVE_BYTES,
      "archiveBudgetBytes",
    );
    const maxPeakBytes = resolveBudgetLimit(
      options.memoryBudgetBytes,
      BROWSER_ZIP_MAX_PEAK_BYTES,
      "memoryBudgetBytes",
    );
    const withinBudget = (
      entryCount <= ZIP_MAX_UINT16
      && zipBytes <= ZIP_MAX_UINT32
      && zipBytes <= maxArchiveBytes
      && peakBytes <= maxPeakBytes
    );
    const budget = Object.freeze({
      schemaVersion: BROWSER_ZIP_BUDGET_SCHEMA_VERSION,
      limits: Object.freeze({
        maxArchiveBytes,
        maxPeakBytes,
        safeMaximumArchiveBytes: BROWSER_ZIP_MAX_ARCHIVE_BYTES,
        safeMaximumPeakBytes: BROWSER_ZIP_MAX_PEAK_BYTES,
      }),
      estimate: Object.freeze({
        entryCount,
        dataUrlEntryCount,
        base64Characters,
        decodedBytes,
        textBytes,
        entryBytes,
        nameBytes,
        zipBytes,
        blobBytes: zipBytes,
        sourceStorageBytes,
        decodeScratchBytes,
        decodePeakBytes,
        zipAndBlobPeakBytes,
        peakBytes,
      }),
      withinBudget,
    });
    return Object.freeze({ sources: Object.freeze(sources), budget });
  }

  function assertBrowserZipBudget(budget) {
    const estimate = budget.estimate;
    const limits = budget.limits;
    if (estimate.entryCount > ZIP_MAX_UINT16 || estimate.zipBytes > ZIP_MAX_UINT32) {
      fail("AIFX_EXPORT_ZIP_TOO_LARGE", "Browser ZIP exceeds the supported non-ZIP64 limits.", {
        budget,
      });
    }
    if (estimate.zipBytes > limits.maxArchiveBytes) {
      fail(
        "AIFX_EXPORT_ZIP_MEMORY_BUDGET_EXCEEDED",
        `Browser ZIP export exceeds the safe archive budget before base64 decoding (${estimate.zipBytes} estimated bytes > ${limits.maxArchiveBytes} bytes).`,
        { reason: "archive-size", budget },
      );
    }
    if (estimate.peakBytes > limits.maxPeakBytes) {
      fail(
        "AIFX_EXPORT_ZIP_MEMORY_BUDGET_EXCEEDED",
        `Browser ZIP export exceeds the safe in-memory budget before base64 decoding (${estimate.peakBytes} estimated peak bytes > ${limits.maxPeakBytes} bytes).`,
        { reason: "peak-memory", budget },
      );
    }
    return budget;
  }

  function resolveTextEncoder(dependencies) {
    const Encoder = dependencies?.TextEncoder || root?.TextEncoder;
    if (typeof Encoder !== "function") {
      fail("AIFX_EXPORT_ZIP_ENCODING_UNAVAILABLE", "TextEncoder is required for browser ZIP export.");
    }
    return new Encoder();
  }

  function decodeBase64DataUrl(dataUrl, dependencies, entryName) {
    const match = clean(dataUrl).match(/^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]+)$/i);
    if (!match) {
      fail("AIFX_EXPORT_ZIP_DATA_INVALID", `ZIP entry ${entryName} must use a base64 data URL.`, {
        entryName,
      });
    }
    const decode = dependencies?.atob || root?.atob;
    if (typeof decode !== "function") {
      fail("AIFX_EXPORT_ZIP_ENCODING_UNAVAILABLE", "atob is required for browser ZIP export.");
    }
    let binary = "";
    try {
      binary = decode(match[2].replace(/\s+/g, ""));
    } catch (cause) {
      fail("AIFX_EXPORT_ZIP_DATA_INVALID", `ZIP entry ${entryName} contains invalid base64 data.`, {
        entryName,
        cause,
      });
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function browserZipSourceEntries(product) {
    const files = product?.files;
    if (
      product?.status !== "ready"
      || !files
      || !Array.isArray(files.frames)
      || !files.frames.length
      || !files.atlas?.dataUrl
      || !files.atlasMetadata?.text
      || !files.generationManifest?.text
    ) {
      fail(
        "AIFX_EXPORT_ZIP_INPUT_INVALID",
        "A completed final AIFX product with frames, atlas, atlas metadata and generation manifest is required.",
      );
    }
    if (positiveInteger(product.frameCount) !== files.frames.length) {
      fail("AIFX_EXPORT_ZIP_INPUT_INVALID", "Browser ZIP frame count does not match the final product.", {
        expected: product.frameCount,
        actual: files.frames.length,
      });
    }
    return [
      ...files.frames.map((file) => ({
        name: file?.name,
        kind: "data-url",
        value: file?.dataUrl,
      })),
      { name: files.atlas.name, kind: "data-url", value: files.atlas.dataUrl },
      { name: files.atlasMetadata.name, kind: "text", value: files.atlasMetadata.text },
      { name: files.generationManifest.name, kind: "text", value: files.generationManifest.text },
    ];
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

  function writeUint16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function concatBytes(parts, totalLength) {
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function buildStoreZip(entries) {
    if (entries.length > ZIP_MAX_UINT16) {
      fail("AIFX_EXPORT_ZIP_TOO_LARGE", "Browser ZIP contains too many entries for the non-ZIP64 exporter.");
    }
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;

    for (const entry of entries) {
      const size = entry.bytes.length;
      if (size > ZIP_MAX_UINT32 || localOffset > ZIP_MAX_UINT32) {
        fail("AIFX_EXPORT_ZIP_TOO_LARGE", "Browser ZIP exceeds the supported 4 GiB non-ZIP64 limit.");
      }
      const checksum = crc32(entry.bytes);
      const localHeader = new Uint8Array(30);
      const localView = new DataView(localHeader.buffer);
      writeUint32(localView, 0, 0x04034b50);
      writeUint16(localView, 4, 20);
      writeUint16(localView, 6, ZIP_UTF8_FLAG);
      writeUint16(localView, 8, ZIP_STORE_METHOD);
      writeUint16(localView, 10, ZIP_DOS_TIME);
      writeUint16(localView, 12, ZIP_DOS_DATE);
      writeUint32(localView, 14, checksum);
      writeUint32(localView, 18, size);
      writeUint32(localView, 22, size);
      writeUint16(localView, 26, entry.nameBytes.length);
      writeUint16(localView, 28, 0);
      localParts.push(localHeader, entry.nameBytes, entry.bytes);

      const centralHeader = new Uint8Array(46);
      const centralView = new DataView(centralHeader.buffer);
      writeUint32(centralView, 0, 0x02014b50);
      writeUint16(centralView, 4, 20);
      writeUint16(centralView, 6, 20);
      writeUint16(centralView, 8, ZIP_UTF8_FLAG);
      writeUint16(centralView, 10, ZIP_STORE_METHOD);
      writeUint16(centralView, 12, ZIP_DOS_TIME);
      writeUint16(centralView, 14, ZIP_DOS_DATE);
      writeUint32(centralView, 16, checksum);
      writeUint32(centralView, 20, size);
      writeUint32(centralView, 24, size);
      writeUint16(centralView, 28, entry.nameBytes.length);
      writeUint16(centralView, 30, 0);
      writeUint16(centralView, 32, 0);
      writeUint16(centralView, 34, 0);
      writeUint16(centralView, 36, 0);
      writeUint32(centralView, 38, 0);
      writeUint32(centralView, 42, localOffset);
      centralParts.push(centralHeader, entry.nameBytes);

      localOffset += localHeader.length + entry.nameBytes.length + size;
      centralSize += centralHeader.length + entry.nameBytes.length;
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, entries.length);
    writeUint16(endView, 10, entries.length);
    writeUint32(endView, 12, centralSize);
    writeUint32(endView, 16, localOffset);
    writeUint16(endView, 20, 0);

    const totalLength = localOffset + centralSize + end.length;
    if (totalLength > ZIP_MAX_UINT32) {
      fail("AIFX_EXPORT_ZIP_TOO_LARGE", "Browser ZIP exceeds the supported 4 GiB non-ZIP64 limit.");
    }
    return concatBytes([...localParts, ...centralParts, end], totalLength);
  }

  function buildBrowserZip(product, options = {}, dependencies = {}) {
    const prepared = prepareBrowserZipBudget(product, options);
    assertBrowserZipBudget(prepared.budget);
    const encoder = resolveTextEncoder(dependencies);
    const entries = prepared.sources.map((entry) => {
      const { source, name } = entry;
      const nameBytes = encoder.encode(name);
      const bytes = source.kind === "text"
        ? encoder.encode(entry.value)
        : decodeBase64DataUrl(entry.value, dependencies, name);
      if (nameBytes.length !== entry.estimatedNameBytes || bytes.length !== entry.estimatedBytes) {
        fail("AIFX_EXPORT_ZIP_BUDGET_ESTIMATE_MISMATCH", "Browser ZIP byte estimate changed before allocation.", {
          name,
          expected: { nameBytes: entry.estimatedNameBytes, bytes: entry.estimatedBytes },
          actual: { nameBytes: nameBytes.length, bytes: bytes.length },
        });
      }
      return { name, nameBytes, bytes };
    });
    const bytes = buildStoreZip(entries);
    return Object.freeze({
      schemaVersion: BROWSER_ZIP_SCHEMA_VERSION,
      name: normalizeZipFileName(options.fileName),
      mimeType: "application/zip",
      compression: "store",
      entryCount: entries.length,
      entryNames: Object.freeze(entries.map((entry) => entry.name)),
      byteLength: bytes.length,
      budget: prepared.budget,
      bytes,
    });
  }

  function estimateBrowserZipBudget(product, options = {}) {
    return prepareBrowserZipBudget(product, options).budget;
  }

  async function buildFinalProduct(input, dependencies) {
    const source = input && typeof input === "object" ? input : {};
    if (source.status && source.status !== "ready") {
      fail("AIFX_EXPORT_POSTPROCESS_INCOMPLETE", "Only a completed post-process result can be exported.", {
        status: source.status,
      });
    }
    if (source.alphaMode && clean(source.alphaMode).toLowerCase() !== "straight") {
      fail("AIFX_EXPORT_ALPHA_MODE_INVALID", "Final AIFX output requires straight alpha.", {
        alphaMode: source.alphaMode,
      });
    }
    if (source.pixelFormat && clean(source.pixelFormat).toLowerCase() !== "rgba8") {
      fail("AIFX_EXPORT_PIXEL_FORMAT_INVALID", "Final AIFX output requires rgba8 pixels.", {
        pixelFormat: source.pixelFormat,
      });
    }

    const frames = assertReadyRgbaFrames(source.frames);
    const provider = clean(source.provider).toLowerCase();
    const model = clean(source.model);
    if (!provider) fail("AIFX_EXPORT_PROVIDER_REQUIRED", "Final AIFX metadata requires a provider.");
    if (!model) fail("AIFX_EXPORT_MODEL_REQUIRED", "Final AIFX metadata requires a model identifier.");
    const promptHash = source.promptHash
      ? validatePromptHash(source.promptHash)
      : await sha256Text(source.prompt, dependencies);
    const templateResource = resolveTemplateResource(dependencies);
    const fps = normalizeFps(source.fps);
    const lifecycle = source.lifecycle || "one-shot";
    const atlasOptions = source.atlas && typeof source.atlas === "object" ? source.atlas : {};
    const plan = templateResource.createSpriteSheetPlan(frames, {
      columns: atlasOptions.columns,
      gutter: atlasOptions.gutter ?? 2,
      padding: atlasOptions.padding ?? 2,
      maxDimension: atlasOptions.maxDimension,
      fps,
      lifecycle,
    });
    const packed = await templateResource.packFrames(
      frames,
      { plan, background: "transparent" },
      resolveCanvasDependencies(dependencies),
    );
    if (typeof packed?.dataUrl !== "string" || !/^data:image\/png(?:;[^,]*)?,/i.test(packed.dataUrl)) {
      fail("AIFX_EXPORT_ATLAS_DATA_INVALID", "Atlas canvas did not serialize to a PNG data URL.");
    }
    const traceability = normalizeTraceability(source, frames.length);
    const metadataInput = {
      frames,
      plan,
      fps,
      lifecycle: plan.lifecycle,
      provider,
      model,
      promptHash,
      ...traceability,
    };
    const atlasJson = buildAtlasMetadata(metadataInput);
    const manifest = buildGenerationManifest(metadataInput);
    const frameFiles = Object.freeze(frames.map((frame) => Object.freeze({
      name: `frames/${frame.name}`,
      mimeType: "image/png",
      dataUrl: frame.dataUrl,
      index: frame.index,
    })));
    const files = Object.freeze({
      atlas: Object.freeze({
        name: "atlas.png",
        mimeType: "image/png",
        dataUrl: packed.dataUrl,
        width: plan.sheetSize.width,
        height: plan.sheetSize.height,
      }),
      atlasMetadata: Object.freeze({
        name: "atlas.json",
        mimeType: "application/json",
        text: stableJson(atlasJson),
      }),
      generationManifest: Object.freeze({
        name: "generation-manifest.json",
        mimeType: "application/json",
        text: stableJson(manifest),
      }),
      frames: frameFiles,
    });

    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      status: "ready",
      frameCount: frames.length,
      fps,
      lifecycle: plan.lifecycle,
      pixelFormat: "rgba8",
      alphaMode: "straight",
      provider,
      model,
      promptHash,
      ...traceability,
      plan,
      atlasJson,
      manifest,
      files,
    });
  }

  return Object.freeze({
    version: SCHEMA_VERSION,
    AifxExportError,
    validatePromptHash,
    sha256Text,
    assertReadyRgbaFrames,
    buildAtlasMetadata,
    buildGenerationManifest,
    buildFinalProduct,
    buildBrowserZip,
    estimateBrowserZipBudget,
  });
});
