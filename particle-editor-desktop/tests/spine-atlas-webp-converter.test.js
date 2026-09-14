const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const {
  convertSpineAtlasWebp,
  overwriteSpineAtlasWebpOutput,
  rewriteAtlasPngPagesToWebp,
  writeSpineAtlasWebpOutput
} = require("../main/spine-atlas-webp-converter");

const memoryFs = {
  existsSync: () => false,
  readFileSync: () => {
    throw new Error("unexpected file read");
  }
};

test("PMA WebP preserves every RGBA byte including transparent additive colors", async () => {
  const pixels = Buffer.alloc(64 * 64 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = (i / 4) % 256;
    pixels[i] = Math.round(alpha * 0.8);
    pixels[i + 1] = Math.round(alpha * 0.4);
    pixels[i + 2] = Math.round(alpha * 0.2);
    pixels[i + 3] = alpha;
  }
  pixels[0] = 97;
  pixels[1] = 41;
  const png = await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
  const result = await convertSpineAtlasWebp({
    atlasName: "fx.atlas", atlasText: "fx.png\nsize: 64,64\npma: true\nfx.png\nbounds: 0,0,64,64\n",
    images: [{ fileName: "fx.png", bytes: png }]
  }, { fs: memoryFs, sharp });
  assert.equal(result.images[0].encoding, "pma-lossless");
  assert.equal(result.images[0].rgbaVerified, true);
  assert.equal(result.images[0].pma, true);
  const decoded = await sharp(Buffer.from(result.images[0].bytes)).ensureAlpha().raw().toBuffer();
  assert.deepEqual(decoded, pixels);
  assert.equal(result.atlas.text, "fx.webp\nsize: 64,64\npma: true\nfx.png\nbounds: 0,0,64,64\n");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-pma-exact-"));
  writeSpineAtlasWebpOutput({ dir, atlas: result.atlas, images: result.images }, { fs });
  assert.deepEqual(await sharp(path.join(dir, "fx.webp")).ensureAlpha().raw().toBuffer(), pixels);
});

test("per-page alpha overrides update only page metadata and preserve BOM/CRLF", async () => {
  const png = await makePng();
  const atlas = "\uFEFFa.png\r\nsize: 4,4\r\nregion.png\r\nbounds: 0,0,4,4\r\n\r\nb.png\r\nsize: 4,4\r\npma: true\r\nregion2\r\npma: true\r\n";
  const result = await convertSpineAtlasWebp({
    atlasText: atlas,
    images: [{ fileName: "a.png", bytes: png, alphaMode: "pma" }, { fileName: "b.png", bytes: png, alphaMode: "straight" }]
  }, { fs: memoryFs, sharp });
  assert.equal(result.atlas.text, "\uFEFFa.webp\r\nsize: 4,4\r\npma: true\r\nregion.png\r\nbounds: 0,0,4,4\r\n\r\nb.webp\r\nsize: 4,4\r\npma: false\r\nregion2\r\npma: true\r\n");
  assert.deepEqual(result.images.map((image) => image.pma), [true, false]);
});

test("conflicting atlas PMA metadata requires an explicit source mode", async () => {
  const payload = {
    atlases: [{ fileName: "a.atlas", text: "fx.png\nsize: 4,4\npma: true\n" }, { fileName: "b.atlas", text: "fx.png\nsize: 4,4\npma: false\n" }],
    images: [{ fileName: "fx.png", bytes: await makePng() }]
  };
  await assert.rejects(convertSpineAtlasWebp(payload, { fs: memoryFs, sharp }), /PMA 标记冲突/);
  payload.images[0].alphaMode = "pma";
  const result = await convertSpineAtlasWebp(payload, { fs: memoryFs, sharp });
  assert.ok(result.atlases.every((atlas) => atlas.text.includes("pma: true")));
});

