// Review-only verification. This function cannot deploy or change a service.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,lstat,realpath,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve,sep} from 'node:path';
const expectedZip='8e190b7c4c1db625cca5d3d41526b0e549d8e15dc99cb803c076b0610ab980c4';
const expectedJs='ae1b0132c142c46af0a7f1e39a6ece11c5d8809785dedff89ac9120b5fc55691';
const controlUrl='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web';
const authUrl='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend';
const hash=async p=>{const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');};
async function names(dir,base=dir,out=[]){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlink in site');if(e.isDirectory())await names(p,base,out);else if(e.isFile())out.push(p.slice(base.length+1).split(sep).join('/'));else throw Error('Unexpected member');}return out.sort();}
export async function verifyFrozen266(root,{verifyFrozen265,verifySiteEntries}){
 const baseline=await verifyFrozen265(root),stage=resolve(root,'../work/xiaotao-session-266-mainentry-20261102');
 const zip=join(stage,'foart-site-2.0.266.zip'),assets=join(stage,'web-dist');
 for(const [p,kind] of [[stage,'directory'],[zip,'file'],[assets,'directory']]){const s=await lstat(p);if(s.isSymbolicLink()||await realpath(p)!==p||(kind==='directory'?!s.isDirectory():!s.isFile()))throw Error('Unsafe 266 path');}
 if(await hash(zip)!==expectedZip||await hash(join(assets,'xiaotao-art-agent.js'))!==expectedJs)throw Error('266 artifact hash mismatch');
 const left=await names(baseline.assets),right=await names(assets);if(left.length!==739||JSON.stringify(left)!==JSON.stringify(right))throw Error('Site member mismatch');
 const changed=[];for(const name of left)if(await hash(join(baseline.assets,...name.split('/')))!==await hash(join(assets,...name.split('/'))))changed.push(name);
 const allowed=['editor.html','index.html','release.json','xiaotao-art-agent.js'];if(JSON.stringify(changed)!==JSON.stringify(allowed))throw Error('Unexpected asset changes');
 const [home,editor,release]=await Promise.all([readFile(join(assets,'index.html'),'utf8'),readFile(join(assets,'editor.html'),'utf8'),readFile(join(assets,'release.json'),'utf8')]);
 const config=verifySiteEntries(home,editor,JSON.parse(release),{controlUrl,authUrl,version:'2.0.266'});
 if(!editor.includes('xiaotao-art-agent.js?v=c1bdc79433'))throw Error('Wrong cache token');
 const python=process.platform==='win32'?'python':'python3';execFileSync(python,[join(root,'tools','verify-frozen-site.py'),zip,assets],{cwd:root,stdio:'pipe',windowsHide:true});
 return {version:'2.0.266',zip,sha256:expectedZip,assets,members:left.length,changed,config,verifyOnly:true};
}
