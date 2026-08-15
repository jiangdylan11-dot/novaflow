"use strict";

const fsDefault = require("node:fs");
const pathDefault = require("node:path");
const cryptoDefault = require("node:crypto");

const EXPORT_SCHEMA = "novaflow.video-compositor.export/v1";
const PROGRESS_CHANNEL = "video-compositor-export-progress";
const MAX_MASK_BYTES = 32 * 1024 * 1024;
const MAX_DIMENSION = 8192;
const MAX_SOURCE_DURATION_SECONDS = 60 * 60;
const MAX_SOURCES_PER_SESSION = 16;

const IPC_CHANNELS = Object.freeze({
  sessionOpen: "video-compositor-session-open",
  sourceRegister: "video-compositor-source-register",
  sourceRelease: "video-compositor-source-release",
  maskPut: "video-compositor-mask-put",
  exportStart: "video-compositor-export-start",
  exportCancel: "video-compositor-export-cancel",
  sessionClose: "video-compositor-session-close",
  progress: PROGRESS_CHANNEL
});

function compositorError(code, message = code) {
  const error = new Error(String(message || code || "video_compositor_error"));
  error.code = String(code || "video_compositor_error");
  return error;
}

function assertAllowedKeys(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw compositorError(code);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw compositorError(code, `${code}:${key}`);
  }
}

function normalizeToken(value, code) {
  const token = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(token)) throw compositorError(code);
  return token;
}

function normalizeLayerId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw compositorError("invalid_layer_id");
  return id;
}

function finiteNumber(value, code, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw compositorError(code);
  return number;
}

function integerNumber(value, code, min, max) {
  const number = finiteNumber(value, code, min, max);
  if (!Number.isInteger(number)) throw compositorError(code);
  return number;
}

function evenDimension(value, code) {
  const number = integerNumber(value, code, 16, MAX_DIMENSION);
  if (number % 2 !== 0) throw compositorError(code);
  return number;
}

function toByteBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return Buffer.from(bytes);
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw compositorError("invalid_mask_bytes");
}

function parseRational(value, fallback = null) {
  const text = String(value || "").trim();
  if (!text || text === "0/0" || text === "N/A") return fallback;
  const separator = text.includes(":") ? ":" : (text.includes("/") ? "/" : "");
  if (separator) {
    const [left, right] = text.split(separator);
    const numerator = Number(left);
    const denominator = Number(right);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return fallback;
    return numerator / denominator;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRotation(value) {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw)) throw compositorError("unsupported_source_rotation");
  const normalized = ((raw % 360) + 360) % 360;
  const candidates = [0, 90, 180, 270];
  const matched = candidates.find((candidate) => Math.abs(candidate - normalized) < 0.01 || Math.abs(candidate + 360 - normalized) < 0.01);
  if (matched == null) throw compositorError("unsupported_source_rotation");
  return matched;
}

function getStreamRotation(stream) {
  const sideData = Array.isArray(stream?.side_data_list) ? stream.side_data_list : [];
  const sideRotation = sideData.find((item) => Number.isFinite(Number(item?.rotation)))?.rotation;
  return normalizeRotation(sideRotation != null ? sideRotation : stream?.tags?.rotate);
}

function getAlphaModeTag(stream) {
  const tags = stream?.tags && typeof stream.tags === "object" ? stream.tags : {};
  for (const [key, value] of Object.entries(tags)) {
    if (String(key).toLowerCase() === "alpha_mode") return String(value);
  }
  return "";
}

function parseSourceProbeJson(jsonText, filePath) {
  let data = null;
  try {
    data = typeof jsonText === "string" ? JSON.parse(jsonText) : jsonText;
  } catch {
    throw compositorError("ffprobe_invalid_json");
  }
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const videoStreams = streams.filter((stream) => stream?.codec_type === "video");
  if (videoStreams.length !== 1) throw compositorError(videoStreams.length ? "multiple_video_streams_not_supported" : "video_stream_missing");
  const video = videoStreams[0];
  const audioStreams = streams.filter((stream) => stream?.codec_type === "audio");
  const audio = audioStreams[0] || null;
  const width = integerNumber(video?.width, "invalid_source_dimensions", 1, MAX_DIMENSION);
  const height = integerNumber(video?.height, "invalid_source_dimensions", 1, MAX_DIMENSION);
  const rotation = getStreamRotation(video);
  const sar = parseRational(video?.sample_aspect_ratio, 1);
  if (!Number.isFinite(sar) || sar <= 0 || sar > 32) throw compositorError("invalid_source_sample_aspect_ratio");
  const squarePixelWidth = Math.max(1, Math.round(width * sar));
  const displayWidth = rotation === 90 || rotation === 270 ? height : squarePixelWidth;
  const displayHeight = rotation === 90 || rotation === 270 ? squarePixelWidth : height;
  if (displayWidth > MAX_DIMENSION || displayHeight > MAX_DIMENSION) throw compositorError("source_display_dimensions_too_large");
  const durationSec = Number(data?.format?.duration || video?.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > MAX_SOURCE_DURATION_SECONDS) {
    throw compositorError("invalid_source_duration");
  }
  const codec = String(video?.codec_name || "").toLowerCase();
  const pixelFormat = String(video?.pix_fmt || "").toLowerCase();
  const alphaMode = getAlphaModeTag(video);
  const hasAlpha = alphaMode === "1" || /(^|[^a-z])(yuva|rgba|argb|bgra|abgr)/i.test(pixelFormat);
  const formatNames = String(data?.format?.format_name || "")
    .toLowerCase()
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const extension = pathDefault.extname(String(filePath || "")).toLowerCase();
  const container = extension === ".mp4" ? "mp4" : (extension === ".webm" ? "webm" : "");
  if (!container) throw compositorError("unsupported_source_extension");
  if (container === "mp4") {
    if (codec !== "h264" || !formatNames.some((name) => name === "mov" || name === "mp4")) {
      throw compositorError("unsupported_mp4_codec");
    }
    if (hasAlpha) throw compositorError("unsupported_mp4_alpha");
  } else {
    if (!new Set(["vp8", "vp9"]).has(codec) || !formatNames.some((name) => name === "matroska" || name === "webm")) {
      throw compositorError("unsupported_webm_codec");
    }
    if (hasAlpha && codec !== "vp9") throw compositorError("unsupported_webm_alpha_codec");
  }
  const audioCodec = String(audio?.codec_name || "").toLowerCase();
  const allowedAudio = container === "mp4" ? new Set(["aac", "mp3"]) : new Set(["opus", "vorbis"]);
  if (audio && !allowedAudio.has(audioCodec)) throw compositorError("unsupported_source_audio_codec");
  return {
    container,
    formatNames,
    codec,
    pixelFormat,
    width,
    height,
    displayWidth,
    displayHeight,
    rotation,
    sampleAspectRatio: sar,
    durationSec,
    avgFrameRate: parseRational(video?.avg_frame_rate, null),
    realFrameRate: parseRational(video?.r_frame_rate, null),
    hasAlpha,
    alphaMode,
    hasAudio: Boolean(audio),
    audioCodec: audioCodec || null,
    audioSampleRate: audio ? Number(audio.sample_rate) || null : null,
    audioChannels: audio ? Number(audio.channels) || null : null
  };
}

