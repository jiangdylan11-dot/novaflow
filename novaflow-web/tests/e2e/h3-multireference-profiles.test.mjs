import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const root=new URL('../../renderer/',import.meta.url);
const read=f=>fs.readFileSync(new URL(f,root),'utf8');
const memory=new Map();const c=vm.createContext({console,localStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)}});c.globalThis=c;c.window=c;
for(const f of ['h3-prompt-format.js','ai-sequence-minimax-h3.resource.js','ai-sequence-minimax-h3-prompt.workflow.js','ai-sequence-minimax-h3.workflow.js','ai-sequence-h3-media.js'])vm.runInContext(read(f),c,{filename:f});
const api=c.NovaFlowAiSequenceMiniMaxH3Workflow;
for(const profile of ['beta5_int8','beta6_int8'])for(const mode of ['t2v','i2v','fl2v','r2v'])for(const n of mode==='r2v'?[1,9]:[0]){
const opts={profile,mode,steps:profile==='beta6_int8'?8:4,prompt:'A small robot waves in a garden.',width:256,height:256,durationSeconds:1,fps:24,seed:123};
if(mode==='i2v')opts.images=['first.png'];if(mode==='fl2v')opts.images=['first.png','last.png'];
if(mode==='r2v')Object.assign(opts,{referenceImages:Array.from({length:n},(_,i)=>`image${i}.png`),referenceVideos:Array.from({length:n===9?3:1},(_,i)=>`video${i}.mp4`),referenceAudios:Array.from({length:n===9?3:1},(_,i)=>`audio${i}.wav`)});
try{const g=api.buildWorkflow(opts);assert(api.validateWorkflow(g,opts));const cond=Object.values(g).find(x=>/MiniMaxH3(?:ReferenceToVideo|ImageToVideo)/.test(x.class_type));const keys=Object.keys(cond.inputs);if(mode==='r2v'){assert.equal(keys.filter(x=>x.startsWith('ref_images.')).length,n);assert.equal(keys.filter(x=>x.startsWith('ref_videos.')).length,n===9?3:1);assert.equal(keys.filter(x=>x.startsWith('ref_audios.')).length,n===9?3:1);}if(profile==='beta6_int8'){assert.equal(cond.class_type,'MiniMaxH3ReferenceToVideo');assert.equal(Object.values(g).find(x=>x.class_type==='MiniMaxH3SigmaShift').inputs.shift_video,10)}console.log('PASS',profile,mode,n,Object.keys(g).length)}catch(e){console.log('FAIL',profile,mode,n,e.stack);process.exitCode=1;}
}
const M=c.NovaFlowH3Media;const db=new Map();const storage={async get(k){return db.get(k)},async put(k,v){db.set(k,JSON.parse(JSON.stringify(v)))}};const store=M.createStore(storage);await store.load('one');
const items=[];for(const[k,n]of Object.entries(M.LIMITS))for(let i=0;i<n;i++)items.push({sourceId:k+i,kind:k,fileName:k+i,type:k+'/test',dataUrl:'data:'+k+'/test;base64,YQ=='});
await store.add(items);assert.equal((await store.snapshot()).length,15);let removed=await store.remove('video0');assert.equal(M.remapPrompt('@视频参考2 <Audio 3> @参考图9',removed.before,removed.after),'@视频参考1 @声音参考3 @参考图9');const reopened=M.createStore(storage);await reopened.load('one');assert.equal((await reopened.snapshot()).length,14);await reopened.restore(store.export());assert.equal((await reopened.snapshot()).length,14);console.log('PASS persistence, 15 materials, removal renumbering and restore');

await reopened.restore({version:1,items:[]}); const empty=M.createStore(storage); await empty.load("one"); assert.equal((await empty.snapshot()).length,0); assert.equal(empty.hasSaved("one"),true); console.log("PASS intentionally empty saved board does not resurrect legacy materials");
