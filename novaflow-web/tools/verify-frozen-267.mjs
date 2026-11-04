// Proposed read-only verifier. Does not deploy or modify any site.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,lstat,realpath,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve,sep} from 'node:path';
const expectedZip='a6549f4eae3afc827900f309fa56f0d00fb6e151c6e8ee330ea971654de693f5';
const expectedScripts={'xiaotao-prompt-source.js':'b8764fb389ebcb8abd3618b76064f6196875f0825dc1faaf1b8923f9accb131f','novaflow-web-runtime.js':'4de1061042da862b3b84db03211c534be15d0fd860943c40418dc45b4c2832d3','xiaotao-art-agent.js':'6a2d860d59d22e861db105d4dc629bcf9b987c544a32e8a270aa7aa9534dd9c0','xiaotao-foart-tools.js':'f1de3cbcf919dddeca67588e04d6fb6ec55776ee51493e38909baf018ee3f8cc','home-shell.js':'c445a06ffe1113095da8d3c1f541b6df034275f619fd244847bee524a5b441c7','art-direction.workflow.js':'f11c9e7f18430e68192c24ec6f17c407f1d4821337ab68075cdeb6a912401733','art-generate-credit-pricing.tool.js':'27205072207804935c1a4b7997ea24f095f5c5c5edb352b07946cd21e4e20a1a','novaflow-brand-runtime.js':'61ac3a8216b5c2f882ea639859277d2301386a7076215ab691d0b85f8a74e331','spine-split-runtime.js':'250f198929fed239092e1634f621898ba27f45662ceacdf2c009f8091d64b3fc','ui-design.drawing.js':'0cacc32f4538b7b4794beb89c528a44a3b8c97c0d18934679568660ecf97cefe'};
const controlUrl='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web';
const authUrl='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend';
const hash=async p=>{const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');};
async function names(dir,base=dir,out=[]){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlink in site');if(e.isDirectory())await names(p,base,out);else if(e.isFile())out.push(p.slice(base.length+1).split(sep).join('/'));else throw Error('Unexpected member');}return out.sort();}
export async function verifyFrozen267(root,{verifyFrozen265,verifyFrozen266,verifySiteEntries}){
 const baseline=await verifyFrozen266(root,{verifyFrozen265,verifySiteEntries});
 const stage=resolve(root,'../work/qa-owner-safety-preflight-267-20261103'),zip=resolve(root,'../work/qa-art-security-267-20261103/foart-site-2.0.267-owner-balance-safety.zip'),assets=join(stage,'web-dist');
 for(const [p,kind] of [[stage,'directory'],[zip,'file'],[assets,'directory']]){const s=await lstat(p);if(s.isSymbolicLink()||await realpath(p)!==p||(kind==='directory'?!s.isDirectory():!s.isFile()))throw Error('Unsafe 267 path');}
 if(await hash(zip)!==expectedZip)throw Error('267 ZIP hash mismatch');
 for(const [name,expected] of Object.entries(expectedScripts))if(await hash(join(assets,name))!==expected)throw Error('267 script hash mismatch: '+name);
 const left=await names(baseline.assets),right=await names(assets);if(left.length!==739||JSON.stringify(left)!==JSON.stringify(right))throw Error('Site member mismatch');
 const changed=[];for(const name of left)if(await hash(join(baseline.assets,...name.split('/')))!==await hash(join(assets,...name.split('/'))))changed.push(name);
 const allowed=['art-direction.workflow.js','art-generate-credit-pricing.tool.js','editor.html','home-shell.js','index.html','novaflow-brand-runtime.js','novaflow-web-runtime.js','release.json','spine-split-runtime.js','ui-design.drawing.js','xiaotao-art-agent.js','xiaotao-foart-tools.js','xiaotao-prompt-source.js'];if(JSON.stringify(changed)!==JSON.stringify(allowed))throw Error('Unexpected asset changes');
 const [home,editor,release]=await Promise.all([readFile(join(assets,'index.html'),'utf8'),readFile(join(assets,'editor.html'),'utf8'),readFile(join(assets,'release.json'),'utf8')]);
 const config=verifySiteEntries(home,editor,JSON.parse(release),{controlUrl,authUrl,version:'2.0.267'});
 if(!home.includes('novaflow-web-runtime.js?v=4de1061042')||!editor.includes('novaflow-web-runtime.js?v=4de1061042')||!editor.includes('xiaotao-prompt-source.js?v=3179419263')||!editor.includes('xiaotao-art-agent.js?v=6a2d860d59')||!editor.includes('xiaotao-foart-tools.js?v=f1de3cbcf9')||!home.includes('home-shell.js?v=45194b9135')||!editor.includes('art-direction.workflow.js?v=0b44031c6b')||!editor.includes('art-generate-credit-pricing.tool.js?v=a3e75621fa')||!editor.includes('novaflow-brand-runtime.js?v=5dfa079fbe')||!editor.includes('spine-split-runtime.js?v=f411435bdd')||!editor.includes('ui-design.drawing.js?v=8ad088c253'))throw Error('Wrong cache token');
 const python=process.platform==='win32'?'python':'python3';execFileSync(python,[join(root,'tools','verify-frozen-site.py'),zip,assets],{cwd:root,stdio:'pipe',windowsHide:true});
 return {version:'2.0.267',zip,sha256:expectedZip,assets,members:left.length,changed,config,verifyOnly:true};
}
