// Publish one self-contained control-plane entry, then verify the live code.
// Uploading new source alone is insufficient: a mismatched health reply is a failure.
import {mkdir,mkdtemp,readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {bundleEdgeFunction} from './bundle-edge-function.mjs';
import {syncEdgeFunction} from './sync-edge-function.mjs';
import {RELEASE_VERSION} from '../packages/shared/src/release.mjs';

// 290 frozen release: no shared-output build or default deployment fallback.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-290'))){
  const args=process.argv.slice(2),expected=['--local-qwen-290','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 290 release arguments');
  const helper=new URL('../../work/xiaotao-local-290-20261104/release-290.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='8db2323c6a29f8fcb6eee827dcb0797c995183e53c4c2e6a138c082862819239';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('290 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute290('control',args)));process.exit(0);
}

// 289 frozen release: no shared-output build or default deployment fallback.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-289'))){
  const args=process.argv.slice(2),expected=['--local-qwen-289','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 289 release arguments');
  const helper=new URL('../../work/xiaotao-local-289-20261104/release-289.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='69efd7af3b432495feae7441ffc0190d0155bb9980356b9b5cc0517bcf1816dd';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('289 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute289('control',args)));process.exit(0);
}

// 288 frozen release: never fall through to shared build or default deploy.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-288'))){
  const args=process.argv.slice(2),expected=['--local-qwen-288','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 288 release arguments');
  const helper=new URL('../../work/xiaotao-local-288-20261104/release-288.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='45ae8bd4212c682fc70f89bf88e3ca8c3b3cb06e98fd4082895dd5c75e0245e8';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('288 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute288('control',args)));process.exit(0);
}

// 287 frozen release: only the reviewed helper may perform the explicit action.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-287'))){
  const args=process.argv.slice(2),expected=['--local-qwen-287','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 287 deployment arguments');
  const helper=new URL('../../work/xiaotao-local-287-20261104/release-287.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='9d7e6b0b51e512a20c2e2ad75dc733dea682a30f8365d4b999eae999716d9f81';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('287 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute287('control',args)));process.exit(0);
}

