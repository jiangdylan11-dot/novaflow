const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const sharp = require(path.join(root, 'node_modules/sharp'));
  const { convertSpineAtlasWebp, writeSpineAtlasWebpOutput } = require(path.join(root, 'main/spine-atlas-webp-converter'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaflow-pma-smoke-'));
  const width = 256;
  const height = 128;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = Math.round(255 * Math.max(0, 1 - Math.hypot((x - 128) / 100, (y - 64) / 50)));
      data[i] = alpha;
      data[i + 1] = Math.round(alpha * 0.55);
      data[i + 3] = alpha;
    }
  }
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  fs.writeFileSync(path.join(dir, 'fx.png'), png);
  fs.writeFileSync(path.join(dir, 'second.png'), png);
  const atlasText = 'fx.png\nsize: 256,128\npma: true\nfx\nbounds: 0,0,256,128\n\nsecond.png\nsize: 256,128\npma: true\nsecond\nbounds: 0,0,256,128\n';
  fs.writeFileSync(path.join(dir, 'sample.atlas'), atlasText);
  const result = await convertSpineAtlasWebp({
    atlasName: 'sample.atlas', atlasText,
    images: [{ fileName: 'fx.png', bytes: png }, { fileName: 'second.png', bytes: png, outputFormat: 'jpg' }]
  }, { fs, sharp });
  const outputDir = path.join(dir, 'output');
  const saved = writeSpineAtlasWebpOutput({ dir: outputDir, atlases: result.atlases, images: result.images }, { fs });
  assert.deepEqual(await sharp(path.join(outputDir, 'fx.webp')).ensureAlpha().raw().toBuffer(), data);
  assert.match(fs.readFileSync(path.join(outputDir, 'sample.atlas'), 'utf8'), /fx.webp\nsize: 256,128\npma: true/);
  assert.match(fs.readFileSync(path.join(outputDir, 'sample.atlas'), 'utf8'), /second.jpg\nsize: 256,128\npma: false/);
  console.log(JSON.stringify({ root, fixtureDir: dir, outputDir, files: saved.files, rgbaEqual: true, node: process.versions.node, electron: process.versions.electron || null }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
