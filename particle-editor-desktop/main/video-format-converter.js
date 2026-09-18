// 视频格式转换 for the Tools section.
//
// This is the conversion 导出视频 already does when a plain video sits on the AI-sequence board,
// lifted out to where a file goes when all you want is a different container: the same percentage
// scale off the decoded frame (so aspect ratio and phone rotation follow the source), the same
// source frame rate, and the same encoder settings per format. The ffmpeg arguments below are kept
// character-for-character in step with the sourceConvert branch of export-encode-video-to-video in
// main.js -- tests/video-tools-compress-convert.test.js fails if the two drift.

const { sanitizeFileName, sanitizeFileStem } = require("./path-helpers");
const { runFfmpegWithProgress, probeMp4Meta } = require("./mp4-compressor");

const VIDEO_CONVERT_FORMATS = Object.freeze(["mp4", "webm", "gif"]);
const VIDEO_CONVERT_DEFAULT_SCALE_PCT = 100;
// What the Tools entry will open. ffmpeg reads far more than this, but an extension it cannot
// demux only fails later, and a silent list is worse than a short one.
const VIDEO_CONVERT_INPUT_EXTENSIONS = Object.freeze([
  ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv", ".flv", ".ts", ".mpg", ".mpeg", ".gif"
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function normalizeVideoFormat(value) {
  const format = String(value || "").trim().toLowerCase();
  return VIDEO_CONVERT_FORMATS.includes(format) ? format : "mp4";
}

function normalizeScalePct(value) {
  const pct = Number(value);
  // Only a missing or unreadable value falls back to 100%; an explicit 0 is a request for the
  // smallest output the encoder will take, so it clamps to the floor instead.
  return clamp(Math.round(Number.isFinite(pct) ? pct : VIDEO_CONVERT_DEFAULT_SCALE_PCT), 10, 200);
}

function videoConvertOutputFileName(name, format) {
  const stem = sanitizeFileStem(name, "video") || "video";
  return `${stem}.${normalizeVideoFormat(format)}`;
}

// A percentage off the decoded frame, rounded down to an even size, so the aspect ratio is whatever
// the file already had -- including phone clips ffmpeg auto-rotates on the way in.
function videoConvertScaleFilter(scalePct) {
  const pct = normalizeScalePct(scalePct);
  return `scale=max(2\\,trunc(iw*${pct}/200)*2):max(2\\,trunc(ih*${pct}/200)*2):flags=lanczos`;
}

function videoConvertArgs({ inPath, outPath, format, scalePct }) {
  const target = normalizeVideoFormat(format);
  const vf = videoConvertScaleFilter(scalePct);
  const head = ["-hide_banner", "-loglevel", "error", "-y", "-i", inPath];
  const tail = ["-progress", "pipe:1", "-nostats", outPath];

  if (target === "gif") {
    return [
      ...head,
      "-filter_complex", `${vf},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=new=1`,
      "-loop", "0",
      ...tail
    ];
  }
  if (target === "webm") {
    return [
      ...head,
      "-vf", vf,
      "-c:v", "libvpx-vp9",
      // VP9 at its default speed turns a plain format change into a multi-minute wait.
      "-row-mt", "1",
      "-deadline", "good",
      "-cpu-used", "2",
      "-pix_fmt", "yuv420p",
      "-b:v", "0",
      "-crf", "30",
      ...tail
    ];
  }
  return [
    ...head,
    "-vf", vf,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-crf", "18",
    ...tail
  ];
}

async function convertVideoFormat(payload = {}, deps = {}) {
  const { fs, path, spawn, runCmd, ffmpegPath, ffprobePath, onProgress, trackChild } = deps;
  if (!fs || !path) return { ok: false, error: "video_convert_deps_missing" };
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return { ok: false, error: "ffmpeg 不可用（未内置或打包缺失）" };

  const inPath = String(payload.inputPath || "").trim();
  if (!inPath || !fs.existsSync(inPath)) return { ok: false, error: "找不到原始视频文件" };
  const outDir = String(payload.outDir || "").trim();
  if (!outDir) return { ok: false, error: "video_convert_out_dir_missing" };

  const format = normalizeVideoFormat(payload.format);
  const scalePct = normalizeScalePct(payload.scalePct);
  const fileName = videoConvertOutputFileName(sanitizeFileName(payload.fileName) || path.basename(inPath), format);
  const outPath = path.join(outDir, `${Date.now()}_${Math.random().toString(16).slice(2)}_${fileName}`);
  fs.mkdirSync(outDir, { recursive: true });

  const meta = await probeMp4Meta(inPath, { runCmd, ffprobePath, cwd: outDir });
  const bytesIn = fs.statSync(inPath).size;
  const run = await runFfmpegWithProgress({
    spawn,
    ffmpegPath,
    args: videoConvertArgs({ inPath, outPath, format, scalePct }),
    durationSec: meta?.durationSec ?? null,
    onProgress,
    trackChild
  });
  if (!run.ok) {
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
    return { ok: false, error: `视频转换失败：${String(run.error || "").slice(0, 240)}` };
  }
  if (!fs.existsSync(outPath)) return { ok: false, error: "视频转换失败：没有产生输出文件" };

  // No keep-original rule here: a format change was asked for, so a bigger file is still the
  // answer to the question. The size is reported and the user decides.
  return { ok: true, outPath, fileName, format, scalePct, bytesIn, bytesOut: fs.statSync(outPath).size, meta };
}

module.exports = {
  VIDEO_CONVERT_FORMATS,
  VIDEO_CONVERT_DEFAULT_SCALE_PCT,
  VIDEO_CONVERT_INPUT_EXTENSIONS,
  normalizeVideoFormat,
  normalizeScalePct,
  videoConvertOutputFileName,
  videoConvertScaleFilter,
  videoConvertArgs,
  convertVideoFormat
};
