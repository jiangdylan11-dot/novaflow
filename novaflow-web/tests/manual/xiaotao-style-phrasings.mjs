// Asks the REAL online brain to plan every phrasing in the corpus. Planning only: nothing is generated.
//   NOVAFLOW_RUNNINGHUB_API_KEY=... node tests/manual/xiaotao-style-phrasings.mjs [model id]
//   node tests/manual/xiaotao-style-phrasings.mjs --dry      (checks this script with a canned reply, no network)
// Each planning call costs real credits. Default model: 豆包 Seed 2.1 Lite.
import {FOART_TOOL_SCHEMA,FOART_TOOL_SYSTEM,foartPlanResponseFormat,readFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';
import {postRunningHubResponses,readRunningHubLlmConfig} from '../../packages/shared/src/runninghub-llm.mjs';
import {PHRASINGS} from '../fixtures/xiaotao-art-phrasings.mjs';

const dry=process.argv.includes('--dry');
const model=process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'bytedance/doubao-seed-2.1-lite';
if(!dry&&!process.env.NOVAFLOW_RUNNINGHUB_API_KEY){console.error('Set NOVAFLOW_RUNNINGHUB_API_KEY, or use --dry.');process.exit(2);}
const config=dry?null:{...readRunningHubLlmConfig(process.env),model};
const context=item=>({schema:FOART_TOOL_SCHEMA,controls:[{id:'control-2',label:'尺寸',kind:'input',type:'number',min:64,max:4096}],pictureCount:item.pictures,hasCurrentSubject:item.subject===true});
const samePlan=(want,got)=>{
  if(!want)return got.status!=='act'||!got.operations.some(op=>op.action.startsWith('image_'));
  const op=got.operations.find(row=>row.action===want.action);
  if(!op)return false;
  for(const key of ['generationMode','perStyle','count'])if((want[key]??undefined)!==(op[key]??undefined))return false;
  if(want.subjectRef&&op.subjectRef!==want.subjectRef)return false;
  if(want.styleRefs&&JSON.stringify(want.styleRefs)!==JSON.stringify(op.styleRefs))return false;
  return true;
};
let good=0;const wrong=[];
for(const item of PHRASINGS){
  const body={model,store:false,temperature:0,max_output_tokens:2048,text:{format:foartPlanResponseFormat(context(item))},
    input:[{role:'system',content:[{type:'input_text',text:FOART_TOOL_SYSTEM}]},{role:'user',content:[{type:'input_text',text:JSON.stringify({message:item.text,currentFoart:context(item)})}]}]};
  try{
    const reply=dry?{output_text:JSON.stringify({schema:FOART_TOOL_SCHEMA,status:item.brain?'act':'reply',reply:'好的',operations:item.brain?[item.brain]:[]})}:await postRunningHubResponses({body,config,maxRetries:0,timeoutMs:120000});
    const plan=readFoartPlan(reply.output_text,context(item));
    if(samePlan(item.brain,plan))good++;else wrong.push({text:item.text,want:item.brain,got:plan.operations});
  }catch(error){wrong.push({text:item.text,error:String(error?.message||error)});}
}
console.log(`${good}/${PHRASINGS.length} plans correct (${dry?'dry run':model})`);
for(const row of wrong)console.log(JSON.stringify(row));
if(wrong.length)process.exitCode=1;
