import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';

// Install only NovaFlow's adapter; the GGUF extension and the weights stay intact.
export async function installQwen21Bf16Node(runtimeRoot) {
  let config;
  try { config=JSON.parse((await readFile(join(runtimeRoot,'runtime.json'),'utf8')).replace(/^\uFEFF/,'')); }
  catch { return false; }
  if(!config.customNodesPath)return false;
  const source=await readFile(new URL('./qwen21-bf16-loader.py',import.meta.url));
  const folder=join(config.customNodesPath,'novaflow_qwen_bf16_loader');
  const target=join(folder,'__init__.py');
  if(await readFile(target).then(bytes=>bytes.equals(source),()=>false))return false;
  await mkdir(folder,{recursive:true});
  await writeFile(target,source);
  return true;
}
