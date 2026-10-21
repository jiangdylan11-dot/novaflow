import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {webcrypto,createHash} from 'node:crypto';
function fixture(){
 const draws=[],context={crypto:webcrypto,atob,Uint8Array,console};vm.createContext(context);
 vm.runInContext(readFileSync(new URL('../../renderer/ui-design-style-reference.js',import.meta.url),'utf8'),context);
 const options={loadImage:async()=>({width:576,height:1248}),createCanvas:()=>({getContext:()=>({fillRect(){},save(){},beginPath(){},arc(){},clip(){},restore(){},drawImage(...args){draws.push(args.slice(1));}}),toDataURL:()=> 'data:image/png;base64,'+Buffer.from('conditioning').toString('base64')})};
 return {api:context.NovaFlowUiDesignStyleReference,draws,options};
}
const refs=()=>[{id:'layout',role:'layout',width:576,height:1250,dataUrl:'data:image/png;base64,'+Buffer.from('layout').toString('base64')},
 {id:'style',role:'style',width:576,height:1248,dataUrl:'data:image/png;base64,'+Buffer.from('original-style').toString('base64')},
 {id:'tiger',role:'character',width:175,height:218,dataUrl:'data:image/png;base64,'+Buffer.from('tiger').toString('base64')}];
const plan={visualMode:'theme-redesign',layoutMode:'preserve',layoutReference:1};
test('declared page style is represented once with visible conditioning provenance; originals, layout and identity remain intact',async()=>{
 const {api,draws,options}=fixture(),original=refs(),snapshot=JSON.stringify(original);
 const output=await api.prepare(original,plan,options);
 assert.equal(output.length,3);assert.equal(output[0],original[0]);assert.equal(output[2],original[2]);assert.equal(JSON.stringify(original),snapshot);
 assert.equal(output[1].id,'style');assert.equal(output[1].originalDataUrl,original[1].dataUrl);assert.notEqual(output[1].dataUrl,original[1].dataUrl);
 assert.deepEqual([output[1].width,output[1].height],[512,512]);assert.equal(draws.length,6);
 const meta=output[1].uiReferenceTreatment;
 assert.equal(meta.sourceSHA256,createHash('sha256').update('original-style').digest('hex'));
 assert.equal(meta.conditioningSHA256,createHash('sha256').update('conditioning').digest('hex'));
 assert.ok(meta.samples.every(patch=>patch.width*patch.height<576*1248/50));
 assert.ok(meta.samples.every(patch=>patch.x>=0&&patch.y>=0&&patch.x+patch.width<=576&&patch.y+patch.height<=1248));
});
test('partial edits, pure style transfer, square material cutouts, and undeclared references retain their original pixels',async()=>{
 for(const patch of [{visualMode:'partial',layoutMode:'partial'},{visualMode:'style-transfer'}]){
  const {api,options}=fixture(),original=refs();assert.deepEqual(Array.from(await api.prepare(original,{...plan,...patch},options)),original);
 }
 const {api,options}=fixture(),original=refs();original[1].role='reference';assert.equal((await api.prepare(original,plan,options))[1],original[1]);
 original[1].role='material';original[1].width=384;original[1].height=384;assert.equal((await api.prepare(original,plan,options))[1],original[1]);
});
test('unreadable source fails before generation instead of silently dropping or substituting a reference',async()=>{
 const {api,options}=fixture();await assert.rejects(()=>api.prepare(refs(),plan,{...options,loadImage:async()=>{throw Error('decode failed');}}),/decode failed/);
});
