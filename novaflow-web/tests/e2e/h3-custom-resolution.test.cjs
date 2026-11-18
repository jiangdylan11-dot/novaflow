const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const file = __dirname + '/../../renderer/ai-sequence-minimax-h3.workflow.js';
const source = fs.readFileSync(file, 'utf8');
let saved;
function load() {
  const ctx = { console, localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } } };
  vm.runInNewContext(source, ctx);
  return ctx.NovaFlowAiSequenceMiniMaxH3Workflow;
}
const api = load();
assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeCustomResolution({width:1000,height:550}))), {width:1000,height:550});
assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeCustomResolution({width:2048,height:2048}))), {width:2048,height:2048});
const plan = JSON.parse(JSON.stringify(api.generationPlan({width:1000,height:750})));
assert.deepEqual(plan, {outputWidth:1000,outputHeight:750,scaledWidth:1000,scaledHeight:750,width:1024,height:768,scaled:false,pad:{left:12,top:9,right:12,bottom:9}});
const big = api.generationPlan({width:4000,height:3000});
assert.ok(big.scaled && big.width%32===0 && big.height%32===0 && big.width*big.height<=api.MAX_CANVAS_PIXELS);
assert.ok(Math.abs(big.scaledWidth/big.scaledHeight - 4/3) < 0.01);
for (const size of [{width:0,height:512},{width:512.5,height:512},{width:NaN,height:512}]) assert.throws(()=>api.normalizeCustomResolution(size));
for (const mode of ['t2v','i2v','fl2v','r2v']) {
 const graph = api.buildWorkflow({mode,width:1000,height:750,steps:8,acceleration:'sage',prompt:'A bird flies',...(mode==='i2v'?{images:['first.png']}:mode==='fl2v'?{images:['first.png','last.png']}:mode==='r2v'?{referenceImages:['ref.png']}:{})});
 const nodes = Object.values(graph.prompt || graph);
 assert.ok(nodes.some(n=>/^MiniMaxH3/.test(n.class_type) && n.inputs?.width===1024 && n.inputs?.height===768), mode);
 const crop = nodes.find(n=>n.class_type==='ImageCrop');
 assert.deepEqual([crop.inputs.width,crop.inputs.height,crop.inputs.x,crop.inputs.y],[1000,750,12,9], mode);
 const pads = nodes.filter(n=>n.class_type==='ImagePadForOutpaint');
 assert.equal(pads.length, mode==='i2v'?1:mode==='fl2v'?2:0, mode);
 for (const p of pads) assert.deepEqual([p.inputs.left,p.inputs.top,p.inputs.right,p.inputs.bottom],[12,9,12,9]);
 api.validateWorkflow(graph,{mode});
}
api.saveProfileSettings('beta5_int8',{resolutionMode:'custom',width:1000,height:550});
const restored=load().getProfileSettings();
assert.equal(restored.resolutionMode,'custom');
assert.equal(restored.width,1000); assert.equal(restored.height,550);
console.log('PASS: exact custom size with 32 padding, invalid dimensions, four H3 graphs, persisted settings');
