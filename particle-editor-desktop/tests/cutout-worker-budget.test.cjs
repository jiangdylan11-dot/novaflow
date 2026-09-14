const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../particle-editor/ai-sequence-green-screen-matting.js'),'utf8');
function api(cores){const context={module:{exports:{}},navigator:{hardwareConcurrency:cores}};vm.runInNewContext(source,context);return context.module.exports;}
test('worker concurrency honors CPU count and bounds high-resolution scratch memory',()=>{
 const powerful=api(32);assert.equal(powerful.parallelism(1080,1920),8);assert.equal(powerful.parallelism(2160,3840),2);assert.equal(powerful.parallelism(4320,7680),1);
 assert.equal(api(8).parallelism(1080,1920),2);assert.equal(api(2).parallelism(1080,1920),1);
});
test('async matting remains inert when the light effect path is disabled',async()=>{
 const engine=api(32);assert.equal(await engine.renderAsync(null,{enabled:false}),null);assert.equal(engine.workerStats().workers,0);
});
