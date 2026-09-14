const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");
const { encodePmaCompatibleWebp, webpChunks } = require("../main/spine-webp-pma-encoder");
const { convertSpineAtlasWebp } = require("../main/spine-atlas-webp-converter");

async function fixture(width = 65, height = 63, opaque = false) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const a = opaque ? 255 : Math.round(255 * Math.max(0, 1 - Math.hypot(x - width / 2, y - height / 2) / (width * 0.4)));
    pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.floor(a * 0.6);
    pixels[i + 3] = a;
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { png, pixels, width, height };
}

function payload(png, options = {}) {
  return {
    atlasName: "fx.atlas", atlasText: "fx.png\nsize: 65,63\npma: true\nfx.png\nbounds: 0,0,65,63\n",
    images: [{ fileName: "fx.png", bytes: png }], options
  };
}

test("PMA Q90 keeps alpha and clean transparent RGB, including odd dimensions", async () => {
  const source = await fixture();
  const output = await encodePmaCompatibleWebp(source.png, sharp);
  assert.equal(output.quality, 90);
  assert.ok(output.passes >= 1 && output.passes <= 4);
  assert.ok(webpChunks(output.data).has("VP8 "));
  assert.ok(webpChunks(output.data).has("ALPH"));
  const decoded = await sharp(output.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, source.width);
  assert.equal(decoded.info.height, source.height);
  let error = 0;
  for (let i = 0; i < source.pixels.length; i += 4) {
    assert.equal(decoded.data[i + 3], source.pixels[i + 3]);
    for (let c = 0; c < 3; c++) {
      if (source.pixels[i + 3] === 0) assert.equal(decoded.data[i + c], 0);
      error += Math.abs(decoded.data[i + c] - source.pixels[i + c]);
    }
  }
  // Stored PMA color must not be multiplied by alpha a second time.
  assert.ok(error / (source.width * source.height * 3) < 3);
});

test("fully opaque PMA uses a valid color-only WebP", async () => {
  const source = await fixture(17, 15, true);
  const output = await encodePmaCompatibleWebp(source.png, sharp);
  assert.equal(webpChunks(output.data).has("ALPH"), false);
  const decoded = await sharp(output.data).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < decoded.length; i += 4) assert.equal(decoded[i], 255);
});

test("large FFmpeg pipe output gets a complete RIFF size without relaxing chunk validation", async () => {
  const pixels = Buffer.alloc(256 * 256 * 4);
  let seed = 42;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = i % 4 === 3 ? 255 : seed >>> 24;
  }
  const png = await sharp(pixels, { raw: { width: 256, height: 256, channels: 4 } }).png().toBuffer();
  const output = await encodePmaCompatibleWebp(png, sharp);
  assert.ok(output.data.length > 32768);
  assert.equal(output.data.readUInt32LE(4), output.data.length - 8);
  assert.ok(webpChunks(output.data).has("VP8 "));
  const decoded = await sharp(output.data).metadata();
  assert.equal(decoded.width, 256);
  assert.equal(decoded.height, 256);
});

test("converter reports compatible output, keeps PMA metadata and changes page names only", async () => {
  const { png } = await fixture();
  const input = payload(png, { quality: 75, alphaQuality: 90 });
  const result = await convertSpineAtlasWebp(input, { fs, sharp });
  const image = result.images[0];
  assert.equal(image.encoding, "pma-compatible");
  assert.equal(image.quality, 90);
  assert.equal(image.alphaQuality, 100);
  assert.equal(image.pma, true);
  assert.equal(image.rgbaVerified, false);
  assert.equal(image.alphaVerified, true);
  assert.equal(image.transparentRgbVerified, true);
  assert.equal(image.size, image.bytes.length);
  assert.equal(result.atlas.text, input.atlasText.replace("fx.png", "fx.webp"));
  assert.deepEqual(result.warnings, []);
});

test("explicit lossless bypasses compatible encoding and preserves every pixel", async () => {
  const { png, pixels } = await fixture();
  const result = await convertSpineAtlasWebp(payload(png, { lossless: true }), {
    fs, sharp, encodePma: () => assert.fail("lossless must bypass compatible encoder")
  });
  assert.equal(result.images[0].encoding, "pma-lossless");
  assert.equal(result.images[0].rgbaVerified, true);
  assert.deepEqual(await sharp(Buffer.from(result.images[0].bytes)).ensureAlpha().raw().toBuffer(), pixels);
});

