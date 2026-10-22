// Derive compact, non-textured mannequin body variants from the pinned CC0 pack.
// The large morph source stays in work/ and is never shipped to the browser.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cache = join(root, 'work/pose-studio-upstream');
const assets = join(root, 'novaflow-web/renderer/vendor/vnccs/pose_studio/assets');
const provenance = JSON.parse(await readFile(join(assets, '../../UPSTREAM.json'), 'utf8'));
const source = await readFile(join(cache, 'pose_studio_makehuman.v2.bin.gz'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha256(source) !== provenance.mannequin.sha256) throw new Error('Morph source differs from the pinned upstream pack');
const { parseMorphPack, solveMorph, buildStaticModelData } = await import(pathToFileURL(join(cache, 'web/pose_studio/morph_runtime.mjs')));
const bytes = gunzipSync(source);
const pack = parseMorphPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const mesh = buildStaticModelData(pack, false);
const neutral = JSON.parse(await readFile(join(assets, 'mannequin.json'), 'utf8'));
let ground = Infinity;
for (let i = 1; i < neutral.vertices.length; i += 3) ground = Math.min(ground, neutral.vertices[i]);
const catalog = { license: 'CC0-1.0', sourceSha256: provenance.mannequin.sha256, bodies: [] };
for (const age of ['adult', 'child']) for (const [gender, factor] of [['neutral', 0.5], ['female', 0], ['male', 1]]) {
  // These are morph-space coordinates, not chronological ages. 0.1875 is
  // MakeHuman's child target; 0.5 is the full adult target, with no old morph.
  const shape = { ...provenance.mannequin.shape, gender: factor, age: age === 'adult' ? 45.5 : 1 + 89 * 0.1875, show_genitals: false };
  const id = `${age}-${gender}`, file = id === 'adult-neutral' ? 'mannequin.json' : `mannequin-${id}.json`;
  if (id !== 'adult-neutral') {
    const solved = solveMorph(pack, shape);
    let minY = Infinity;
    for (let i = 1; i < solved.vertices.length; i += 3) minY = Math.min(minY, solved.vertices[i]);
    const dy = ground - minY;
    for (let i = 1; i < solved.vertices.length; i += 3) solved.vertices[i] += dy;
    const bones = mesh.bones.map((bone, i) => {
      const headPos = Array.from(solved.bonePositions.subarray(i * 6, i * 6 + 3));
      const tailPos = Array.from(solved.bonePositions.subarray(i * 6 + 3, i * 6 + 6));
      headPos[1] += dy; tailPos[1] += dy;
      return { name: bone.name, parent: bone.parent || null, headPos, tailPos, length: Math.hypot(...headPos.map((v, j) => tailPos[j] - v)) };
    });
    const model = { vertices: solved.vertices, indices: mesh.indices, skinIndices: mesh.skinIndices, skinWeights: mesh.skinWeights, bones };
    await writeFile(join(assets, file), JSON.stringify(model, (_, value) => ArrayBuffer.isView(value) ? Array.from(value, n => Number.isInteger(n) ? n : +n.toFixed(6)) : value));
  }
  const contents = await readFile(join(assets, file));
  catalog.bodies.push({ id, age, gender, shape, file, sha256: sha256(contents), bytes: contents.length });
}
await writeFile(join(assets, 'body-types.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(`Derived ${catalog.bodies.length} CC0 body variants; shared ground ${ground}`);
