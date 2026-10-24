import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
require('../../renderer/spine-version-convert.js');
require('../../renderer/spine-binary-write.js');
require('../../renderer/spine-skel-import.js');
const V=globalThis.NovaFlowSpineVersion, B=globalThis.NovaFlowSpineBinary, R=globalThis.NovaFlowSpineSkel;
const fixture=()=>({skeleton:{spine:'3.7.94'},bones:[{name:'root'}],slots:[{name:'slot',bone:'root',attachment:'picture'}],skins:{default:{slot:{picture:{width:16,height:16}}}},animations:{move:{bones:{root:{translate:[{time:0,x:0,curve:[.2,0,.7,1]},{time:1,x:20}]}}}}});
const runtimeSource=readFileSync(new URL('../../renderer/spine-official-runtime.js',import.meta.url),'utf8');

test('3.7 runtime conversion preserves the original file, version, skins and curves',()=>{
 const text=JSON.stringify(fixture()), out=JSON.parse(V.runtimeJsonText(text));
 assert.equal(out.skeleton.spine,'3.8.99');assert.equal(out.nfSpine3,'3.7.94');assert(Array.isArray(out.skins));
 assert.equal(out.animations.move.bones.root.translate[0].curve,.2);
 assert.deepEqual(V.fromSpine38(out,'3.7'),JSON.parse(text));
 for(const version of ['3.8.99','4.0.64','4.1.24','4.2.19']){const t=JSON.stringify({skeleton:{spine:version}});assert.equal(V.runtimeJsonText(t),t);}
});

test('the official preview accepts original 3.7 source before acquiring the canvas',()=>{
 const start=runtimeSource.indexOf('  function normalizeSource('),end=runtimeSource.indexOf('  function readSkeletonDataCompat(',start);
 const hash=runtimeSource.slice(runtimeSource.indexOf('  function hashString('),runtimeSource.indexOf('\n  window[factoryName]'));
 const ctx=vm.createContext({window:{NovaFlowSpineVersion:V},normalizeName:n=>n});
 vm.runInContext(hash+'\n'+runtimeSource.slice(start,end),ctx);
 const raw={skeleton:{text:JSON.stringify(fixture())},atlas:{text:'picture.png\nsize:16,16'},images:[{fileName:'picture.png',dataUrl:'data:image/png;base64,AA=='}]};
 const before=JSON.stringify(raw),out=ctx.normalizeSource(raw);
 assert.equal(out.kind,'3.8');assert.equal(JSON.parse(out.jsonText).nfSpine3,'3.7.94');assert.equal(JSON.stringify(raw),before);
});

test('the actual app import worker receives the 3.8 runtime copy of a 3.7 file',()=>{
 const bundle=readFileSync(new URL('../../renderer/assets/index-BbIa-2NM.js',import.meta.url),'utf8');
 const ast=require('acorn').parse(bundle,{ecmaVersion:'latest',sourceType:'module'});let parser;
 const todo=[ast];while(todo.length){const n=todo.pop();if(n.type==='FunctionDeclaration'&&n.id?.name==='pe'){parser=n;break;}for(const value of Object.values(n)){if(Array.isArray(value))for(const child of value)if(child?.type)todo.push(child);else{}else if(value?.type)todo.push(value);}}
 assert(parser);let request;
 class Worker{postMessage(v){request=v;}terminate(){}}
 const ctx=vm.createContext({window:{NovaFlowSpineVersion:V,setTimeout:()=>0,clearTimeout(){}},Worker,URL,console});
 vm.runInContext(bundle.slice(parser.start,parser.end).replaceAll('import.meta.url',"'https://fixture.local/'"),ctx);
 ctx.pe(JSON.stringify(fixture()),'atlas',[]);
 assert(request);const json=JSON.parse(request.jsonText);assert.equal(json.skeleton.spine,'3.8.99');assert(Array.isArray(json.skins));
});

test('3.7 SKEL reimports as version-correct JSON, including named skins and Bezier curves',()=>{
 const j=fixture();j.skins.alternate={slot:{picture:{width:20,height:20}}};
 const out=R.toJson(B.write37(j));assert.equal(out.version,'3.7.94');assert.equal(Array.isArray(out.json.skins),false);
 assert.deepEqual(Object.keys(out.json.skins),['default','alternate']);
 const curve=out.json.animations.move.bones.root.translate[0].curve;assert.equal(curve.length,4);assert(Math.abs(curve[0]-.2)<1e-6);
 assert(Array.isArray(JSON.parse(V.runtimeJsonText(out.text)).skins));
});

test('3.7 binary roundtrip preserves real fixture geometry throughout animation playback',()=>{
 const ctx=vm.createContext({console,Math,Float32Array,Int16Array,Uint16Array,setTimeout});
 vm.runInContext(readFileSync(new URL('../fixtures/spine-runtimes/spine-webgl-3.7.94.js',import.meta.url),'utf8'),ctx);
 const S=ctx.spine,atlas=new S.TextureAtlas(readFileSync(new URL('../fixtures/spine-3.8/skeleton.atlas',import.meta.url),'utf8'),()=>new S.FakeTexture({width:2048,height:2048}));
 const json=V.fromSpine38(R.toJson(new Uint8Array(readFileSync(new URL('../fixtures/spine-3.8/skeleton.skel',import.meta.url)))).json,'3.7');
 const restored=R.toJson(B.write37(json)).json;
 const read=j=>new S.SkeletonJson(new S.AtlasAttachmentLoader(atlas)).readSkeletonData(j);
 const original=read(json),roundtrip=read(restored);
 const pose=(data,an,t)=>{const sk=new S.Skeleton(data),state=new S.AnimationState(new S.AnimationStateData(data));state.setAnimation(0,an,false);state.update(t);state.apply(sk);sk.updateWorldTransform();const out=[];
  for(const b of sk.bones)out.push(b.a,b.b,b.c,b.d,b.worldX,b.worldY);
  for(const slot of sk.slots){out.push(slot.color.r,slot.color.g,slot.color.b,slot.color.a);const a=slot.attachment;if(!a)continue;const points=[];if(a instanceof S.RegionAttachment)a.computeWorldVertices(slot.bone,points,0,2);else if(a.worldVerticesLength)a.computeWorldVertices(slot,0,a.worldVerticesLength,points,0,2);out.push(...points);}return out;};
 assert.equal(original.skins.length,roundtrip.skins.length);
 for(const an of original.animations)for(let t=0;t<=an.duration+1e-6;t+=1/30){const a=pose(original,an.name,t),b=pose(roundtrip,an.name,t);assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert(Math.abs(a[i]-b[i])<.002,`${an.name}@${t}: ${a[i]} != ${b[i]}`);}
});
