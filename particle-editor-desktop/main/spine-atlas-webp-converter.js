const path = require("path");
const { Worker } = require("node:worker_threads");
const { dataUrlToBuffer, safeBufferFromBytes, hasPngSignature } = require("./buffer-helpers");
const { sanitizeFileName, sanitizeFileStem } = require("./path-helpers");

function normalizeName(value) {
  return String(value || "").replace(/\\/g, "/").split("/").pop().trim().toLowerCase();
}

function toWebpFileName(fileName) {
  const clean = sanitizeFileName(fileName) || "atlas.png";
  const stem = sanitizeFileStem(clean, "atlas");
  return `${stem}.webp`;
}

function toJpgFileName(fileName) {
  const clean = sanitizeFileName(fileName) || "atlas.png";
  const stem = sanitizeFileStem(clean, "atlas");
  return `${stem}.jpg`;
}

function normalizeOutputFormat(value) {
  const format = String(value || "").trim().toLowerCase();
  if (format === "jpg" || format === "jpeg") return "jpg";
  return "webp";
}

function outputFileNameForFormat(fileName, format) {
  return normalizeOutputFormat(format) === "jpg" ? toJpgFileName(fileName) : toWebpFileName(fileName);
}

function atlasOutputFileName(atlasName) {
  const clean = sanitizeFileName(atlasName) || "spine.atlas";
  const stem = sanitizeFileStem(clean, "spine");
  return `${stem}.atlas`;
}

function hasWebpSignature(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP";
}

function hasJpegSignature(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 4
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[buffer.length - 2] === 0xff
    && buffer[buffer.length - 1] === 0xd9;
}

function normalizeSourcePath(value) {
  const sourcePath = String(value || "").trim();
  if (!sourcePath || !path.isAbsolute(sourcePath)) return "";
  return path.resolve(sourcePath);
}

function assertExistingSourceFile(filePath, expectedExt, fs, label) {
  const resolved = normalizeSourcePath(filePath);
  if (!resolved) throw new Error(`${label} 缺少原文件路径`);
  if (!new RegExp(`\\.${expectedExt}$`, "i").test(resolved)) throw new Error(`${label} 原文件类型无效`);
  if (!fs.existsSync(resolved)) throw new Error(`${label} 原文件不存在`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`${label} 原路径不是文件`);
  return resolved;
}

function uniquePathKey(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function readImageInputBuffer(payload, fs) {
  const inputPath = String(payload?.inputPath || "").trim();
  if (inputPath && fs?.existsSync?.(inputPath)) return fs.readFileSync(inputPath);
  const fromBytes = safeBufferFromBytes(payload?.bytes);
  if (fromBytes && fromBytes.length > 0) return fromBytes;
  const fromDataUrl = typeof payload?.dataUrl === "string"
    ? dataUrlToBuffer(payload.dataUrl, { mime: "image/png", requirePng: true })
    : null;
  if (fromDataUrl && fromDataUrl.length > 0) return fromDataUrl;
  throw new Error(`PNG 输入无效：${sanitizeFileName(payload?.fileName) || "unnamed.png"}`);
}

function clampInt(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function resolveWebpEncodeOptions(options) {
  const mode = String(options?.mode || "").trim().toLowerCase();
  if (options?.lossless === true || mode === "lossless") {
    return {
      mode: "lossless",
      sharp: { lossless: true, effort: 6 },
      quality: null,
      alphaQuality: null
    };
  }

  const quality = clampInt(options?.quality, 75, 1, 100);
  const alphaQuality = clampInt(options?.alphaQuality, 90, 1, 100);
  return {
    mode: "spine",
    sharp: { quality, alphaQuality, smartSubsample: true, effort: 6 },
    quality,
    alphaQuality
  };
}

function splitAtlasLines(text) {
  const source = String(text || "");
  const matches = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) || [];
  return matches.filter((line, index) => line.length > 0 || index < matches.length - 1).map((raw) => {
    const newlineMatch = raw.match(/(\r\n|\n|\r)$/);
    const newline = newlineMatch ? newlineMatch[0] : "";
    return { body: newline ? raw.slice(0, -newline.length) : raw, newline };
  });
}

function isAtlasPageHeader(lines, index) {
  const body = lines[index].body.replace(/^\uFEFF/, "");
  return !!body.trim() && !body.includes(":")
    && (index === 0 || !lines[index - 1].body.trim());
}

function atlasPages(lines) {
  const pages = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isAtlasPageHeader(lines, i)) continue;
    let end = i + 1;
    let pma = false;
    let pmaIndex = -1;
    while (end < lines.length && lines[end].body.includes(":")) {
      const match = lines[end].body.match(/^\s*pma\s*:\s*(true|false)\s*$/i);
      if (match) { pma = match[1].toLowerCase() === "true"; pmaIndex = end; }
      end += 1;
    }
    pages.push({ index: i, end, pma, pmaIndex, name: lines[i].body.trim() });
  }
  return pages;
}

