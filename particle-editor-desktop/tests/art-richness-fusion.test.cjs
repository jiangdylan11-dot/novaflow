const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'../..');
const cases = [
  ['增加参考图的画面丰富感。','前中后景层次递进，木材表面纹理清晰，暖色光影过渡细腻',true],
  ['提升画面丰富度','材质反射区分明确，光影过渡自然，色彩冷暖呼应',true],
  ['增加参考图的画面丰富感。','画面更丰富、更高清、高质量',false],
  ['增加参考图的画面丰富感。','建议增加材质纹理，提升光影层次',false],
  ['增加参考图的画面丰富感。','蓝色陶瓷杯位于木桌右侧',false],
  ['增加参考图的画面丰富感。','前景层次分明',false],
  ['增加参考图的画面丰富感；将杯子改为红色','前景层次分明，材质纹理细腻，光影过渡自然',false],
  ['降低背景亮度','增加背景亮度',false],
];
for(const file of ['supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs','particle-editor-desktop/admin-server/server.js']) {
  const src = fs.readFileSync(path.join(root,file),'utf8');
  const names = ['ordinaryArtPromptPatchCompact','ordinaryArtPromptPatchBigrams','ordinaryArtStructuredPromptLine','ordinaryArtStructuredPromptRequirementClauseSpecs','ordinaryArtStructuredPromptStemEnglishWord','ordinaryArtStructuredPromptSemanticComponents','ordinaryArtStructuredPromptSemanticAnchorCovers','ordinaryArtStructuredPromptSemanticSegments','ordinaryArtStructuredPromptSegmentPolarity','ordinaryArtRichnessFactCoverage','ordinaryArtStructuredPromptClauseCovered','ordinaryArtStructuredPromptRequirementCoverage'];
  names.unshift('normalizeSmartAiText');
  const sandbox = vm.createContext({});
  for(const name of names) {
    const start = src.indexOf('function '+name+'(');
    assert.ok(start>=0,name);
    const next = src.indexOf('\nfunction ',start+1);
    vm.runInContext(src.slice(start,next),sandbox);
  }
  for(const [requirement,fact,expected] of cases) {
    assert.equal(sandbox.ordinaryArtStructuredPromptRequirementCoverage(requirement,[fact]),expected,`${file}: ${requirement}: ${fact}`);
  }
}
console.log('Art richness fusion: cloud and desktop semantic coverage passed');
