const { dataUrlToBuffer, safeBufferFromBytes, clampNumber } = require("./buffer-helpers");
const { repairIndexedPngTransparentPalette } = require("./png-palette-helpers");

const SPINE_ATLAS_PMA_PROFILE = "spine-atlas-pma";
const MIN_ALPHA_CLASSIFICATION_PIXELS = 64;
const MIN_LOW_ALPHA_CLASSIFICATION_PIXELS = 64;
const MIN_ALPHA_BUCKETS = 8;
const MAX_ALPHA_ANALYSIS_PIXELS = 4096 * 4096;

function classifyStoredRgbaAlpha(data) {
  if (!Buffer.isBuffer(data) || data.length === 0 || data.length % 4 !== 0) {
    throw new Error("invalid RGBA analysis buffer");
  }

  let transparentPixels = 0;
  let translucentPixels = 0;
  let premultipliedLikePixels = 0;
  let straightLikePixels = 0;
  let lowAlphaPixels = 0;
  let highAlphaPixels = 0;
  let alphaSum = 0;
  let maxRgbSum = 0;
  let alphaSquareSum = 0;
  let maxRgbSquareSum = 0;
  let alphaRgbProductSum = 0;
  let lowAlphaRgbSum = 0;
  let highAlphaRgbSum = 0;
  let lowAlphaNormalizedRgbSum = 0;
  let highAlphaNormalizedRgbSum = 0;
  let minTranslucentAlpha = 255;
  let maxTranslucentAlpha = 0;
  const alphaBuckets = new Set();
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha <= 4) {
      transparentPixels += 1;
      continue;
    }
    if (alpha >= 250) continue;
    const maxRgb = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    translucentPixels += 1;
    if (alpha <= 32) {
      lowAlphaPixels += 1;
      lowAlphaRgbSum += maxRgb;
      lowAlphaNormalizedRgbSum += maxRgb / alpha;
    }
    if (alpha >= 128) {
      highAlphaPixels += 1;
      highAlphaRgbSum += maxRgb;
      highAlphaNormalizedRgbSum += maxRgb / alpha;
    }
    alphaSum += alpha;
    maxRgbSum += maxRgb;
    alphaSquareSum += alpha * alpha;
    maxRgbSquareSum += maxRgb * maxRgb;
    alphaRgbProductSum += alpha * maxRgb;
    minTranslucentAlpha = Math.min(minTranslucentAlpha, alpha);
    maxTranslucentAlpha = Math.max(maxTranslucentAlpha, alpha);
    alphaBuckets.add(Math.min(15, Math.floor(alpha / 16)));
    if (maxRgb <= alpha + 3) premultipliedLikePixels += 1;
    if (maxRgb > alpha + 18) straightLikePixels += 1;
  }

  if (transparentPixels === 0 && translucentPixels === 0) {
    return {
      mode: "opaque",
      transparentPixels,
      translucentPixels,
      lowAlphaPixels,
      minTranslucentAlpha: 0,
      maxTranslucentAlpha: 0,
      occupiedAlphaBuckets: 0,
      alphaRgbCorrelation: 0,
      intensityGrowth: 0,
      normalizedIntensityRetention: 0,
      premultipliedRatio: 0,
      straightRatio: 0
    };
  }

  const premultipliedRatio = translucentPixels > 0 ? premultipliedLikePixels / translucentPixels : 0;
  const straightRatio = translucentPixels > 0 ? straightLikePixels / translucentPixels : 0;
  const correlationNumerator = translucentPixels * alphaRgbProductSum - alphaSum * maxRgbSum;
  const correlationDenominator = Math.sqrt(
    (translucentPixels * alphaSquareSum - alphaSum * alphaSum)
    * (translucentPixels * maxRgbSquareSum - maxRgbSum * maxRgbSum)
  );
  const alphaRgbCorrelation = correlationDenominator > 0
    ? correlationNumerator / correlationDenominator
    : 0;
  const lowAlphaRgbMean = lowAlphaPixels > 0 ? lowAlphaRgbSum / lowAlphaPixels : 0;
  const highAlphaRgbMean = highAlphaPixels > 0 ? highAlphaRgbSum / highAlphaPixels : 0;
  const intensityGrowth = lowAlphaRgbMean > 0
    ? highAlphaRgbMean / lowAlphaRgbMean
    : highAlphaRgbMean > 0 ? 255 : 0;
  const lowAlphaNormalizedRgbMean = lowAlphaPixels > 0
    ? lowAlphaNormalizedRgbSum / lowAlphaPixels
    : 0;
  const highAlphaNormalizedRgbMean = highAlphaPixels > 0
    ? highAlphaNormalizedRgbSum / highAlphaPixels
    : 0;
  const normalizedIntensityRetention = lowAlphaNormalizedRgbMean > 0
    ? highAlphaNormalizedRgbMean / lowAlphaNormalizedRgbMean
    : highAlphaNormalizedRgbMean > 0 ? 255 : 0;
  let mode = "ambiguous";
  if (
    translucentPixels >= MIN_ALPHA_CLASSIFICATION_PIXELS
    && lowAlphaPixels >= MIN_LOW_ALPHA_CLASSIFICATION_PIXELS
    && minTranslucentAlpha <= 16
    && maxTranslucentAlpha >= 128
    && alphaBuckets.size >= MIN_ALPHA_BUCKETS
    && alphaRgbCorrelation >= 0.35
    && intensityGrowth >= 4
    && normalizedIntensityRetention >= 0.5
    && premultipliedRatio >= 0.995
    && straightRatio <= 0.001
  ) {
    mode = "pma-like";
  } else if (translucentPixels >= MIN_ALPHA_CLASSIFICATION_PIXELS && straightRatio >= 0.04) {
    mode = "straight";
  }

  return {
    mode,
    transparentPixels,
    translucentPixels,
    lowAlphaPixels,
    minTranslucentAlpha: translucentPixels > 0 ? minTranslucentAlpha : 0,
    maxTranslucentAlpha,
    occupiedAlphaBuckets: alphaBuckets.size,
    alphaRgbCorrelation,
    intensityGrowth,
    normalizedIntensityRetention,
    premultipliedRatio,
    straightRatio
  };
}