test("PMA to JPG does not multiply RGB by alpha a second time", async () => {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 100; pixels[i + 1] = 60; pixels[i + 2] = 20; pixels[i + 3] = 128; }
  const png = await sharp(pixels, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();
  const result = await convertSpineAtlasWebp({ atlasText: "fx.png\nsize: 16,16\npma: true\n", images: [{ fileName: "fx.png", bytes: png, outputFormat: "jpg" }] }, { fs: memoryFs, sharp });
  const decoded = await sharp(Buffer.from(result.images[0].bytes)).raw().toBuffer();
  assert.ok(Math.abs(decoded[0] - 100) <= 3);
  assert.ok(Math.abs(decoded[1] - 60) <= 3);
  assert.ok(Math.abs(decoded[2] - 20) <= 3);
  assert.match(result.atlas.text, /pma: false/);
});

test("PMA verification failure rejects conversion before any result can be exported", async () => {
  const png = await makePng();
  const failingSharp = (input) => {
    if (Buffer.isBuffer(input) && input.toString("ascii", 8, 12) === "WEBP") return sharp({ create: { width: 4, height: 4, channels: 4, background: "black" } });
    return sharp(input);
  };
  await assert.rejects(convertSpineAtlasWebp({ atlasText: "fx.png\nsize: 4,4\npma: true\n", images: [{ fileName: "fx.png", bytes: png }] }, { fs: memoryFs, sharp: failingSharp }), /像素校验失败/);
});

async function makePng(width = 4, height = 4) {
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 220;
    data[offset + 1] = 24;
    data[offset + 2] = 32;
    data[offset + 3] = offset % 8 === 0 ? 128 : 255;
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

test("legacy auto mode preserves all alpha levels and transparent RGB with lossy options", async () => {
  const pixels = Buffer.alloc(256 * 4 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = (i / 4) % 256;
    pixels[i] = Math.round(alpha * 0.8);
    pixels[i + 1] = Math.round(alpha * 0.4);
    pixels[i + 3] = alpha;
  }
  pixels[0] = 93;
  const png = await sharp(pixels, { raw: { width: 256, height: 4, channels: 4 } }).png().toBuffer();
  for (const extraHeader of ["", "pma: false\r\n"]) {
    const atlasText = `\uFEFFfx.png\r\nsize: 256,4\r\n${extraHeader}region.png\r\nbounds: 0,0,256,4\r\n`;
    const result = await convertSpineAtlasWebp({
      atlasText, images: [{ fileName: "fx.png", bytes: png }],
      options: extraHeader ? { lossless: true } : { mode: "spine", quality: 75, alphaQuality: 90 }
    }, { fs: memoryFs, sharp });
    assert.equal(result.images[0].rgbaVerified, true);
    assert.deepEqual(await sharp(Buffer.from(result.images[0].bytes)).ensureAlpha().raw().toBuffer(), pixels);
    assert.equal(result.atlas.text, atlasText.replace("fx.png", "fx.webp"));
  }
});

test("explicit straight lossy WebP retains every alpha byte even with stale alphaQuality", async () => {
  const pixels = Buffer.alloc(256 * 4);
  for (let i = 0; i < 256; i += 1) {
    pixels[i * 4] = 210;
    pixels[i * 4 + 1] = 90;
    pixels[i * 4 + 3] = i;
  }
  const png = await sharp(pixels, { raw: { width: 256, height: 1, channels: 4 } }).png().toBuffer();
  const result = await convertSpineAtlasWebp({
    atlasText: "fx.png\nsize: 256,1\npma: false\n",
    images: [{ fileName: "fx.png", bytes: png }], options: { alphaQuality: 90 }
  }, { fs: memoryFs, sharp });
  assert.equal(result.images[0].encoding, "spine");
  assert.equal(result.images[0].alphaQuality, 100);
  assert.equal(result.images[0].rgbaVerified, false);
  const decoded = await sharp(Buffer.from(result.images[0].bytes)).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < pixels.length; i += 4) assert.equal(decoded[i], pixels[i]);
});

