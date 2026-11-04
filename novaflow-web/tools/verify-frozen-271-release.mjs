// PROPOSAL ONLY: install under novaflow-web/tools after review and lock values.
// Deliberately fails closed until separately approved release inputs are frozen.
// This module NEVER deploys or changes files.
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

// Replace each null only with a reviewed, exact SHA-256 from the FINAL
// independent release, never the REVIEW-NOT-DEPLOY candidate.
const LOCK=Object.freeze({
  manifestSha:'3fe6ca8382b2d4c13f429a43e17d9874b6bb4592732ec46972d75121841e901e',
  zipSha:'71f71b7a0bfb51c906c449d5687eadab643806901a21a183392d4d72f96e8b24',
  wranglerSha:'5d5848ac47cec74644a550b1862232614b4688c8df757ac4e69d3f029993d7b7',
  workerSha:'8bdf853b0505460c96ba69a25e8f4d02eb2df5f3acd0d753785251326ce5bb0b',
  zipVerifierSha:'059aff6bdecdd94c100a254fca00d3b7637349b4a7761dd2ad349e62666bd1aa',
  runtimeCheckerSha:'4a71d90ad001282dde1b1d534bf073af99688cfca320cfe55c197e810f6e5858'
});
const EXPECTED_VERSION='2.0.271';
const BASELINE_VERSION='2.0.267';
const BASELINE_SHA='a6549f4eae3afc827900f309fa56f0d00fb6e151c6e8ee330ea971654de693f5';
const CONTROL='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web';
const AUTH='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend';
// Fixed constant, not an environment variable or caller-supplied path.
const STAGE='../work/qa-site-release-271-final-20261103';
const ZIP='foart-site-2.0.271-RELEASE.zip';
const sha=b=>createHash('sha256').update(b).digest('hex');
const isSha=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s)&&s!=='0'.repeat(64);

export function parseFrozen271ReleaseArgs(args){
  const accepted=['--frozen-271-release','--verify-only'];
  if(!args.includes('--frozen-271-release')||args.some(a=>!accepted.includes(a))||new Set(args).size!==args.length)
    throw Error('Frozen 271 accepts only --frozen-271-release and optional --verify-only');
  return {verifyOnly:args.includes('--verify-only')};
}

function verifyLocks(){
  for(const [key,value] of Object.entries(LOCK))if(!isSha(value))throw Error('Release lock not finalized: '+key);
}

async function checkedFile(p,expected){
  const info=await lstat(p);
  if(!info.isFile()||info.isSymbolicLink()||await realpath(p)!==p)throw Error('Unsafe release file: '+p);
  const data=await readFile(p);
  if(sha(data)!==expected)throw Error('Release SHA mismatch: '+p);
  return data;
}

async function checkedDirectory(p){
  const info=await lstat(p);
  if(!info.isDirectory()||info.isSymbolicLink()||await realpath(p)!==p)throw Error('Unsafe release directory: '+p);
}

async function inventory(dir,base=dir,out=[]){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name),relative=path.slice(base.length+1).split(sep).join('/');
    if(!relative||relative.split('/').some(x=>!x||x==='.'||x==='..')||/[:\\\x00-\x1f]/.test(relative))throw Error('Unsafe asset name');
    const info=await lstat(path);
    if(info.isSymbolicLink()||await realpath(path)!==path)throw Error('Reparse point in release assets: '+relative);
    if(info.isDirectory())await inventory(path,base,out);
    else if(info.isFile())out.push(relative);
    else throw Error('Non-regular release asset: '+relative);
  }
  return out.sort();
}

export async function requireLive267(){
  for(const url of ['https://foart.net/release.json','https://www.foart.net/release.json']){
    const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Live release check failed: '+url+' HTTP '+response.status);
    const body=await response.json();
    if(body?.version!==BASELINE_VERSION)throw Error('Live site changed; do not overwrite: '+url+' '+String(body?.version));
  }
}