function parseOutputProbeJson(jsonText) {
  let data = null;
  try {
    data = typeof jsonText === "string" ? JSON.parse(jsonText) : jsonText;
  } catch {
    throw compositorError("output_probe_invalid_json");
  }
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const videoStreams = streams.filter((stream) => stream?.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream?.codec_type === "audio");
  if (videoStreams.length !== 1) throw compositorError("output_video_stream_invalid");
  const video = videoStreams[0];
  const audio = audioStreams[0] || null;
  return {
    videoStreamCount: videoStreams.length,
    audioStreamCount: audioStreams.length,
    videoCodec: String(video?.codec_name || "").toLowerCase(),
    pixelFormat: String(video?.pix_fmt || "").toLowerCase(),
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    avgFrameRate: parseRational(video?.avg_frame_rate, null),
    realFrameRate: parseRational(video?.r_frame_rate, null),
    durationSec: Number(data?.format?.duration || video?.duration) || 0,
    alphaMode: getAlphaModeTag(video),
    audioCodec: audio ? String(audio.codec_name || "").toLowerCase() : null,
    audioSampleRate: audio ? Number(audio.sample_rate) || null : null,
    audioChannels: audio ? Number(audio.channels) || null : null
  };
}

function orientationFilters(source) {
  if (source.meta.rotation === 90) return ["transpose=clock"];
  if (source.meta.rotation === 180) return ["hflip", "vflip"];
  if (source.meta.rotation === 270) return ["transpose=cclock"];
  return [];
}

function formatFilterNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw compositorError("invalid_filter_number");
  return Number(number.toFixed(6)).toString();
}

