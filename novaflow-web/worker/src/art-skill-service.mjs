import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
export async function readArtSkill(path = BUNDLED_ART_SKILL) {
  return validateArtSkill(JSON.parse(await readFile(path, 'utf8')));
}

// This directory is local application data, never a GPU-node-specific model cache.
// Publication is an explicit pointer change to an immutable version, not an Agent tool.
export function createArtSkillService(directory) {
  async function active() {
    await mkdir(directory, { recursive: true });
    const seed = await readArtSkill();
    try { await writeFile(join(directory, `style-transfer.${seed.version}.json`), JSON.stringify(seed, null, 2), { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    try { await writeFile(join(directory, 'active.json'), JSON.stringify({ version: seed.version, sha256: seed.systemSHA256 }), { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const pointer = JSON.parse(await readFile(join(directory, 'active.json'), 'utf8'));
    check(/^[0-9]+\.[0-9]+\.[0-9]+$/.test(pointer.version), '美术技能版本指针无效');
    const skill = await readArtSkill(join(directory, `style-transfer.${pointer.version}.json`));
    check(skill.version === pointer.version && skill.systemSHA256 === pointer.sha256, '美术技能版本指针与内容不符');
    return skill;
  }
  return { active };
}