function rewriteAtlasPngPagesToOutput(atlasText, pngNameToOutputName, outputPma = new Map()) {
  const lines = splitAtlasLines(atlasText);
  const replacements = [];
  const referencedPngNames = new Set();
  // Page boundaries, not property indentation, distinguish modern atlas regions.
  for (const page of atlasPages(lines).reverse()) {
    const line = lines[page.index];
    const original = page.name;
    if (!/\.png$/i.test(original)) continue;
    referencedPngNames.add(normalizeName(original));
    const nextName = pngNameToOutputName.get(normalizeName(original));
    if (!nextName) continue;
    replacements.unshift({ oldName: original, nextName });
    line.body = line.body.replace(original, nextName);
    if (outputPma.has(normalizeName(original))) {
      const pma = outputPma.get(normalizeName(original));
      if (page.pmaIndex >= 0) {
        lines[page.pmaIndex].body = lines[page.pmaIndex].body.replace(/(true|false)/i, String(pma));
      } else if (pma) {
        const newline = line.newline || "\n";
        if (!lines[page.end - 1].newline) lines[page.end - 1].newline = newline;
        lines.splice(page.end, 0, { body: `pma: ${pma}`, newline });
      }
    }
  }
  const output = lines.map((line) => `${line.body}${line.newline}`).join("");
  return { text: output, replacements, referencedPngNames: Array.from(referencedPngNames) };
}

async function encodeExactWebp(input, sharp) {
  const { data: original, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bytes = Uint8Array.from(original).buffer;
  const data = await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "spine-webp-exact-worker.mjs"), {
      workerData: { bytes, width: info.width, height: info.height }, transferList: [bytes]
    });
    let result;
    worker.once("message", (message) => { result = message; });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0 || !result?.bytes) reject(new Error(result?.error || `WebP encoder exited: ${code}`));
      else resolve(Buffer.from(result.bytes));
    });
  });
  const decoded = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== info.width || decoded.info.height !== info.height || !original.equals(decoded.data)) {
    throw new Error("PMA WebP 像素校验失败，未生成可导出结果");
  }
  return { data, info };
}

function rewriteAtlasPngPagesToWebp(atlasText, pngNameToWebpName) {
  return rewriteAtlasPngPagesToOutput(atlasText, pngNameToWebpName);
}

function normalizeAtlasInputs(payload) {
  const rawAtlases = Array.isArray(payload?.atlases) ? payload.atlases : [];
  const atlases = rawAtlases.map((atlas, index) => ({
    fileName: atlasOutputFileName(atlas?.fileName || atlas?.atlasName || `spine_${index + 1}.atlas`),
    text: typeof atlas?.text === "string" ? atlas.text : String(atlas?.atlasText || "")
  })).filter((atlas) => atlas.text.trim());

  if (!atlases.length && typeof payload?.atlasText === "string" && payload.atlasText.trim()) {
    atlases.push({
      fileName: atlasOutputFileName(payload?.atlasName),
      text: payload.atlasText
    });
  }
  return atlases;
}