function validateExportManifest(manifest, session, pathApi = pathDefault) {
  assertAllowedKeys(manifest, ["schema", "sessionId", "jobId", "output", "layers", "audio"], "invalid_export_manifest");
  if (manifest.schema !== EXPORT_SCHEMA) throw compositorError("invalid_export_schema");
  const sessionId = normalizeToken(manifest.sessionId, "invalid_session_id");
  if (sessionId !== session.id) throw compositorError("session_not_found");
  const jobId = normalizeToken(manifest.jobId, "invalid_job_id");

  assertAllowedKeys(manifest.output, ["filePath", "format", "width", "height", "fps"], "invalid_export_output");
  const outputPath = String(manifest.output.filePath || "").trim();
  if (!pathApi.isAbsolute(outputPath)) throw compositorError("invalid_output_path");
  const format = String(manifest.output.format || "").trim().toLowerCase();
  if (format !== "mp4" && format !== "webm") throw compositorError("invalid_output_format");
  if (pathApi.extname(outputPath).toLowerCase() !== `.${format}`) throw compositorError("output_extension_mismatch");
  const outputParent = pathApi.dirname(outputPath);
  let outputParentStat = null;
  try { outputParentStat = session.fs.statSync(outputParent); } catch { outputParentStat = null; }
  if (!outputParentStat?.isDirectory()) throw compositorError("output_parent_missing");
  const width = evenDimension(manifest.output.width, "invalid_output_width");
  const height = evenDimension(manifest.output.height, "invalid_output_height");
  const fps = integerNumber(manifest.output.fps, "invalid_output_fps", 30, 60);
  if (fps !== 30 && fps !== 60) throw compositorError("invalid_output_fps");

  if (!Array.isArray(manifest.layers) || manifest.layers.length !== 2) throw compositorError("video_compositor_requires_two_layers");
  const layerIds = new Set();
  const normalizedLayers = manifest.layers.map((layer) => {
    assertAllowedKeys(layer, ["layerId", "sourceId", "maskId", "visible", "transform"], "invalid_video_layer");
    const layerId = normalizeLayerId(layer.layerId);
    if (layerIds.has(layerId)) throw compositorError("duplicate_layer_id");
    layerIds.add(layerId);
    const sourceId = normalizeToken(layer.sourceId, "invalid_source_id");
    const source = session.sources.get(sourceId);
    if (!source) throw compositorError("source_not_found");
    let mask = null;
    if (layer.maskId != null && String(layer.maskId).trim()) {
      const maskId = normalizeToken(layer.maskId, "invalid_mask_id");
      mask = session.masks.get(maskId);
      if (!mask || mask.sourceId !== sourceId || mask.layerId !== layerId) throw compositorError("mask_source_or_layer_mismatch");
    }
    if (typeof layer.visible !== "boolean") throw compositorError("invalid_layer_visibility");
    assertAllowedKeys(layer.transform, ["centerX", "centerY", "scale"], "invalid_layer_transform");
    const centerX = finiteNumber(layer.transform.centerX, "invalid_layer_center_x", -MAX_DIMENSION * 4, MAX_DIMENSION * 4);
    const centerY = finiteNumber(layer.transform.centerY, "invalid_layer_center_y", -MAX_DIMENSION * 4, MAX_DIMENSION * 4);
    const scale = finiteNumber(layer.transform.scale, "invalid_layer_scale", 0.001, 64);
    const layerWidth = Math.max(1, Math.round(source.meta.displayWidth * scale));
    const layerHeight = Math.max(1, Math.round(source.meta.displayHeight * scale));
    if (layerWidth > MAX_DIMENSION || layerHeight > MAX_DIMENSION) throw compositorError("scaled_layer_dimensions_too_large");
    return {
      layerId,
      sourceId,
      source,
      mask,
      visible: layer.visible,
      transform: { centerX, centerY, scale, width: layerWidth, height: layerHeight }
    };
  });

  assertAllowedKeys(manifest.audio, ["mode", "sourceLayerId"], "invalid_audio_manifest");
  const audioMode = String(manifest.audio.mode || "").trim().toLowerCase();
  if (audioMode !== "none" && audioMode !== "single") throw compositorError("invalid_audio_mode");
  let audioLayer = null;
  if (audioMode === "single") {
    const sourceLayerId = normalizeLayerId(manifest.audio.sourceLayerId);
    audioLayer = normalizedLayers.find((layer) => layer.layerId === sourceLayerId) || null;
    if (!audioLayer) throw compositorError("audio_layer_not_found");
    if (!audioLayer.source.meta.hasAudio) throw compositorError("audio_stream_missing");
  } else if (manifest.audio.sourceLayerId != null && String(manifest.audio.sourceLayerId).trim()) {
    throw compositorError("audio_source_not_allowed_for_none");
  }

  for (const layer of normalizedLayers) {
    const sourcePath = pathApi.resolve(layer.source.filePath).toLowerCase();
    if (pathApi.resolve(outputPath).toLowerCase() === sourcePath) throw compositorError("output_path_overwrites_source");
  }
  const rawDurationSec = Math.max(...normalizedLayers.map((layer) => layer.source.meta.durationSec));
  const frameCount = Math.max(1, Math.ceil(rawDurationSec * fps - 0.000001));
  const durationSec = frameCount / fps;
  return {
    schema: EXPORT_SCHEMA,
    sessionId,
    jobId,
    output: { filePath: pathApi.resolve(outputPath), format, width, height, fps },
    layers: normalizedLayers,
    audio: { mode: audioMode, layer: audioLayer },
    frameCount,
    durationSec
  };
}

