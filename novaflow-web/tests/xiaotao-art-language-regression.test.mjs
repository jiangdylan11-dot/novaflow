import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildGrokPromptOptimizeRequest,grokResponsesPublicResult} from '../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/xiaotao-watercolor-structure.json',import.meta.url),'utf8'));
const model='deepseek/deepseek-v4.1-flash';
function validate(value){
 const prepared=buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',targetEngine:'qwen-2.1',agentModelLanguage:'en',promptSchema:'nf.art.prompt.v1',currentPrompt:'森林中的小木屋，暖色灯光，水彩风格',requirements:'',negativePrompt:'',supportsNegativePrompt:true,nsfw:false,qwenPromptMode:'txt2img'},model);
 const text=JSON.stringify(value);
 return grokResponsesPublicResult({model,status:'completed',finish_reason:'stop',output_text:text,output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]},prepared.resultOptions);
}
test('a complete real watercolor response with wet and dry brush techniques is accepted',()=>{
 const result=validate(fixture);assert.equal(result.editContract,'structured-recompile-v1');assert.match(result.output_text,/湿画法|水彩/);
});
for(const label of ['中文','English','style'])test('generic or wrong-slot render language remains invalid: '+label,()=>{
 const value=structuredClone(fixture);value.style.render_language=label;assert.throws(()=>validate(value),/style.render_language/);
});
test('non-art medium and generic finish remain invalid',()=>{
 for(const field of ['medium','finish']){const value=structuredClone(fixture);value.style[field]='high';assert.throws(()=>validate(value));}
});
