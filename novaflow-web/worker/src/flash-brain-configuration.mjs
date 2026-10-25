// Build portable local configuration from the installed environment and model root.
// No download, inference, cloud configuration or model substitution happens here.
import { readFile, stat, mkdir, writeFile, rename, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync,statSync } from 'node:fs';
const first='Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf';
const second='Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00002-of-00002.gguf';
const projector='mmproj-Swift-Qwen3.8-Flash-Next-BF16.gguf';
const hashes=['ca3b302d3d1eb6eddce3ea4acc79854e6cc5fdc0583e374a6a8b6bb67327743b','e4996a6de18fd49c58d9a0040fcfd73787db6407c51973f29884bee7b14c9dbb','cd1140f4abba943ce8d9fa92fed8407e389954d26907efde7b72153c75bd8a60'];
const sizes=[39788473344,28363693824,907543520];
const exists=async path=>{try {await access(path);return true;}catch{return false;}};
export function isFlashBrainConfigured(config) {
  try {
    if (config?.enabled===false || !config?.modelFiles?.length) return false;
    for (const value of config.modelFiles) {
      const file=typeof value==='string'?{path:value}:value, info=statSync(file.path);
      if(!info.isFile() || (file.bytes!==undefined && info.size!==file.bytes))return false;
    }
    const server=JSON.parse(readFileSync(config.serverConfigPath,'utf8').replace(/^\uFEFF/,'')),args=server.args;
    if(!Array.isArray(args) || !args.includes('--pack') || !args.includes('--mtp'))return false;
    const pack=args[args.indexOf('--pack')+1],mtp=args[args.indexOf('--mtp')+1];
    const required=[config.pythonPath,join(config.controlRoot,'serve','server.py'),join(config.controlRoot,'data','expert-profile.bin'),server.exe,server.vision?.exe,
      join(pack,'dense.bin'),join(pack,'experts.bin'),join(pack,'index.txt'),join(server.tokenizer,'vocab.json'),
      ...['dense.bin','dense.txt','experts.bin','draft_vocab.bin'].map(name=>join(mtp,name))];
    return required.every(path=>typeof path==='string' && statSync(path).isFile());
  } catch {return false;}
}
export function buildFlashBrainConfiguration({installPath,modelsPath,configPath}) {
  const root=join(installPath,'engine','strata'),control=join(root,'control-0.1.49.2'),engine=join(root,'engine-0.1.48-windows-cuda13');
  const models=join(modelsPath,'LLM','qwen38_swift15_strata'),state=join(dirname(configPath),'flash-local-brain-runtime');
  const files=[first,second,projector].map((name,i)=>({path:join(models,name),bytes:sizes[i],sha256:hashes[i]}));
  const server={exe:join(engine,'strata.exe'),args:['--pack',join(models,'strata-pack-resident'),'--native',files[0].path,'--ple-gguf',files[0].path,'--expert-profile',join(control,'data','expert-profile.bin'),'--expert-cache','auto','--prefill','4096','--max-context','12288','--resident-budget-gib','24','--ple-io','direct','--spec','4','--mtp',join(models,'mtp','rt'),'--spec-min-p','0.5','--conversation-cache-mib','0','--vram-reserve-mib','3072'],
    cwd:state,tokenizer:join(models,'strata-pack','tokenizer'),model_name:'swift-1.5-qwen38-iq2-xs',host:'127.0.0.1',port:8198,backend:'cuda',gpu:0,lib_dirs:[engine],mtp:true,lazy_load:true,open_browser:false,log:join(state,'logs','engine.log'),
    vision:{exe:join(engine,'strata-vision.exe'),mmproj:files[2].path,model:files[0].path,gpu:true,max_tokens:2048},env:{STRATA_RESIDENT_HEADROOM_GIB:'6',STRATA_UNBUFFERED_LOAD:'1',STRATA_ROUTE_TAIL_SKIP:'0'}};
  const config={enabled:true,analysisBackend:'strata',pythonPath:join(control,'python','python.exe'),controlRoot:control,serverConfigPath:join(state,'server.json'),baseUrl:'http://127.0.0.1:8198',receiptPath:join(state,'state','runtime-owner.json'),readyFilePath:join(state,'state','http-ready.json'),logPath:join(state,'logs','http.log'),lastCommandPath:join(state,'state','control-result.json'),workflowTimeoutMs:900000,timeoutMs:180000,requestTimeoutMs:180000,releaseTimeoutMs:75000,maxTokens:4096,temperature:.4,topP:.95,topK:20,minP:0,repetitionPenalty:1,seed:957282577,reasoningEffort:'low',reasoningBudgetTokens:1024,
    expectedModel:{ids:[server.model_name],paths:[files[0].path]},modelFiles:files,modelRevision:'99bb8f7f95c7aa7b24a36a7786a4f657b30f5d3d'};
  return {config,server,required:[...files.map(f=>f.path),config.pythonPath,join(control,'serve','server.py'),server.exe,server.vision.exe,join(control,'data','expert-profile.bin'),join(models,'strata-pack-resident','dense.bin'),join(models,'strata-pack-resident','experts.bin'),join(models,'strata-pack-resident','index.txt'),join(models,'strata-pack','tokenizer','vocab.json'),...['dense.bin','dense.txt','experts.bin','draft_vocab.bin'].map(name=>join(models,'mtp','rt',name))]};
}
export async function ensureFlashBrainConfiguration({runtimeJsonPath=join(process.env.ProgramData || 'C:/ProgramData','NovaFlow','AI-Runtime','runtime.json'),configPath=join(dirname(runtimeJsonPath),'strata-prompt.json')}={}) {
  if(await exists(configPath))return {ok:true,created:false,configPath};
  let runtime;try {runtime=JSON.parse((await readFile(runtimeJsonPath,'utf8')).replace(/^\uFEFF/,''));}catch{return {ok:false,reason:'runtime-not-configured'};}
  if(!runtime.installPath || !runtime.modelsPath)return {ok:false,reason:'runtime-not-configured'};
  const built=buildFlashBrainConfiguration({installPath:resolve(runtime.installPath),modelsPath:resolve(runtime.modelsPath),configPath});
  const missing=[];for(const path of built.required){if(!await exists(path))missing.push(path);}
  for(const file of built.config.modelFiles){try{if((await stat(file.path)).size!==file.bytes)missing.push(file.path);}catch{}}
  if(missing.length)return {ok:false,reason:'flash-installation-incomplete',missing:[...new Set(missing)]};
  const write=async(path,data)=>{await mkdir(dirname(path),{recursive:true});const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(data,null,2)+'\n');await rename(temporary,path);};
  await write(built.config.serverConfigPath,built.server);await write(configPath,built.config);
  return {ok:true,created:true,configPath};
}