function buildExportPlan(normalized, options = {}) {
  const { output, layers, audio, frameCount, durationSec } = normalized;
  const encodeOutputPath = String(options.outputPath || output.filePath);
  if (!encodeOutputPath || pathDefault.extname(encodeOutputPath).toLowerCase() !== `.${output.format}`) {
    throw compositorError("invalid_encode_output_path");
  }
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const layer of layers) {
    args.push("-noautorotate");
    if (layer.source.meta.hasAlpha) args.push("-c:v", "libvpx-vp9");
    args.push("-i", layer.source.filePath);
  }
  let nextInputIndex = layers.length;
  for (const layer of layers) {
    if (!layer.visible || !layer.mask) continue;
    layer.maskInputIndex = nextInputIndex;
    nextInputIndex += 1;
    args.push("-loop", "1", "-framerate", String(output.fps), "-i", layer.mask.filePath);
  }

  const graph = [];
  const layerLabels = [];
  layers.forEach((layer, index) => {
    if (!layer.visible) return;
    const filters = ["setpts=PTS-STARTPTS", ...orientationFilters(layer.source)];
    filters.push(`scale=${layer.source.meta.displayWidth}:${layer.source.meta.displayHeight}:flags=lanczos`);
    filters.push("setsar=1");
    filters.push(`fps=fps=${output.fps}:round=near:start_time=0`);
    filters.push("format=rgba");
    graph.push(`[${index}:v:0]${filters.join(",")}[source_${index}]`);
    let maskedLabel = `source_${index}`;
    if (layer.mask) {
      graph.push(`[source_${index}]split=2[source_rgb_${index}][source_for_alpha_${index}]`);
      graph.push(`[source_for_alpha_${index}]alphaextract[source_alpha_${index}]`);
      graph.push(`[${layer.maskInputIndex}:v:0]setpts=PTS-STARTPTS,fps=fps=${output.fps}:round=near:start_time=0,format=gray[coverage_alpha_${index}]`);
      graph.push(`[source_alpha_${index}][coverage_alpha_${index}]blend=all_mode=multiply:shortest=1[masked_alpha_${index}]`);
      graph.push(`[source_rgb_${index}][masked_alpha_${index}]alphamerge=shortest=1,format=rgba[masked_${index}]`);
      maskedLabel = `masked_${index}`;
    }
    graph.push(`[${maskedLabel}]scale=${layer.transform.width}:${layer.transform.height}:flags=lanczos,format=rgba[layer_${index}]`);
    layerLabels.push({ index, label: `layer_${index}`, layer });
  });

  const durationText = formatFilterNumber(durationSec);
  const baseColor = output.format === "webm" ? "black@0.0" : "black";
  graph.push(`color=c=${baseColor}:s=${output.width}x${output.height}:r=${output.fps}:d=${durationText},format=rgba[base]`);
  let compositeLabel = "base";
  layerLabels.forEach(({ index, label, layer }, overlayIndex) => {
    const outLabel = `composite_${overlayIndex}`;
    const x = formatFilterNumber(layer.transform.centerX);
    const y = formatFilterNumber(layer.transform.centerY);
    graph.push(`[${compositeLabel}][${label}]overlay=x=${x}-overlay_w/2:y=${y}-overlay_h/2:eval=init:shortest=0:eof_action=pass:repeatlast=0:format=auto:alpha=straight[${outLabel}]`);
    compositeLabel = outLabel;
  });
  graph.push(`[${compositeLabel}]format=${output.format === "webm" ? "yuva420p" : "yuv420p"}[vout]`);

  let audioLabel = null;
  if (audio.mode === "single") {
    const audioInputIndex = layers.indexOf(audio.layer);
    audioLabel = "aout";
    graph.push(`[${audioInputIndex}:a:0]aresample=48000:async=1:first_pts=0,asetpts=PTS-STARTPTS,apad=whole_dur=${durationText},atrim=duration=${durationText}[${audioLabel}]`);
  }

  args.push("-filter_complex", graph.join(";"), "-map", "[vout]");
  if (audioLabel) args.push("-map", `[${audioLabel}]`);
  args.push("-frames:v", String(frameCount), "-t", durationText, "-fps_mode", "cfr");
  if (output.format === "webm") {
    args.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1");
    if (audioLabel) args.push("-c:a", "libopus", "-b:a", "160k", "-ar", "48000", "-ac", "2");
  } else {
    args.push("-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
    if (audioLabel) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
  }
  if (!audioLabel) args.push("-an");
  args.push("-progress", "pipe:1", "-nostats", encodeOutputPath);
  return {
    args,
    filterComplex: graph.join(";"),
    expected: {
      format: output.format,
      width: output.width,
      height: output.height,
      fps: output.fps,
      frameCount,
      durationSec,
      hasAlpha: output.format === "webm",
      hasAudio: Boolean(audioLabel),
      audioCodec: audioLabel ? (output.format === "webm" ? "opus" : "aac") : null,
      audioSampleRate: audioLabel ? 48000 : null,
      audioChannels: audioLabel ? 2 : null
    }
  };
}

function replaceOutputFileSafely(fsApi, partialPath, outputPath, backupPath) {
  const hadExistingOutput = fsApi.existsSync(outputPath);
  let movedExistingToBackup = false;
  if (hadExistingOutput) {
    if (fsApi.existsSync(backupPath)) throw compositorError("output_backup_collision");
    try {
      fsApi.renameSync(outputPath, backupPath);
      movedExistingToBackup = true;
    } catch (error) {
      throw compositorError("output_backup_failed", String(error?.message || error));
    }
  }
  try {
    fsApi.renameSync(partialPath, outputPath);
  } catch (replaceError) {
    let restoreError = null;
    if (movedExistingToBackup) {
      try {
        if (fsApi.existsSync(outputPath)) fsApi.unlinkSync(outputPath);
        fsApi.renameSync(backupPath, outputPath);
        movedExistingToBackup = false;
      } catch (error) {
        restoreError = error;
      }
    }
    const failure = compositorError(
      restoreError ? "output_replace_restore_failed" : "output_replace_failed",
      restoreError
        ? `${String(replaceError?.message || replaceError)}; restore: ${String(restoreError?.message || restoreError)}`
        : String(replaceError?.message || replaceError)
    );
    if (restoreError) failure.recoveryPath = backupPath;
    throw failure;
  }
  let backupCleanupError = null;
  if (movedExistingToBackup && fsApi.existsSync(backupPath)) {
    try { fsApi.unlinkSync(backupPath); } catch (error) { backupCleanupError = String(error?.message || error); }
  }
  return { replacedExisting: hadExistingOutput, backupCleanupError, backupPath: backupCleanupError ? backupPath : null };
}