test("fixed presets control actual PMA WebP quality without changing alpha", async () => {
  const { png, pixels } = await fixture();
  const outputs = [];
  for (const [preset, quality] of [["clarity", 95], ["compact", 90], ["small", 86]]) {
    const result = await convertSpineAtlasWebp(payload(png, { preset }), { fs, sharp });
    const image = result.images[0];
    assert.equal(image.encoding, "pma-compatible");
    assert.equal(image.quality, quality);
    assert.equal(image.alphaQuality, 100);
    assert.equal(image.pma, true);
    assert.deepEqual(result.warnings, []);
    const bytes = Buffer.from(image.bytes);
    const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < pixels.length; i += 4) {
      assert.equal(decoded[i + 3], pixels[i + 3]);
      if (!pixels[i + 3]) assert.deepEqual(decoded.subarray(i, i + 3), Buffer.alloc(3));
    }
    outputs.push(bytes);
  }
  assert.notDeepEqual(outputs[0], outputs[1]);
  assert.notDeepEqual(outputs[1], outputs[2]);
  const baseline = await encodePmaCompatibleWebp(png, sharp);
  assert.deepEqual(outputs[1], baseline.data);
});

test("one preset applies to mixed JPG, straight WebP and PMA WebP pages", async () => {
  const { png, pixels } = await fixture();
  const input = {
    atlasText: "a.png\nsize:65,63\npma:true\n\nb.png\nsize:65,63\npma:false\n\nc.png\nsize:65,63\npma:true\n",
    images: [
      { fileName: "a.png", bytes: png },
      { fileName: "b.png", bytes: png },
      { fileName: "c.png", bytes: png, outputFormat: "jpg" }
    ],
    options: { preset: "clarity", lossless: true, quality: 99, jpgQuality: 99 }
  };
  const result = await convertSpineAtlasWebp(input, { fs, sharp });
  assert.deepEqual(result.images.map(image => image.quality), [95, 95, 95]);
  assert.deepEqual(result.images.map(image => image.encoding), ["pma-compatible", "spine", "jpg"]);
  assert.deepEqual(result.images.map(image => image.fileName), ["a.webp", "b.webp", "c.jpg"]);
  assert.equal(result.atlas.text, "a.webp\nsize:65,63\npma:true\n\nb.webp\nsize:65,63\npma:false\n\nc.jpg\nsize:65,63\npma:false\n");
  input.options = { preset: "small" };
  const smaller = await convertSpineAtlasWebp(input, { fs, sharp });
  assert.deepEqual(smaller.images.map(image => image.quality), [86, 86, 86]);
  assert.deepEqual(smaller.images.map(image => image.encoding), ["pma-compatible", "spine", "jpg"]);
  assert.equal(smaller.atlas.text, result.atlas.text);
  input.options = { lossless: true };
  const lossless = await convertSpineAtlasWebp(input, { fs, sharp, encodePma: () => assert.fail("legacy lossless must bypass compatible encoding") });
  for (const image of lossless.images.slice(0, 2)) {
    assert.equal(image.rgbaVerified, true);
    assert.deepEqual(await sharp(Buffer.from(image.bytes)).ensureAlpha().raw().toBuffer(), pixels);
  }
  assert.equal(lossless.images[2].quality, 85);
  assert.equal(lossless.images[2].encoding, "jpg");
});

test("invalid presets are rejected at the converter boundary", async () => {
  const { png } = await fixture();
  for (const preset of ["", "lossless", "strong", "constructor", "toString", "__proto__", 90, NaN, null, true, [], ["compact"], {}]) {
    await assert.rejects(convertSpineAtlasWebp(payload(png, { preset }), {
      fs, sharp, encodePma: () => assert.fail("invalid presets must not encode")
    }), /压缩档位无效/);
  }
});

test("encoder failure produces an explicit warning and verified lossless fallback", async () => {
  const { png, pixels } = await fixture();
  const result = await convertSpineAtlasWebp(payload(png), {
    fs, sharp, encodePma: () => { throw new Error("encoder unavailable"); }
  });
  assert.match(result.warnings.join("\n"), /encoder unavailable/);
  assert.match(result.warnings.join("\n"), /回退无损/);
  assert.equal(result.images[0].encoding, "pma-lossless");
  assert.equal(result.images[0].transparentRgbVerified, false);
  assert.deepEqual(await sharp(Buffer.from(result.images[0].bytes)).ensureAlpha().raw().toBuffer(), pixels);
});