test("unknown JPG source alpha requires an explicit choice instead of guessing", async () => {
  await assert.rejects(convertSpineAtlasWebp({
    atlasText: "fx.png\nsize: 4,4\n",
    images: [{ fileName: "fx.png", bytes: await makePng(), outputFormat: "jpg" }]
  }, { fs: memoryFs, sharp }), /转 JPG 前请选择/);
});

test("shared pages with missing and explicit PMA flags preserve pixels and both atlases", async () => {
  const png = await makePng();
  const atlases = [
    { fileName: "legacy.atlas", text: "fx.png\nsize: 4,4\n" },
    { fileName: "tagged.atlas", text: "fx.png\nsize: 4,4\npma: true\n" }
  ];
  const result = await convertSpineAtlasWebp({ atlases, images: [{ fileName: "fx.png", bytes: png }] }, { fs: memoryFs, sharp });
  assert.equal(result.images[0].sourceAlphaMode, "unknown");
  assert.equal(result.images[0].rgbaVerified, true);
  assert.deepEqual(result.atlases.map((atlas) => atlas.text), atlases.map((atlas) => atlas.text.replace("fx.png", "fx.webp")));
});

test("atlas rewrite changes only matching page headers", () => {
  const atlas = [
    "",
    "立绘.png",
    "size: 1946,1190",
    "format: RGBA8888",
    "filter: Linear,Linear",
    "repeat: none",
    "head.png",
    "  rotate: false",
    "  xy: 1, 2",
    "",
    "missing.png",
    "size: 32,32",
    "format: RGBA8888",
    "filter: Linear,Linear",
    "repeat: none",
    "body",
    "  rotate: false",
    ""
  ].join("\n");

  const rewritten = rewriteAtlasPngPagesToWebp(
    atlas,
    new Map([["立绘.png", "立绘.webp"]])
  );

  assert.match(rewritten.text, /\n立绘\.webp\nsize: 1946,1190/);
  assert.match(rewritten.text, /\nhead\.png\n  rotate: false/);
  assert.match(rewritten.text, /\nmissing\.png\nsize: 32,32/);
  assert.deepEqual(rewritten.replacements, [{ oldName: "立绘.png", nextName: "立绘.webp" }]);
  assert.deepEqual(rewritten.referencedPngNames.sort(), ["missing.png", "立绘.png"].sort());
});

function webpChunkTypes(buffer) {
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    chunks.push(type);
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

function isJpeg(buffer) {
  return buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[buffer.length - 2] === 0xff
    && buffer[buffer.length - 1] === 0xd9;
}

test("unmarked legacy atlas pages default to exact RGBA without inventing PMA metadata", async () => {
  const png = await makePng();
  const result = await convertSpineAtlasWebp(
    {
      atlasName: "立绘.atlas",
      atlasText: "\n立绘.png\nsize: 4,4\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nbody\n  rotate: false\n",
      images: [{ fileName: "立绘.png", bytes: Array.from(png) }]
    },
    { fs: memoryFs, sharp }
  );

  assert.equal(result.ok, true);
  assert.equal(result.atlas.fileName, "立绘.atlas");
  assert.match(result.atlas.text, /\n立绘\.webp\nsize: 4,4/);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].sourceName, "立绘.png");
  assert.equal(result.images[0].fileName, "立绘.webp");
  const output = Buffer.from(result.images[0].bytes);
  assert.equal(output.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(output.subarray(8, 12).toString("ascii"), "WEBP");
  assert.deepEqual(webpChunkTypes(output), ["VP8L"]);
  assert.equal(result.images[0].encoding, "rgba-lossless");
  assert.equal(result.images[0].sourceAlphaMode, "unknown");
  assert.equal(result.images[0].pma, null);
  assert.equal(result.images[0].rgbaVerified, true);
  assert.equal(result.images[0].quality, null);
  assert.equal(result.images[0].alphaQuality, null);
  assert.doesNotMatch(result.atlas.text, /pma:/);
  assert.deepEqual(await sharp(output).ensureAlpha().raw().toBuffer(), await sharp(png).ensureAlpha().raw().toBuffer());
  assert.equal(result.images[0].width, 4);
  assert.equal(result.images[0].height, 4);
});