function validateQuickOutputProbe(actual, expected) {
  if (actual.videoCodec !== (expected.format === "webm" ? "vp9" : "h264")) throw compositorError("output_codec_mismatch");
  if (actual.pixelFormat !== "yuv420p") throw compositorError("output_pixel_format_mismatch");
  if (actual.width !== expected.width || actual.height !== expected.height) throw compositorError("output_dimensions_mismatch");
  if (expected.hasAudio !== (actual.audioStreamCount > 0)) throw compositorError("output_audio_contract_mismatch");
  if (actual.audioStreamCount > 1) throw compositorError("output_audio_stream_count_invalid");
  if (expected.hasAudio) {
    if (actual.audioCodec !== expected.audioCodec) throw compositorError("output_audio_codec_mismatch");
    if (actual.audioSampleRate !== expected.audioSampleRate) throw compositorError("output_audio_sample_rate_mismatch");
    if (actual.audioChannels !== expected.audioChannels) throw compositorError("output_audio_channels_mismatch");
  }
  if (expected.format === "webm" && actual.alphaMode !== "1") throw compositorError("output_alpha_metadata_missing");
  if (!Number.isFinite(actual.avgFrameRate) || Math.abs(actual.avgFrameRate - expected.fps) > 0.01) throw compositorError("output_frame_rate_mismatch");
  if (!Number.isFinite(actual.realFrameRate) || Math.abs(actual.realFrameRate - expected.fps) > 0.01) throw compositorError("output_real_frame_rate_mismatch");
  const tolerance = (1 / expected.fps) + 0.08;
  if (!Number.isFinite(actual.durationSec) || Math.abs(actual.durationSec - expected.durationSec) > tolerance) {
    throw compositorError("output_duration_mismatch");
  }
  return true;
}

