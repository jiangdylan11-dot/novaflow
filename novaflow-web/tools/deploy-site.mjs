// Deploy the verified ZIP, never the mutable web-dist used by other builds.
import {readFile,mkdir,writeFile,lstat,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {readConfig} from './set-web-config.mjs';
import {RELEASE_VERSION} from '../packages/shared/src/release.mjs';

// 290 frozen release: no shared-output build or default deployment fallback.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-290'))){
  const args=process.argv.slice(2),expected=['--local-qwen-290','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 290 release arguments');
  const helper=new URL('../../work/xiaotao-local-290-20261104/release-290.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='8db2323c6a29f8fcb6eee827dcb0797c995183e53c4c2e6a138c082862819239';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('290 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute290('site',args)));process.exit(0);
}

// 289 frozen release: no shared-output build or default deployment fallback.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-289'))){
  const args=process.argv.slice(2),expected=['--local-qwen-289','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 289 release arguments');
  const helper=new URL('../../work/xiaotao-local-289-20261104/release-289.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='69efd7af3b432495feae7441ffc0190d0155bb9980356b9b5cc0517bcf1816dd';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('289 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute289('site',args)));process.exit(0);
}

// 288 frozen release: never fall through to shared build or default deploy.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-288'))){
  const args=process.argv.slice(2),expected=['--local-qwen-288','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 288 release arguments');
  const helper=new URL('../../work/xiaotao-local-288-20261104/release-288.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='45ae8bd4212c682fc70f89bf88e3ca8c3b3cb06e98fd4082895dd5c75e0245e8';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('288 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute288('site',args)));process.exit(0);
}

// 287 frozen release: only the reviewed helper may perform the explicit action.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-287'))){
  const args=process.argv.slice(2),expected=['--local-qwen-287','--execute'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 287 deployment arguments');
  const helper=new URL('../../work/xiaotao-local-287-20261104/release-287.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='9d7e6b0b51e512a20c2e2ad75dc733dea682a30f8365d4b999eae999716d9f81';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('287 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).execute287('site',args)));process.exit(0);
}

