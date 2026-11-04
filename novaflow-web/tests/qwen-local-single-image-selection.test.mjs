import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createContext,runInContext} from 'node:vm';
const src=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');const start=src.indexOf('  async function selectedQwenImageEdit('),end=src.indexOf('  // Standalone text rewrite only.',start);assert.ok(start>0&&end>start);
function fixture({hang=false}={}){
 let session=true,resolve,called=0,cancelled=0,nodeListener=null,sent,width=64,height=64,decodeError=false;const observers=new Set();const selected={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:1};const controller={businessModelSnapshot:()=>selected,subscribeBusinessModel:()=>()=>{}};
 const guard=()=>session;guard.expiresAtMs=Date.now()+300000;class FakeImage {set src(_value){this.naturalWidth=width;this.naturalHeight=height;queueMicrotask(()=>decodeError?this.onerror():this.onload());}}
 const root={Image:FakeImage,NovaFlowXiaotaoArtAgent:{panel:{controller}},addEventListener:(name,fn)=>{if(name==='novaflow:compute-node')nodeListener=fn;},removeEventListener:()=>{nodeListener=null;},setTimeout,clearTimeout};
 const context={root,computeNode:{id:'node'},computeNodeEpoch:0,qwen21LocalImageEditAvailable:()=>true,captureFoartSessionGuard:()=>guard,foartSessionObservers:observers,QWEN_ROTATION_REQUEST_ID:/^[0-9a-f-]{36}$/,Date,Number,String,Object,Array,Promise,Error,TextEncoder,
 cancelPromptAssistantRequest:async()=>{cancelled++;return {ok:true};},pooledPromptAssistant:async(_action,request)=>{sent=request;called++;if(hang)await new Promise(r=>{resolve=r;});return {ok:true};}};
 createContext(context);runInContext(src.slice(start,end)+'\nglobalThis.run=selectedQwenImageEdit;',context);
 const payload={requestId:'33333333-3333-4333-8333-333333333333',surface:'art',purpose:'optimize',targetEngine:'qwen-2.1',qwenPromptMode:'img2img',currentPrompt:'cat',requirements:'',negativePrompt:'',images:[{role:'subject',dataUrl:'data:image/png;base64,YQ=='}],isImageInputCurrent:()=>true,selectionStillCurrent:()=>true};
 return {payload,run:()=>context.run(payload,selected,controller),get called(){return called;},get sent(){return sent;},get cancelled(){return cancelled;},switchNode:()=>nodeListener(),revoke:()=>{session=false;for(const fn of observers)fn();},release:()=>resolve?.(),setDimensions:(w,h)=>{width=w;height=h;},breakDecode:()=>{decodeError=true;}};
}
test('4000 character source accepted, longer input rejected before task',async()=>{for(const size of [4000,4001]){const f=fixture();f.payload.currentPrompt='a'.repeat(size);const r=await f.run();assert.equal(r.ok,size===4000);assert.equal(f.called,size===4000?1:0);}});
test('node change or session revocation cancels and returns while transport is pending',async()=>{for(const change of ['switchNode','revoke']){const f=fixture({hang:true}),work=f.run();await Promise.resolve();f[change]();const result=await Promise.race([work,new Promise((_,reject)=>setTimeout(()=>reject(Error('did not return promptly')),300))]);assert.equal(result.ok,false);assert.equal(f.cancelled,1);f.release();}});

test('selection sends ordered images with every explicit valid role and rejects bad counts or roles',async()=>{
 for(const roles of [['style'],['subject','subject'],['style','pose','style'],['attachment','reference','background']]){const f=fixture();f.payload.images=roles.map((role,i)=>({role,dataUrl:'data:image/png;base64,'+['YQ==','Yg==','Yw=='][i]}));const r=await f.run();assert.equal(r.ok,true);assert.deepEqual(Array.from(f.sent.images,x=>x.role),roles);assert.deepEqual(Array.from(f.sent.images,x=>x.dataUrl),f.payload.images.map(x=>x.dataUrl));assert.equal(Object.hasOwn(f.sent,'image'),false);}
 for(const roles of [[],['bad'],['subject','style','pose','reference']]){const f=fixture();f.payload.images=roles.map(role=>({role,dataUrl:'data:image/png;base64,YQ=='}));assert.equal((await f.run()).ok,false);assert.equal(f.called,0);}
});
test('changed role or reordered image invalidates the pending selection',async()=>{for(const change of ['role','order']){const f=fixture({hang:true});f.payload.images=[{role:'subject',dataUrl:'data:image/png;base64,YQ=='},{role:'style',dataUrl:'data:image/png;base64,Yg=='}];const pending=f.run();await Promise.resolve();if(change==='role')f.payload.images[0].role='style';else f.payload.images.reverse();f.release();assert.equal((await pending).ok,false);}});

test('individual dimensions, pixels and total bytes are checked before task creation',async()=>{
 for(const [w,h,ok] of [[6000,4000,true],[6001,4000,false],[8193,1,false],[8192,1,true],[0,1,false]]){const f=fixture();f.setDimensions(w,h);const result=await f.run();assert.equal(result.ok,ok,`${w}x${h}`);assert.equal(f.called,ok?1:0);if(!ok)assert.match(result.error,/8192|2400/);}
 const bad=fixture();bad.breakDecode();assert.match((await bad.run()).error,/无法解码/);assert.equal(bad.called,0);
 const multi=fixture();multi.setDimensions(6000,4000);multi.payload.images=Array.from({length:3},()=>({role:'reference',dataUrl:'data:image/png;base64,YQ=='}));assert.equal((await multi.run()).ok,true);assert.equal(multi.called,1);
 const large=fixture();large.payload.images=[{role:'reference',dataUrl:'data:image/png;base64,'+'A'.repeat(16*1024*1024)}];assert.match((await large.run()).error,/超过 16 MiB/);assert.equal(large.called,0);
});
test('largest base64 payload below the 16 MiB serialized limit is accepted',async()=>{
 const f=fixture(),prefix='data:image/png;base64,';
 const request={requestId:f.payload.requestId,mode:'image-edit',images:[{role:'reference',dataUrl:prefix}],currentPrompt:f.payload.currentPrompt,requirements:'',negativePrompt:'',promptContract:'qwen21-native-rewrite-v3'};
 const overhead=new TextEncoder().encode(JSON.stringify(request)).byteLength, length=Math.floor((16*1024*1024-overhead)/4)*4;
 f.payload.images=[{role:'reference',dataUrl:prefix+'A'.repeat(length)}];
 const result=await f.run();assert.equal(result.ok,true);assert.equal(f.called,1);
 assert.ok(new TextEncoder().encode(JSON.stringify(f.sent)).byteLength<=16*1024*1024);
});
