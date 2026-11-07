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
runInContext(source.slice(source.indexOf('function turnSlot'),source.indexOf('function createQwenNodeRecheck'))+';this.planImageRuns=planImageRuns;this.plainFoartError=plainFoartError;this.pageLimit=pageLimitQuestion;',box);
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
  const run=box.planImageRuns(kept,item.pictures,item.subject===true);
  if(item.expect.ask){assert.match(String(run?.ask||box.pageLimit(kept,item.pictures)),item.expect.ask);return;}
  if(item.expect.run===null){
    assert.equal(run,null);
    if(item.expect.count)assert.equal(kept.count,item.expect.count);
    if(item.expect.useResult!==undefined)assert.equal(kept.useResult,item.expect.useResult);
  }else{
    assert.equal(run?.ask,undefined);
    assert.equal(run.subjectSlot,item.expect.run.subjectSlot,'subjectSlot');
    assert.deepEqual(JSON.parse(JSON.stringify(run.runs.map(row=>row.slots))),item.expect.run.runs);
  }
  validateFoartPlan(plan({...kept}),context());
});

test('the brain\'s roles and runs are placed as given; wording decides nothing',()=>{
  const op={action:'image_generate',prompt:'p',generationMode:'img2img',useResult:false};
  assert.equal(box.planImageRuns(op,3,true),null,'no references or runs: the ordinary drawing path');
  const pose=box.planImageRuns({...op,references:[{ref:1,role:'style'},{ref:2,role:'style'},{ref:3,role:'pose'}],runs:[{refs:[1,3]},{refs:[2,3]}]},3,true);
  const slots=plan=>JSON.parse(JSON.stringify(plan.runs.map(run=>run.slots)));
  assert.deepEqual(slots(pose),[[0,2],[1,2]]);assert.equal(pose.roles[2],'pose');
  assert.equal(box.planImageRuns({...op,references:[{ref:1,role:'subject'}]},1,false),null,'a subject alone is an ordinary edit');
  assert.match(box.planImageRuns({...op,references:[{ref:1,role:'style'}]},1,false).ask,/主体图/);
  assert.match(box.planImageRuns({...op,references:[{ref:1,role:'subject'},{ref:2,role:'style'},{ref:3,role:'style'},{ref:4,role:'pose'}]},4,false).ask,/最多用 3 张图/);
  assert.deepEqual(slots(box.planImageRuns({...op,references:[{ref:1,role:'style'},{ref:9,role:'style'}]},2,true)),[[0]],'a number past this turn\'s pictures names nothing');
});

test('stray fields are dropped and bad parameters ignored',()=>{
  const checked=validateFoartPlan(plan({action:'image_generate',prompt:'p',generationMode:'img2img',useResult:false,eachStyle:true,references:[{ref:'one',role:'style'}],runs:[]}),context());
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

test('a quote on another line tells the person the model changed',()=>{
  assert.match(source,/onPricingQuote:quote=>\{if\(current\(\)\)\{if\(quote\?\.model&&quote\.model!==modelId\)state\.messages\.push\(\{role:'status',content:backupLineNotice\(quote\.model\)\}\)/);
  assert.match(source,/所选模型线路慢，这步已改用 /);
});

test('a folded 生图 panel does not switch the page off during a 小桃 run',()=>{
  const brand=readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
  const busy=brand.slice(brand.indexOf('function isArtGeneratePromptAssistantBusy'),brand.indexOf('function isArtGenerateRuntimeOwnedElement'));
  assert.match(busy,/NovaFlowXiaotaoArtAgent\?\.panel\?\.controller\?\.state\?\.pending === true/);
  assert.match(brand,/if \(isArtGeneratePromptAssistantBusy\(\) && hasArtGenerateMountedSurface\(\)\) return false;/);
});

test('a lapsed quote at the same price refreshes and carries on',()=>{
  assert.match(source,/const policy=currentPricingPolicy\(\)\|\|await refreshPricingPolicy\(\),terms=/);
  assert.match(source,/if\(!currentPricingPolicy\(\)\|\|currentPricingPolicy\(\)\.version!==knownPrice\)\{state\.error=/);
});

test('internal check wording never reaches the panel',()=>{
  for(const text of ['Foart 工具含未知参数（image_generate）：x','模型返回的绘图提示词未通过完整性校验。'])assert.match(box.plainFoartError(Error(text)),/这一步没做成/);
  assert.equal(box.plainFoartError(Error('参考图尺寸仍在读取')),'参考图尺寸仍在读取');
});

console.warn=realWarn;
console.log(`xiaotao-art-phrasings: ${passed} passed, ${failed} failed`);
if(failed)process.exit(1);
