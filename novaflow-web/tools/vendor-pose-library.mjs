// Vendor the exact 81 community poses + 55 supplied presets used by the linked recipe.
// Preserve raw scene files/previews and record every source revision and digest.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../renderer/vendor/vnccs/pose_library');
await mkdir(target, { recursive: true });
const hf = [
  ['Totemistyk/General_Poses_PoseStudio', '23468b2be53ab91fe493754b241d27dcfeb965ed'],
  ['Totemistyk/Ballet_PoseStudio', '14d658f5891ac752126f47fabc54993a48980f23'],
  ['MIUProject/VNCCS_PoseLibrary_Main', 'baef0455ef9d3cc31ce3e2a407f722069355c617'],
  ['MIUProject/MySuperPoseRepo', '75931b865e95b0ab97aaca2a3756f4d0fab83a32'],
];
const recipe = { repo: 'Arekejoker/qwen21-nsfw-pose-skill', commit: '5fa2aa12ebbc106fbf32aa3e05c87f613303aa2c' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function json(url) { const response = await fetch(url); if (!response.ok) throw new Error(`${response.status}: ${url}`); return response.json(); }
function encoded(path) { return path.split('/').map(encodeURIComponent).join('/'); }
const pending = [];
for (const [repository, revision] of hf) {
  const base = `https://huggingface.co/${repository}/resolve/${revision}/`;
  const manifest = await json(base + 'pose_library.json');
  for (const pose of manifest.poses) pending.push({ name: pose.name, category: pose.category, tags: pose.tags || [], source: `https://huggingface.co/${repository}`, revision, jsonSource: base + encoded(pose.json_path), previewSource: base + encoded(pose.preview_path), expectedJson: pose.json_sha256, expectedPreview: pose.preview_sha256 });
}
const tree = await json(`https://api.github.com/repos/${recipe.repo}/git/trees/${recipe.commit}?recursive=1`);
for (const entry of tree.tree.filter(entry => /^pose_library\/local_user_poses\/.*\.json$/.test(entry.path))) {
  const base = `https://raw.githubusercontent.com/${recipe.repo}/${recipe.commit}/`;
  pending.push({ name: entry.path.split('/').at(-1).slice(0, -5), category: '精选姿势', tags: [], source: `https://github.com/${recipe.repo}`, revision: recipe.commit, jsonSource: base + encoded(entry.path), previewSource: base + encoded(entry.path.replace(/\.json$/, '.webp')) });
}
const entries = Array(pending.length);
let next = 0;
async function worker() {
  while (next < pending.length) {
    const index = next++, pose = pending[index], id = `pose-${String(index + 1).padStart(3, '0')}`;
    const files = {};
    for (const [kind, extension, expected] of [['json', '.json', pose.expectedJson], ['preview', '.webp', pose.expectedPreview]]) {
      const response = await fetch(pose[`${kind}Source`]);
      if (!response.ok) throw new Error(`${pose.name}: ${kind} HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer()), hash = digest(bytes);
      if (expected && hash !== expected) throw new Error(`Source hash mismatch: ${pose.name} ${kind}`);
      await writeFile(join(target, id + extension), bytes);
      files[kind] = id + extension; files[`${kind}Sha256`] = hash;
    }
    entries[index] = { id, name: pose.name, category: pose.category, tags: pose.tags, source: pose.source, revision: pose.revision, ...files };
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
await writeFile(join(target, 'index.json'), JSON.stringify({ version: 1, sources: hf.map(([repository, revision]) => ({ repository, revision })), recipe, poses: entries }, null, 2) + '\n');
await writeFile(join(target, 'NOTICE.txt'), 'VNCCS Pose Library: poses and previews retain their upstream authors and terms.\nThis is a local copy of the four public libraries and 55 presets referenced by Arekejoker/qwen21-nsfw-pose-skill.\nThe Pose Studio MIT license does not relicense third-party pose libraries. Sources and pinned revisions are listed per entry in index.json.\nTotemistyk/Ballet_PoseStudio declares MIT; other sources do not declare a separate license in their model cards.\n');
console.log(`Vendored ${entries.length} poses and matching previews; supplied presets revision ${recipe.commit}`);
