const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const file = 'novaflow-web/renderer/ai-sequence-minimax-h3.workflow.js';
const source = fs.readFileSync(file, 'utf8');
let saved;
function load() {
  const ctx = { console, localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } } };
  vm.runInNewContext(source, ctx);
  return ctx.NovaFlowAiSequenceMiniMaxH3Workflow;
}
const api = load();
assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeCustomResolution({width:1000,height:550}))), {width:992,height:544});
for (const size of [{width:0,height:512},{width:512.5,height:512},{width:2048,height:2048},{width:NaN,height:512}]) assert.throws(()=>api.normalizeCustomResolution(size));
for (const mode of ['t2v','i2v','fl2v','r2v']) {
 const graph = api.buildWorkflow({mode,width:992,height:544,steps:4,acceleration:'sage',prompt:'A bird flies',...(mode==='i2v'?{images:['first.png']}:mode==='fl2v'?{images:['first.png','last.png']}:mode==='r2v'?{referenceImages:['ref.png']}:{})});
 const nodes = Object.values(graph.prompt || graph);
 assert.ok(nodes.some(n=>n.inputs?.width===992 && n.inputs?.height===544), mode);
 api.validateWorkflow(graph,{mode});
}
api.saveProfileSettings('beta5_int8',{resolutionMode:'custom',width:1000,height:550});
const restored=load().getProfileSettings();
assert.equal(restored.resolutionMode,'custom');
assert.equal(restored.width,992); assert.equal(restored.height,544);
console.log('PASS: custom alignment, invalid dimensions, four H3 graphs, persisted settings');
