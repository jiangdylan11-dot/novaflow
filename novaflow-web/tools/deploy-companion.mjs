// Deploy a self-contained companion, then verify the runtime that handles chats.
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
  console.log(JSON.stringify(await (await import(helper)).execute290('companion',args)));process.exit(0);
}

// 289 frozen release: no shared-output build or default deployment fallback.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-289'))){
  const args=process.argv.slice(2),expected=['--local-qwen-289','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 289 release arguments');
  const helper=new URL('../../work/xiaotao-local-289-20261104/release-289.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='69efd7af3b432495feae7441ffc0190d0155bb9980356b9b5cc0517bcf1816dd';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('289 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute289('companion',args)));process.exit(0);
}

// 288 frozen release: never fall through to shared build or default deploy.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-288'))){
  const args=process.argv.slice(2),expected=['--local-qwen-288','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 288 release arguments');
  const helper=new URL('../../work/xiaotao-local-288-20261104/release-288.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='45ae8bd4212c682fc70f89bf88e3ca8c3b3cb06e98fd4082895dd5c75e0245e8';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('288 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute288('companion',args)));process.exit(0);
}

// 287 frozen release: only the reviewed helper may perform the explicit action.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-287'))){
  const args=process.argv.slice(2),expected=['--local-qwen-287','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 287 deployment arguments');
  const helper=new URL('../../work/xiaotao-local-287-20261104/release-287.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='9d7e6b0b51e512a20c2e2ad75dc733dea682a30f8365d4b999eae999716d9f81';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('287 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute287('companion',args)));process.exit(0);
}

