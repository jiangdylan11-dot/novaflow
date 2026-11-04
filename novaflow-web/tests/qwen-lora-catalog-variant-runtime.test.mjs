import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createDomSandbox} from '../worker/src/comfy/dom-shim.mjs';
const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
function fixture(){
 const paths=[],events=new Map(),root=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,TextEncoder,TextDecoder,crypto:webcrypto,NOVAFLOW_LIGHT_HOME:true,NOVAFLOW_WEB_CONFIG:{controlUrl:'https://fixture.invalid',authUrl:'https://fixture.invalid/novaflow-backend'},addEventListener:(n,f)=>{if(!events.has(n))events.set(n,new Set());events.get(n).add(f)},removeEventListener:(n,f)=>events.get(n)?.delete(f),dispatchEvent:()=>true,fetch:async url=>{const target=new URL(String(url));assert.equal(target.origin,'https://fixture.invalid');paths.push(target);return Response.json({ok:true,items:[]});}});
 runInContext(source,createContext(root));return {root,paths};
}
test('standard Qwen LoRA catalog keeps the standard lookup',async()=>{const f=fixture(),r=await f.root.electronAPI.qwenLoraCatalog({engine:'qwen-2.1',variant:'standard',nsfw:false});assert.equal(r.ok,true);assert.equal(f.paths.length,1);assert.equal(f.paths[0].searchParams.get('engine'),'qwen-2.1');assert.equal(f.paths[0].searchParams.get('variant'),null);assert.equal(f.paths[0].searchParams.get('nsfw'),'false');});
test('Turbo Qwen LoRA catalog carries the Turbo variant',async()=>{const f=fixture(),r=await f.root.electronAPI.qwenLoraCatalog({engine:'qwen-2.1',variant:'turbo',nsfw:true});assert.equal(r.ok,true);assert.equal(f.paths.length,1);assert.equal(f.paths[0].searchParams.get('engine'),'qwen-2.1');assert.equal(f.paths[0].searchParams.get('variant'),'turbo');assert.equal(f.paths[0].searchParams.get('nsfw'),'true');});