async function convertSpineAtlasWebp(payload, { fs, sharp }) {
  const atlasInputs = normalizeAtlasInputs(payload);
  if (!atlasInputs.length) throw new Error("缺少 atlas 文件内容");
  const encodeOptions = resolveWebpEncodeOptions(payload?.options || {});

  const rawImages = Array.isArray(payload?.images) ? payload.images : [];
  if (!rawImages.length) throw new Error("请至少上传 1 张 PNG 图集");

  const imageInputs = [];
  const pngNameToOutputName = new Map();
  const outputPma = new Map();
  const pages = atlasInputs.flatMap((atlas) => atlasPages(splitAtlasLines(atlas.text)));
  for (const image of rawImages) {
    const sourceName = sanitizeFileName(image?.fileName) || "atlas.png";
    if (!/\.png$/i.test(sourceName)) continue;
    const input = readImageInputBuffer(image, fs);
    if (!hasPngSignature(input)) throw new Error(`PNG 解码失败：${sourceName}`);
    const outputFormat = normalizeOutputFormat(image?.outputFormat || image?.format || image?.targetFormat);
    const outputName = outputFileNameForFormat(sourceName, outputFormat);
    const key = normalizeName(sourceName);
    if (pngNameToOutputName.has(key)) throw new Error(`PNG 文件名重复：${sourceName}`);
    const alphaMode = image?.alphaMode || "auto";
    if (!["auto", "straight", "pma"].includes(alphaMode)) throw new Error(`Alpha 设置无效：${sourceName}`);
    const pageModes = new Set(pages.filter((page) => normalizeName(page.name) === key).map((page) => page.pma));
    if (alphaMode === "auto" && pageModes.size > 1) throw new Error(`atlas 的 PMA 标记冲突，请指定原图 Alpha：${sourceName}`);
    const pma = alphaMode === "pma" || (alphaMode === "auto" && pageModes.has(true));
    if (alphaMode !== "auto" || outputFormat === "jpg") outputPma.set(key, outputFormat === "webp" && pma);
    imageInputs.push({ sourceName, input, outputName, outputFormat, pma });
    pngNameToOutputName.set(normalizeName(sourceName), outputName);
  }

  if (!imageInputs.length) throw new Error("请上传 .png 格式的 Spine 图集");

  const warnings = [];
  const convertedAtlases = [];
  const matchedSourceNames = new Set();
  for (const inputAtlas of atlasInputs) {
    const atlas = rewriteAtlasPngPagesToOutput(inputAtlas.text, pngNameToOutputName, outputPma);
    if (!atlas.replacements.length) {
      warnings.push(`${inputAtlas.fileName} 未匹配到已上传的 PNG 图集`);
      continue;
    }
    for (const replacement of atlas.replacements) matchedSourceNames.add(normalizeName(replacement.oldName));
    for (const ref of atlas.referencedPngNames) {
      if (!pngNameToOutputName.has(ref)) warnings.push(`${inputAtlas.fileName} 引用的 PNG 未上传：${ref}`);
    }
    convertedAtlases.push({
      fileName: inputAtlas.fileName,
      text: atlas.text,
      replacements: atlas.replacements
    });
  }
  if (!convertedAtlases.length) throw new Error("atlas 未匹配到已上传的 PNG 图集");

  const convertedImages = [];
  for (const image of imageInputs) {
    if (!matchedSourceNames.has(normalizeName(image.sourceName))) continue;
    const pipeline = sharp(image.input, { limitInputPixels: false });
    const protectedPma = image.pma && image.outputFormat === "webp";
    const { data, info } = protectedPma
      ? await encodeExactWebp(image.input, sharp)
      : image.outputFormat === "jpg"
      ? await (image.pma ? pipeline.removeAlpha() : pipeline.flatten({ background: { r: 0, g: 0, b: 0 } }))
        .jpeg({ quality: clampInt(payload?.options?.jpgQuality, 85, 1, 100), mozjpeg: true })
        .toBuffer({ resolveWithObject: true })
      : await pipeline
        .ensureAlpha()
        .webp(encodeOptions.sharp)
        .toBuffer({ resolveWithObject: true });
    if (protectedPma) warnings.push(`${image.sourceName}：PMA 无损保护，已校验 RGBA；体积可能较大`);
    if (image.outputFormat === "jpg") warnings.push(`${image.sourceName}：JPG 不保留透明，输出黑底`);
    convertedImages.push({
      sourceName: image.sourceName,
      fileName: image.outputName,
      format: image.outputFormat,
      bytes: Array.from(data),
      width: Number(info?.width) || 0,
      height: Number(info?.height) || 0,
      size: data.length,
      sourceAlphaMode: image.pma ? "pma" : "straight",
      pma: image.outputFormat === "webp" && image.pma,
      rgbaVerified: protectedPma,
      encoding: protectedPma ? "pma-lossless" : image.outputFormat === "jpg" ? "jpg" : encodeOptions.mode,
      quality: image.outputFormat === "jpg" ? clampInt(payload?.options?.jpgQuality, 85, 1, 100) : protectedPma ? null : encodeOptions.quality,
      alphaQuality: image.outputFormat === "jpg" || protectedPma ? null : encodeOptions.alphaQuality
    });
  }

  if (!convertedImages.length) throw new Error("未生成图集");

  return {
    ok: true,
    atlas: convertedAtlases[0],
    atlases: convertedAtlases,
    images: convertedImages,
    warnings
  };
}

