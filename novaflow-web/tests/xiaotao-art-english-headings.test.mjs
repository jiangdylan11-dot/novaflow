import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedArtPhases} from '../packages/shared/src/companion-art-business.mjs';

const model='deepseek/deepseek-v4.1-flash',actor={userId:'fixture',sessionId:'fixture',epoch:1},pricingVersion='fixture';
const source='[风格设定]\n水彩纸本\n[主体物品]\n一座木屋\n[环境背景]\n森林\n[光线与色彩]\n暖色灯光\n[拍摄参数]\n中景\n[用户附加要求]\n无人物';
const english='[Style]\nwatercolor on paper\n[Subjects]\none wooden cabin\n[Environment]\na forest\n[Lighting]\nwarm light\n[Camera]\nmedium shot\n[Requirements]\nno people';
async function translate(output){
  const compiler={buildGrokPromptOptimizeRequest:(_input,model)=>({body:{model,max_output_tokens:6144,input:[{role:'system',content:[{text:'fixture'}]}]},resultOptions:{ordinaryArtStructuredPrompt:true}}),
    grokResponsesPublicResult:()=>({output_text:source,editContract:'structured-recompile-v1',promptSchema:'nf.art.prompt.v1'})};
  const phases=createTrustedArtPhases({secret:Buffer.alloc(32,7),models:[model],compiler,policyFor:()=> 'fixture',isCurrent:async()=>true,
    quote:async()=>({pricingVersion,estimatedCredits:1}),assessUsage:async()=>({}),infer:async()=>{},
    executeAtomic:async({requestHash,pricingVersion,model})=>({status:'settled',settledCredits:1,requestHash,pricingVersion,model,
      decision:{credits:1,usageMissing:false,pricingVersion},response:{model,status:'completed',finish_reason:'stop',output:[],output_text:output}})});
  const q=await phases.quoteStructure({actor,model,intentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',input:{currentPrompt:'森林中的木屋'}});
  const structure=await phases.submit({actor,quoteToken:q.quoteToken});assert.equal(structure.ok,true);
  const e=await phases.quoteEnglish({actor,stageToken:structure.stageToken});return phases.submit({actor,quoteToken:e.quoteToken});
}
for(const headings of [['Lighting and Color','User Additional Requirements'],['Lighting & Colour','Additional Requirements'],['Lighting','User Requirements']])
test('accept equivalent headings: '+headings.join(', '),async()=>{
  const result=await translate(english.replace('[Lighting]','['+headings[0]+']').replace('[Requirements]','['+headings[1]+']'));
  assert.equal(result.ok,true);assert.equal(result.modelPrompt,english);
});
for(const [label,output] of [['missing section',english.replace('[Camera]\nmedium shot\n','')],['unknown heading',english.replace('[Lighting]','[Other]')],['untranslated body',english.replace('warm light','暖色灯光')],['reordered sections',english.replace('[Lighting]','[Camera]').replace('[Camera]\nmedium','[Lighting]\nmedium')]])
test('reject '+label,async()=>{const result=await translate(output);assert.equal(result.ok,false);assert.equal(result.errorCode,'english-invalid');});
