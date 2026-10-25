// Build portable local configuration from the installed environment and model root.
// No download, inference, cloud configuration or model substitution happens here.
import { readFile, stat, mkdir, writeFile, rename, access } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync,statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const first='Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf';
const second='Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00002-of-00002.gguf';
const projector='mmproj-Swift-Qwen3.8-Flash-Next-BF16.gguf';
const hashes=['ca3b302d3d1eb6eddce3ea4acc79854e6cc5fdc0583e374a6a8b6bb67327743b','e4996a6de18fd49c58d9a0040fcfd73787db6407c51973f29884bee7b14c9dbb','cd1140f4abba943ce8d9fa92fed8407e389954d26907efde7b72153c75bd8a60'];
const sizes=[39788473344,28363693824,907543520];
const exists=async path=>{try {await access(path);return true;}catch{return false;}};
const profile={schema:'nf.strata.resource-profile.v1',id:'flash-headroom-v2',version:2};
const currentResources={prefill:'2048',resident:'20',reserve:'4096'};
const legacyResources={prefill:'4096',resident:'24',reserve:'3072'};
const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const sha256=value=>createHash('sha256').update(value).digest('hex');

// CPU-only migration under the SAME inter-process operation lock as load/unload.
// Importing the control module does not start its CLI or write diagnostics. A
// missing/unknown ownership API or receipt deliberately leaves the old file alone.
const migrationScript=String.raw`
import hashlib, importlib.util, json, os, sys, uuid
from pathlib import Path
def emit(reason, **extra):
    print(json.dumps(dict(status="pending", reason=reason, **extra)))
def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def atomic_bytes(path, data):
    path=Path(path)
    temporary=path.with_name(path.name+"."+uuid.uuid4().hex+".tmp")
    try:
        with temporary.open("xb") as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists(): temporary.unlink()
try:
    request=json.loads(sys.stdin.read())
    spec=importlib.util.spec_from_file_location("nf_flash_profile_control", request["controlModulePath"])
    control=importlib.util.module_from_spec(spec); sys.modules[spec.name]=control; spec.loader.exec_module(control)
    for name in ("Settings", "Owner", "remaining_released_identities", "port_open", "exact_heavy_processes", "operation_lock"):
        if not callable(getattr(control,name,None)): raise ValueError("unknown ownership API")
    settings=control.Settings(request["configPath"])
    def unchanged():
        return digest(settings.path)==request["configSHA256"] and digest(settings.server_path)==request["serverSHA256"]
    def released():
        if not Path(settings.receipt).is_file(): return False
        owner=control.Owner.read(settings)
        if owner.receipt.get("state")!="released": return False
        remaining=control.remaining_released_identities(owner)
        parent=owner.parent(); port=control.port_open(settings); heavy=control.exact_heavy_processes(settings)
        return (isinstance(remaining,list) and not remaining and parent is None
                and type(port) is bool and not port and isinstance(heavy,list) and not heavy)
    if not unchanged(): emit("configuration-changed")
    elif not released(): emit("runtime-active-or-unconfirmed")
    else:
        with control.operation_lock(settings):
            if not unchanged(): emit("configuration-changed")
            elif not released(): emit("runtime-active-or-unconfirmed")
            else:
                server=Path(settings.server_path)
                backup=server.with_name(server.name+".flash-profile-v1."+uuid.uuid4().hex+".bak")
                atomic_bytes(backup, server.read_bytes())
                atomic_bytes(server, request["targetServerText"].encode("utf-8"))
                print(json.dumps(dict(status="migrated",ownershipVerified=True,backupPath=str(backup),
                                     backupSHA256=request["serverSHA256"],serverSHA256=digest(server))))
except Exception as error:
    emit("ownership-or-write-unconfirmed", errorCode=getattr(error,"code",type(error).__name__))
`;
function runProfileMigration({pythonPath,input}) {
  return new Promise(resolve=>{
    const child=execFile(pythonPath,['-B','-c',migrationScript],{windowsHide:true,timeout:10000,maxBuffer:256*1024,
      encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}},(error,stdout)=>{
      try {const reply=JSON.parse(String(stdout || '').trim());if(!error && ['migrated','pending'].includes(reply.status))return resolve(reply);}catch{}
      resolve({status:'pending',reason:'ownership-probe-unavailable'});
    });
    child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify(input));
  });
}
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
function buildConfiguration({installPath,modelsPath,configPath},resources,marked) {
  const root=join(installPath,'engine','strata'),control=join(root,'control-0.1.49.2'),engine=join(root,'engine-0.1.48-windows-cuda13');
  const models=join(modelsPath,'LLM','qwen38_swift15_strata'),state=join(dirname(configPath),'flash-local-brain-runtime');
  const files=[first,second,projector].map((name,i)=>({path:join(models,name),bytes:sizes[i],sha256:hashes[i]}));
  const server={exe:join(engine,'strata.exe'),args:['--pack',join(models,'strata-pack-resident'),'--native',files[0].path,'--ple-gguf',files[0].path,'--expert-profile',join(control,'data','expert-profile.bin'),'--expert-cache','auto','--prefill',resources.prefill,'--max-context','12288','--resident-budget-gib',resources.resident,'--ple-io','direct','--spec','4','--mtp',join(models,'mtp','rt'),'--spec-min-p','0.5','--conversation-cache-mib','0','--vram-reserve-mib',resources.reserve],
    cwd:state,tokenizer:join(models,'strata-pack','tokenizer'),model_name:'swift-1.5-qwen38-iq2-xs',host:'127.0.0.1',port:8198,backend:'cuda',gpu:0,lib_dirs:[engine],mtp:true,lazy_load:true,open_browser:false,log:join(state,'logs','engine.log'),
    vision:{exe:join(engine,'strata-vision.exe'),mmproj:files[2].path,model:files[0].path,gpu:true,max_tokens:2048},env:{STRATA_RESIDENT_HEADROOM_GIB:'6',STRATA_UNBUFFERED_LOAD:'1',STRATA_ROUTE_TAIL_SKIP:'0'},
    ...(marked?{runtimeProfile:{...profile}}:{})};
  const config={enabled:true,analysisBackend:'strata',pythonPath:join(control,'python','python.exe'),controlRoot:control,serverConfigPath:join(state,'server.json'),baseUrl:'http://127.0.0.1:8198',receiptPath:join(state,'state','runtime-owner.json'),readyFilePath:join(state,'state','http-ready.json'),logPath:join(state,'logs','http.log'),lastCommandPath:join(state,'state','control-result.json'),workflowTimeoutMs:900000,timeoutMs:180000,requestTimeoutMs:180000,releaseTimeoutMs:75000,maxTokens:4096,temperature:.4,topP:.95,topK:20,minP:0,repetitionPenalty:1,seed:957282577,reasoningEffort:'low',reasoningBudgetTokens:1024,
    expectedModel:{ids:[server.model_name],paths:[files[0].path]},modelFiles:files,modelRevision:'99bb8f7f95c7aa7b24a36a7786a4f657b30f5d3d'};
  return {config,server,required:[...files.map(f=>f.path),config.pythonPath,join(control,'serve','server.py'),server.exe,server.vision.exe,join(control,'data','expert-profile.bin'),join(models,'strata-pack-resident','dense.bin'),join(models,'strata-pack-resident','experts.bin'),join(models,'strata-pack-resident','index.txt'),join(models,'strata-pack','tokenizer','vocab.json'),...['dense.bin','dense.txt','experts.bin','draft_vocab.bin'].map(name=>join(models,'mtp','rt',name))]};
}
export function buildFlashBrainConfiguration(input) {return buildConfiguration(input,currentResources,true);}
async function migrateExisting({runtimeJsonPath,configPath,profileMigrationRunner}) {
  const preserved=reason=>({ok:true,created:false,configPath,migration:{status:'preserved',reason}});
  if(resolve(configPath)!==resolve(join(dirname(runtimeJsonPath),'strata-prompt.json')))return preserved('explicit-configuration-path');
  let runtime,existing,server,configText,serverText;
  try {
    runtime=JSON.parse((await readFile(runtimeJsonPath,'utf8')).replace(/^\uFEFF/,''));
    if(!runtime.installPath || !runtime.modelsPath)return preserved('runtime-not-configured');
    configText=await readFile(configPath,'utf8');existing=JSON.parse(configText.replace(/^\uFEFF/,''));
  }catch{return preserved('unknown-configuration');}
  const input={installPath:resolve(runtime.installPath),modelsPath:resolve(runtime.modelsPath),configPath};
  const legacy=buildConfiguration(input,legacyResources,false),updated=buildFlashBrainConfiguration(input);
  if(!same(existing,legacy.config))return preserved('custom-or-unknown-profile');
  try{serverText=await readFile(legacy.config.serverConfigPath,'utf8');server=JSON.parse(serverText.replace(/^\uFEFF/,''));}
  catch{return preserved('unknown-server-configuration');}
  if(same(existing,updated.config) && same(server,updated.server))return {ok:true,created:false,configPath,migration:{status:'current',profile:{...profile}}};
  if(!same(existing,legacy.config) || !same(server,legacy.server))return preserved('custom-or-unknown-profile');
  const pending=reason=>({ok:true,created:false,configPath,migration:{status:'pending',reason}});
  // Never create a backup/lock or invoke a process for a known active or absent
  // release receipt. A stale "loaded" receipt is uncertain, not permission.
  try {const receipt=JSON.parse((await readFile(existing.receiptPath,'utf8')).replace(/^\uFEFF/,''));
    if(receipt.schemaVersion!==1 || receipt.state!=='released')return pending('runtime-active-or-unconfirmed');
  }catch{return pending('owned-release-unconfirmed');}
  const targetServerText=JSON.stringify(updated.server,null,2)+'\n';
  try {
    const result=await profileMigrationRunner({pythonPath:existing.pythonPath,script:migrationScript,input:{
      controlModulePath:fileURLToPath(new URL('./strata-runtime-control.py',import.meta.url)),configPath:resolve(configPath),
      configSHA256:sha256(configText),serverSHA256:sha256(serverText),targetServerText}});
    const backupPath=typeof result?.backupPath==='string'?resolve(result.backupPath):'';
    if(result?.status==='migrated' && result.ownershipVerified===true && result.serverSHA256===sha256(targetServerText)
      && dirname(backupPath)===dirname(resolve(updated.config.serverConfigPath))
      && basename(backupPath).startsWith(basename(updated.config.serverConfigPath)+'.flash-profile-v1.') && backupPath.endsWith('.bak')
      && sha256(await readFile(backupPath))===sha256(serverText)
      && sha256(await readFile(updated.config.serverConfigPath))===sha256(targetServerText))
      return {ok:true,created:false,configPath,migration:{...result,profile:{...profile}}};
    return pending(result?.reason || 'ownership-unconfirmed');
  }catch{return pending('ownership-probe-unavailable');}
}
export async function ensureFlashBrainConfiguration({runtimeJsonPath=join(process.env.ProgramData || 'C:/ProgramData','NovaFlow','AI-Runtime','runtime.json'),configPath=join(dirname(runtimeJsonPath),'strata-prompt.json'),profileMigrationRunner=runProfileMigration}={}) {
  if(await exists(configPath))return migrateExisting({runtimeJsonPath,configPath,profileMigrationRunner});
  let runtime;try {runtime=JSON.parse((await readFile(runtimeJsonPath,'utf8')).replace(/^\uFEFF/,''));}catch{return {ok:false,reason:'runtime-not-configured'};}
  if(!runtime.installPath || !runtime.modelsPath)return {ok:false,reason:'runtime-not-configured'};
  const built=buildFlashBrainConfiguration({installPath:resolve(runtime.installPath),modelsPath:resolve(runtime.modelsPath),configPath});
  if(await exists(built.config.serverConfigPath))return {ok:false,reason:'existing-server-configuration',configPath};
  const missing=[];for(const path of built.required){if(!await exists(path))missing.push(path);}
  for(const file of built.config.modelFiles){try{if((await stat(file.path)).size!==file.bytes)missing.push(file.path);}catch{}}
  if(missing.length)return {ok:false,reason:'flash-installation-incomplete',missing:[...new Set(missing)]};
  const write=async(path,data)=>{await mkdir(dirname(path),{recursive:true});const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(data,null,2)+'\n');await rename(temporary,path);};
  await write(built.config.serverConfigPath,built.server);await write(configPath,built.config);
  return {ok:true,created:true,configPath};
}
