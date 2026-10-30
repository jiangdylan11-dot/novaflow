// Headless entry for the compute-only appliance. Editing stays on foart.net.
import {readFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createComputeAssistant} from './compute-assistant.mjs';

const dataDir=process.env.NOVAFLOW_COMPUTE_DATA_DIR||join(process.env.APPDATA||homedir(),'Foart Compute','data');
await mkdir(dataDir,{recursive:true});
let config={};
try{config=JSON.parse(await readFile(join(dataDir,'compute.config.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const root=fileURLToPath(new URL('../../',import.meta.url));
const assistant=await createComputeAssistant({
  dataDir,configPath:join(dataDir,'identity.json'),
  controlUrl:'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web',
  workerName:config.workerName||'foart-compute',modelsRoot:config.modelsRoot||'',
  workflowDir:join(root,'worker/workflows'),rendererDir:join(root,'compute-renderer'),gatewayPort:8791
});
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{
  if(stopping)return;stopping=true;await assistant.stop();process.exit(0);
});
await assistant.start();
console.log('Foart 算力助手已启动；请在 https://foart.net/ 使用编辑器，机器权限由后台管理。');
