// LOCAL REVIEW ONLY: fixed 267 baseline + five reviewed overlays. No deployment.
// Intended to be imported by the guarded package-site review option; no shared
// web-dist, source tree, database, backend or worker is modified.
import {createHash} from 'node:crypto';
import {lstat,realpath,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve,sep,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const sha=x=>createHash('sha256').update(x).digest('hex');
const inputs={
 'novaflow-brand-runtime.js':{source:'3e03e8d1e7aaa361be3c75fd01301cfd6dd941ddcf76bca51b26b7220eb6f808',compiled:'fb039d4ef167aed5e840f7106f761b506c81ed5e148f68f875c2b3a2a3540737',cache:'5dfa079fbe'},
 'novaflow-web-runtime.js':{source:'8e8ec6080537f7a57da5cc721c0fbef666a641bbcaed1b914ee0315a4b1c848f',compiled:'f7db27b6e2f68f70e6f3fa73286c088277f20205b44053bc61f1506d317455aa',cache:'4de1061042'},
 'novaflow-smart-ai.js':{source:'ff72e3a1292398ed61c2a53994cea58d2de6ddd0ae7f081fbc892a64511e6e81',compiled:'3ccfa8b38c1348a288baad15d16fa8a36acebc2d05c511a0f7a4e0d8c7a6aa2e',cache:'759f1fad78'},
 'xiaotao-foart-tools.js':{source:'81c386c56e2e1abc5c3b24d80dceaef665958c969f96944d127988bb7c1cf44c',compiled:'792a70126175e8cc2d5d7700b6b4e6ea6f7f3b4e71dab363e6c7bb814130796e',cache:'f1de3cbcf9'},
 'xiaotao-art-agent.js':{source:'084234282b12cbe83c13160072620f3f5a9e640d5ca8faa95138f1fc0c58e3fe',compiled:'da23a181db165bf0e3eb3e759b954a67cee52cf59fdc92a0fb7cfada521a53ee',cache:'6a2d860d59'}
};
const pyExpected='971a5a6ae2c1d62733b537151ae27c38a7dbc4dc6b4279a6e0cde2c018ea302e';
async function safeFile(path,parent){const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||await realpath(path)!==path||!path.startsWith(parent+sep))throw Error('Unsafe input file');return readFile(path)}
function once(s,a,b){if(s.split(a).length!==2)throw Error('Expected one cache/version token: '+a);return s.replace(a,()=>b)}
function loopbacks(s){return [...new Set(s.match(/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?/gi)||[])].sort()}
export async function packageFrozen271Pilot({root,tag,controlUrl,authUrl,logger=()=>{}}){
 root=resolve(root);if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(tag))throw Error('Invalid review stage tag');
 const work=resolve(root,'../work'),out=join(work,tag),ws=await lstat(work);
 if(!ws.isDirectory()||ws.isSymbolicLink()||await realpath(work)!==work)throw Error('Unsafe work path');
 const project=await import(pathToFileURL(join(root,'tools','deploy-site.mjs')).href),{verifyFrozen266}=await import(pathToFileURL(join(root,'tools','verify-frozen-266.mjs')).href),{verifyFrozen267}=await import(pathToFileURL(join(root,'tools','verify-frozen-267.mjs')).href);
 const args={verifyFrozen265:project.verifyFrozen265,verifyFrozen266,verifySiteEntries:project.verifySiteEntries},proof=await verifyFrozen267(root,args);
 if(proof.version!=='2.0.267'||proof.sha256!=='a6549f4eae3afc827900f309fa56f0d00fb6e151c6e8ee330ea971654de693f5'||proof.members!==739)throw Error('Unexpected frozen 267 baseline');
 const sourceDir=join(work,'qa-art-web-unified-267-20261103','renderer'),compiledDir=join(work,'qa-art-web-unified-267-20261103','compiled-review-v5'),files=new Map();
 for(const [name,expected] of Object.entries(inputs)){
  const [src,compiled,previous]=await Promise.all([safeFile(join(sourceDir,name),work),safeFile(join(compiledDir,name),work),safeFile(join(proof.assets,name),work)]);
  if(sha(src)!==expected.source||sha(compiled)!==expected.compiled)throw Error('Frozen overlay mismatch: '+name);
  const text=compiled.toString('utf8'),old=previous.toString('utf8');
  if(JSON.stringify(loopbacks(text))!==JSON.stringify(loopbacks(old)))throw Error('Loopback URL set changed: '+name);
  if(/SUPABASE_SERVICE_ROLE_KEY|(?:sk-|ghp_)[A-Za-z0-9_-]{20,}|nfs_[A-Za-z0-9_.-]{30,}|D:[\\/]AI_APP[\\/]NovaFlow[\\/]|qwen2_1-femaledVaginus/i.test(text))throw Error('Sensitive or obsolete marker: '+name);
  files.set(name,compiled);
 }
 if(!files.get('novaflow-web-runtime.js').includes(Buffer.from('confirmedArtImageAvailableSync:()=>!1')))throw Error('Cloud confirmed-art gate must remain closed');
 const [oldHome,oldEditor,releaseText]=await Promise.all(['index.html','editor.html','release.json'].map(n=>readFile(join(proof.assets,n),'utf8')));
 const oldVersion='window.NOVAFLOW_RELEASE_VERSION = "2.0.267";',newVersion='window.NOVAFLOW_RELEASE_VERSION = "2.0.271";';
 let home=once(oldHome,oldVersion,newVersion),editor=once(oldEditor,oldVersion,newVersion);
 for(const [name,expected] of Object.entries(inputs)){
  const a=name+'?v='+expected.cache,b=name+'?v='+expected.compiled.slice(0,10);
  editor=once(editor,a,b);
  if(name==='novaflow-web-runtime.js')home=once(home,a,b);else if(home.includes(name+'?v='))throw Error('Unexpected homepage script: '+name);
 }
 const release=JSON.parse(releaseText);if(release.version!=='2.0.267')throw Error('Baseline version mismatch');release.version='2.0.271';
 const config=project.verifySiteEntries(home,editor,release,{controlUrl,authUrl,version:'2.0.271'});
 const changes=new Map([['index.html',Buffer.from(home)],['editor.html',Buffer.from(editor)],['release.json',Buffer.from(JSON.stringify(release,null,2)+'\n')],...files]);
 async function list(dir,base=dir,result=[]){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name),name=p.slice(base.length+1).split(sep).join('/');if(e.isSymbolicLink()||!name||name.includes('\\')||name.split('/').some(x=>!x||x==='.'||x==='..')||/[:\x00-\x1f]/.test(name))throw Error('Unsafe asset path');if(e.isDirectory())await list(p,base,result);else if(e.isFile())result.push(name);else throw Error('Unexpected asset type')}return result.sort()}
 const names=await list(proof.assets);if(names.length!==739||[...changes.keys()].some(n=>!names.includes(n)))throw Error('Unexpected asset inventory');
 const py=join(dirname(fileURLToPath(import.meta.url)),'package-frozen-271-pilot-zip.py'),pyBytes=await readFile(py);if(sha(pyBytes)!==pyExpected)throw Error('ZIP helper mismatch');
 await mkdir(out);if(await realpath(out)!==out||!out.startsWith(work+sep))throw Error('Unsafe review output');
 const changeDir=join(out,'changes');await mkdir(changeDir);for(const [name,bytes] of changes)await writeFile(join(changeDir,name),bytes,{flag:'wx'});
 const zip=join(out,'foart-site-2.0.271-REVIEW-NOT-DEPLOY.zip'),python=process.platform==='win32'?'python':'python3';
 const result=execFileSync(python,[py,proof.assets,changeDir,zip],{cwd:root,encoding:'utf8',windowsHide:true,timeout:300000});if(!result.includes('PILOT_ZIP_VERIFIED members=739 changed=8 unchanged=731'))throw Error('ZIP verification missing');
 await verifyFrozen267(root,args);
 for(const [name,expected] of Object.entries(inputs)){if(sha(await readFile(join(sourceDir,name)))!==expected.source||sha(await readFile(join(compiledDir,name)))!==expected.compiled)throw Error('Overlay changed during packaging: '+name)}
 const zipBytes=await readFile(zip),manifest={reviewOnly:true,notDeployable:true,version:'2.0.271',baseline:proof.sha256,assets:739,overlays:8,unchanged:731,changed:[...changes.keys()],inputs:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.compiled])),bytes:zipBytes.length,zipSha256:sha(zipBytes),zip,productionDeployed:false,limitations:['No production database/service/worker updated','Protected tools remain unavailable until authorized backend and node deployment','Cloud confirmed-art gate remains closed','Music and video retain frozen 267 assets','User confirmation and real model/provider billing not verified','Unified project version files require review before any production release']};
 await writeFile(join(out,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});logger('isolated review package',manifest);return {zip,bytes:zipBytes.length,config,files:{reviewOnly:true,notDeployable:true,members:739}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=process.argv.slice(2),get=k=>{const hits=a.filter(v=>v.startsWith('--'+k+'='));if(hits.length!==1)throw Error('Invalid '+k);return hits[0].slice(k.length+3)};
 if(a.length!==4||!a.includes('--review-check'))throw Error('Review check only');
 const root=resolve('D:/AI_APP/NovaFlow-Web/novaflow-web'),{assertFullDestinations}=await import(pathToFileURL(join(root,'tools','isolated-full-site-policy.mjs')).href);
 const controlUrl=get('control-url'),authUrl=get('auth-url');assertFullDestinations({controlUrl,authUrl});
 const result=await packageFrozen271Pilot({root,tag:get('tag'),controlUrl,authUrl,logger:(x,y)=>console.log(x,JSON.stringify(y))});console.log('REVIEW_ONLY',JSON.stringify({zip:result.zip,bytes:result.bytes}));
}
