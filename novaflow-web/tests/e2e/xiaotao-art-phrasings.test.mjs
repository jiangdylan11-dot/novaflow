// Every phrasing in the corpus, as a correct brain would plan it, through the real plan checks (twice,
// as the tool loop validates again before each step) and the real run planning.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';
import {compileQwen21NativeRewrite,buildQwen21NativeRewrite,QWEN21_NATIVE_REWRITE} from '../../packages/shared/src/qwen21-native-rewrite.mjs';
import {PHRASINGS} from '../fixtures/xiaotao-art-phrasings.mjs';

let passed=0,failed=0;
const test=(name,fn)=>{try{fn();passed++;}catch(error){failed++;console.error('FAIL '+name+'\n'+error.message);}};
const source=readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
const box={};createContext(box);
runInContext(source.slice(source.indexOf('function turnSlot'),source.indexOf('function createQwenNodeRecheck'))+';this.planStyleRun=planStyleRun;this.plainFoartError=plainFoartError;this.pageLimit=pageLimitQuestion;',box);
runInContext(source.slice(source.indexOf('function keepTurnPictures'),source.indexOf('// Which pictures a request names as style'))+';this.keep=keepTurnPictures;',box);
const context=()=>({schema:FOART_TOOL_SCHEMA,controls:[{id:'control-2',label:'尺寸',kind:'input',type:'number',min:64,max:4096}]});
const plan=op=>({schema:FOART_TOOL_SCHEMA,status:op?'act':'reply',reply:'好的',operations:op?[op]:[]});
const realWarn=console.warn;console.warn=()=>{};

assert.ok(PHRASINGS.length>=60,'at least 60 phrasings');
for(const item of PHRASINGS)test(item.text,()=>{
  const checked=validateFoartPlan(plan(item.brain&&{...item.brain}),context());
  const op=checked.operations[0];
  if(item.expect.newConversation){assert.match(source,/新对话/);assert.ok(new RegExp('^(?:请)?(?:开始|开启|新建|重新开始)?(?:一个)?新对话[。.!！]?$|^(?:请)?(?:清空|重置)(?:当前)?对话[。.!！]?$').test(item.text));return;}
  if(!op||!op.action.startsWith('image_')){assert.equal(item.expect.run,null);return;}
  const kept=item.attached?box.keep(op):op;
  const run=box.planStyleRun(kept,item.text,item.pictures,item.subject===true,item.attached===true||item.pictures>0);
  if(item.expect.ask){assert.match(String(run?.ask||box.pageLimit(kept,item.pictures)),item.expect.ask);return;}
  if(item.expect.run===null){
    assert.equal(run,null);
    if(item.expect.count)assert.equal(kept.count,item.expect.count);
    if(item.expect.useResult!==undefined)assert.equal(kept.useResult,item.expect.useResult);
  }else{
    assert.equal(run?.ask,undefined);
    for(const key of ['subjectSlot','perStyle'])assert.equal(run[key],item.expect.run[key],key);
    assert.deepEqual([...run.styleSlots],item.expect.run.styleSlots);
  }
  validateFoartPlan(plan({...kept}),context());
});

test('with no parameters the wording still carries his sentences',()=>{
  const op={action:'image_generate',prompt:'p',generationMode:'img2img',useResult:false};
  const run=(text,count,subject)=>box.planStyleRun(op,text,count,subject,true);
  assert.deepEqual([...run('分别用@参考图1@参考图2@参考图3各自生成一张',3,true).styleSlots],[0,1,2]);
  assert.equal(run('主体还是刚才那张，继续用@参考图1@参考图2@参考图3各种再生成一次风格转换',3,true).subjectSlot,-1);
  assert.equal(run('把@参考图1分别转成@参考图2@参考图3的风格',3,false).subjectSlot,0);
  assert.equal(run('把这些图合成一张',3,true),null);
});

test('stray fields are dropped and bad parameters ignored',()=>{
  const checked=validateFoartPlan(plan({action:'image_generate',prompt:'p',generationMode:'img2img',useResult:false,eachStyle:true,subjectRef:'one',styleRefs:[],perStyle:'yes'}),context());
  assert.deepEqual(Object.keys(checked.operations[0]).sort(),['action','generationMode','prompt','useResult']);
  assert.throws(()=>validateFoartPlan(plan({action:'set_control',controlId:'control-2',value:5,eachStyle:true}),context()),/未知参数/,'other tools stay strict');
});

test('an ordinary edit whose rewrite fails falls back to the request, tags intact',()=>{
  const input={promptContract:QWEN21_NATIVE_REWRITE,qwenPromptMode:'img2img',currentPrompt:'把__NF_1__的背景换成海边',requirements:'',negativePrompt:'',supportsNegativePrompt:true};
  const result=compileQwen21NativeRewrite({output_text:JSON.stringify({rewritten_prompt:'把背景换成海边'})},buildQwen21NativeRewrite(input,'m',['subject']));
  assert.equal(result.modelPrompt,input.currentPrompt);
  const broken=compileQwen21NativeRewrite({output_text:'不是 JSON'},buildQwen21NativeRewrite(input,'m',['subject']));
  assert.equal(broken.modelPrompt,input.currentPrompt);
});

test('internal check wording never reaches the panel',()=>{
  for(const text of ['Foart 工具含未知参数（image_generate）：x','模型返回的绘图提示词未通过完整性校验。'])assert.match(box.plainFoartError(Error(text)),/这一步没做成/);
  assert.equal(box.plainFoartError(Error('参考图尺寸仍在读取')),'参考图尺寸仍在读取');
});

console.warn=realWarn;
console.log(`xiaotao-art-phrasings: ${passed} passed, ${failed} failed`);
if(failed)process.exit(1);