// 286 frozen candidate: strictly read-only prepare-only verification.
if(process.argv.slice(2).includes('--local-qwen-286')){
  const helper=new URL('../../work/local-qwen-aligned-286-20261104/release-preflight-286.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  if(createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!=='5ef2a1e2eceafdb14c497ce4abb2a58512926df637dbb425dac73a8d1086a6a6')throw Error('286 preflight helper changed');
  if(process.argv.includes('--execute')){
    const execution=new URL('../../work/local-qwen-aligned-286-20261104/release-execute-286.mjs',import.meta.url);
    if(createFrozenHash('sha256').update(await readFrozen(execution)).digest('hex')!=='b2b590a3cf1a9f4314a0970ee5b6771225453fe6ae63c42a4282fa392be0941c')throw Error('286 execution helper changed');
    console.log(JSON.stringify(await (await import(execution)).execute286('site',process.argv.slice(2))));
  }else console.log(JSON.stringify(await (await import(helper)).verify286(process.argv.slice(2),{site:false})));
  process.exit(0);
}
const frozen265=Object.freeze({
  version:'2.0.265',
  zip:'../work/xiaotao-online-265-20261102/foart-site-2.0.265.zip',
  assets:'../work/xiaotao-online-265-20261102/web-dist',
  zipSha:'ce4562df3d54f896a7d53932473b48cec5297bb241070acade20bc503cd7f3a7',
  configSha:'5d5848ac47cec74644a550b1862232614b4688c8df757ac4e69d3f029993d7b7',
  workerSha:'8bdf853b0505460c96ba69a25e8f4d02eb2df5f3acd0d753785251326ce5bb0b',
  controlUrl:'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web',
  authUrl:'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend'
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function parseFrozen265Args(args){
  const accepted=['--frozen-265','--verify-only'];
  if(!args.includes('--frozen-265')||args.some(a=>!accepted.includes(a))||new Set(args).size!==args.length)throw Error('Frozen 265 accepts only --frozen-265 and optional --verify-only');
  return {verifyOnly:args.includes('--verify-only')};
}

export function parseFrozen266SessionArgs(args){
  const accepted=['--frozen-266-session','--verify-only'];
  if(!args.includes('--frozen-266-session')||args.some(a=>!accepted.includes(a))||new Set(args).size!==args.length)throw Error('Frozen 266 accepts only --frozen-266-session and optional --verify-only');
  return {verifyOnly:args.includes('--verify-only')};
}

export function parseFrozen267QaArgs(args){
  const accepted=['--frozen-267-qa','--verify-only'];
  if(!args.includes('--frozen-267-qa')||args.some(a=>!accepted.includes(a))||new Set(args).size!==args.length)throw Error('Frozen 267 accepts only --frozen-267-qa and optional --verify-only');
  return {verifyOnly:args.includes('--verify-only')};
}

export function parseFrozen268RollbackArgs(args){
  const accepted=['--frozen-268-rollback','--verify-only'];
  if(!args.includes('--frozen-268-rollback')||args.some(a=>!accepted.includes(a))||new Set(args).size!==args.length)throw Error('Frozen rollback accepts only --frozen-268-rollback and optional --verify-only');
  return {verifyOnly:args.includes('--verify-only')};
}

export function requireFrozen268Release(version){
  if(version!=='2.0.268')throw Error('Synchronize the repository release version to 2.0.268 before rollback');
}

export async function verifyFrozen265(root){
  const zip=resolve(root,frozen265.zip),assets=resolve(root,frozen265.assets);
  for(const p of [zip,assets]){const stat=await lstat(p);if(stat.isSymbolicLink())throw Error('Frozen ZIP and asset directory must not be symbolic links');}
  if(!(await lstat(zip)).isFile()||!(await lstat(assets)).isDirectory())throw Error('Frozen site paths are not a file and directory');
  if(await realpath(zip)!==zip||await realpath(assets)!==assets)throw Error('Frozen paths must resolve to their exact expected locations');
  if(sha(await readFile(zip))!==frozen265.zipSha)throw Error('Frozen site ZIP SHA mismatch');
  if(sha(await readFile(join(root,'wrangler.toml')))!==frozen265.configSha)throw Error('Worker route or configuration differs from the reviewed production target');
  if(sha(await readFile(join(root,'deploy','_worker.js')))!==frozen265.workerSha)throw Error('Worker entry differs from the frozen site');
  // Read-only byte comparison: prevents deploying a changed hard-linked asset while
  // avoiding another copy of the entire asset library.  No archive extraction.
  const python=process.platform==='win32'?'python':'python3';
  execFileSync(python,[join(root,'tools','verify-frozen-site.py'),zip,assets],{cwd:root,stdio:'pipe',windowsHide:true});
  const [home,editor,release]=await Promise.all([readFile(join(assets,'index.html'),'utf8'),readFile(join(assets,'editor.html'),'utf8'),readFile(join(assets,'release.json'),'utf8')]);
  const config=verifySiteEntries(home,editor,JSON.parse(release),frozen265);
  return {version:frozen265.version,zip,sha256:frozen265.zipSha,assets,config};
}

export function verifyProductionSite(html,release,{controlUrl,authUrl,version}) {
  const config=readConfig(html);
  if(!config||config.controlUrl!==controlUrl||config.authUrl!==authUrl)throw Error('Site endpoints differ from the explicitly selected production endpoints');
  for(const url of [config.controlUrl,config.authUrl]){const u=new URL(url);if(u.protocol!=='https:'||/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname))throw Error('A production site cannot use a local control or authentication endpoint');}
  if(release.version!==version||!html.includes('"'+version+'"'))throw Error('Site ZIP release differs from the intended version');
  return config;
}

export function verifySiteEntries(homeHtml,editorHtml,release,options) {
  const home=verifyProductionSite(homeHtml,release,options);
  const editor=verifyProductionSite(editorHtml,release,options);
  if(JSON.stringify(home)!==JSON.stringify(editor))throw Error('Home and editor configuration do not match');
  return home;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length===3&&process.argv[2]==='--qwen21-edit-285'){
    const {deployHotfixSite}=await import('../../work/qwen21-edit-285-20261104/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.length===3&&process.argv[2]==='--qwen21-edit-284'){
    const {deployHotfixSite}=await import('../../work/qwen21-edit-284-20261104/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.length===3&&process.argv[2]==='--qwen21-edit-283'){
    const {deployHotfixSite}=await import('../../work/qwen21-edit-283-20261104/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.length===3&&process.argv[2]==='--qwen21-native-282'){
    const {deployHotfixSite}=await import('../../work/qwen21-native-282-20261104/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.length===3&&process.argv[2]==='--art-recovery-281'){
    const {deployHotfixSite}=await import('../../work/xiaotao-art-diagnostics-281-20261103/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.length===3&&process.argv[2]==='--art-english-280'){
    const {deployHotfixSite}=await import('../../work/xiaotao-art-english-280-20261103/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.length===3&&process.argv[2]==='--art-language-279'){
    const {deployHotfixSite}=await import('../../work/xiaotao-art-contract-279-20261103/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.length===3&&process.argv[2]==='--billing-note-278'){
    const {deployHotfixSite}=await import('../../work/xiaotao-billing-note-278-20261103/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.length===3&&process.argv[2]==='--direct-prompt-277'){
    const {deployHotfixSite}=await import('../../work/xiaotao-direct-prompt-277-20261103/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.length===3&&process.argv[2]==='--chat-recovery-276'){
    const {deployHotfixSite}=await import('../../work/xiaotao-chat-recovery-276-20261103/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.length===3&&process.argv[2]==='--chat-recovery-275'){
    const {deployHotfixSite}=await import('../../work/xiaotao-video-budget-20261103/release.mjs');
    await deployHotfixSite();process.exit(0);
  }
  if(process.argv.some(arg=>arg.startsWith('--frozen-271-'))&&!process.argv.includes('--frozen-271-release'))throw Error('Invalid frozen 271 option');
  if(process.argv.some(arg=>arg.startsWith('--frozen-268-'))&&!process.argv.includes('--frozen-268-rollback'))throw Error('Invalid frozen 268 option');
  if(process.argv.some(arg=>arg.startsWith('--frozen-267-'))&&!process.argv.includes('--frozen-267-qa'))throw Error('Invalid frozen 267 option');
  if(process.argv.includes('--frozen-271-release')){
    if(sha(await readFile(join(resolve(dirname(fileURLToPath(import.meta.url)),'..'),'tools','verify-frozen-271-release.mjs'))) !== 'c41c1ce30bc5a21200f861797117dacc2dfd89b29cdcaa171c936f988e3ebcd1')throw Error('271 release verifier hash not finalized or mismatched');
    const {parseFrozen271ReleaseArgs,verifyFrozen271Release,requireLive267}=await import('./verify-frozen-271-release.mjs');
    const {verifyOnly}=parseFrozen271ReleaseArgs(process.argv.slice(2));
    const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
    if(RELEASE_VERSION!=='2.0.271')throw Error('Synchronize the repository release version to 2.0.271 before verification and deployment');
    const {verifyFrozen266}=await import('./verify-frozen-266.mjs');
    const {verifyFrozen267}=await import('./verify-frozen-267.mjs');
    const verifyBaseline267=(path)=>verifyFrozen267(path,{verifyFrozen265,verifyFrozen266,verifySiteEntries});
    const proof=await verifyFrozen271Release(root,{verifySiteEntries,verifyBaseline267});
    console.log(JSON.stringify({...proof,verifyOnly}));
    if(!verifyOnly){
      await requireLive267();
      await verifyFrozen271Release(root,{verifySiteEntries,verifyBaseline267});
      execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npx --offline wrangler@4.156.0 deploy --config wrangler.toml --assets ../work/qa-site-release-271-final-20261103/web-dist'],{cwd:root,stdio:'inherit',windowsHide:true});
    }
  }else if(process.argv.includes('--frozen-268-rollback')){
    const {verifyOnly}=parseFrozen268RollbackArgs(process.argv.slice(2));
    const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
    const {verifyFrozen266}=await import('./verify-frozen-266.mjs');
    const {verifyFrozen268Rollback,requireLive267}=await import('./verify-frozen-268-rollback.mjs');
    const proof=await verifyFrozen268Rollback(root,{verifyFrozen265,verifyFrozen266,verifySiteEntries});
    console.log(JSON.stringify({...proof,verifyOnly}));
    if(!verifyOnly){
      requireFrozen268Release(RELEASE_VERSION);
      await requireLive267();
      execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npx wrangler@4 deploy --config wrangler.toml --assets ../work/qa-web-rollback-268-20261102/web-dist'],{cwd:root,stdio:'inherit',windowsHide:true});
    }
  }else if(process.argv.includes('--frozen-267-qa')){
    const {verifyOnly}=parseFrozen267QaArgs(process.argv.slice(2));
    const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
    const {verifyFrozen266}=await import('./verify-frozen-266.mjs');
    const {verifyFrozen267}=await import('./verify-frozen-267.mjs');
    const proof=await verifyFrozen267(root,{verifyFrozen265,verifyFrozen266,verifySiteEntries});
    console.log(JSON.stringify({...proof,verifyOnly}));
    if(!verifyOnly){
      if(RELEASE_VERSION!=='2.0.267')throw Error('Synchronize the repository release version to 2.0.267 before deployment');
      execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npx wrangler@4 deploy --config wrangler.toml --assets ../work/qa-owner-safety-preflight-267-20261103/web-dist'],{cwd:root,stdio:'inherit',windowsHide:true});
    }
  }else if(process.argv.includes('--frozen-266-session')){
    const {verifyOnly}=parseFrozen266SessionArgs(process.argv.slice(2));
    const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
    const {verifyFrozen266}=await import('./verify-frozen-266.mjs');
    const proof=await verifyFrozen266(root,{verifyFrozen265,verifySiteEntries});
    console.log(JSON.stringify({...proof,verifyOnly}));
    if(!verifyOnly){
      if(RELEASE_VERSION!=='2.0.266')throw Error('Synchronize the repository release version to 2.0.266 before deployment');
      // Fixed reviewed target; never deploy the shared mutable web-dist.
      execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npx wrangler@4 deploy --config wrangler.toml --assets ../work/xiaotao-session-266-mainentry-20261102/web-dist'],{cwd:root,stdio:'inherit',windowsHide:true});
    }
  }else if(process.argv.includes('--frozen-265')){
    const {verifyOnly}=parseFrozen265Args(process.argv.slice(2));
    const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
    const proof=await verifyFrozen265(root);
    console.log(JSON.stringify({...proof,verifyOnly}));
    if(!verifyOnly){
      // Fixed relative path and reviewed config: never write into shared web-dist.
      execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npx wrangler@4 deploy --config wrangler.toml --assets ../work/xiaotao-online-265-20261102/web-dist'],{cwd:root,stdio:'inherit',windowsHide:true});
    }
  }else{
  const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
  const zip=arg('site-zip'),controlUrl=arg('control-url'),authUrl=arg('auth-url');
  if(!zip||!controlUrl||!authUrl)throw Error('Provide --site-zip, --control-url and --auth-url');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),assetArg='.artifacts/site-'+RELEASE_VERSION+'-'+randomUUID(),target=join(root,assetArg);
  await mkdir(target,{recursive:true});
  const tar=process.platform==='win32'?join(process.env.SystemRoot||'C:/Windows','System32','tar.exe'):'tar';
  execFileSync(tar,['-xf',resolve(zip),'-C',target],{stdio:'pipe'});
  const html=await readFile(join(target,'index.html'),'utf8'),editor=await readFile(join(target,'editor.html'),'utf8'),release=JSON.parse(await readFile(join(target,'release.json'),'utf8'));
  const config=verifySiteEntries(html,editor,release,{controlUrl,authUrl,version:RELEASE_VERSION});
  const proof={version:RELEASE_VERSION,config,zip:resolve(zip),sha256:createHash('sha256').update(await readFile(zip)).digest('hex'),assets:target};
  await writeFile(target+'.json',JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
  // Use the existing Worker gateway and routes, with these frozen assets.
  execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`npx wrangler@4 deploy --assets ${assetArg}`],{cwd:root,stdio:'inherit',windowsHide:true});
  }
}