function createVideoCompositorExportService(dependencies = {}) {
  const fs = dependencies.fs || fsDefault;
  const path = dependencies.path || pathDefault;
  const crypto = dependencies.crypto || cryptoDefault;
  const sharp = dependencies.sharp;
  const ffmpegPath = String(dependencies.ffmpegPath || "");
  const ffprobePath = String(dependencies.ffprobePath || "");
  const runCommand = dependencies.runCommand;
  const spawnCommand = dependencies.spawnCommand;
  const terminateChild = dependencies.terminateChild;
  const createWorkDir = dependencies.createWorkDir;
  const cleanupWorkDir = dependencies.cleanupWorkDir;
  const assertEntitled = dependencies.assertEntitled || (async () => void 0);
  const log = typeof dependencies.log === "function" ? dependencies.log : () => void 0;
  const now = typeof dependencies.now === "function" ? dependencies.now : Date.now;
  const appAbortSignal = dependencies.appAbortSignal || null;
  for (const [name, value] of Object.entries({ sharp, runCommand, spawnCommand, terminateChild, createWorkDir, cleanupWorkDir })) {
    if (typeof value !== "function") throw new TypeError(`video compositor dependency missing: ${name}`);
  }

  const sessions = new Map();
  const jobs = new Map();

  const makeToken = (prefix) => `${prefix}_${typeof crypto.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "") : crypto.randomBytes(16).toString("hex")}`;

  function getSession(sessionId, ownerId) {
    const id = normalizeToken(sessionId, "invalid_session_id");
    const session = sessions.get(id);
    if (!session || session.closing) throw compositorError("session_not_found");
    if (String(session.ownerId) !== String(ownerId)) throw compositorError("session_owner_mismatch");
    return session;
  }

  async function openSession(ownerId) {
    if (ownerId == null) throw compositorError("invalid_session_owner");
    const id = makeToken("vcs");
    const workDir = createWorkDir("video", "video-compositor");
    const session = {
      id,
      ownerId: String(ownerId),
      workDir,
      fs,
      createdAt: now(),
      sources: new Map(),
      masks: new Map(),
      jobIds: new Set(),
      closing: false
    };
    sessions.set(id, session);
    return { ok: true, sessionId: id };
  }

  async function registerSource(ownerId, payload) {
    const session = getSession(payload?.sessionId, ownerId);
    if (session.sources.size >= MAX_SOURCES_PER_SESSION) throw compositorError("source_limit_reached");
    const requestedPath = String(payload?.path || "").trim();
    if (!path.isAbsolute(requestedPath)) throw compositorError("source_path_not_absolute");
    let lstat = null;
    try { lstat = fs.lstatSync(requestedPath); } catch { lstat = null; }
    if (!lstat || !lstat.isFile() || lstat.isSymbolicLink()) throw compositorError("source_file_invalid");
    const realPath = fs.realpathSync.native ? fs.realpathSync.native(requestedPath) : fs.realpathSync(requestedPath);
    const stat = fs.statSync(realPath);
    if (!stat.isFile() || stat.size <= 0) throw compositorError("source_file_invalid");
    if (!ffprobePath || !fs.existsSync(ffprobePath)) throw compositorError("ffprobe_unavailable");
    const probe = await runCommand(ffprobePath, ["-v", "error", "-show_streams", "-show_format", "-of", "json", realPath], {
      cwd: path.dirname(realPath),
      timeoutMs: 20_000,
      killTreeOnTimeout: true,
      signal: appAbortSignal || undefined,
      killTreeOnAbort: true
    });
    if (!probe?.ok) throw compositorError("source_probe_failed", String(probe?.stderr || probe?.stdout || "source_probe_failed").slice(0, 520));
    const meta = parseSourceProbeJson(probe.stdout, realPath);
    if (meta.hasAlpha && payload?.alphaSourceConfirmed !== true) throw compositorError("alpha_source_not_confirmed");
    const id = makeToken("src");
    const source = {
      id,
      filePath: realPath,
      size: Number(stat.size),
      mtimeMs: Number(stat.mtimeMs),
      meta,
      alphaSourceConfirmed: meta.hasAlpha,
      registeredAt: now()
    };
    session.sources.set(id, source);
    return {
      ok: true,
      sourceId: id,
      fingerprint: { size: source.size, mtimeMs: source.mtimeMs },
      meta: { ...meta, decoder: meta.hasAlpha ? "libvpx-vp9" : null }
    };
  }

  async function releaseSource(ownerId, payload) {
    const session = getSession(payload?.sessionId, ownerId);
    if (session.jobIds.size > 0) throw compositorError("session_export_busy");
    const sourceId = normalizeToken(payload?.sourceId, "invalid_source_id");
    if (!session.sources.has(sourceId)) return { ok: true, released: false, sourceId };
    for (const [maskId, mask] of Array.from(session.masks.entries())) {
      if (mask.sourceId !== sourceId) continue;
      try { if (fs.existsSync(mask.filePath)) fs.unlinkSync(mask.filePath); } catch { void 0; }
      session.masks.delete(maskId);
    }
    session.sources.delete(sourceId);
    return { ok: true, released: true, sourceId };
  }

  async function putMask(ownerId, payload) {
    const session = getSession(payload?.sessionId, ownerId);
    if (session.jobIds.size > 0) throw compositorError("session_export_busy");
    const sourceId = normalizeToken(payload?.sourceId, "invalid_source_id");
    const layerId = normalizeLayerId(payload?.layerId);
    const source = session.sources.get(sourceId);
    if (!source) throw compositorError("source_not_found");
    const bytes = toByteBuffer(payload?.bytes);
    if (bytes.length <= 0 || bytes.length > MAX_MASK_BYTES) throw compositorError("mask_size_limit_exceeded");
    let metadata = null;
    try {
      metadata = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_DIMENSION * MAX_DIMENSION }).metadata();
    } catch (error) {
      throw compositorError("invalid_mask_png", String(error?.message || error));
    }
    if (metadata?.format !== "png" || metadata?.depth !== "uchar" || metadata?.hasAlpha !== true) throw compositorError("invalid_mask_png_format");
    const width = integerNumber(metadata.width, "invalid_mask_dimensions", 1, MAX_DIMENSION);
    const height = integerNumber(metadata.height, "invalid_mask_dimensions", 1, MAX_DIMENSION);
    if (width !== source.meta.displayWidth || height !== source.meta.displayHeight) throw compositorError("mask_dimensions_mismatch");
    let canonicalBytes = null;
    try {
      canonicalBytes = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_DIMENSION * MAX_DIMENSION })
        .ensureAlpha()
        .extractChannel(3)
        .toColourspace("b-w")
        .png({ compressionLevel: 9 })
        .toBuffer();
    } catch (error) {
      throw compositorError("invalid_mask_png", String(error?.message || error));
    }
    if (!canonicalBytes?.length || canonicalBytes.length > MAX_MASK_BYTES) throw compositorError("mask_size_limit_exceeded");
    const id = makeToken("mask");
    const filePath = path.join(session.workDir, `${id}.png`);
    fs.writeFileSync(filePath, canonicalBytes);
    const sha256 = crypto.createHash("sha256").update(canonicalBytes).digest("hex");
    const mask = { id, sourceId, layerId, filePath, width, height, size: canonicalBytes.length, sha256, createdAt: now() };
    session.masks.set(id, mask);
    for (const [previousId, previousMask] of Array.from(session.masks.entries())) {
      if (previousId === id || previousMask.sourceId !== sourceId || previousMask.layerId !== layerId) continue;
      try { if (fs.existsSync(previousMask.filePath)) fs.unlinkSync(previousMask.filePath); } catch { void 0; }
      session.masks.delete(previousId);
    }
    return { ok: true, maskId: id, width, height, size: bytes.length, sha256 };
  }

  function assertSourceFingerprints(normalized) {
    for (const layer of normalized.layers) {
      let stat = null;
      try { stat = fs.statSync(layer.source.filePath); } catch { stat = null; }
      if (!stat?.isFile() || Number(stat.size) !== layer.source.size || Math.abs(Number(stat.mtimeMs) - layer.source.mtimeMs) > 0.5) {
        throw compositorError("source_changed_since_probe");
      }
    }
  }

  function emitProgress(callback, job, data) {
    const payload = {
      jobId: job.id,
      sessionId: job.sessionId,
      stage: String(data?.stage || "encoding"),
      progress: Math.max(0, Math.min(1, Number(data?.progress) || 0)),
      outTimeSec: Number(data?.outTimeSec) || 0,
      ...data
    };
    try { callback?.(payload); } catch { void 0; }
  }

  function parseProgressChunk(job, callback, chunk) {
    job.progressBuffer += String(chunk || "");
    const lines = job.progressBuffer.split(/\r?\n/);
    job.progressBuffer = lines.pop() || "";
    for (const line of lines) {
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (key === "out_time_us" || key === "out_time_ms") {
        const micros = Number(value);
        if (Number.isFinite(micros)) job.outTimeSec = Math.max(0, micros / 1_000_000);
      } else if (key === "out_time") {
        const match = value.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
        if (match) job.outTimeSec = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      } else if (key === "progress") {
        emitProgress(callback, job, {
          stage: value === "end" ? "encoding-complete" : "encoding",
          progress: Math.min(1, job.outTimeSec / Math.max(0.001, job.durationSec)),
          outTimeSec: job.outTimeSec
        });
      }
    }
  }

  async function quickProbeOutput(filePath, expected, signal) {
    const result = await runCommand(ffprobePath, ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath], {
      cwd: path.dirname(filePath),
      timeoutMs: 20_000,
      killTreeOnTimeout: true,
      signal,
      killTreeOnAbort: true
    });
    if (!result?.ok) throw compositorError("output_probe_failed", String(result?.stderr || result?.stdout || "output_probe_failed").slice(0, 520));
    const actual = parseOutputProbeJson(result.stdout);
    validateQuickOutputProbe(actual, expected);
    return actual;
  }

  async function startExport(ownerId, manifest, progressCallback) {
    const session = getSession(manifest?.sessionId, ownerId);
    const requestedJobId = normalizeToken(manifest?.jobId, "invalid_job_id");
    if (jobs.has(requestedJobId)) throw compositorError("job_id_already_exists");
    if (session.jobIds.size > 0) throw compositorError("session_export_busy");
    let resolveDone = null;
    const job = {
      id: requestedJobId,
      sessionId: session.id,
      ownerId: String(ownerId),
      outputPath: "",
      partialPath: "",
      backupPath: "",
      durationSec: 0,
      child: null,
      cancelRequested: false,
      success: false,
      progressBuffer: "",
      outTimeSec: 0,
      abortController: new AbortController(),
      done: new Promise((resolve) => { resolveDone = resolve; })
    };
    jobs.set(job.id, job);
    session.jobIds.add(job.id);
    emitProgress(progressCallback, job, { stage: "preparing", progress: 0 });
    try {
      await assertEntitled("export", "video-compositor-export-start");
      if (job.cancelRequested || job.abortController.signal.aborted || session.closing) throw compositorError("export_canceled");
      const normalized = validateExportManifest(manifest, session, path);
      assertSourceFingerprints(normalized);
      if (!ffmpegPath || !fs.existsSync(ffmpegPath)) throw compositorError("ffmpeg_unavailable");
      if (!ffprobePath || !fs.existsSync(ffprobePath)) throw compositorError("ffprobe_unavailable");
      const outputExtension = `.${normalized.output.format}`;
      const outputStem = path.basename(normalized.output.filePath, outputExtension).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "video";
      const fileNonce = makeToken("partial");
      const outputDirectory = path.dirname(normalized.output.filePath);
      job.outputPath = normalized.output.filePath;
      job.partialPath = path.join(outputDirectory, `.${outputStem}.${fileNonce}.partial${outputExtension}`);
      job.backupPath = path.join(outputDirectory, `.${outputStem}.${fileNonce}.backup${outputExtension}`);
      job.durationSec = normalized.durationSec;
      const plan = buildExportPlan(normalized, { outputPath: job.partialPath });
      if (job.cancelRequested || job.abortController.signal.aborted || session.closing) throw compositorError("export_canceled");
      emitProgress(progressCallback, job, { stage: "starting", progress: 0 });
      const child = spawnCommand(ffmpegPath, plan.args, {
        cwd: session.workDir,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      job.child = child;
      let stderr = "";
      child.stdout?.on("data", (chunk) => parseProgressChunk(job, progressCallback, chunk));
      child.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk || "")}`;
        if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024);
      });
      const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code == null ? -1 : Number(code)));
      });
      if (job.cancelRequested || job.abortController.signal.aborted) throw compositorError("export_canceled");
      if (exitCode !== 0) throw compositorError("ffmpeg_export_failed", stderr.slice(-2000) || `ffmpeg_exit_${exitCode}`);
      let partialStat = null;
      try { partialStat = fs.statSync(job.partialPath); } catch { partialStat = null; }
      if (!partialStat?.isFile() || partialStat.size <= 0) throw compositorError("output_file_missing");
      emitProgress(progressCallback, job, { stage: "probing", progress: 1, outTimeSec: normalized.durationSec });
      const actual = await quickProbeOutput(job.partialPath, plan.expected, job.abortController.signal);
      if (job.cancelRequested || job.abortController.signal.aborted) throw compositorError("export_canceled");
      emitProgress(progressCallback, job, { stage: "committing", progress: 1, outTimeSec: normalized.durationSec });
      const replacement = replaceOutputFileSafely(fs, job.partialPath, job.outputPath, job.backupPath);
      if (replacement.backupCleanupError) {
        log("warn", "video-compositor-output-backup-cleanup-failed", {
          jobId: job.id,
          backupPath: replacement.backupPath,
          error: replacement.backupCleanupError
        });
      }
      let outputStat = null;
      try { outputStat = fs.statSync(job.outputPath); } catch { outputStat = null; }
      if (!outputStat?.isFile() || outputStat.size <= 0) throw compositorError("committed_output_file_missing");
      job.success = true;
      const evidence = {
        expected: plan.expected,
        actual,
        outputSize: Number(outputStat.size),
        sourceFingerprints: normalized.layers.map((layer) => ({ sourceId: layer.sourceId, size: layer.source.size, mtimeMs: layer.source.mtimeMs })),
        maskSha256s: normalized.layers.map((layer) => layer.mask?.sha256 || null),
        replacement
      };
      emitProgress(progressCallback, job, { stage: "complete", progress: 1, outTimeSec: normalized.durationSec });
      return { ok: true, jobId: job.id, filePath: job.outputPath, evidence };
    } catch (error) {
      const failure = (job.cancelRequested || job.abortController.signal.aborted || session.closing) && error?.code !== "export_canceled"
        ? compositorError("export_canceled")
        : error;
      emitProgress(progressCallback, job, {
        stage: failure?.code === "export_canceled" ? "canceled" : "error",
        progress: Math.min(1, job.outTimeSec / Math.max(0.001, job.durationSec)),
        error: String(failure?.message || failure),
        code: String(failure?.code || "video_compositor_export_failed")
      });
      throw failure;
    } finally {
      try { if (job.partialPath && fs.existsSync(job.partialPath)) fs.unlinkSync(job.partialPath); } catch { void 0; }
      jobs.delete(job.id);
      session.jobIds.delete(job.id);
      resolveDone?.();
    }
  }

  async function cancelExport(ownerId, payload) {
    const session = getSession(payload?.sessionId, ownerId);
    const jobId = normalizeToken(payload?.jobId, "invalid_job_id");
    const job = jobs.get(jobId);
    if (!job || job.sessionId !== session.id || String(job.ownerId) !== String(ownerId)) return { ok: true, canceled: false };
    job.cancelRequested = true;
    try { job.abortController.abort(); } catch { void 0; }
    if (job.child) await terminateChild(job.child, true);
    return { ok: true, canceled: true, jobId };
  }

  async function closeSession(ownerId, payload) {
    const id = normalizeToken(payload?.sessionId, "invalid_session_id");
    const session = sessions.get(id);
    if (!session) return { ok: true, closed: false };
    if (String(session.ownerId) !== String(ownerId)) throw compositorError("session_owner_mismatch");
    session.closing = true;
    const activeJobs = Array.from(session.jobIds).map((jobId) => jobs.get(jobId)).filter(Boolean);
    for (const job of activeJobs) {
      job.cancelRequested = true;
      try { job.abortController.abort(); } catch { void 0; }
      if (job.child) await terminateChild(job.child, true);
    }
    await Promise.allSettled(activeJobs.map((job) => job.done));
    const cleanup = await cleanupWorkDir(session.workDir, "video-compositor-session-close");
    sessions.delete(id);
    if (cleanup?.ok === false) throw compositorError("session_cleanup_failed", cleanup.error || "session_cleanup_failed");
    return { ok: true, closed: true, sessionId: id };
  }

  async function closeOwner(ownerId) {
    const owned = Array.from(sessions.values()).filter((session) => String(session.ownerId) === String(ownerId));
    await Promise.allSettled(owned.map((session) => closeSession(ownerId, { sessionId: session.id })));
  }

  async function closeAll() {
    const all = Array.from(sessions.values());
    await Promise.allSettled(all.map((session) => closeSession(session.ownerId, { sessionId: session.id })));
  }

  if (appAbortSignal) {
    appAbortSignal.addEventListener("abort", () => { void closeAll(); }, { once: true });
  }

  return {
    sessions,
    jobs,
    openSession,
    registerSource,
    releaseSource,
    putMask,
    startExport,
    cancelExport,
    closeSession,
    closeOwner,
    closeAll
  };
}

function registerVideoCompositorExportIpc(options = {}) {
  const service = options.service;
  const handleIpc = options.handleIpc;
  const toErrorResult = typeof options.toErrorResult === "function"
    ? options.toErrorResult
    : (error) => ({ ok: false, error: String(error?.message || error), code: String(error?.code || "video_compositor_error") });
  if (!service || typeof handleIpc !== "function") throw new TypeError("video compositor IPC dependencies missing");
  const cleanupBoundSenders = new WeakSet();
  const register = (channel, fallback, handler) => {
    handleIpc(channel, async (event, payload) => {
      try {
        return await handler(event, payload || {});
      } catch (error) {
        const result = toErrorResult(error, fallback) || { ok: false, error: String(error?.message || error) };
        if (!result.code && error?.code) result.code = String(error.code);
        return result;
      }
    });
  };
  const ownerId = (event) => event?.sender?.id;
  register(IPC_CHANNELS.sessionOpen, "video_compositor_session_open_failed", async (event) => {
    const openedOwnerId = ownerId(event);
    const result = await service.openSession(openedOwnerId);
    try {
      const sender = event?.sender;
      if (sender && (typeof sender === "object" || typeof sender === "function") && !cleanupBoundSenders.has(sender)) {
        cleanupBoundSenders.add(sender);
        sender.once?.("destroyed", () => { void service.closeOwner(openedOwnerId); });
      }
    } catch { void 0; }
    return result;
  });
  register(IPC_CHANNELS.sourceRegister, "video_compositor_source_register_failed", (event, payload) => service.registerSource(ownerId(event), payload));
  register(IPC_CHANNELS.sourceRelease, "video_compositor_source_release_failed", (event, payload) => service.releaseSource(ownerId(event), payload));
  register(IPC_CHANNELS.maskPut, "video_compositor_mask_put_failed", (event, payload) => service.putMask(ownerId(event), payload));
  register(IPC_CHANNELS.exportStart, "video_compositor_export_failed", (event, payload) => service.startExport(ownerId(event), payload, (progress) => {
    try { event?.sender?.send?.(PROGRESS_CHANNEL, progress); } catch { void 0; }
  }));
  register(IPC_CHANNELS.exportCancel, "video_compositor_cancel_failed", (event, payload) => service.cancelExport(ownerId(event), payload));
  register(IPC_CHANNELS.sessionClose, "video_compositor_session_close_failed", (event, payload) => service.closeSession(ownerId(event), payload));
}

module.exports = {
  EXPORT_SCHEMA,
  IPC_CHANNELS,
  MAX_MASK_BYTES,
  MAX_DIMENSION,
  parseSourceProbeJson,
  parseOutputProbeJson,
  validateExportManifest,
  buildExportPlan,
  replaceOutputFileSafely,
  validateQuickOutputProbe,
  createVideoCompositorExportService,
  registerVideoCompositorExportIpc
};