test("small preset retries only transparent RGB spill at Q90 and reports the actual quality", async () => {
  const { png } = await fixture();
  const attempts = [];
  const result = await convertSpineAtlasWebp(payload(png, { preset: "small" }), {
    fs, sharp, encodePma: async (input, sharpInstance, options) => {
      attempts.push(options);
      if (options.quality === 86) throw Object.assign(new Error("transparent spill"), { code: "PMA_TRANSPARENT_RGB" });
      return encodePmaCompatibleWebp(input, sharpInstance, options);
    }
  });
  assert.deepEqual(attempts, [{ quality: 86, codecPreset: "drawing" }, { quality: 90 }]);
  assert.equal(result.images[0].quality, 90);
  assert.equal(result.images[0].encoding, "pma-compatible");
  assert.equal(result.images[0].transparentRgbVerified, true);
  assert.match(result.warnings.join("\n"), /Q86.*Q90/);
});

test("small preset keeps exact fallback when verification fails, with bounded retries", async () => {
  const { png, pixels } = await fixture();
  for (const code of ["PMA_TRANSPARENT_RGB", "ALPHA_CORRUPTION", "SPAWN_FAILED"]) {
    const attempts = [];
    const result = await convertSpineAtlasWebp(payload(png, { preset: "small" }), {
      fs, sharp, encodePma: async (_input, _sharp, options) => {
        attempts.push(options.quality);
        throw Object.assign(new Error(code), { code });
      }
    });
    assert.deepEqual(attempts, code === "PMA_TRANSPARENT_RGB" ? [86, 90] : [86]);
    assert.equal(result.images[0].encoding, "pma-lossless");
    assert.equal(result.images[0].quality, null);
    assert.match(result.warnings.join("\n"), /回退无损/);
    assert.deepEqual(await sharp(Buffer.from(result.images[0].bytes)).ensureAlpha().raw().toBuffer(), pixels);
  }
});

test("unsupported codec profiles cannot be passed to FFmpeg", async () => {
  await assert.rejects(encodePmaCompatibleWebp(Buffer.alloc(0), sharp, { codecPreset: "photo" }), /Invalid PMA codec preset/);
});

test("alpha corruption is rejected and never labelled compatible", async () => {
  const { png } = await fixture();
  const corruptSharp = (input, options) => {
    if (Buffer.isBuffer(input) && input.toString("ascii", 8, 12) === "WEBP") {
      return sharp({ create: { width: 65, height: 63, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } });
    }
    return sharp(input, options);
  };
  await assert.rejects(encodePmaCompatibleWebp(png, corruptSharp), /Alpha/);
});

test("persistent transparent RGB spill is bounded and rejected", async () => {
  const { png, pixels } = await fixture();
  let decodes = 0;
  const corruptSharp = (input, options) => {
    if (Buffer.isBuffer(input) && input.toString("ascii", 8, 12) === "WEBP") {
      decodes++;
      const dirty = Buffer.from(pixels);
      dirty[0] = 12;
      return sharp(dirty, { raw: { width: 65, height: 63, channels: 4 } });
    }
    return sharp(input, options);
  };
  await assert.rejects(encodePmaCompatibleWebp(png, corruptSharp), /透明区域/);
  assert.equal(decodes, 4);
});

test("invalid frames and FFmpeg failures propagate instead of generating partial output", async () => {
  const { png } = await fixture();
  await assert.rejects(encodePmaCompatibleWebp(png, sharp, { run: async () => Buffer.alloc(2) }), /YUV/);
  await assert.rejects(encodePmaCompatibleWebp(png, sharp, { run: async () => { throw new Error("spawn failed"); } }), /spawn failed/);
});

test("RIFF parser rejects truncated and oversized chunks", async () => {
  const { png } = await fixture();
  const webp = await sharp(png).webp().toBuffer();
  assert.ok(webpChunks(webp).has("ALPH"));
  assert.throws(() => webpChunks(webp.subarray(0, webp.length - 1)), /container/);
  const corrupted = Buffer.from(webp);
  corrupted.writeUInt32LE(0xffffffff, 16);
  assert.throws(() => webpChunks(corrupted), /chunk/);
});

test("compatible helper participates in runtime sync and main-directory packaging", () => {
  const root = path.resolve(__dirname, "../..");
  const files = fs.readFileSync(path.join(root, "scripts/spine-webp-runtime-files.mjs"), "utf8");
  assert.match(files, /main\/spine-webp-pma-encoder\.js/);
  for (const script of ["sync-runtime.mjs", "check-runtime-sync.mjs"]) {
    assert.match(fs.readFileSync(path.join(root, "scripts", script), "utf8"), /spineWebpRuntimeFiles/);
  }
  const build = fs.readFileSync(path.join(root, "particle-editor-desktop/scripts/build-renderer.mjs"), "utf8");
  assert.match(build, /desktopAppShellDirs = \["admin-server", "main"\]/);
});
