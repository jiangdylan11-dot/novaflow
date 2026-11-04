// Deploy a self-contained backend, then verify the runtime that handles chats.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {RELEASE_VERSION} from '../packages/shared/src/release.mjs';
// 290 frozen release: no shared-output build or default deployment fallback.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-290'))){
  const args=process.argv.slice(2),expected=['--local-qwen-290','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 290 release arguments');
  const helper=new URL('../../work/xiaotao-local-290-20261104/release-290.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='8db2323c6a29f8fcb6eee827dcb0797c995183e53c4c2e6a138c082862819239';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('290 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute290('backend',args)));process.exit(0);
}

// 289 frozen release: no shared-output build or default deployment fallback.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-289'))){
  const args=process.argv.slice(2),expected=['--local-qwen-289','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 289 release arguments');
  const helper=new URL('../../work/xiaotao-local-289-20261104/release-289.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='69efd7af3b432495feae7441ffc0190d0155bb9980356b9b5cc0517bcf1816dd';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('289 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute289('backend',args)));process.exit(0);
}

// 288 frozen release: never fall through to shared build or default deploy.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-288'))){
  const args=process.argv.slice(2),expected=['--local-qwen-288','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 288 release arguments');
  const helper=new URL('../../work/xiaotao-local-288-20261104/release-288.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='45ae8bd4212c682fc70f89bf88e3ca8c3b3cb06e98fd4082895dd5c75e0245e8';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('288 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute288('backend',args)));process.exit(0);
}

// 287 frozen release: only the reviewed helper may perform the explicit action.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-287'))){
  const args=process.argv.slice(2),expected=['--local-qwen-287','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 287 deployment arguments');
  const helper=new URL('../../work/xiaotao-local-287-20261104/release-287.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='9d7e6b0b51e512a20c2e2ad75dc733dea682a30f8365d4b999eae999716d9f81';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('287 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute287('backend',args)));process.exit(0);
}

// 286 frozen candidate: strictly read-only prepare-only verification.
if(process.argv.slice(2).includes('--local-qwen-286')){
  const helper=new URL('../../work/local-qwen-aligned-286-20261104/release-preflight-286.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  if(createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!=='5ef2a1e2eceafdb14c497ce4abb2a58512926df637dbb425dac73a8d1086a6a6')throw Error('286 preflight helper changed');
  if(process.argv.includes('--execute')){
    const execution=new URL('../../work/local-qwen-aligned-286-20261104/release-execute-286.mjs',import.meta.url);
    if(createFrozenHash('sha256').update(await readFrozen(execution)).digest('hex')!=='b2b590a3cf1a9f4314a0970ee5b6771225453fe6ae63c42a4282fa392be0941c')throw Error('286 execution helper changed');
    console.log(JSON.stringify(await (await import(execution)).execute286('backend',process.argv.slice(2))));
  }else console.log(JSON.stringify(await (await import(helper)).verify286(process.argv.slice(2),{site:false})));
  process.exit(0);
}
const frozenArgs=process.argv.slice(2);
if(frozenArgs.length){
  const {deployFrozen}=await import('./frozen-edge-deploy.mjs');
  await deployFrozen('backend',frozenArgs);
}else{
  await import('./sync-novaflow-backend-shared.mjs');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),project='cjakoblszlmbmotchzva',target=join(root,'.artifacts','backend-'+RELEASE_VERSION),entry=join(target,'supabase/functions/novaflow-backend/index.ts');
await mkdir(dirname(entry),{recursive:true});
function run(command,cwd){const result=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',command],{cwd,stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw Error('Backend release command failed');}
run(`npx --yes esbuild@0.25.5 ../supabase/functions/novaflow-backend/index.ts --bundle --external:npm:* --external:jsr:* --external:https:* --external:node:* --format=esm --platform=neutral --outfile=.artifacts/backend-${RELEASE_VERSION}/supabase/functions/novaflow-backend/index.ts`,root);
const code=await readFile(entry,'utf8');if(!code.includes(RELEASE_VERSION)||/from\s*['"]\.\.?\//.test(code))throw Error('Backend bundle is not self-contained');
await writeFile(join(target,'supabase/config.toml'),`project_id = "${project}"\n[functions.novaflow-backend]\nverify_jwt = false\n`);
run(`npx supabase --workdir . functions deploy novaflow-backend --project-ref ${project} --use-api`,target);
let verified=false;
for(let attempt=0;attempt<8;attempt++){const response=await fetch(`https://${project}.supabase.co/functions/v1/novaflow-backend/health?release=${RELEASE_VERSION}&attempt=${attempt}`,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(15000)}),body=await response.json();if(response.ok&&body.releaseVersion===RELEASE_VERSION){const proof={status:response.status,version:body.releaseVersion,deployment:response.headers.get('x-foart-deployment')};await writeFile(join(target,'live-proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));verified=true;break;}if(attempt<7)await delay(3000);}
if(!verified)throw Error('Backend upload did not update the actual live runtime');
}