test("keeps an explicit lossless WebP mode for exact PNG conversion", async () => {
  const png = await makePng();
  const result = await convertSpineAtlasWebp(
    {
      atlasName: "立绘.atlas",
      atlasText: "立绘.png\nsize: 4,4\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n",
      images: [{ fileName: "立绘.png", bytes: Array.from(png) }],
      options: { mode: "lossless", lossless: true }
    },
    { fs: memoryFs, sharp }
  );

  const output = Buffer.from(result.images[0].bytes);
  assert.deepEqual(webpChunkTypes(output), ["VP8L"]);
  assert.equal(result.images[0].encoding, "lossless");
  assert.equal(result.images[0].quality, null);
  assert.equal(result.images[0].alphaQuality, null);
});

test("converts multiple atlas files by matching page file names", async () => {
  const body = await makePng(2, 2);
  const face = await makePng(3, 3);
  const result = await convertSpineAtlasWebp(
    {
      atlases: [
        {
          fileName: "body.atlas",
          text: "body.png\nsize: 2,2\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nbodyRegion\n  rotate: false\n"
        },
        {
          fileName: "face.atlas",
          text: "face.png\nsize: 3,3\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nfaceRegion\n  rotate: false\n"
        }
      ],
      images: [
        { fileName: "body.png", bytes: Array.from(body) },
        { fileName: "face.png", bytes: Array.from(face) }
      ],
      options: { lossless: true }
    },
    { fs: memoryFs, sharp }
  );

  assert.equal(result.ok, true);
  assert.equal(result.atlases.length, 2);
  assert.match(result.atlases[0].text, /^body\.webp\nsize: 2,2/);
  assert.match(result.atlases[1].text, /^face\.webp\nsize: 3,3/);
  assert.match(result.atlases[0].text, /\nbodyRegion\n  rotate: false/);
  assert.match(result.atlases[1].text, /\nfaceRegion\n  rotate: false/);
  assert.deepEqual(result.images.map((item) => item.fileName).sort(), ["body.webp", "face.webp"]);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.every((warning) => warning.includes("atlas 未标记原图 Alpha")));
});

test("converts one atlas with mixed JPG and WebP page outputs", async () => {
  const body = await makePng(2, 2);
  const fx = await makePng(3, 3);
  const result = await convertSpineAtlasWebp(
    {
      atlasName: "mixed.atlas",
      atlasText: [
        "body.png",
        "size: 2,2",
        "format: RGBA8888",
        "filter: Linear,Linear",
        "repeat: none",
        "bodyRegion",
        "  rotate: false",
        "",
        "fx.png",
        "size: 3,3",
        "format: RGBA8888",
        "filter: Linear,Linear",
        "repeat: none",
        "fxRegion",
        "  rotate: false",
        ""
      ].join("\n"),
      images: [
        { fileName: "body.png", outputFormat: "jpg", alphaMode: "straight", bytes: Array.from(body) },
        { fileName: "fx.png", outputFormat: "webp", bytes: Array.from(fx) }
      ]
    },
    { fs: memoryFs, sharp }
  );

  assert.match(result.atlas.text, /^body\.jpg\nsize: 2,2/);
  assert.match(result.atlas.text, /\nfx\.webp\nsize: 3,3/);
  assert.deepEqual(result.atlas.replacements, [
    { oldName: "body.png", nextName: "body.jpg" },
    { oldName: "fx.png", nextName: "fx.webp" }
  ]);
  assert.deepEqual(result.images.map((item) => [item.sourceName, item.fileName, item.format]).sort(), [
    ["body.png", "body.jpg", "jpg"],
    ["fx.png", "fx.webp", "webp"]
  ].sort());
  assert.equal(isJpeg(Buffer.from(result.images.find((item) => item.fileName === "body.jpg").bytes)), true);
  assert.equal(Buffer.from(result.images.find((item) => item.fileName === "fx.webp").bytes).toString("ascii", 0, 4), "RIFF");
});

