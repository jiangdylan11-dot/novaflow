import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

for(const path of ['../packages/shared/src/companion-chat.mjs','../supabase/functions/_art-shared/companion-chat.mjs']){
 test(`planner roles are scoped and validated in ${path}`,async()=>{
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const start=source.indexOf('export function companionInput('),end=source.indexOf('function prepareCompanionRequest(',start);
  assert.ok(start>=0&&end>start);
  const ctx={atob,btoa,isArtPromptLanguage:()=>true,validateFoartContext:x=>x,xiaotaoFileKind:()=>'',FOART_TOOL_SYSTEM:'tool',XIAOTAO_VISION_SYSTEM:'vision',XIAOTAO_TEXT_SYSTEM:'text',artPromptLanguageSystem:x=>x,need:(x,m)=>{if(!x)throw Error(m)}};
  vm.createContext(ctx);vm.runInContext(source.slice(start,end).replace('export function','function')+'\nglobalThis.input=companionInput;',ctx);
  const image=role=>({role,dataUrl:'data:image/png;base64,iVBORw0KGgo='});
  const payload={requestId:'request-123456',promptLanguage:'en',message:'fixture',mode:'foart',foartContext:{},images:['subject','style','pose'].map(image)};
  const result=ctx.input(payload);assert.equal(result.imageCount,3);
  const contents=result.input.at(-1).content;assert.deepEqual(Array.from(contents.filter(x=>x.type==='input_image'),x=>x.image_url),payload.images.map(x=>x.dataUrl));
  for(const role of ['pose','background','material','color','composition','lighting','object']){ctx.input({...payload,images:[image(role)]});assert.throws(()=>ctx.input({...payload,mode:'chat',images:[image(role)]}));}
  assert.throws(()=>ctx.input({...payload,images:[image('unsupported')]}));
  assert.throws(()=>ctx.input({...payload,images:[image('subject'),image('style'),image('pose'),image('reference')]}));
 });
}
