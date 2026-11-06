import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createContext,runInContext} from 'node:vm';
const src=await readFile(new URL('../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');const start=src.indexOf('  let ART_GENERATE_REFERENCE_REVISION = 0;'),end=src.indexOf('  function artGenerateResourceMentionSnapshot(',start);assert.ok(start>0&&end>start);
// The setter reads a placed image's known size (2.0.324); bring the real reader along.
const sizeStart=src.indexOf('  function readArtGenerateReferenceSize('),sizeEnd=src.indexOf('  function measureArtGenerateReferenceSize(',sizeStart);assert.ok(sizeStart>0&&sizeEnd>sizeStart);
test('actual reference setter increments revision when an image is switched and restored',()=>{
 const original={dataUrl:'data:image/png;base64,AAAA'},s={references:[original],reference:original};
 const ctx={ART_GENERATE_STATE:s,ART_GENERATE_BASE_REFERENCE_SLOTS:3,ART_GENERATE_MAX_REFERENCES:10,artGenerateImg2imgCapability:()=>({engine:'qwen-2.1'}),URL};createContext(ctx);
 runInContext(src.slice(start,end)+src.slice(sizeStart,sizeEnd)+'\nglobalThis.change=setArtGenerateReference;globalThis.revision=()=>ART_GENERATE_REFERENCE_REVISION;',ctx);
 assert.equal(ctx.revision(),0);ctx.change(0,{dataUrl:'data:image/png;base64,BBBB'});ctx.change(0,original);assert.equal(ctx.revision(),2);assert.equal(s.references[0],original);
 assert.match(src,/referenceRevision: ART_GENERATE_REFERENCE_REVISION/);
});
