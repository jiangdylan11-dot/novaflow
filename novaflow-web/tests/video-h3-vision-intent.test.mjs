import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeXiaotaoV3VideoIntent, inspectXiaotaoV3VideoReply } from '../packages/shared/src/xiaotao-video-framework-v3.mjs';
import { responsesToChatCompletions } from '../packages/shared/src/runninghub-llm.mjs';

const one='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aS0AAAAASUVORK5CYII=';
const two='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
const input=()=>({mode:'video-rewrite',requestId:'request-v1',h3Mode:'first_last',durationSeconds:2,prompt:'角色静静思考',requirements:'',references:[{key:'first_frame',kind:'image',sourceId:'first-1'},{key:'last_frame',kind:'image',sourceId:'last-2'}],images:[{key:'first_frame',dataUrl:one},{key:'last_frame',dataUrl:two}]});

test('H3 first-last vision is explicitly enabled and sends two ordered real image parts',()=>{
  const request=input();assert.throws(()=>canonicalizeXiaotaoV3VideoIntent(request));
  const result=canonicalizeXiaotaoV3VideoIntent(request,{visionEnabled:true});
  assert.equal(result.compiled.imageCount,2);assert.equal(result.compiled.textOnly,false);
  const parts=result.compiled.input.at(-1).content;
  assert.deepEqual(parts.filter(x=>x.type==='input_image').map(x=>x.image_url),[one,two]);
  assert.match(result.compiled.systemText,/first frame.*second.*last frame/i);
  assert.doesNotMatch(result.compiled.systemText,/no reference media has been analysed/i);
  const wire=responsesToChatCompletions({input:result.compiled.input,max_output_tokens:1200},'xai/grok-4.7');
  assert.equal(wire.model,'xai/grok-4.7');
  assert.deepEqual(wire.messages.at(-1).content.filter(x=>x.type==='image_url').map(x=>x.image_url.url),[one,two]);
  assert.match(JSON.stringify(wire.messages.at(-1).content),/First frame image.*Last frame image/);
});
test('the signed hash binds image bytes and their roles',()=>{
  const original=input(),changed=input();changed.images[0].dataUrl=two;
  assert.notEqual(canonicalizeXiaotaoV3VideoIntent(original,{visionEnabled:true}).intentHash,canonicalizeXiaotaoV3VideoIntent(changed,{visionEnabled:true}).intentHash);
  const swapped=input();[swapped.images[0].dataUrl,swapped.images[1].dataUrl]=[two,one];
  assert.notEqual(canonicalizeXiaotaoV3VideoIntent(original,{visionEnabled:true}).intentHash,canonicalizeXiaotaoV3VideoIntent(swapped,{visionEnabled:true}).intentHash);
});
test('reject missing, duplicate, invalid or unsupported reference media before a provider call',()=>{
  for(const mutate of [r=>r.images.pop(),r=>r.images[1].key='first_frame',r=>r.images[0].dataUrl='https://example.test/private.png',r=>r.h3Mode='image_video',r=>r.images[0].dataUrl='data:image/png;base64,aGVsbG8=']) {
    const r=input();mutate(r);assert.throws(()=>canonicalizeXiaotaoV3VideoIntent(r,{visionEnabled:true}));
  }
});
test('vision reply still must pass the original H3 structured bilingual validator',()=>{
  const r=input();r.prompt='<Picture 1> 中的女孩睁开眼睛，最后停在 <Picture 2>';
  const prepared=canonicalizeXiaotaoV3VideoIntent(r,{visionEnabled:true});
  const fields=(n,s)=>`integrated_multimodal_description: ${n}\n\noverall_soundscape: ${s}\n\nnon_diegetic_music: N/A`;
  const answer=JSON.stringify({modelPrompt:fields('[Shot 1] 3D CG, the girl shown in <Picture 1> sits with her eyes closed. The camera holds a static shot as she opens her eyes, then closes them again and settles into the pose of <Picture 2>.','A soft breeze moves through the room.'),displayPrompt:fields('[Shot 1] 三维 CG，<Picture 1> 中的女孩闭眼坐着。镜头固定，她睁开眼睛，随后又闭上，落定在 <Picture 2> 的姿态。','微风轻轻吹过房间。')});
  const result=inspectXiaotaoV3VideoReply({intent:r,intentHash:prepared.intentHash,reply:answer});
  assert.equal(result.textOnly,false);assert.equal(result.h3Mode,'first_last');assert.equal(result.durationSeconds,2);
  assert.match(result.displayPrompt,/@首帧/);assert.match(result.displayPrompt,/@尾帧/);
  assert.match(result.modelPrompt,/Picture 1/);assert.match(result.modelPrompt,/Picture 2/);
  assert.throws(()=>inspectXiaotaoV3VideoReply({intent:{...r,images:[{...r.images[0],dataUrl:two},r.images[1]]},intentHash:prepared.intentHash,reply:answer}));
});
