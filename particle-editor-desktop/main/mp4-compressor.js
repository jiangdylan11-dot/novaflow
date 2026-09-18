// MP4 compression for the Tools section.
//
// Compression here means "the same footage, fewer bytes": the frame size, the frame rate and the
// duration are left exactly as the file had them and only the encoder's quality target moves.
// Downscaling or dropping frames would shrink a file faster, but it hands back a different asset,
// and a clip only reaches the Tools section once it is final.

const { sanitizeFileName, sanitizeFileStem } = require("./path-helpers");

const MP4_COMPRESS_DEFAULT_STRENGTH = 32;
// x264 at CRF 18 is the "can't tell it apart" end; past 34 the blocking is plain on flat colour,
// which is most of what a game clip is made of.
const MP4_COMPRESS_MIN_CRF = 18;
const MP4_COMPRESS_MAX_CRF = 34;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// The strength slider is shared with PNG / JPG 压缩, so the same number has to make the same
// promise in all three: the quality curve is the JPG one (95 - 0.6 * strength), and CRF rides
// along it from visually lossless down to visibly compressed.
function mp4CompressionPlan(strength) {
  const level = clamp(Math.round(Number(strength) || 0), 0, 100);
  return {
    strength: level,
    quality: clamp(Math.round(95 - level * 0.6), 35, 95),
    crf: clamp(Math.round(MP4_COMPRESS_MIN_CRF + level * 0.16), MP4_COMPRESS_MIN_CRF, MP4_COMPRESS_MAX_CRF),
    zone: level >= 78 ? "danger" : level >= 56 ? "warning" : "safe"
  };
}

function mp4CompressOutputFileName(name) {
  const stem = sanitizeFileStem(name, "video") || "video";
  return `${stem}-compressed.mp4`;
}

function mp4ProbeArgs(inPath) {
  return [
    "-v", "error",
    "-show_entries", "stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate",
    "-show_entries", "format=duration,bit_rate",
    "-of", "json",
    inPath
  ];
}

function parseRational(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.includes("/")) {
    const [a, b] = text.split("/");
    const n = Number(a);
    const d = Number(b);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return n / d;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function parseMp4ProbeOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video") || null;
  const audio = streams.find((stream) => stream?.codec_type === "audio") || null;
  const duration = Number(parsed?.format?.duration);
  const fps = parseRational(video?.avg_frame_rate) || parseRational(video?.r_frame_rate);
  return {
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    fps: fps && fps > 0.1 ? fps : null,
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
    videoCodec: String(video?.codec_name || ""),
    audioCodec: audio ? String(audio.codec_name || "") : "",
    hasAudio: Boolean(audio)
  };
}

// AAC is what an MP4 almost always carries already, and a second AAC pass only loses what the
// first one kept -- for a track that is a rounding error next to the video bitrate.
function mp4AudioMode(meta) {
  if (!meta?.hasAudio) return "none";
  return String(meta.audioCodec || "").toLowerCase() === "aac" ? "copy" : "encode";
}

function mp4CompressArgs({ inPath, outPath, crf, audioMode }) {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", inPath,
    "-map", "0:v:0",
    ...(audioMode === "none" ? ["-an"] : ["-map", "0:a:0"]),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", String(crf),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    ...(audioMode === "none" ? [] : audioMode === "copy" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "128k"]),
    "-progress", "pipe:1",
    "-nostats",
    outPath
  ];
}

