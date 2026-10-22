// Refresh the reusable MIT Pose Studio core and derive a compact CC0 mannequin.
// No ComfyUI server, generation models or Python extension is shipped.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cache = join(root, 'work/pose-studio-upstream');
const commit = '2b0f4041b368e3408cfb826f4cf09e6f8dafa164';
const target = join(root, 'novaflow-web/renderer/vendor/vnccs');
const base = `https://raw.githubusercontent.com/AHEKOT/ComfyUI_VNCCS_Utils/${commit}/`;
// Keep the large morph source in ignored work/, outside the shipped runtime.
for (const [remote, local] of [
  ['web/pose_studio/morph_runtime.mjs', 'web/pose_studio/morph_runtime.mjs'],
  ['web/pose_studio/assets/pose_studio_makehuman.v2.bin.gz', 'pose_studio_makehuman.v2.bin.gz'],
]) {
  const output = join(cache, local);
  const response = await fetch(base + remote);
  if (!response.ok) throw new Error(`${remote}: HTTP ${response.status}`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
}
const files = [
  ['web/pose_studio/core.js', 'pose_studio/core.js'],
  ['web/pose_studio/hand_presets.js', 'pose_studio/hand_presets.js'],
  ['web/vendor/three/three.module.js', 'vendor/three/three.module.js'],
  ['web/vendor/three/OrbitControls.js', 'vendor/three/OrbitControls.js'],
  ['web/vendor/three/TransformControls.js', 'vendor/three/TransformControls.js'],
  ['LICENSE', 'LICENSE.txt'],
  ['web/pose_studio/assets/pose_studio_makehuman.v2.LICENSE.md', 'pose_studio/assets/MAKEHUMAN-LICENSE.txt'],
  ['web/pose_studio/assets/pose_studio_makehuman.v2.CC0-1.0.md', 'pose_studio/assets/CC0-1.0.txt'],
];
const hashes = {};
for (const [source, destination] of files) {
  const response = await fetch(base + source);
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const output = join(target, destination);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
  hashes[destination] = createHash('sha256').update(bytes).digest('hex');
}
const threeLicense = await fetch('https://raw.githubusercontent.com/mrdoob/three.js/r160/LICENSE');
if (!threeLicense.ok) throw new Error('Three.js license download failed');
await writeFile(join(target, 'vendor/three/LICENSE.txt'), await threeLicense.text());

const { parseMorphPack, solveMorph, buildStaticModelData } = await import(pathToFileURL(join(cache, 'web/pose_studio/morph_runtime.mjs')));
const source = await readFile(join(cache, 'pose_studio_makehuman.v2.bin.gz'));
const bytes = gunzipSync(source);
const pack = parseMorphPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
// Upstream's age factor reaches its full adult ('young') target at the midpoint
// of its 1..90 range. Avoid mixing the child target into the neutral mannequin.
const shape = { gender: 0.5, age: 45.5, muscle: 0.5, weight: 0.5, height: 0.5, show_genitals: false };
const solved = solveMorph(pack, shape);
const mesh = buildStaticModelData(pack, false);
const bones = mesh.bones.map((bone, i) => {
  const headPos = Array.from(solved.bonePositions.subarray(i * 6, i * 6 + 3));
  const tailPos = Array.from(solved.bonePositions.subarray(i * 6 + 3, i * 6 + 6));
  return { name: bone.name, parent: bone.parent || null, headPos, tailPos, length: Math.hypot(...headPos.map((v, j) => tailPos[j] - v)) };
});
const model = { vertices: solved.vertices, indices: mesh.indices, skinIndices: mesh.skinIndices, skinWeights: mesh.skinWeights, bones };
const compact = JSON.stringify(model, (_, value) => ArrayBuffer.isView(value) ? Array.from(value, n => Number.isInteger(n) ? n : +n.toFixed(6)) : value);
await writeFile(join(target, 'pose_studio/assets/mannequin.json'), compact);
await writeFile(join(target, 'UPSTREAM.json'), JSON.stringify({
  repository: 'https://github.com/AHEKOT/ComfyUI_VNCCS_Utils', commit,
  license: 'MIT', files: hashes,
  mannequin: { source: 'web/pose_studio/assets/pose_studio_makehuman.v2.bin.gz', sha256: createHash('sha256').update(source).digest('hex'), license: 'CC0-1.0', shape, bodyStage: 'adult', note: 'Neutral adult static mesh derived using upstream morph_runtime.mjs; no textures or optional anatomical mesh. Rounded to six decimal places.' },
}, null, 2) + '\n');
console.log(`Vendored ${commit}; mannequin ${compact.length} bytes, ${bones.length} bones`);
