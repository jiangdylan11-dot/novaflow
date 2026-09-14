import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import vm from 'node:vm';
import {buildGrokPromptOptimizeRequest, grokResponsesPublicResult} from '../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';

const reverseCase = process.argv.includes('--reverse-outdoor');
const optimizeCase = process.argv.includes('--optimize-outdoor');
const out = path.resolve(reverseCase || optimizeCase ? 'docs/art-reverse-fusion-20260914' : 'docs/art-prompt-fusion-20260914');
fs.mkdirSync(out, {recursive:true});
let source = '[风格设定]\n精细水彩插画，安静温暖的午后氛围。\n\n[主体物品]\n一只橘猫坐在木桌上，绿色眼睛看向窗外，前爪并拢，尾巴绕在身体右侧。桌上放着一只蓝色陶瓷杯。\n\n[环境背景]\n背景是木质窗框与窗外花园，主体始终为橘猫。\n\n[光线与色彩]\n阳光从左侧窗户照入，暖色阳光与蓝色陶瓷杯形成冷暖呼应。\n\n[拍摄参数]\n平视中景，猫位于画面中央，保持原有构图。\n\n[要求]\n保持一只橘猫、蓝色陶瓷杯、木桌和窗外花园，不增加其他动物，不改变水彩风格。';
const payload = {prompt:source,currentPrompt:source,surface:'art',purpose:'optimize',promptSchema:'nf.art.prompt.v1',requirements:'用户本次修改要求（最高优先级）：增加参考图的画面丰富感。',negativePrompt:'模糊，结构错误，水印',supportsNegativePrompt:true};
delete payload.promptSchema;
if(reverseCase || optimizeCase) {
  const frontend = fs.readFileSync('particle-editor/novaflow-smart-ai.js','utf8');
  const start = frontend.indexOf('  function prepareStaticArtReverseFusion(');
  const end = frontend.indexOf('\n  async function ', start);
  const sandbox = vm.createContext({});
  vm.runInContext(frontend.slice(start,end),sandbox);
  const prepared = sandbox.prepareStaticArtReverseFusion(fs.readFileSync('particle-editor-desktop/tests/fixtures/art-reverse-outdoor-fusion.txt','utf8'),'增加室外背景，提升画面质量和精美度。增加人物细节');
  source = prepared.basePrompt;
  Object.assign(payload,prepared.request,{supportsNegativePrompt:false,negativePrompt:'',nsfw:false});
  if(optimizeCase) payload.requirements = '用户本次修改要求（最高优先级）：增加室外背景，提升画面质量和精美度。增加人物细节';
}
const ui = process.argv.includes('--ui');
if(ui) {
  payload.prompt = payload.currentPrompt = '一只橘猫坐在木桌上，绿色眼睛看向窗外，前爪并拢，尾巴绕在身体右侧。桌上放着一只蓝色陶瓷杯。背景是木质窗框与窗外花园。阳光从左侧窗户照入。平视中景，猫位于画面中央。精细水彩插画，安静温暖的午后氛围。保持猫、杯子、木桌和花园，不增加其他动物。';
  const sandbox = vm.createContext({window:{},state:{requirements:'增加画面丰富感。',context:{surface:'art'},mode:'optimize',starterPreset:'',artStyle:'original'}});
  vm.runInContext(fs.readFileSync('particle-editor/art-quality-profile.workflow.js','utf8'),sandbox);
  const frontend = fs.readFileSync('particle-editor/novaflow-smart-ai.js','utf8');
  for(const name of ['stripTrailingGenericArtPreservation','artAutomaticQualityInstruction','artHighQualityCgRenderingGuardInstruction','buildSmartAiRequirements']) {
    const start = frontend.indexOf('  function '+name+'(');
    const end = frontend.indexOf('\n  function ',start+1);
    vm.runInContext(frontend.slice(start,end),sandbox);
  }
  payload.requirements = sandbox.buildSmartAiRequirements({includeUserIntent:true,userIntentFirst:true,purpose:'optimize'});
  payload.supportsNegativePrompt = false;
  payload.negativePrompt = '';
}
const local = process.argv.includes('--local');
const prefix = (local ? 'local' : 'grok') + (ui ? '-ui' : '') + (optimizeCase ? '-optimize' : '');
const save = (name,data) => fs.writeFileSync(path.join(out,`${prefix}-${name}`),typeof data==='string'?data:JSON.stringify(data,null,2));
save('request.json',payload);
const start=Date.now();
try {
  let data;
  if(local){
    const config = await (await fetch('http://127.0.0.1:4783/__prompt_assistant/status')).json();
    const log=fs.openSync(path.join(out,prefix+'-service.log'),'w');
    const probe = `import sys,runpy,pathlib\nsys.path.insert(0,${JSON.stringify(path.dirname(config.serviceScript))})\nns=runpy.run_path(${JSON.stringify(config.serviceScript)},run_name='fusion_probe')\noriginal=ns['PromptAssistant'].generate\ndef capture(self,*args,**kwargs):\n result=original(self,*args,**kwargs)\n pathlib.Path(${JSON.stringify(path.join(out,prefix+'-generated.txt'))}).write_text(result,encoding='utf-8')\n return result\nns['PromptAssistant'].generate=capture\nns['main']()\n`;
    const child=spawn(config.pythonPath,['-c',probe],{windowsHide:true,stdio:['pipe','pipe',log],env:{...process.env,PYTHONIOENCODING:'utf-8',NOVAFLOW_RUNTIME_JSON:'C:/ProgramData/NovaFlow/AI-Runtime/runtime.json',NOVAFLOW_PROMPT_ASSISTANT_MODEL_PATH:config.modelPath,NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH:config.reverseModelPath}});
    const timer=setTimeout(()=>child.kill(),900000);
    child.stdin.on('error',()=>{});
    try {
      for await(const line of readline.createInterface({input:child.stdout})){
        let response; try{response=JSON.parse(line);}catch{continue;}
        if(response.type==='ready') child.stdin.write(JSON.stringify({id:1,command:'optimizePrompt',...payload})+'\n');
        if(response.id!==1) continue;
        save('response.json',response);
        if(!response.ok) throw Error(response.error||'Local model failed');
        data=response.data||response.result||response; break;
      }
    } finally {clearTimeout(timer);child.kill();fs.closeSync(log);}
  } else {
    const require=createRequire(import.meta.url);
    const config=require('../particle-editor-desktop/license-admin-gui/admin-data.js').readAdminGrokEnv();
    if(!config.apiKey) throw Error('Grok provider not configured');
    const built=buildGrokPromptOptimizeRequest(payload,config.model);
    save('model-request.json',built.body);
    const response=await fetch(config.baseUrl.replace(/\/$/,'')+'/responses',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},body:JSON.stringify(built.body),signal:AbortSignal.timeout(240000)});
    const raw=await response.json();
    save('raw-response.json',raw);
    if(!response.ok) throw Error('Grok HTTP '+response.status);
    data=grokResponsesPublicResult(raw,built.resultOptions);
    save('response.json',data);
  }
  const text=data?.positivePrompt||data?.output_text||data?.prompt||'';
  if(!text || text===source) throw Error('No changed prompt');
  const anchors = reverseCase || optimizeCase ? ['成年女性','粉色长发','银色花冠','红色花朵','粉色宝石','银色脚链','右手','下巴','左手','全身','仰视'] : ['橘猫','蓝色','陶瓷杯','木桌','花园','水彩'];
  for(const anchor of anchors) if(!text.includes(anchor)) throw Error('Missing source anchor: '+anchor);
  if(reverseCase || optimizeCase) {
    if(/纯白色背景|后景无层次|无其他物体|用户补充要求|只作为最终提示词约束/.test(text)) throw Error('Unfused original background or requirement carrier');
    const section = (value,name)=>value.split('['+name+']')[1]?.split(/\n\[/)[0]?.trim();
    const background = section(text,'环境背景') || '';
    if(!/室外|户外|花园|庭院|森林|花海|草地|山谷|天空|阳光|树|花丛/.test(background)) throw Error('No concrete outdoor background');
    if(section(text,'主体物品') === section(source,'主体物品')) throw Error('Character detail request not applied');
  }
  save('output.txt',text);
  save('summary.json',{ok:true,elapsedMs:Date.now()-start,chars:text.length,sourceAnchorsPreserved:true});
  console.log(JSON.stringify({provider:prefix,ok:true,elapsedMs:Date.now()-start,chars:text.length}));
} catch(error){save('summary.json',{ok:false,elapsedMs:Date.now()-start,error:error.message});console.error(error.message);process.exitCode=1;}
