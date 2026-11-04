import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,lstat,realpath,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve,sep} from 'node:path';

const expectedZip='85c4b910c75203cd0e5913e114679884f90c6fe44a4e0c0cf37f88fcc4329369';
const controlUrl='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web';
const authUrl='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend';
const hash=async p=>{const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');};
async function names(dir,base=dir,out=[]){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlink in rollback site');if(e.isDirectory())await names(p,base,out);else if(e.isFile())out.push(p.slice(base.length+1).split(sep).join('/'));else throw Error('Unexpected rollback member');}return out.sort();}

export async function verifyFrozen268Rollback(root,{verifyFrozen265,verifyFrozen266,verifySiteEntries}){
 const baseline=await verifyFrozen266(root,{verifyFrozen265,verifySiteEntries});
 const stage=resolve(root,'../work/qa-web-rollback-268-20261102'),zip=join(stage,'foart-site-2.0.268-rollback.zip'),assets=join(stage,'web-dist');
 for(const [p,kind] of [[stage,'directory'],[zip,'file'],[assets,'directory']]){const s=await lstat(p);if(s.isSymbolicLink()||await realpath(p)!==p||(kind==='directory'?!s.isDirectory():!s.isFile()))throw Error('Unsafe rollback path');}
 if(await hash(zip)!==expectedZip)throw Error('Rollback ZIP hash mismatch');
 const left=await names(baseline.assets),right=await names(assets);if(left.length!==739||JSON.stringify(left)!==JSON.stringify(right))throw Error('Rollback members mismatch');
 const changed=[];
 for(const name of left){
  const a=join(baseline.assets,...name.split('/')),b=join(assets,...name.split('/'));
  if(await hash(a)!==await hash(b)){
   changed.push(name);
   if(!['editor.html','index.html','release.json'].includes(name))throw Error('Unexpected rollback asset changed: '+name);
   const old=await readFile(a,'utf8'),now=await readFile(b,'utf8');
   if(old.split('2.0.266').length!==2||old.replace('2.0.266','2.0.268')!==now)throw Error('Rollback changes more than version: '+name);
  }
 }
 if(JSON.stringify(changed)!==JSON.stringify(['editor.html','index.html','release.json']))throw Error('Rollback version files mismatch');
 const [home,editor,release]=await Promise.all([readFile(join(assets,'index.html'),'utf8'),readFile(join(assets,'editor.html'),'utf8'),readFile(join(assets,'release.json'),'utf8')]);
 const config=verifySiteEntries(home,editor,JSON.parse(release),{controlUrl,authUrl,version:'2.0.268'});
 const python=process.platform==='win32'?'python':'python3';execFileSync(python,[join(root,'tools','verify-frozen-site.py'),zip,assets],{cwd:root,stdio:'pipe',windowsHide:true});
 return {version:'2.0.268',zip,sha256:expectedZip,assets,members:left.length,changed,config,verifyOnly:true};
}

// Called only during an explicitly approved actual rollback, not verify-only.
export async function requireLive267(fetcher=fetch){
 for(const url of ['https://foart.net/release.json','https://www.foart.net/release.json']){
  const r=await fetcher(url,{headers:{'cache-control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok||(await r.json())?.version!=='2.0.267')throw Error('Rollback requires both live domains to report 2.0.267');
 }
}
