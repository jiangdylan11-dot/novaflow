// Piecewise anatomical proportion variants; this never uniformly scales a figure.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const assets = resolve(dirname(fileURLToPath(import.meta.url)), '../renderer/vendor/vnccs/pose_studio/assets');
const catalog = JSON.parse(await readFile(join(assets, 'body-types.json'), 'utf8'));
catalog.bodies = catalog.bodies.filter(body => !body.proportion);
const canonical = JSON.parse(await readFile(join(assets, 'mannequin.json'), 'utf8'));
const headIndex = canonical.bones.findIndex(bone => bone.name === 'head');
const head = canonical.bones[headIndex];
// Use the same anatomical chin vertex for all variants of the common topology.
let chinVertex = -1, chinY = Infinity;
for (let i = 0; i < canonical.vertices.length / 3; i++) {
  const [x, y, z] = canonical.vertices.slice(i * 3, i * 3 + 3);
  const weight = [0, 1, 2, 3].reduce((sum, j) => sum + (canonical.skinIndices[i * 4 + j] === headIndex ? canonical.skinWeights[i * 4 + j] : 0), 0);
  if (weight > 0.9 && Math.abs(x) < 0.12 && z > head.headPos[2] + 0.4 && y < chinY) { chinVertex = i; chinY = y; }
}
if (chinVertex < 0) throw new Error('Cannot locate anatomical chin');
for (const age of ['adult', 'child']) {
  const source = JSON.parse(await readFile(join(assets, catalog.bodies.find(body => body.id === `${age}-neutral`).file), 'utf8'));
  const bones = Object.fromEntries(source.bones.map(bone => [bone.name, bone]));
  const ys = source.vertices.filter((_, i) => i % 3 === 1), floor = Math.min(...ys), top = Math.max(...ys);
  const chin = source.vertices[chinVertex * 3 + 1], height = top - floor;
  const hip = bones.thigh_l.headPos[1], shoulder = bones.upperarm_l.headPos[1];
  for (const proportion of [3, 4, 5, 6, 7, 7.5, 8, 9]) {
    const headHeight = height / proportion, headScale = headHeight / (top - chin);
    const neckHeads = 0.12 + Math.min(1, (proportion - 3) / 4.5) * 0.38;
    const targetChin = top - headHeight, targetShoulder = targetChin - headHeight * neckHeads;
    const legFraction = 0.48 + (proportion - 3) / 6 * 0.22;
    const targetHip = floor + (targetShoulder - floor) * legFraction;
    const from = [floor, hip, shoulder, chin, top], to = [floor, targetHip, targetShoulder, targetChin, top];
    const bodyWidth = 0.86 + Math.min(1, (proportion - 3) / 4.5) * 0.14;
    function warp(point, headWeight = 0) {
      const [x, y, z] = point;
      let band = 0; while (band < from.length - 2 && y > from[band + 1]) band++;
      const newY = to[band] + (y - from[band]) / (from[band + 1] - from[band]) * (to[band + 1] - to[band]);
      const blend = Math.max(0, Math.min(1, headWeight));
      const width = bodyWidth * (1 - blend) + headScale * blend;
      const centerZ = bones.head.headPos[2];
      return [x * width, newY, z * bodyWidth * (1 - blend) + (centerZ + (z - centerZ) * headScale) * blend];
    }
    const vertices = [];
    for (let i = 0; i < source.vertices.length; i += 3) {
      const vi = i / 3;
      const headWeight = [0, 1, 2, 3].reduce((sum, j) => sum + (source.skinIndices[vi * 4 + j] === headIndex ? source.skinWeights[vi * 4 + j] : 0), 0);
      vertices.push(...warp(source.vertices.slice(i, i + 3), headWeight).map(n => +n.toFixed(6)));
    }
    const model = { ...source, vertices, bones: source.bones.map(bone => {
      const weight = bone.name === 'head' ? 1 : bone.name === 'neck_01' ? 0.2 : 0;
      const headPos = warp(bone.headPos, weight), tailPos = warp(bone.tailPos, weight);
      return { ...bone, headPos, tailPos, length: Math.hypot(...headPos.map((v, i) => tailPos[i] - v)) };
    }) };
    const id = `${age}-neutral-${proportion}`, file = `mannequin-${id}.json`;
    const contents = JSON.stringify(model);
    await writeFile(join(assets, file), contents);
    const newY = vertices.filter((_, i) => i % 3 === 1), actualTop = Math.max(...newY), actualFloor = Math.min(...newY);
    const measuredRatio = (actualTop - actualFloor) / (actualTop - vertices[chinVertex * 3 + 1]);
    if (Math.abs(measuredRatio - proportion) > 0.001) throw new Error(`${id}: wrong measured head ratio ${measuredRatio}`);
    catalog.bodies.push({ id, age, gender: 'neutral', proportion, chinVertex, measuredRatio, legacy: false, license: 'CC0-1.0', file, bytes: Buffer.byteLength(contents), sha256: createHash('sha256').update(contents).digest('hex') });
  }
}
await writeFile(join(assets, 'body-types.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log('Derived 3–9 head proportion models with matched meshes and skeletons');