// ffmpeg reports on stdout in microseconds of output written, so progress is only meaningful once
// the probe has a duration; without one the caller gets no ratio rather than a made-up one.
function runFfmpegWithProgress(options = {}) {
  const { spawn, ffmpegPath, args, durationSec, onProgress, trackChild } = options;
  return new Promise((resolve) => {
    let child = null;
    try {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      if (typeof trackChild === "function") child = trackChild(child) || child;
    } catch (error) {
      resolve({ ok: false, error: String(error?.message || error || "ffmpeg_spawn_failed") });
      return;
    }
    let stdoutBuf = "";
    let stderrBuf = "";
    let lastRatio = -1;
    const emit = (outTimeUs) => {
      if (typeof onProgress !== "function") return;
      if (!Number.isFinite(durationSec) || !(durationSec > 0)) return;
      const ratio = clamp((Number(outTimeUs) || 0) / (durationSec * 1e6), 0, 1);
      if (Math.abs(ratio - lastRatio) < 0.01) return;
      lastRatio = ratio;
      onProgress(ratio);
    };
    child.stdout.on("data", (chunk) => {
      stdoutBuf += String(chunk || "");
      for (;;) {
        const idx = stdoutBuf.indexOf("\n");
        if (idx < 0) break;
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (line.startsWith("out_time_ms=")) emit(line.slice("out_time_ms=".length));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBuf += String(chunk || "");
      if (stderrBuf.length > 20000) stderrBuf = stderrBuf.slice(-20000);
    });
    child.on("error", (error) => resolve({ ok: false, error: String(error?.message || error || "ffmpeg_failed") }));
    child.on("close", (code) => {
      if (code === 0) {
        if (typeof onProgress === "function" && lastRatio < 1) onProgress(1);
        resolve({ ok: true });
        return;
      }
      resolve({ ok: false, error: stderrBuf.trim() || `ffmpeg failed (code ${code})` });
    });
  });
}

async function probeMp4Meta(inPath, deps = {}) {
  const { runCmd, ffprobePath } = deps;
  if (!ffprobePath || typeof runCmd !== "function") return null;
  const result = await runCmd(ffprobePath, mp4ProbeArgs(inPath), { cwd: deps.cwd });
  if (!result?.ok) return null;
  return parseMp4ProbeOutput(result.stdout);
}

async function compressMp4(payload = {}, deps = {}) {
  const { fs, path, spawn, runCmd, ffmpegPath, ffprobePath, onProgress, trackChild } = deps;
  if (!fs || !path) return { ok: false, error: "mp4_compress_deps_missing" };
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return { ok: false, error: "ffmpeg 不可用（未内置或打包缺失）" };

  const inPath = String(payload.inputPath || "").trim();
  if (!inPath || !fs.existsSync(inPath)) return { ok: false, error: "找不到原始视频文件" };
  const outDir = String(payload.outDir || "").trim();
  if (!outDir) return { ok: false, error: "mp4_compress_out_dir_missing" };

  const plan = mp4CompressionPlan(payload.strength ?? MP4_COMPRESS_DEFAULT_STRENGTH);
  const fileName = mp4CompressOutputFileName(sanitizeFileName(payload.fileName) || path.basename(inPath));
  const outPath = path.join(outDir, `${Date.now()}_${Math.random().toString(16).slice(2)}_${fileName}`);
  fs.mkdirSync(outDir, { recursive: true });

  const meta = await probeMp4Meta(inPath, { runCmd, ffprobePath, cwd: outDir });
  const bytesIn = fs.statSync(inPath).size;
  const run = await runFfmpegWithProgress({
    spawn,
    ffmpegPath,
    args: mp4CompressArgs({ inPath, outPath, crf: plan.crf, audioMode: mp4AudioMode(meta) }),
    durationSec: meta?.durationSec ?? null,
    onProgress,
    trackChild
  });
  if (!run.ok) {
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
    return { ok: false, error: `视频压缩失败：${String(run.error || "").slice(0, 240)}` };
  }
  if (!fs.existsSync(outPath)) return { ok: false, error: "视频压缩失败：没有产生输出文件" };

  const bytesOut = fs.statSync(outPath).size;
  // Same rule the image tools follow: a clip that is already tighter than this pass can make it
  // keeps its own bytes, because handing back a bigger file that also lost a generation is worse
  // than doing nothing.
  if (bytesOut >= bytesIn) {
    try { fs.unlinkSync(outPath); } catch {}
    return { ok: true, keptOriginal: true, outPath: inPath, fileName, bytesIn, bytesOut: bytesIn, plan, meta };
  }
  return { ok: true, keptOriginal: false, outPath, fileName, bytesIn, bytesOut, plan, meta };
}

module.exports = {
  MP4_COMPRESS_DEFAULT_STRENGTH,
  MP4_COMPRESS_MIN_CRF,
  MP4_COMPRESS_MAX_CRF,
  mp4CompressionPlan,
  mp4CompressOutputFileName,
  mp4ProbeArgs,
  parseMp4ProbeOutput,
  mp4AudioMode,
  mp4CompressArgs,
  runFfmpegWithProgress,
  probeMp4Meta,
  compressMp4
};