function writeSpineAtlasWebpOutput(payload, { fs }) {
  const dir = String(payload?.dir || "").trim();
  const atlases = (Array.isArray(payload?.atlases) ? payload.atlases : [])
    .concat(payload?.atlas ? [payload.atlas] : [])
    .map((atlas) => ({
      fileName: sanitizeFileName(atlas?.fileName || "spine.atlas") || "spine.atlas",
      text: atlas?.text
    }))
    .filter((atlas, index, list) => atlas.text && list.findIndex((item) => item.fileName === atlas.fileName) === index);
  const images = Array.isArray(payload?.images) ? payload.images : [];
  if (!dir) throw new Error("缺少导出目录");
  if (!atlases.length) throw new Error("atlas 内容无效");
  if (!images.length) throw new Error("没有可导出的图集");

  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const atlas of atlases) {
    if (!/\.atlas$/i.test(atlas.fileName)) throw new Error("atlas 文件名无效");
    if (typeof atlas.text !== "string" || !atlas.text.trim()) throw new Error("atlas 内容无效");
    fs.writeFileSync(path.join(dir, atlas.fileName), atlas.text, "utf8");
    files.push(atlas.fileName);
  }

  for (const image of images) {
    const fileName = sanitizeFileName(image?.fileName || "");
    if (!fileName || !/\.(webp|jpe?g)$/i.test(fileName)) throw new Error("图集文件名无效");
    const buffer = safeBufferFromBytes(image?.bytes);
    const validOutput = /\.webp$/i.test(fileName) ? hasWebpSignature(buffer) : hasJpegSignature(buffer);
    if (!buffer || !buffer.length || !validOutput) throw new Error(`图集输出无效：${fileName}`);
    fs.writeFileSync(path.join(dir, fileName), buffer);
    files.push(fileName);
  }

  return { ok: true, dir, files };
}