// 286 frozen candidate: strictly read-only prepare-only verification.
if(process.argv.slice(2).includes('--local-qwen-286')){
  const helper=new URL('../../work/local-qwen-aligned-286-20261104/release-preflight-286.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  if(createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!=='5ef2a1e2eceafdb14c497ce4abb2a58512926df637dbb425dac73a8d1086a6a6')throw Error('286 preflight helper changed');
  if(process.argv.includes('--execute')){
    const execution=new URL('../../work/local-qwen-aligned-286-20261104/release-execute-286.mjs',import.meta.url);
    if(createFrozenHash('sha256').update(await readFrozen(execution)).digest('hex')!=='b2b590a3cf1a9f4314a0970ee5b6771225453fe6ae63c42a4282fa392be0941c')throw Error('286 execution helper changed');
    console.log(JSON.stringify(await (await import(execution)).execute286('companion',process.argv.slice(2))));
  }else console.log(JSON.stringify(await (await import(helper)).verify286(process.argv.slice(2),{site:false})));
  process.exit(0);
}
const frozenArgs=process.argv.slice(2);
if(frozenArgs.length===1&&frozenArgs[0]==='--qwen21-edit-285'){
  const {deployHotfixCompanion}=await import('../../work/qwen21-edit-285-20261104/release.mjs');
  await deployHotfixCompanion();process.exit(0);
}
if(frozenArgs.length===1&&frozenArgs[0]==='--qwen21-edit-284'){
  const {deployHotfixCompanion}=await import('../../work/qwen21-edit-284-20261104/release.mjs');
  await deployHotfixCompanion();process.exit(0);
}
if(frozenArgs.length===1&&frozenArgs[0]==='--qwen21-edit-283'){
  const {deployHotfixCompanion}=await import('../../work/qwen21-edit-283-20261104/release.mjs');
  await deployHotfixCompanion();process.exit(0);
}
if(frozenArgs.length===1&&frozenArgs[0]==='--qwen21-native-282'){
  const {deployHotfixCompanion}=await import('../../work/qwen21-native-282-20261104/release.mjs');
  await deployHotfixCompanion();process.exit(0);
}
if(frozenArgs.length===1&&frozenArgs[0]==='--art-recovery-281'){
  const {deployHotfixCompanion}=await import('../../work/xiaotao-art-diagnostics-281-20261103/release.mjs');
  await deployHotfixCompanion();process.exit(0);
}
if(frozenArgs.length===1&&frozenArgs[0]==='--art-english-280'){
  const {deployHotfixCompanion}=await import('../../work/xiaotao-art-english-280-20261103/release.mjs');
  await deployHotfixCompanion();process.exit(0);
}
if(frozenArgs.length===1&&frozenArgs[0]==='--art-language-279'){
  const {deployHotfixCompanion}=await import('../../work/xiaotao-art-contract-279-20261103/release.mjs');
  await deployHotfixCompanion();process.exit(0);
}
if(frozenArgs.length===1&&frozenArgs[0]==='--chat-recovery-275'){
  const {deployHotfixCompanion}=await import('../../work/xiaotao-video-budget-20261103/release.mjs');
  await deployHotfixCompanion();process.exit(0);
}
if(frozenArgs.length===1&&frozenArgs[0]==='--chat-recovery-276'){
  const {deployHotfixCompanion}=await import('../../work/xiaotao-chat-recovery-276-20261103/release.mjs');
  await deployHotfixCompanion();process.exit(0);
}
if(!frozenArgs.length&&['2.0.272','2.0.273'].includes(RELEASE_VERSION))
  throw Error('272/273 production deployment is blocked pending verified safe cutover');
if(frozenArgs.some(arg=>arg.startsWith('--live-272'))){
  const valid=frozenArgs.length===2&&frozenArgs.includes('--live-272')&&
    (frozenArgs.includes('--verify-only')!==frozenArgs.includes('--execute'))&&
    frozenArgs.every(arg=>['--live-272','--verify-only','--execute'].includes(arg));
  if(!valid)throw Error('Live 272 requires exactly one explicit action');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const path=join(root,'tools','live-companion-272.mjs');
  const {createHash}=await import('node:crypto');
  if(createHash('sha256').update(await readFile(path)).digest('hex')!=='be4d2239f2fc4ba6fb6ea11be61fda6222a2b19995f1af91692a85e634400e1e')
    throw Error('Live 272 release helper hash mismatch');
  const {runLive272}=await import('./live-companion-272.mjs');
  await runLive272(frozenArgs.includes('--verify-only')?'--verify-only':'--execute');
}else if(frozenArgs.some(arg=>arg.startsWith('--frozen-272')||arg.startsWith('--frozen-273'))){
  const is272=frozenArgs.includes('--frozen-272'),is273=frozenArgs.includes('--frozen-273');
  const verifyOnly=frozenArgs.includes('--verify-only'),stageOnly=frozenArgs.includes('--stage-only');
  if(frozenArgs.length!==2||is272===is273||verifyOnly===stageOnly)
    throw Error('272/273 production deployment is blocked: only offline verify-only or stage-only actions are available');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const {createHash}=await import('node:crypto');
  const hash=async name=>createHash('sha256').update(await readFile(join(root,'tools',name))).digest('hex');
  if(await hash('verify-companion-272.mjs')!=='460af3d16697c3750fac58ac38295b0d9b709ad569af8dbbd8d81dcf98a8d854')
    throw Error('Frozen 272 verifier hash mismatch');
  if(stageOnly){
    if(await hash('stage-companion-272-review.mjs')!=='51de3f570a99b8f221ac515c80f475729cf5f64b8232cabc78cf73ab1d19fa11')
      throw Error('Frozen companion staging helper hash mismatch');
    const {stageCompanionReview}=await import('./stage-companion-272-review.mjs');
    console.log(JSON.stringify(await stageCompanionReview(is272?'272':'273')));
  }else{
    const {verifyCompanion272Offline,verifyCompanion273Offline}=await import('./verify-companion-272.mjs');
    console.log(JSON.stringify(await (is272?verifyCompanion272Offline():verifyCompanion273Offline())));
  }
}else if(frozenArgs.length){
  const {deployFrozen}=await import('./frozen-edge-deploy.mjs');
  await deployFrozen('companion',frozenArgs);
}else{
  await import('./sync-art-knowledge-edge.mjs');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),project='cjakoblszlmbmotchzva',target=join(root,'.artifacts','companion-'+RELEASE_VERSION),entry=join(target,'supabase/functions/novaflow-companion/index.ts');
await mkdir(dirname(entry),{recursive:true});
function run(command,cwd){const result=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',command],{cwd,stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw Error('Companion release command failed');}
run('node tools/sync-legacy-ai-server-v3.mjs --check',root);
run(`npx --yes esbuild@0.25.5 supabase/functions/novaflow-companion/index.ts --bundle --external:npm:* --external:jsr:* --external:https:* --external:node:* --format=esm --platform=neutral --outfile=.artifacts/companion-${RELEASE_VERSION}/supabase/functions/novaflow-companion/index.ts`,root);
const code=await readFile(entry,'utf8');if(!code.includes(RELEASE_VERSION)||/from\s*['"]\.\.?\//.test(code))throw Error('Companion bundle is not self-contained');
await writeFile(join(target,'supabase/config.toml'),`project_id = "${project}"\n[functions.novaflow-companion]\nverify_jwt = false\n`);
run(`npx supabase --workdir . functions deploy novaflow-companion --project-ref ${project} --use-api`,target);
let verified=false;
for(let attempt=0;attempt<8;attempt++){const response=await fetch(`https://${project}.supabase.co/functions/v1/novaflow-companion/health?release=${RELEASE_VERSION}&attempt=${attempt}`,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(15000)}),body=await response.json();if(response.ok&&body.releaseVersion===RELEASE_VERSION){const proof={status:response.status,version:body.releaseVersion,deployment:response.headers.get('x-foart-deployment')};await writeFile(join(target,'live-proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));verified=true;break;}if(attempt<7)await delay(3000);}
if(!verified)throw Error('Companion upload did not update the actual live runtime');
}
