import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { planFlashArtDirection } from '../../worker/src/flash-art-direction.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const payload=()=>({surface:'art',purpose:'art-director',visualSchema:'nf.art.direction.v1',promptLanguage:'en',
  currentPrompt:'Keep the source scene.',images:[{dataUrl:png,name:'style.png'},{dataUrl:png,name:'subject.png'}],
  artContext:{task:'style',references:[{source:2,roles:['style']},{source:5,roles:['subject']}]}});
function session(prompt,model='qwen35-heretic') {
  const calls=[];return {calls,identity:{id:model},infer:async input=>{calls.push(input);return {model,requestId:'isolated-test',
    text:JSON.stringify({prompt,sourceContent:'A red circle on a white background.',renderingClass:'painterly'})};}};
}
test('validated reordered Qwen input supplies missing role markers while preserving native text and review evidence',async()=>{
  const prose='Paint a red circle against the original white background with textured brushwork.';
  const flash=session(prose),out=await planFlashArtDirection({payload:payload(),flash});
  assert.deepEqual(flash.calls[0].images.map(x=>x.name),['subject.png','style.png']);
  assert.deepEqual(out.artDirection.editEnhancer.sourceOrder,[5,2]);
  assert.match(out.artDirection.prompt,/Use <image1> as the original content source/);
  assert.match(out.artDirection.prompt,/Use <image2> only as the artistic rendering reference/);
  assert.ok(out.artDirection.prompt.endsWith(prose));
  assert.equal(out.artDirection.editEnhancer.prompt,out.artDirection.prompt);
  assert.equal(JSON.parse(out.rawOutput).prompt,prose);
  assert.deepEqual(out.nativeAnalysis.inputRoleBinding,{source:'validated-input-order',markers:'application-inserted',requiresManualReview:true,
    modelPromptSHA256:createHash('sha256').update(prose).digest('hex')});
});
test('partial, malformed, conflicting and out-of-range Qwen markers never get silently fixed',async()=>{
  for(const prompt of ['Use <image1> for content.','Use <image1> and <image2> and <image3>.',
    'Use <IMAGE1> and <image2>.','Use image1 and image2.','Use 参考图1 for style.',
    'Use <image1> and <image2> and <image3']) {
    await assert.rejects(planFlashArtDirection({payload:payload(),flash:session(prompt)}),e=>e.code==='strata-art-invalid-response',prompt);
  }
});
test('existing valid marker output remains byte-exact and other models still require their native markers',async()=>{
  const text='Use <image1> for the content and <image2> for the style.\n';
  const out=await planFlashArtDirection({payload:payload(),flash:session(text)});
  assert.equal(out.artDirection.prompt,text);assert.equal(out.nativeAnalysis.inputRoleBinding,undefined);
  await assert.rejects(planFlashArtDirection({payload:payload(),flash:session('No markers','other-model')}),e=>e.code==='strata-art-invalid-response');
});
test('binding does not grant authority or infer semantic fidelity from model prose',async()=>{
  const conflicting='Paint a red circle; replace the white background with blue stripes.';
  const out=await planFlashArtDirection({payload:payload(),flash:session(conflicting)});
  assert.equal(out.nativeAnalysis.inputRoleBinding.requiresManualReview,true);
  assert.ok(out.artDirection.prompt.endsWith(conflicting));
  assert.equal(out.artDirection.editEnhancer.resourcesReleased,undefined);
  assert.equal(out.artDirection.editEnhancer.generationReady,undefined);
});