function overwriteSpineAtlasWebpOutput(payload, { fs }) {
  const atlases = (Array.isArray(payload?.atlases) ? payload.atlases : [])
    .concat(payload?.atlas ? [payload.atlas] : [])
    .filter((atlas) => atlas);
  const images = Array.isArray(payload?.images) ? payload.images : [];
  if (!atlases.length) throw new Error("atlas 内容无效");
  if (!images.length) throw new Error("没有可覆盖的图集");

  const writes = [];
  const sourcePngs = [];
  const targetKeys = new Set();
  const sourceKeys = new Set();

  for (const atlas of atlases) {
    const sourcePath = assertExistingSourceFile(atlas?.sourcePath || atlas?.inputPath, "atlas", fs, "atlas");
    if (typeof atlas?.text !== "string" || !atlas.text.trim()) throw new Error("atlas 内容无效");
    const key = uniquePathKey(sourcePath);
    if (targetKeys.has(key)) throw new Error(`重复覆盖路径：${path.basename(sourcePath)}`);
    targetKeys.add(key);
    writes.push({ targetPath: sourcePath, data: Buffer.from(atlas.text, "utf8"), encoding: "utf8", name: path.basename(sourcePath) });
  }

  for (const image of images) {
    const sourcePath = assertExistingSourceFile(image?.sourcePath || image?.inputPath, "png", fs, "PNG");
    const sourceKey = uniquePathKey(sourcePath);
    if (sourceKeys.has(sourceKey)) throw new Error(`重复 PNG 原文件：${path.basename(sourcePath)}`);
    sourceKeys.add(sourceKey);

    const fileName = sanitizeFileName(image?.fileName || "");
    if (!fileName || !/\.(webp|jpe?g)$/i.test(fileName)) throw new Error("图集文件名无效");
    const buffer = safeBufferFromBytes(image?.bytes);
    const validOutput = /\.webp$/i.test(fileName) ? hasWebpSignature(buffer) : hasJpegSignature(buffer);
    if (!buffer || !buffer.length || !validOutput) throw new Error(`图集输出无效：${fileName}`);

    const targetPath = path.join(path.dirname(sourcePath), fileName);
    if (uniquePathKey(targetPath) === sourceKey) throw new Error(`输出不能覆盖原 PNG：${path.basename(sourcePath)}`);
    const targetKey = uniquePathKey(targetPath);
    if (targetKeys.has(targetKey)) throw new Error(`重复覆盖路径：${fileName}`);
    targetKeys.add(targetKey);

    writes.push({ targetPath, data: buffer, name: fileName });
    sourcePngs.push(sourcePath);
  }

  const temps = [];
  try {
    for (const [index, write] of writes.entries()) {
      fs.mkdirSync(path.dirname(write.targetPath), { recursive: true });
      const tempPath = path.join(path.dirname(write.targetPath), `.novaflow-spine-${process.pid}-${Date.now()}-${index}.tmp`);
      fs.writeFileSync(tempPath, write.data, write.encoding);
      temps.push({ tempPath, targetPath: write.targetPath, name: write.name });
    }
    for (const item of temps) {
      fs.copyFileSync(item.tempPath, item.targetPath);
      fs.unlinkSync(item.tempPath);
      item.committed = true;
    }
    for (const sourcePath of sourcePngs) {
      if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
    }
  } finally {
    for (const item of temps) {
      if (!item.committed && fs.existsSync(item.tempPath)) {
        try { fs.unlinkSync(item.tempPath); } catch {}
      }
    }
  }

  return {
    ok: true,
    files: writes.map((item) => item.name),
    overwritten: writes.map((item) => item.targetPath),
    deletedPngs: sourcePngs.map((item) => path.basename(item))
  };
}

module.exports = {
  atlasOutputFileName,
  convertSpineAtlasWebp,
  overwriteSpineAtlasWebpOutput,
  rewriteAtlasPngPagesToOutput,
  rewriteAtlasPngPagesToWebp,
  toJpgFileName,
  toWebpFileName,
  writeSpineAtlasWebpOutput
};