// 286 frozen candidate: strictly read-only prepare-only verification.
if(process.argv.slice(2).includes('--local-qwen-286')){
  const helper=new URL('../../work/local-qwen-aligned-286-20261104/release-preflight-286.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  if(createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!=='5ef2a1e2eceafdb14c497ce4abb2a58512926df637dbb425dac73a8d1086a6a6')throw Error('286 preflight helper changed');
  if(process.argv.includes('--execute')){
    const execution=new URL('../../work/local-qwen-aligned-286-20261104/release-execute-286.mjs',import.meta.url);
    if(createFrozenHash('sha256').update(await readFrozen(execution)).digest('hex')!=='b2b590a3cf1a9f4314a0970ee5b6771225453fe6ae63c42a4282fa392be0941c')throw Error('286 execution helper changed');
    console.log(JSON.stringify(await (await import(execution)).execute286('control',process.argv.slice(2))));
  }else console.log(JSON.stringify(await (await import(helper)).verify286(process.argv.slice(2),{site:false})));
  process.exit(0);
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project='cjakoblszlmbmotchzva';
const args=process.argv.slice(2);

// The frozen candidate can only be staged and verified here. Production CLI
// execution stays unavailable until its side effects and approval are settled.
if(args.includes('--frozen-267-control')){
  if(args.length!==2||!args.includes('--verify-only'))throw Error('Frozen control mode requires exactly --frozen-267-control --verify-only');
  const repo=resolve(root,'..'),work=join(repo,'work');
  const candidate=join(work,'qa-control-267-frozen-audio-20261103','index.ts');
  const expected='d437b1f92fb1f859e3bb7567de9b8a9072800d8da47d6f5580430bdc8e6d6e84';
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const inside=(base,target)=>{const r=relative(base,target);return !!r&&r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
  const checked=async(p,kind)=>{const s=await lstat(p);if(s.isSymbolicLink()||(kind==='dir'?!s.isDirectory():!s.isFile()))throw Error('Unsafe frozen path: '+p);return realpath(p);};
  const actualRepo=await checked(repo,'dir'),actualWork=await checked(work,'dir');
  const canonical=p=>process.platform==='win32'?resolve(p).toLowerCase():resolve(p);
  if(canonical(actualRepo)!==canonical(repo))throw Error('Repository path contains a link or alias');
  if(!inside(actualRepo,actualWork))throw Error('Work directory escaped repository');
  const actualCandidateDir=await checked(dirname(candidate),'dir');
  if(!inside(actualWork,actualCandidateDir))throw Error('Frozen directory escaped work');
  const actualCandidate=await checked(candidate,'file');
  if(!inside(actualCandidateDir,actualCandidate))throw Error('Frozen file escaped its directory');
  const bytes=await readFile(actualCandidate);
  if(hash(bytes)!==expected)throw Error('Frozen control SHA mismatch');
  const code=bytes.toString('utf8');
  if(!code.includes('const RELEASE_VERSION = "2.0.267";')||/from\s+['"]\.\//.test(code))throw Error('Frozen control version or bundle invalid');
  const stages=join(work,'control-frozen-267-stages');
  try{await mkdir(stages);}catch(e){if(e.code!=='EEXIST')throw e;}
  const actualStages=await checked(stages,'dir');
  if(!inside(actualWork,actualStages))throw Error('Staging directory escaped work');
  const stage=await mkdtemp(join(actualStages,'verify-'));
  if(!inside(actualStages,await checked(stage,'dir')))throw Error('Staging escaped its parent');
  const supabase=join(stage,'supabase'),functions=join(supabase,'functions'),fnDir=join(functions,'novaflow-web');
  for(const p of [supabase,functions,fnDir]){await mkdir(p);if(!inside(stage,await checked(p,'dir')))throw Error('Unsafe staging component');}
  const dest=join(fnDir,'index.ts'),config=join(supabase,'config.toml');
  const configText=`project_id = "${project}"\n[functions.novaflow-web]\nverify_jwt = false\n`;
  await writeFile(dest,bytes,{flag:'wx'});await writeFile(config,configText,{flag:'wx'});
  if(!inside(fnDir,await checked(dest,'file'))||!inside(supabase,await checked(config,'file'))||hash(await readFile(dest))!==expected||await readFile(config,'utf8')!==configText)throw Error('Staged control verification failed');
  console.log(JSON.stringify({stage:'frozen-verify-only',version:'2.0.267',sha256:expected,path:stage,productionDeployEnabled:false}));
}else{
if(args.some(arg=>arg.startsWith('--frozen')))throw Error('Unknown frozen control mode');
if(args.includes('--verify-only'))throw Error('--verify-only requires an explicit frozen mode');
const target=join(root,'.artifacts','control-plane-'+RELEASE_VERSION);
const fn=join(target,'supabase/functions/novaflow-web');
await syncEdgeFunction();
const bundle=await bundleEdgeFunction();
const code=await readFile(bundle.out,'utf8');
if(!code.includes(`RELEASE_VERSION = "${RELEASE_VERSION}"`)||/from\s+['"]\.\//.test(code))throw Error('Control bundle is not self-contained at the intended release');
await mkdir(fn,{recursive:true});
await writeFile(join(fn,'index.ts'),code);
await writeFile(join(target,'supabase/config.toml'),`project_id = "${project}"\n[functions.novaflow-web]\nverify_jwt = false\n`);
console.log(JSON.stringify({stage:'prepared',version:RELEASE_VERSION,path:target}));
if(!process.argv.includes('--prepare-only')){
  const args=['supabase','--workdir','.','functions','deploy','novaflow-web','--project-ref',project,'--use-api'];
  const result=process.platform==='win32'
    ?spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`npx supabase --workdir . functions deploy novaflow-web --project-ref ${project} --use-api`],{cwd:target,stdio:'inherit',windowsHide:true})
    :spawnSync('npx',args,{cwd:target,stdio:'inherit',windowsHide:true});
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
}
