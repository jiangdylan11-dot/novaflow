import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8'),start=source.indexOf('  async function resolveGptDeliveredImage('),end=source.indexOf('\n  function parseJsonOrRawText',start),body=source.slice(start,end);
function load(width,height){let resized=false;const root={loadNovaflowArtExportImage:async()=>({naturalWidth:width,naturalHeight:height}),document:{createElement:()=>({getContext:()=>({drawImage(){resized=true;}}),toDataURL:()=> 'data:image/png;base64,resized'})}};vm.runInNewContext(body+'\nthis.deliver=resolveGptDeliveredImage;',root);return {root,resized:()=>resized};}
test('custom dimensions resample a matching provider tier without changing composition',async()=>{const e=load(1024,1024),result=await e.root.deliver('actual-provider-image',{gptSize:'Custom',gptCustomWidth:512,gptCustomHeight:512});assert.equal(result.width,512);assert.equal(result.height,512);assert.equal(result.customSizeApplied,true);assert.equal(e.resized(),true);});
test('an unsupported aspect remains truthful and is never silently stretched',async()=>{const e=load(1024,768),result=await e.root.deliver('actual-provider-image',{gptSize:'Custom',gptCustomWidth:512,gptCustomHeight:512});assert.equal(result.width,1024);assert.equal(result.height,768);assert.equal(result.customSizeApplied,false);assert.equal(result.requestedWidth,512);assert.equal(e.resized(),false);});
