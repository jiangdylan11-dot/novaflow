import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const BUNDLED_ART_SKILL = new URL('./art-skills/style-transfer.v1.json', import.meta.url);
export const artDigest = value => createHash('sha256').update(value).digest('hex');
const check = (ok, message) => { if (!ok) throw new Error(message); };
export function validateArtSkill(value) {
  check(value.schema === 'nf.art.skill.v1' && value.id === 'style-transfer' && value.status === 'stable'
    && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.version) && value.applicability?.task === 'drawing'
    && value.applicability.generationModels?.join(',') === 'qwen-2.1'
    && typeof value.systemPrompt === 'string' && value.systemPrompt.length < 24000
    && value.systemPrompt.lastIndexOf('Return ONLY JSON:') > 0
    && artDigest(value.systemPrompt) === value.systemSHA256
    && Array.isArray(value.brainStrategies) && value.brainStrategies.length <= 16
    && value.brainStrategies.every(item => typeof item.brain === 'string' && item.brain.length <= 240
      && ['none','low'].includes(item.reasoningEffort) && Number.isInteger(item.reasoningBudgetTokens)
      && item.reasoningBudgetTokens >= 0 && item.reasoningBudgetTokens <= 1024
      && (item.reasoningEffort !== 'none' || item.reasoningBudgetTokens === 0)), '美术技能版本或内容摘要无效');
  return value;
}
// A bundled software release is the minimum shared-skill version for this client.
// Older shared packets stay cached for rollback but cannot silently replace it.
const canonicalSkill = value => JSON.stringify((function visit(v){return Array.isArray(v)?v.map(visit):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,visit(v[k])])):v;})(value));
export function sharedSkillForRelease(candidate, bundled) {
  validateArtSkill(candidate);validateArtSkill(bundled);
  const a=candidate.version.split('.').map(Number),b=bundled.version.split('.').map(Number);
  const index=a.findIndex((n,i)=>n!==b[i]);
  if(index>=0)return a[index]>b[index]?candidate:null;
  return canonicalSkill(candidate)===canonicalSkill(bundled)?candidate:null;
}
export async function readArtSkill(path = BUNDLED_ART_SKILL) {
  return validateArtSkill(JSON.parse(await readFile(path, 'utf8')));
}

// This directory is local application data, never a GPU-node-specific model cache.
// Publication is an explicit pointer change to an immutable version, not an Agent tool.
export function createArtSkillService(directory) {
  let pending = Promise.resolve();
  async function active() {
    const result = pending.catch(() => {}).then(loadActive);
    pending = result;
    return result;
  }
  async function loadActive() {
    await mkdir(directory, { recursive: true });
    const seed = await readArtSkill();
    const rollback = await readArtSkill(new URL('./art-skills/style-transfer.1.0.11.json', import.meta.url));
    const previous = await readArtSkill(new URL('./art-skills/style-transfer.1.0.13.json', import.meta.url));
    for (const bundled of [rollback, previous, seed]) {
      try { await writeFile(join(directory, `style-transfer.${bundled.version}.json`), JSON.stringify(bundled, null, 2), { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    try { await writeFile(join(directory, 'active.json'), JSON.stringify({ version: seed.version, sha256: seed.systemSHA256 }), { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    let pointer = JSON.parse(await readFile(join(directory, 'active.json'), 'utf8'));
    // Upgrade only the shipped legacy baseline once. A later owner rollback or
    // a separately published skill remains authoritative, including after restart.
    const receipt = join(directory, `bundled-baseline.${seed.version}.json`);
    try { await readFile(receipt, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const shippedBaselines = {
        '1.0.1': 'fac8d2aad6988ed1feffa0234ceef61a6269402c68b52f614098e894901ea4be',
        '1.0.11': '9ee27938e8cba9864728f84540e22deb5ad7c1727677cb92396ef3a00e846c28',
        '1.0.13': 'c74b48b7ec8b15d26e2a4eaf0148c153ffa8a743b84ea1fb4df00146750ff21e'
      };
      if (seed.version === '1.0.14' && Object.hasOwn(shippedBaselines, pointer.version)
        && pointer.sha256 === shippedBaselines[pointer.version]) {
        const previous = await readArtSkill(join(directory, `style-transfer.${pointer.version}.json`));
        check(previous.systemSHA256 === pointer.sha256, '旧美术技能版本指针与内容不符');
        const installed = await readArtSkill(join(directory, `style-transfer.${seed.version}.json`));
        check(installed.systemSHA256 === seed.systemSHA256, '内置美术技能与本地同名版本冲突');
        pointer = { version: seed.version, sha256: seed.systemSHA256 };
        const temporary = join(directory, `active.${randomUUID()}.tmp`);
        try { await writeFile(temporary, JSON.stringify(pointer), { flag: 'wx' }); await rename(temporary, join(directory, 'active.json')); }
        finally { await unlink(temporary).catch(() => {}); }
      }
      await writeFile(receipt, JSON.stringify({ version: seed.version, active: pointer.version }));
    }
    check(/^[0-9]+\.[0-9]+\.[0-9]+$/.test(pointer.version), '美术技能版本指针无效');
    const skill = await readArtSkill(join(directory, `style-transfer.${pointer.version}.json`));
    check(skill.version === pointer.version && skill.systemSHA256 === pointer.sha256, '美术技能版本指针与内容不符');
    return skill;
  }
  return { active };
}
