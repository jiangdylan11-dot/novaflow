// Read-only preflight for the one isolated 269 review ZIP; no deploy path.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,realpath,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyFrozen265,verifySiteEntries} from './deploy-site.mjs';
import {verifyFrozen266} from './verify-frozen-266.mjs';
import {verifyFrozen267} from './verify-frozen-267.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=resolve(root,'../work');
const dir=join(work,'qa-h3-269-site-review-20261103'),changes=join(dir,'changes'),zip=join(dir,'foart-site-2.0.269-REVIEW-NOT-DEPLOY.zip');
const hash=async p=>{const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex')};
const inside=(base,target)=>target.startsWith(base+sep);
for(const [p,kind] of [[work,'dir'],[dir,'dir'],[changes,'dir'],[zip,'file']]){
  const st=await lstat(p),actual=await realpath(p);
  if(st.isSymbolicLink()||actual!==p||(kind==='dir'?!st.isDirectory():!st.isFile()))throw Error('Unsafe review path: '+p);
}
if(!inside(work,dir)||!inside(dir,changes)||!inside(dir,zip))throw Error('Review paths leave stage');
const zipSha='fe42bf595db7ee0e86aa905825eb09572c90781a363795198051b503eefa5595';
const patchSha='82d0e4122eded16b37a6a63db64f2e327c1c83aa6816bf51f385933b3292a80a';
if(await hash(zip)!==zipSha||await hash(join(changes,'novaflow-web-runtime.js'))!==patchSha)throw Error('Review ZIP or patch SHA mismatch');
const proof=await verifyFrozen267(root,{verifyFrozen265,verifyFrozen266,verifySiteEntries});
if(proof.version!=='2.0.267'||proof.sha256!=='a6549f4eae3afc827900f309fa56f0d00fb6e151c6e8ee330ea971654de693f5')throw Error('Frozen baseline mismatch');
const [home,editor,rawRelease,rawManifest]=await Promise.all(['index.html','editor.html','release.json'].map(x=>readFile(join(changes,x),'utf8')).concat(readFile(join(dir,'build-manifest.json'),'utf8')));
const release=JSON.parse(rawRelease),manifest=JSON.parse(rawManifest);
verifySiteEntries(home,editor,release,{version:'2.0.269',controlUrl:'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web',authUrl:'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend'});
if(!home.includes('novaflow-web-runtime.js?v=82d0e4122e')||!editor.includes('novaflow-web-runtime.js?v=82d0e4122e')||manifest.reviewOnly!==true||manifest.productionDeployed!==false||manifest.zipSha256!==zipSha||manifest.patchSha256!==patchSha||manifest.members!==739)throw Error('Review manifest or cache mismatch');
const python=process.platform==='win32'?'python':'python3';
execFileSync(python,[join(root,'tools','package-frozen-269-h3-zip.py'),proof.assets,changes,zip,'--verify-only'],{cwd:root,stdio:'pipe',windowsHide:true,timeout:300000});
console.log(JSON.stringify({reviewOnly:true,version:'2.0.269',sha256:zipSha,members:739,patchSha256:patchSha,cacheToken:'82d0e4122e',baseline:proof.sha256,productionDeployed:false}));
