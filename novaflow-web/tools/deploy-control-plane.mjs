// Publish one self-contained control-plane entry, then verify the live code.
// Uploading new source alone is insufficient: a mismatched health reply is a failure.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {bundleEdgeFunction} from './bundle-edge-function.mjs';
import {RELEASE_VERSION} from '../packages/shared/src/release.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project='cjakoblszlmbmotchzva';
const target=join(root,'.artifacts','control-plane-'+RELEASE_VERSION);
const fn=join(target,'supabase/functions/novaflow-web');
const bundle=await bundleEdgeFunction();
const code=await readFile(bundle.out,'utf8');
if(!code.includes(`RELEASE_VERSION = "${RELEASE_VERSION}"`)||/from\s+['"]\.\//.test(code))throw Error('Control bundle is not self-contained at the intended release');
await mkdir(fn,{recursive:true});
await writeFile(join(fn,'index.ts'),code);
await writeFile(join(target,'supabase/config.toml'),`project_id = "${project}"\n[functions.novaflow-web]\nverify_jwt = false\n`);
console.log(JSON.stringify({stage:'prepared',version:RELEASE_VERSION,path:target}));
if(!process.argv.includes('--prepare-only')){
  const args=['supabase','--workdir',target,'functions','deploy','novaflow-web','--project-ref',project,'--use-api'];
  const result=process.platform==='win32'
    ?spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`npx supabase --workdir "${target}" functions deploy novaflow-web --project-ref ${project} --use-api`],{cwd:root,stdio:'inherit',windowsHide:true})
    :spawnSync('npx',args,{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('Control deploy failed: '+result.status);
  let last='',verified=false;
  for(let attempt=0;attempt<8;attempt++){
    const response=await fetch(`https://${project}.supabase.co/functions/v1/novaflow-web/health?release=${RELEASE_VERSION}&attempt=${attempt}`,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(15000)});
    const body=await response.json();
    const proof={status:response.status,version:body.releaseVersion,deployment:response.headers.get('x-foart-deployment')};
    if(response.ok&&proof.version===RELEASE_VERSION&&proof.deployment&&proof.deployment!=='unknown'){
      await writeFile(join(target,'live-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({stage:'live-verified',...proof}));verified=true;break;
    }
    last=JSON.stringify(proof);console.log(JSON.stringify({stage:'waiting-for-live-release',attempt:attempt+1,...proof}));
    if(attempt<7)await delay(3000);
  }
  if(!verified)throw Error('Uploaded control code is not the live release: '+last);
}
