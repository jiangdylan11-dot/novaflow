import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildGrokPromptOptimizeRequest, grokResponsesPublicResult} from '../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
const source = fs.readFileSync(new URL('./fixtures/art-reverse-outdoor-fusion.txt',import.meta.url),'utf8');
const instruction = '增加室外背景，提升画面质量和精美度。增加人物细节';
const good = source.split('\n[用户附加要求]')[0].trim()
  .replace('纯白色背景，无其他物体，前景无遮挡，中景主体站立，后景无层次','室外花园，前景花草与石径引导视线，中景主体站立，后景绿树与天空形成空间层次')
  .replace('一名成年女性，','一名成年女性，五官柔和清晰，指尖轮廓自然，银色花冠花瓣有细小雕纹，')
  .replace('背景完全虚化浅景深','背景适度柔化，保留花园层次');
for (const requirements of [instruction,'用户本次修改要求（最高优先级）：'+instruction,'']) {
  const request = buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:source,requirements,supportsNegativePrompt:false},'grok-contract-test');
  assert.equal(request.resultOptions.artSemanticFusion,true);
  assert.equal(request.resultOptions.requirements,instruction);
  assert.ok(!request.resultOptions.originalPrompt.includes('[用户附加要求]'));
  const result = text=>grokResponsesPublicResult({output_text:JSON.stringify({prompt:text})},request.resultOptions);
  assert.equal(result(good).output_text,good);
  const standing = good.replace('主体站立','主体站在花园中');
  assert.equal(result(standing).output_text,standing);
  const blur = good.replace('背景适度柔化，保留花园层次','背景完全虚化浅景深');
  assert.ok(!result(blur).output_text.includes('完全虚化'));
  assert.throws(()=>result(source),/融合未完成/);
  assert.throws(()=>result(request.resultOptions.originalPrompt),/未实际融合/);
  assert.throws(()=>result(good.replace('室外花园，前景花草与石径引导视线，中景主体站立，后景绿树与天空形成空间层次','纯白色背景，前景有草地，后景树木丰富')),/冲突/);
  assert.throws(()=>result(good.replace('五官柔和清晰，指尖轮廓自然，银色花冠花瓣有细小雕纹，','')),/主体物品/);
  assert.throws(()=>result(good.replace('[光线与色彩]','[新光线]')),/缺少原段落/);
}
const cloud=fs.readFileSync(new URL('../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs',import.meta.url),'utf8');
const desktop=fs.readFileSync(new URL('../admin-server/server.js',import.meta.url),'utf8');
const fusionCode = text=>text.slice(text.indexOf('const ART_SEMANTIC_FUSION_RULES'),text.indexOf('function buildGrokPromptOptimizeRequest('));
assert.equal(fusionCode(cloud),fusionCode(desktop),'desktop and hosted Grok must use the identical fusion contract');
console.log('Semantic fusion: all requirements applied, conflict/copy/partial edits rejected, legacy carrier repaired, Grok routes identical');