export async function verifyFrozen271Release(root,{verifySiteEntries,verifyBaseline267}){
  verifyLocks();
  root=resolve(root); const stage=resolve(root,STAGE),work=resolve(root,'../work');
  await checkedDirectory(work); await checkedDirectory(stage);
  if(!stage.startsWith(work+sep))throw Error('Release stage outside work');
  const manifestPath=join(stage,'release-manifest.json'),zip=join(stage,ZIP),assets=join(stage,'web-dist');
  await checkedDirectory(assets);
  const manifest=JSON.parse((await checkedFile(manifestPath,LOCK.manifestSha)).toString('utf8'));
  if(manifest.version!==EXPECTED_VERSION||manifest.baseline!==BASELINE_SHA||manifest.zipSha256!==LOCK.zipSha||
     manifest.reviewOnly!==false||manifest.notDeployable!==false||manifest.kind!=='approved-site-release')
    throw Error('Not the separately reviewed formal release manifest');
  if(manifest.zip!==ZIP||/REVIEW|NOT.DEPLOY/i.test(manifest.zip))throw Error('Review ZIP cannot be deployed');
  await checkedFile(zip,LOCK.zipSha);
  await checkedFile(join(root,'wrangler.toml'),LOCK.wranglerSha);
  await checkedFile(join(root,'deploy','_worker.js'),LOCK.workerSha);
  const verifier=join(root,'tools','verify-frozen-site.py'); await checkedFile(verifier,LOCK.zipVerifierSha);
  const checker=join(root,'tools','check-independent-workspace.mjs'); await checkedFile(checker,LOCK.runtimeCheckerSha);
  const names=await inventory(assets);
  if(!Array.isArray(manifest.files)||manifest.files.length!==739||names.length!==739||
     JSON.stringify([...manifest.files].sort())!==JSON.stringify(names))throw Error('Release asset inventory mismatch');
  for(const name of ['index.html','editor.html','release.json','novaflow-web-runtime.js'])if(!names.includes(name))throw Error('Missing release entry: '+name);
  const python=process.platform==='win32'?'python':'python3';
  execFileSync(python,[verifier,zip,assets],{cwd:root,stdio:'pipe',windowsHide:true,timeout:300000});
  if(typeof verifyBaseline267!=='function')throw Error('Missing 267 baseline verifier');
  const baseline=await verifyBaseline267(root);
  if(baseline.version!==BASELINE_VERSION||baseline.sha256!==BASELINE_SHA||baseline.members!==739)throw Error('Unreviewed 267 baseline');
  const overlays=new Set(['index.html','editor.html','release.json','novaflow-brand-runtime.js','novaflow-web-runtime.js','novaflow-smart-ai.js','xiaotao-foart-tools.js','xiaotao-art-agent.js']);
  for(const name of names){
    if(!overlays.has(name)&&sha(await readFile(join(assets,name)))!==sha(await readFile(join(baseline.assets,name))))
      throw Error('Unexpected non-overlay change: '+name);
  }
  // The checker must implement this named, pinned isolated mode. A missing
  // mode or any source/compiled SHA mismatch fails; root check is not waived.
  execFileSync(process.execPath,[checker,'--isolated-frozen-271'],{cwd:root,stdio:'pipe',windowsHide:true,timeout:120000});
  // A valid snapshot alone is insufficient: bind its checked generated
  // artifacts to the exact site assets this deploy would upload.
  const runtimeManifest=JSON.parse(await readFile(resolve(root,'../work/qa-pilot-271-release-preflight/frozen-release/runtime-manifest.json'),'utf8'));
  const runtimeNames=['novaflow-web-warehouse.js','novaflow-web-runtime.js','novaflow-web-account.js','novaflow-web-capabilities.js','novaflow-web-compute-node.js'];
  if(runtimeManifest.version!=='2.0.271'||!Array.isArray(runtimeManifest.files)||JSON.stringify(runtimeManifest.files.map(x=>x.name).sort())!==JSON.stringify(runtimeNames.sort()))throw Error('Runtime snapshot inventory mismatch');
  for(const entry of runtimeManifest.files){
    if(!/^[0-9a-f]{64}$/.test(entry.generatedSha256||'')||sha(await readFile(join(assets,entry.name)))!==entry.generatedSha256)throw Error('Deployed runtime differs from checked snapshot: '+entry.name);
  }
  const [home,editor,releaseText,runtime]=await Promise.all(['index.html','editor.html','release.json','novaflow-web-runtime.js'].map(x=>readFile(join(assets,x),'utf8')));
  const config=verifySiteEntries(home,editor,JSON.parse(releaseText),{controlUrl:CONTROL,authUrl:AUTH,version:EXPECTED_VERSION});
  if(!runtime.includes('confirmedArtImageAvailableSync:()=>!1'))throw Error('Unverified confirmed-art gate must remain closed');
  // Other existing 267 capabilities may remain enabled. All five changed JS
  // outputs and their approved sources are separately pinned by the isolated
  // checker and manifest; manual review must verify newly added gates closed.
  await requireLive267();
  return {version:EXPECTED_VERSION,zip,sha256:LOCK.zipSha,assets,config,productionDeployed:false};
}

// The candidate is directly executable ONLY for fail-closed lock checking.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||process.argv[2]!=='--verify-locks')throw Error('Proposal supports --verify-locks only');
  verifyLocks(); console.log('LOCKS_FINALIZED');
}
