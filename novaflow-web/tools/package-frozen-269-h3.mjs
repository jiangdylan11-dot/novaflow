// Isolated review package from the exact published 267 baseline. No deploy.
// Unchanged assets are streamed read-only; shared output is never written.
import {createHash} from 'node:crypto';
import {lstat,realpath,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve,sep} from 'node:path';

export async function packageFrozen269H3({root,tag,controlUrl,authUrl,logger=()=>{}}){
  if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(tag))throw Error('Invalid review stage tag');
  const work=resolve(root,'../work'),out=join(work,tag);
  const sha=x=>createHash('sha256').update(x).digest('hex');
  const workStat=await lstat(work);
  if(!workStat.isDirectory()||workStat.isSymbolicLink()||await realpath(work)!==work)throw Error('Unsafe work path');
  const patch=join(work,'qa-h3-269-input-lock-20261103','web','runtime-capability-research-v2.min.js');
  const patchStat=await lstat(patch);
  if(!patchStat.isFile()||patchStat.isSymbolicLink()||await realpath(patch)!==patch||!patch.startsWith(work+sep))throw Error('Unsafe patch path');
  const patchBytes=await readFile(patch),patchSha='82d0e4122eded16b37a6a63db64f2e327c1c83aa6816bf51f385933b3292a80a';
  if(sha(patchBytes)!==patchSha||!patchBytes.includes(Buffer.from('video_request_id'))||!patchBytes.includes(Buffer.from('h3CreateOnce')))throw Error('Unexpected H3 review patch');
  const {verifyFrozen265,verifySiteEntries}=await import('./deploy-site.mjs');
  const {verifyFrozen266}=await import('./verify-frozen-266.mjs');
  const {verifyFrozen267}=await import('./verify-frozen-267.mjs');
  const args={verifyFrozen265,verifyFrozen266,verifySiteEntries};
  const proof=await verifyFrozen267(root,args);
  if(proof.version!=='2.0.267'||proof.sha256!=='a6549f4eae3afc827900f309fa56f0d00fb6e151c6e8ee330ea971654de693f5')throw Error('Unexpected 267 baseline');
  const [oldHome,oldEditor,rawRelease]=await Promise.all(['index.html','editor.html','release.json'].map(x=>readFile(join(proof.assets,x),'utf8')));
  const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Expected single version or cache token');return s.replace(a,b)};
  const oldVersion='window.NOVAFLOW_RELEASE_VERSION = "2.0.267";',newVersion='window.NOVAFLOW_RELEASE_VERSION = "2.0.269";';
  const oldScript='novaflow-web-runtime.js?v=4de1061042',newScript='novaflow-web-runtime.js?v='+patchSha.slice(0,10);
  const home=once(once(oldHome,oldVersion,newVersion),oldScript,newScript);
  const editor=once(once(oldEditor,oldVersion,newVersion),oldScript,newScript);
  const release=JSON.parse(rawRelease);if(release.version!=='2.0.267')throw Error('Baseline version mismatch');release.version='2.0.269';
  const config=verifySiteEntries(home,editor,release,{controlUrl,authUrl,version:'2.0.269'});
  const changes=new Map([['index.html',Buffer.from(home)],['editor.html',Buffer.from(editor)],['release.json',Buffer.from(JSON.stringify(release,null,2)+'\n')],['novaflow-web-runtime.js',patchBytes]]);
  async function list(dir,base=dir,result=[]){
    for(const e of await readdir(dir,{withFileTypes:true})){
      const p=join(dir,e.name),name=p.slice(base.length+1).split(sep).join('/');
      if(e.isSymbolicLink()||!name||name.includes('\\')||name.split('/').some(x=>!x||x==='.'||x==='..')||/[:\x00-\x1f]/.test(name))throw Error('Unsafe asset path');
      if(e.isDirectory())await list(p,base,result);else if(e.isFile())result.push(name);else throw Error('Unexpected asset type');
    }return result.sort();
  }
  const names=await list(proof.assets);if(names.length!==739||[...changes.keys()].some(x=>!names.includes(x)))throw Error('Unexpected frozen assets');
  // A fresh exclusive directory prevents overwriting prior work. Only four
  // small changed assets plus the final ZIP are written; no baseline links.
  await mkdir(out);if(await realpath(out)!==out||!out.startsWith(work+sep))throw Error('Unsafe review output');
  const changedDir=join(out,'changes');await mkdir(changedDir);
  for(const [name,bytes] of changes)await writeFile(join(changedDir,name),bytes,{flag:'wx'});
  const zip=join(out,'foart-site-2.0.269-REVIEW-NOT-DEPLOY.zip');
  const python=process.platform==='win32'?'python':'python3';
  execFileSync(python,[join(root,'tools','package-frozen-269-h3-zip.py'),proof.assets,changedDir,zip],{cwd:root,stdio:'pipe',windowsHide:true,timeout:300000});
  // Baseline recheck detects any concurrent modification while streaming.
  await verifyFrozen267(root,args);
  if(sha(await readFile(patch))!==patchSha)throw Error('Patch changed during packaging');
  const zipBytes=await readFile(zip);
  const manifest={reviewOnly:true,version:'2.0.269',baseline:proof.sha256,patchSha256:patchSha,cacheToken:patchSha.slice(0,10),changed:[...changes.keys()],members:names.length,bytes:zipBytes.length,zipSha256:sha(zipBytes),zip,productionDeployed:false,
    limitation:'H3 remains server- and worker-disabled; page reload loses the in-memory pending operation and requires reconciliation.'};
  await writeFile(join(out,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  logger('isolated review package',manifest);return {zip,bytes:zipBytes.length,config,files:{reviewOnly:true,members:names.length}};
}
