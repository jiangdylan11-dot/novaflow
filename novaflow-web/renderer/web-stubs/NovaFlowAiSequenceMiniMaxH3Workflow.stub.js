// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowAiSequenceMiniMaxH3Workflow.
// UI helpers are kept verbatim; every graph builder is replaced by a
// recorder, so this file contains no ComfyUI topology (asserted by
// tools/generate-workflow-stubs.mjs --check and by the protocol suite).
(function (root) {
  const __record = (module, method, options) => {
    const intent = { __novaflowWorkflowIntent: true, module, method, options };
    try { (root.NovaFlowWebRuntime && root.NovaFlowWebRuntime.recordWorkflowIntent || (() => {}))(intent); } catch (_) {}
    return intent;
  };
  const __api = {};
  __api["MODEL_ID"] = "MiniMax_h3";
  __api["MODES"] = ["t2v","i2v","fl2v","r2v"];
  __api["OUTPUT_FPS"] = 24;
  __api["FPS_OPTIONS"] = [16,24];
  __api["OUTPUT_STEPS"] = 4;
  __api["DEFAULT_STEPS"] = 4;
  __api["STEP_OPTIONS"] = [4,20];
  __api["MIN_STEPS"] = 1;
  __api["MAX_STEPS"] = 10000;
  __api["R2V_STEPS"] = 4;
  __api["RESOLUTION_MULTIPLE"] = 32;
  __api["MIN_MEGAPIXELS"] = 0.2;
  __api["MAX_MEGAPIXELS"] = 2;
  __api["MAX_CANVAS_PIXELS"] = 2119680;
  __api["ASPECT_RATIOS"] = [{"value":"1:1","width":1,"height":1,"orientation":"square","label":"1:1（方形）"},{"value":"2:3","width":2,"height":3,"orientation":"portrait","label":"2:3（竖屏照片）"},{"value":"3:2","width":3,"height":2,"orientation":"landscape","label":"3:2（横屏照片）"},{"value":"3:4","width":3,"height":4,"orientation":"portrait","label":"3:4（竖屏标准）"},{"value":"4:3","width":4,"height":3,"orientation":"landscape","label":"4:3（横屏标准）"},{"value":"9:16","width":9,"height":16,"orientation":"portrait","label":"9:16（竖屏宽银幕）"},{"value":"16:9","width":16,"height":9,"orientation":"landscape","label":"16:9（横屏宽银幕）"},{"value":"21:9","width":21,"height":9,"orientation":"landscape","label":"21:9（超宽屏）"}];
  __api["MEGAPIXEL_OPTIONS"] = [0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0.98,1,1.2,1.5,1.8,2];
  __api["MIN_DURATION"] = 1;
  __api["MAX_DURATION"] = 30;
  __api["DURATION_STEP"] = 0.01;
  __api["PROFILES"] = [{"id":"beta5_int8","label":"H3 beta5 TURBO · INT8","steps":4,"checkpoint":"<server-side>"}];
  __api["calculateResolution"] = function calculateResolution(options = {}) {
    if (!isRecord(options)) throw new TypeError('MiniMax H3 resolution options must be an object')
    const multiple = options.multiple == null ? RESOLUTION_MULTIPLE : Number(options.multiple)
    if (multiple !== RESOLUTION_MULTIPLE) {
      throw new TypeError('MiniMax H3 resolution multiple is fixed to ' + RESOLUTION_MULTIPLE)
    }
    const ratio = aspectRatio(options.aspectRatio || options.aspect || '9:16')
    const megapixels = normalizeMegapixels(options.megapixels)
    const targetPixels = megapixels * 1024 * 1024
    const scale = Math.sqrt(targetPixels / (ratio.width * ratio.height))
    const width = Math.max(
      RESOLUTION_MULTIPLE,
      Math.round((ratio.width * scale) / RESOLUTION_MULTIPLE) * RESOLUTION_MULTIPLE,
    )
    const height = Math.max(
      RESOLUTION_MULTIPLE,
      Math.round((ratio.height * scale) / RESOLUTION_MULTIPLE) * RESOLUTION_MULTIPLE,
    )
    return Object.freeze({
      aspectRatio: ratio.value,
      orientation: ratio.orientation,
      megapixels,
      multiple: RESOLUTION_MULTIPLE,
      width,
      height,
      pixels: width * height,
    })
  };
  __api["matchResolution"] = function matchResolution(options = {}) {
    if (!isRecord(options)) throw new TypeError('MiniMax H3 resolution match options must be an object')
    const width = alignDimension(options.width, DEFAULT_WIDTH)
    const height = alignDimension(options.height, DEFAULT_HEIGHT)
    let best = null
    for (const ratio of ASPECT_RATIOS) {
      for (const megapixels of MEGAPIXEL_OPTIONS) {
        const candidate = calculateResolution({ aspectRatio: ratio.value, megapixels })
        const score = Math.abs(candidate.width - width) + Math.abs(candidate.height - height)
        if (!best || score < best.score) best = { ...candidate, score }
      }
    }
    return Object.freeze({ ...best, exact: best.width === width && best.height === height })
  };
  __api["normalizeSteps"] = function normalizeSteps(value, modeValue) {
    normalizeMode(modeValue)
    const parsed = value == null || value === '' ? DEFAULT_STEPS : Number(value)
    if (!Number.isInteger(parsed) || parsed < MIN_STEPS || parsed > MAX_STEPS) {
      throw new RangeError(
        'MiniMax H3 steps must be an integer between ' + MIN_STEPS + ' and ' + MAX_STEPS,
      )
    }
    return parsed
  };
  __api["normalizeFps"] = function normalizeFps(value) {
    if (value == null || value === '') return OUTPUT_FPS
    const parsed = Number(value)
    if (!Number.isInteger(parsed)) {
      throw new TypeError('MiniMax H3 fps must be 16 or 24')
    }
    if (!FPS_OPTIONS.includes(parsed)) {
      throw new RangeError('MiniMax H3 fps must be 16 or 24')
    }
    return parsed
  };
  __api["normalizeLoras"] = function () {
    throw new Error("NovaFlowAiSequenceMiniMaxH3Workflow.normalizeLoras runs on the compute node, not in the browser");
  };
  __api["normalizeDuration"] = function normalizeDuration(value) {
    const source = isRecord(value)
      ? firstProvided(value.seconds, value.duration, value.durationSeconds)
      : value
    const fps = normalizeFps(isRecord(value) ? value.fps : undefined)
    const parsed = source == null || source === '' ? DEFAULT_DURATION : Number(source)
    if (!Number.isFinite(parsed) || parsed < MIN_DURATION || parsed > MAX_DURATION) {
      throw new RangeError(
        'MiniMax H3 duration must be between ' + MIN_DURATION + ' and ' + MAX_DURATION + ' seconds',
      )
    }
    const requestedDuration = Math.round(parsed / DURATION_STEP) * DURATION_STEP
    const frames = alignFrameCount(Math.round(requestedDuration * fps))
    return Object.freeze({
      requestedDuration: Math.round(requestedDuration * 100) / 100,
      frames,
      actualDuration: frames / fps,
      fps,
    })
  };
  __api["getWorkflowJson"] = function (options) {
    return __record("NovaFlowAiSequenceMiniMaxH3Workflow", "getWorkflowJson", options);
  };
  __api["patchWorkflow"] = function (options) {
    return __record("NovaFlowAiSequenceMiniMaxH3Workflow", "patchWorkflow", options);
  };
  __api["buildWorkflow"] = function (options) {
    return __record("NovaFlowAiSequenceMiniMaxH3Workflow", "buildWorkflow", options);
  };
  __api["validateWorkflow"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["getSelectedProfile"] = () => selected;
  __api["setSelectedProfile"] = id => { selected = profileFor(id).id; persist(); return selected };
  __api["getProfileSettings"] = (id = selected) => {
    const profile = profileFor(id)
    const core = instances.get(profile.id)
    const defaults = { aspectRatio: '9:16', megapixels: 0.4, durationSeconds: 5, fps: 24, steps: profile.steps, acceleration: 'sage' }
    const value = { ...defaults, ...settings[profile.id] }
    value.acceleration = defaults.acceleration
    try {
      core.calculateResolution(value)
      core.normalizeDuration(value.durationSeconds)
      core.normalizeFps(value.fps)
      core.normalizeSteps(value.steps, 't2v')
      return { ...value, steps: Number(value.steps), fps: Number(value.fps), durationSeconds: Number(value.durationSeconds), megapixels: Number(value.megapixels) }
    } catch (_) { return defaults }
  };
  __api["saveProfileSettings"] = (id, value) => {
      const key = profileFor(id).id
      settings[key] = { ...getProfileSettings(key), ...value }
      settings[key] = getProfileSettings(key)
      persist()
      return { ...settings[key] }
    };
  __api["supportsMode"] = (id, mode) => {
      const core = instances.get(profileFor(id).id)
      try { core.normalizeSteps(4, mode); return true } catch (_) { return false }
    };
  root["NovaFlowAiSequenceMiniMaxH3Workflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
