// Build an isolated website package from the verified 265 frozen assets.
// Never write into the source renderer, shared output, or the frozen baseline.
import {createHash} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {lstat,realpath,mkdir,readdir,readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function packageFrozen265Session({root,tag,controlUrl,authUrl,logger=()=>{}}){
if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(tag))throw Error('Invalid isolated tag');
const app=root, work=resolve(root,'../work');
const source=join(work,'xiaotao-session-only-20261102','xiaotao-art-agent.js');
const output=join(work,tag);
const base=join(work,'xiaotao-online-265-20261102');
const expectedPatch='e332a942531aeca1a6f146e02cb4eb7ac58deb230ee6f220c359042a05e86455';
const expectedBase='b81efe4987bbc0a144b35e8a80505d6d323388993a82247142eaecb63832e580';
if(controlUrl!=='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web'||authUrl!=='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend')throw Error('Unexpected production endpoints');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const token=bytes=>createHash('sha1').update(bytes).digest('hex').slice(0,10);
const hashFile=async p=>{const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');};
const safeFile=async (p,hash)=>{const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink()||await realpath(p)!==p||await hashFile(p)!==hash)throw Error('Unexpected input file: '+p);};
const {verifyFrozen265,verifySiteEntries}=await import('./deploy-site.mjs');
const require=createRequire(join(app,'package.json'));
const {minify}=require('terser');
const options={module:false,compress:{passes:2},mangle:{toplevel:false},format:{comments:false,ascii_only:true,ecma:2020}};
const once=(text,before,after)=>{if(text.split(before).length!==2)throw Error('Expected exactly one occurrence: '+before);return text.replace(before,after);};
async function list(dir,baseDir=dir,out=[]){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlink in frozen site');if(e.isDirectory())await list(p,baseDir,out);else if(e.isFile())out.push(p.slice(baseDir.length+1).split(sep).join('/'));else throw Error('Unexpected frozen member');}return out;}

const workStat=await lstat(work);if(!workStat.isDirectory()||workStat.isSymbolicLink()||await realpath(work)!==work)throw Error('Unsafe work directory');
await safeFile(source,expectedPatch);
await safeFile(join(base,'worker-renderer','xiaotao-art-agent.js'),expectedBase);
const proof=await verifyFrozen265(app);
if(proof.version!=='2.0.265'||proof.assets!==join(base,'web-dist'))throw Error('Unexpected frozen baseline');
const oldSource=await readFile(join(base,'worker-renderer','xiaotao-art-agent.js'),'utf8');
const newSource=await readFile(source,'utf8');
const frozen=await readFile(join(proof.assets,'xiaotao-art-agent.js'),'utf8');
const oldMin=(await minify({'xiaotao-art-agent.js':oldSource},options)).code;
if(oldMin!==frozen||token(frozen)!=='ed39b5ae5b')throw Error('Frozen script cannot be reproduced');
const newMin=(await minify({'xiaotao-art-agent.js':newSource},options)).code;
if(!newMin||newMin===oldMin)throw Error('Patch is empty or minification failed');
const oldVersion='window.NOVAFLOW_RELEASE_VERSION = "2.0.265";', newVersion='window.NOVAFLOW_RELEASE_VERSION = "2.0.266";';
let index=once(await readFile(join(proof.assets,'index.html'),'utf8'),oldVersion,newVersion);
let editor=once(await readFile(join(proof.assets,'editor.html'),'utf8'),oldVersion,newVersion);
editor=once(editor,'xiaotao-art-agent.js?v=ed39b5ae5b','xiaotao-art-agent.js?v='+token(newMin));
const release=JSON.parse(await readFile(join(proof.assets,'release.json'),'utf8'));
if(release.version!=='2.0.265')throw Error('Wrong release version');release.version='2.0.266';
verifySiteEntries(index,editor,release,{controlUrl,authUrl,version:'2.0.266'});
const changes=new Map([['xiaotao-art-agent.js',newMin],['index.html',index],['editor.html',editor],['release.json',JSON.stringify(release,null,2)+'\n']]);
const names=(await list(proof.assets)).sort();if(names.length!==739)throw Error('Unexpected member count');
await mkdir(output);if(await realpath(output)!==output)throw Error('Unsafe output directory');
const dest=join(output,'web-dist');await mkdir(dest);
for(const name of names){
 if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(x=>!x||x==='.'||x==='..')||/[:\x00-\x1f]/.test(name))throw Error('Unsafe member name');
 const from=join(proof.assets,...name.split('/')),to=join(dest,...name.split('/'));await mkdir(dirname(to),{recursive:true});
 if(changes.has(name))await writeFile(to,changes.get(name),{flag:'wx'});else await copyFile(from,to,constants.COPYFILE_EXCL);
 if((await stat(to)).size>=25*1024*1024)throw Error('Cloudflare asset limit exceeded: '+name);
}
const zip=join(output,'foart-site-2.0.266.zip');
const tar=process.platform==='win32'?join(process.env.SystemRoot||'C:/Windows','System32','tar.exe'):'tar';
execFileSync(tar,['-a','-c','-f',zip,'.'],{cwd:dest,stdio:'pipe',windowsHide:true});
const python=process.platform==='win32'?'python':'python3';
execFileSync(python,[join(app,'tools','verify-frozen-site.py'),zip,dest],{cwd:app,stdio:'pipe',windowsHide:true});
await verifyFrozen265(app);
await safeFile(source,expectedPatch);
const result={version:'2.0.266',baseline:proof.sha256,source:expectedPatch,changed:[...changes.keys()],members:names.length,zip,bytes:(await stat(zip)).size,sha256:await hashFile(zip),scriptSha256:sha(newMin),cacheToken:token(newMin)};
await writeFile(join(output,'build-manifest.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
logger('isolated frozen session package',result);return {zip,bytes:result.bytes,config:{controlUrl,authUrl},files:{frozen:true,members:names.length}};
}