test("writes converted atlas and webp files to the selected output directory", async () => {
  const png = await makePng(2, 2);
  const result = await convertSpineAtlasWebp(
    {
      atlasName: "立绘.atlas",
      atlasText: "立绘.png\nsize: 2,2\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nbody\n  rotate: false\n",
      images: [{ fileName: "立绘.png", bytes: Array.from(png) }],
      options: { lossless: true }
    },
    { fs: memoryFs, sharp }
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-spine-webp-"));

  const saved = writeSpineAtlasWebpOutput({
    dir: outDir,
    atlas: result.atlas,
    images: result.images
  }, { fs });

  assert.equal(saved.ok, true);
  assert.deepEqual(saved.files.sort(), ["立绘.atlas", "立绘.webp"].sort());
  assert.equal(fs.readFileSync(path.join(outDir, "立绘.atlas"), "utf8").startsWith("立绘.webp\n"), true);
  const webp = fs.readFileSync(path.join(outDir, "立绘.webp"));
  assert.equal(webp.toString("ascii", 0, 4), "RIFF");
  assert.equal(webp.toString("ascii", 8, 12), "WEBP");
});

test("writes multiple converted atlas files to the selected output directory", async () => {
  const body = await makePng(2, 2);
  const face = await makePng(3, 3);
  const result = await convertSpineAtlasWebp(
    {
      atlases: [
        { fileName: "body.atlas", text: "body.png\nsize: 2,2\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n" },
        { fileName: "face.atlas", text: "face.png\nsize: 3,3\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n" }
      ],
      images: [
        { fileName: "body.png", bytes: Array.from(body) },
        { fileName: "face.png", bytes: Array.from(face) }
      ]
    },
    { fs: memoryFs, sharp }
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-spine-webp-multi-"));

  const saved = writeSpineAtlasWebpOutput({
    dir: outDir,
    atlases: result.atlases,
    images: result.images
  }, { fs });

  assert.equal(saved.ok, true);
  assert.deepEqual(saved.files.sort(), ["body.atlas", "body.webp", "face.atlas", "face.webp"].sort());
  assert.equal(fs.readFileSync(path.join(outDir, "body.atlas"), "utf8").startsWith("body.webp\n"), true);
  assert.equal(fs.readFileSync(path.join(outDir, "face.atlas"), "utf8").startsWith("face.webp\n"), true);
  assert.equal(fs.existsSync(path.join(outDir, "body.webp")), true);
  assert.equal(fs.existsSync(path.join(outDir, "face.webp")), true);
});

test("writes mixed JPG and WebP page outputs to the selected directory", async () => {
  const body = await makePng(2, 2);
  const fx = await makePng(3, 3);
  const result = await convertSpineAtlasWebp(
    {
      atlasName: "mixed.atlas",
      atlasText: "body.png\nsize: 2,2\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n\nfx.png\nsize: 3,3\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n",
      images: [
        { fileName: "body.png", outputFormat: "jpg", alphaMode: "straight", bytes: Array.from(body) },
        { fileName: "fx.png", outputFormat: "webp", bytes: Array.from(fx) }
      ]
    },
    { fs: memoryFs, sharp }
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-spine-mixed-"));

  const saved = writeSpineAtlasWebpOutput({
    dir: outDir,
    atlas: result.atlas,
    images: result.images
  }, { fs });

  assert.equal(saved.ok, true);
  assert.deepEqual(saved.files.sort(), ["body.jpg", "fx.webp", "mixed.atlas"].sort());
  assert.match(fs.readFileSync(path.join(outDir, "mixed.atlas"), "utf8"), /^body\.jpg\nsize: 2,2/);
  assert.match(fs.readFileSync(path.join(outDir, "mixed.atlas"), "utf8"), /\nfx\.webp\nsize: 3,3/);
  assert.equal(isJpeg(fs.readFileSync(path.join(outDir, "body.jpg"))), true);
  assert.equal(fs.readFileSync(path.join(outDir, "fx.webp")).toString("ascii", 8, 12), "WEBP");
});

test("overwrites source atlas, writes mixed outputs beside PNGs, and deletes original PNGs", async () => {
  const body = await makePng(2, 2);
  const fx = await makePng(3, 3);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-spine-overwrite-"));
  const atlasPath = path.join(outDir, "mixed.atlas");
  const bodyPath = path.join(outDir, "body.png");
  const fxPath = path.join(outDir, "fx.png");
  fs.writeFileSync(atlasPath, "body.png\nsize: 2,2\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n\nfx.png\nsize: 3,3\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n", "utf8");
  fs.writeFileSync(bodyPath, body);
  fs.writeFileSync(fxPath, fx);

  const result = await convertSpineAtlasWebp(
    {
      atlasName: "mixed.atlas",
      atlasText: fs.readFileSync(atlasPath, "utf8"),
      images: [
        { fileName: "body.png", outputFormat: "jpg", alphaMode: "straight", inputPath: bodyPath },
        { fileName: "fx.png", outputFormat: "webp", inputPath: fxPath }
      ]
    },
    { fs, sharp }
  );

  const saved = overwriteSpineAtlasWebpOutput({
    atlas: { ...result.atlas, sourcePath: atlasPath },
    images: [
      { ...result.images.find((item) => item.sourceName === "body.png"), sourcePath: bodyPath },
      { ...result.images.find((item) => item.sourceName === "fx.png"), sourcePath: fxPath }
    ]
  }, { fs });

  assert.equal(saved.ok, true);
  assert.match(fs.readFileSync(atlasPath, "utf8"), /^body\.jpg\nsize: 2,2/);
  assert.match(fs.readFileSync(atlasPath, "utf8"), /\nfx\.webp\nsize: 3,3/);
  assert.equal(fs.existsSync(bodyPath), false);
  assert.equal(fs.existsSync(fxPath), false);
  assert.equal(isJpeg(fs.readFileSync(path.join(outDir, "body.jpg"))), true);
  assert.equal(fs.readFileSync(path.join(outDir, "fx.webp")).toString("ascii", 8, 12), "WEBP");
  assert.deepEqual(saved.deletedPngs.sort(), ["body.png", "fx.png"].sort());
});

test("reports atlas PNG page references that were not uploaded", async () => {
  const png = await makePng();
  const result = await convertSpineAtlasWebp(
    {
      atlasName: "hero.atlas",
      atlasText: [
        "hero.png",
        "size: 4,4",
        "format: RGBA8888",
        "filter: Linear,Linear",
        "repeat: none",
        "",
        "extra.png",
        "size: 4,4",
        "format: RGBA8888",
        "filter: Linear,Linear",
        "repeat: none",
        ""
      ].join("\n"),
      images: [{ fileName: "hero.png", bytes: Array.from(png) }]
    },
    { fs: memoryFs, sharp }
  );

  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes("hero.atlas 引用的 PNG 未上传：extra.png"));
  assert.equal(result.images.length, 1);
});

test("fails closed when atlas does not match uploaded PNG files", async () => {
  const png = await makePng();
  await assert.rejects(
    convertSpineAtlasWebp(
      {
        atlasName: "hero.atlas",
        atlasText: "other.png\nsize: 4,4\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n",
        images: [{ fileName: "hero.png", bytes: Array.from(png) }]
      },
      { fs: memoryFs, sharp }
    ),
    /atlas 未匹配到已上传的 PNG 图集/
  );
});