async function analyzeStoredPngAlpha(sharp, input) {
  const metadata = await sharp(input, { limitInputPixels: false }).metadata();
  const width = Number(metadata?.width);
  const height = Number(metadata?.height);
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > MAX_ALPHA_ANALYSIS_PIXELS
  ) {
    return {
      mode: "ambiguous",
      reason: "analysis-pixel-limit",
      pixelCount: Number.isSafeInteger(pixelCount) ? pixelCount : 0,
      transparentPixels: 0,
      translucentPixels: 0,
      lowAlphaPixels: 0,
      minTranslucentAlpha: 0,
      maxTranslucentAlpha: 0,
      occupiedAlphaBuckets: 0,
      alphaRgbCorrelation: 0,
      intensityGrowth: 0,
      normalizedIntensityRetention: 0,
      premultipliedRatio: 0,
      straightRatio: 0
    };
  }

  const { data } = await sharp(input, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    ...classifyStoredRgbaAlpha(data),
    reason: "full-resolution-alpha-analysis",
    pixelCount
  };
}

function createPngCompressor({ fs, sharp }) {
  function readImageInputBuffer(payload) {
    const inputPath = String(payload?.inputPath || "").trim();
    if (inputPath && fs.existsSync(inputPath)) return fs.readFileSync(inputPath);
    const fromBytes = safeBufferFromBytes(payload?.bytes);
    if (fromBytes && fromBytes.length > 0) return fromBytes;
    const fromDataUrl = typeof payload?.dataUrl === "string" ? dataUrlToBuffer(payload.dataUrl) : null;
    if (fromDataUrl && fromDataUrl.length > 0) return fromDataUrl;
    throw new Error("invalid image payload");
  }

  return async function compressPngWithSharp(payload, options) {
    const input = readImageInputBuffer(payload);
    const compressionLevel = Math.round(clampNumber(payload?.compressionLevel, 0, 9, 9));
    const effort = Math.round(clampNumber(payload?.effort, 1, 10, 8));
    const spineAtlasProfile = String(payload?.profile || "").trim() === SPINE_ATLAS_PMA_PROFILE;
    const requestedPalette = options?.palette === true;
    let effectivePalette = requestedPalette;
    let alphaAnalysis = null;
    let inputDirtyTransparentEntries = 0;

    if (spineAtlasProfile) {
      const inspectedInput = repairIndexedPngTransparentPalette(input);
      inputDirtyTransparentEntries = inspectedInput.repairedEntries;
      alphaAnalysis = await analyzeStoredPngAlpha(sharp, input);
      if (requestedPalette && alphaAnalysis.mode === "straight") {
        effectivePalette = false;
      }
    }

    const image = sharp(input, { limitInputPixels: false });
    const pngOptions = effectivePalette
      ? {
          compressionLevel,
          adaptiveFiltering: true,
          palette: true,
          quality: Math.round(clampNumber(payload?.quality, 1, 100, 80)),
          colours: Math.round(clampNumber(payload?.colors ?? payload?.colours, 2, 256, 256)),
          dither: clampNumber(payload?.dither, 0, 1, 0.5),
          effort
        }
      : {
          compressionLevel,
          adaptiveFiltering: true,
          palette: false,
          effort
        };
    const { data, info } = await image.png(pngOptions).toBuffer({ resolveWithObject: true });
    let outputData = data;
    let repairedTransparentEntries = 0;
    if (spineAtlasProfile) {
      const repaired = repairIndexedPngTransparentPalette(data);
      outputData = repaired.data;
      repairedTransparentEntries = repaired.repairedEntries;
    }

    return {
      ok: true,
      bytes: Array.from(outputData),
      width: Number(info?.width) || 0,
      height: Number(info?.height) || 0,
      size: outputData.length,
      spineAtlasProtection: spineAtlasProfile
        ? {
            alphaMode: alphaAnalysis?.mode || "ambiguous",
            pmaConfirmed: true,
            analysisReason: alphaAnalysis?.reason || "unknown",
            analyzedPixels: Number(alphaAnalysis?.pixelCount) || 0,
            safeFallback: requestedPalette && !effectivePalette,
            inputDirtyTransparentEntries,
            repairedTransparentEntries
          }
        : undefined
    };
  };
}

module.exports = {
  MAX_ALPHA_ANALYSIS_PIXELS,
  SPINE_ATLAS_PMA_PROFILE,
  classifyStoredRgbaAlpha,
  createPngCompressor
};
