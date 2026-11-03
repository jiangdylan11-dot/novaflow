// Fixed 288 release path. Importing this module never writes or deploys.
import {readFile,writeFile,readdir,lstat,realpath,mkdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {spawnSync} from 'node:child_process';

const repo=resolve('D:/AI_APP/NovaFlow-Web'),work=join(repo,'work/xiaotao-local-288-20261104');
const baseline=join(repo,'work/xiaotao-local-287-20261104/web-dist');
const project='cjakoblszlmbmotchzva',base=`https://${project}.supabase.co/functions/v1`;
const cli='C:/Users/jiang/AppData/Local/npm-cache/_npx/91eb58246759989d/node_modules/@supabase/cli-windows-x64/bin/supabase.exe';
const cliSha='f51f287379f72f8d3cdf8469836fd1474141e57f9935a6fb8edd0f60bdb4995e';
const gatewayHashes={'wrangler.toml':'5d5848ac47cec74644a550b1862232614b4688c8df757ac4e69d3f029993d7b7','deploy/_worker.js':'8bdf853b0505460c96ba69a25e8f4d02eb2df5f3acd0d753785251326ce5bb0b'};
const oldHashes={control:'d3c785a2d4883dfa03a32231066eaac65a81e504e35f82291d617abf65b9e221',backend:'9671992d986b01181f248d1fa576cd27174b595ba44a5787835954f140f634f5',companion:'ed417371768fe433eb27b4414f4f216dc50c35790e18388c56720a3ec872cfd5'};
const newHashes={control:'d21cc06d4136f2e7de947ce182b6a331df4cdef842bc959746097604fa4c749c',backend:'bfbb0d56bf2bc0c09acdf160e929a24ddeb0f76767d14b1fb5f297599bfd2131',companion:'4bbf2afa7718f967502275bb335314993e36afa48377ce4da626835a3b09492f'};
const baselineTree='2cba55d5d12791045d9724d2510cba044345ec9cc9d8e470563c9f6f002226c8';
// Fill only after reviewing the generated manifest. The official entry points
// independently pin this helper after that edit.
const sealedManifestSha256='1e6da9fc6fc202c084f8f746f978d78d1513666774bf11458ca6ca744fc2e844';
const names={control:'control-288.ts',backend:'backend-288.mjs',companion:'companion-288.mjs'};
const slugs={control:'novaflow-web',backend:'novaflow-backend',companion:'novaflow-companion'};
const services={control:'novaflow-web-control',backend:'NovaFlow Backend',companion:'novaflow-companion'};
const allowed=['editor.html','index.html','novaflow-web-runtime.js','release.json'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const phases={control:{web:'2.0.287',control:'2.0.287',backend:'2.0.287',companion:'2.0.287'},backend:{web:'2.0.287',control:'2.0.288',backend:'2.0.287',companion:'2.0.287'},companion:{web:'2.0.287',control:'2.0.288',backend:'2.0.288',companion:'2.0.287'},site:{web:'2.0.287',control:'2.0.288',backend:'2.0.288',companion:'2.0.288'}};

function exact(args,expected){return Array.isArray(args)&&args.length===expected.length&&new Set(args).size===args.length&&expected.every(value=>args.includes(value));}
export function parse288Package(args){if(!exact(args,['--local-qwen-288','--package-only','--control-url='+base+'/novaflow-web','--auth-url='+base+'/novaflow-backend']))throw Error('Invalid 288 package arguments');}
export function parse288Execute(component,args){if(!Object.hasOwn(phases,component)||!exact(args,['--local-qwen-288','--execute']))throw Error('Invalid 288 deployment arguments');}
export function validate288Phase(component,liveVersions){const expected=phases[component];if(!expected||!liveVersions||Object.keys(expected).some(key=>liveVersions[key]!==expected[key]))throw Error('Live versions do not match release order');}
export function assert288SafeAsset(name){
 if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..')||/(?:^|\/)(?:\.env(?:\.|$)|[^/]*(?:secret|credential|private|api[-_]?key)[^/]*)(?:\/|$)/i.test(name)||/\.(?:gguf|ggml|safetensors|pem|p12|pfx|key)$/i.test(name))throw Error('Unsafe public asset: '+name);
}
export function compare288Trees(oldRows,newRows){
 const toMap=rows=>{if(!Array.isArray(rows))throw Error('Invalid inventory');const map=new Map();for(const row of rows){if(!Array.isArray(row)||row.length!==2||!validHash(row[1])||map.has(row[0]))throw Error('Invalid or duplicated inventory row');assert288SafeAsset(row[0]);map.set(row[0],row[1]);}return map;};
 const old=toMap(oldRows),next=toMap(newRows);if(old.size!==next.size||[...old.keys()].some(name=>!next.has(name)))throw Error('Inventory changed');
 const changed=[...next].filter(([name,hash])=>old.get(name)!==hash).map(([name])=>name).sort();if(changed.join()!==allowed.join())throw Error('Unexpected asset difference');return changed;
}
export function validate288Manifest(manifest,actual){
 if(!manifest||!actual||manifest.version!=='2.0.288'||actual.version!=='2.0.288'||!Number.isInteger(manifest.files)||manifest.files<1||manifest.files!==actual.files||['baselineTreeSha256','treeSha256','zipSha256'].some(key=>!validHash(manifest[key])||manifest[key]!==actual[key])||['control','backend','companion'].some(key=>!validHash(manifest.componentSha256?.[key])||manifest.componentSha256[key]!==actual.componentSha256?.[key]))throw Error('Release manifest mismatch');
}
function within(root,path){const rel=relative(root,path);return !!rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);}
async function checkPath(root,path,kind){const st=await lstat(path);if(st.isSymbolicLink()||(kind==='dir'?!st.isDirectory():!st.isFile()))throw Error('Unsafe artifact path');const actual=await realpath(path);if(!within(await realpath(root),actual))throw Error('Artifact escaped expected root');return actual;}
async function rowsFor(root,dir= root,prefix=''){
 const rows=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink()||(!entry.isFile()&&!entry.isDirectory()))throw Error('Unexpected asset type');const path=join(dir,entry.name),name=prefix+entry.name;assert288SafeAsset(name);await checkPath(root,path,entry.isDirectory()?'dir':'file');if(entry.isDirectory())rows.push(...await rowsFor(root,path,name+'/'));else rows.push([name,sha(await readFile(path))]);}return rows;
}
function treeHash(rows){return sha(Buffer.from([...rows].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([name,hash])=>hash+'  '+name+'\n').join('')));}
function run(exe,args,cwd,timeout=120000){const result=spawnSync(exe,args,{cwd,encoding:'utf8',windowsHide:true,timeout,maxBuffer:4*1024*1024});if(result.error||result.status!==0)throw Error('Command failed or outcome unknown; inspect actual state before retry');return result.stdout;}
async function safeWork(){const root=await realpath(repo),actual=await checkPath(root,work,'dir');if(actual.toLowerCase()!==work.toLowerCase())throw Error('Unexpected workspace alias');return actual;}
async function validateInputs(){
 const root=await safeWork(),dist=await checkPath(root,join(root,'web-dist'),'dir'),old=await checkPath(repo,baseline,'dir');
 const [oldRows,rows]=await Promise.all([rowsFor(old),rowsFor(dist)]);if(oldRows.length!==739||rows.length!==739||treeHash(oldRows)!==baselineTree)throw Error('Baseline inventory changed');compare288Trees(oldRows,rows);
 const release=JSON.parse(await readFile(join(dist,'release.json'),'utf8'));if(release.version!=='2.0.288')throw Error('Release version mismatch');
 for(const name of ['index.html','editor.html']){const html=await readFile(join(dist,name),'utf8');if(!html.includes('window.NOVAFLOW_RELEASE_VERSION = "2.0.288"')||!html.includes('controlUrl: "'+base+'/novaflow-web"')||!html.includes('authUrl: "'+base+'/novaflow-backend"')||!/xiaotaoQwenBusinessEnabled:\s*true\b/.test(html))throw Error('Page configuration mismatch: '+name);}
 for(const [component,file] of Object.entries(names)){
  const text=await readFile(await checkPath(root,join(root,file),'file'),'utf8');if(!validHash(newHashes[component])||sha(Buffer.from(text))!==newHashes[component]||!text.includes('2.0.288')||/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*["'](?:\.|\/|https?:)/.test(text))throw Error('Function artifact is not the reviewed self-contained candidate');
 }
 for(const [file,digest] of Object.entries(gatewayHashes)){const content=await readFile(await checkPath(repo,join(repo,'novaflow-web',file),'file'));if(sha(content)!==digest)throw Error('Web gateway configuration changed');}
 return {root,dist,rows,treeSha256:treeHash(rows),componentSha256:{...newHashes}};
}
async function packageDir(inputs){
 const parent=join(inputs.root,'site-packages');try{await mkdir(parent);}catch(error){if(error.code!=='EEXIST')throw error;}
 const safeParent=await checkPath(inputs.root,parent,'dir'),target=join(safeParent,inputs.treeSha256);try{await mkdir(target);}catch(error){if(error.code!=='EEXIST')throw error;}
 return checkPath(safeParent,target,'dir');
}
async function pathExists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
const zipScript=String.raw`import hashlib,json,pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2]);action=sys.argv[3]
if action=='create':
 files=sorted((p for p in root.rglob('*') if p.is_file()),key=lambda p:p.relative_to(root).as_posix())
 with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED,allowZip64=True) as z:
  for p in files:z.write(p,p.relative_to(root).as_posix())
with zipfile.ZipFile(target,'r') as z:
 if z.testzip() is not None:raise SystemExit('bad CRC')
 names=z.namelist()
 if len(names)!=739 or len(set(names))!=739:raise SystemExit('bad inventory')
 rows=sorted((n,hashlib.sha256(z.read(n)).hexdigest()) for n in names)
 tree=hashlib.sha256(''.join(h+'  '+n+'\n' for n,h in rows).encode()).hexdigest()
print(json.dumps({'files':len(rows),'treeSha256':tree,'zipSha256':hashlib.sha256(target.read_bytes()).hexdigest()}))`;
function checkZip(dist,archive,action){return JSON.parse(run('python',['-B','-c',zipScript,dist,archive,action],repo,180000).trim());}
export async function package288(args){
 parse288Package(args);const inputs=await validateInputs(),dir=await packageDir(inputs),archive=join(dir,'foart-site-2.0.288.zip'),manifestPath=join(dir,'manifest-288.json');
 const [hasArchive,hasManifest]=await Promise.all([pathExists(archive),pathExists(manifestPath)]);
 if(hasArchive||hasManifest){
  if(!hasArchive||!hasManifest)throw Error('Incomplete package exists; preserve and inspect before retry');
  await checkPath(dir,archive,'file');await checkPath(dir,manifestPath,'file');const raw=await readFile(manifestPath),manifest=JSON.parse(raw),zip=checkZip(inputs.dist,archive,'verify');
  validate288Manifest(manifest,{version:'2.0.288',baselineTreeSha256:baselineTree,treeSha256:inputs.treeSha256,files:zip.files,componentSha256:inputs.componentSha256,zipSha256:zip.zipSha256});
  if(zip.treeSha256!==inputs.treeSha256)throw Error('Existing package content differs');return {mode:'local-package-only',reused:true,archive,manifest:manifestPath,manifestSha256:sha(raw),...manifest,productionMutation:false};
 }
 const zip=checkZip(inputs.dist,archive,'create');if(zip.files!==739||zip.treeSha256!==inputs.treeSha256)throw Error('ZIP content differs from frozen assets');
 const manifest={version:'2.0.288',baselineTreeSha256:baselineTree,treeSha256:inputs.treeSha256,files:zip.files,componentSha256:inputs.componentSha256,zipSha256:zip.zipSha256};
 await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return {mode:'local-package-only',archive,manifest:manifestPath,manifestSha256:sha(await readFile(manifestPath)),...manifest,productionMutation:false};
}
async function stage(){const root=await safeWork(),parent=join(root,'release-stages');try{await mkdir(parent);}catch(error){if(error.code!=='EEXIST')throw error;}const safe=await checkPath(root,parent,'dir');return mkdtemp(join(safe,'stage-'));}
async function downloadSource(component){const dir=await stage();await mkdir(join(dir,'supabase'));await writeFile(join(dir,'supabase/config.toml'),`project_id = "${project}"\n`,{flag:'wx'});run(cli,['--workdir',dir,'functions','download',slugs[component],'--project-ref',project,'--use-api'],dir);return sha(await readFile(join(dir,'supabase/functions',slugs[component],'index.ts')));}
async function getHealth(){const urls={web:'https://foart.net/release.json',...Object.fromEntries(Object.entries(slugs).map(([key,slug])=>[key,base+'/'+slug+'/health']))};const out={};for(const [key,url] of Object.entries(urls)){const response=await fetch(url,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Live health unavailable');const body=await response.json();if(key!=='web'&&(body.ok!==true||body.service!==services[key]))throw Error('Unexpected live service');out[key]=key==='web'?body.version:body.releaseVersion;}return out;}
async function deployedHealth(component){const response=await fetch(base+'/'+slugs[component]+'/health',{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Deployed health unavailable');const body=await response.json(),deployment=response.headers.get('x-foart-deployment');if(body.ok!==true||body.service!==services[component]||body.releaseVersion!=='2.0.288'||(component!=='backend'&&!deployment))throw Error('Deployed health or deployment identifier not verified');return deployment;}
export function validate288ControlProof(proof,deployment,now=Date.now(),expectedControlHash=newHashes.control){
 const policy=proof?.policy,checked=Date.parse(proof?.checkedAt),heartbeat=Date.parse(proof?.heartbeatAt);
 if(!validHash(expectedControlHash)||!deployment||proof?.controlDeployment!==deployment||proof?.controlSourceSha256!==expectedControlHash||proof?.loginHttpStatus!==200||typeof proof?.loginWorkerId!=='string'||!proof.loginWorkerId||proof.loginWorkerId!==proof.heartbeatWorkerId||!policy||['enabled','owner_enabled','sharing_enabled','pending_approval'].some(key=>typeof policy[key]!=='boolean')||policy.enabled!==true||policy.owner_enabled!==true||policy.pending_approval!==false||!['pool','selected'].includes(policy.sharing_scope)||!Array.isArray(policy.allowed_user_ids)||proof?.uiOnline!==true||proof?.uiPolicyConfirmed!==true||!Number.isFinite(checked)||!Number.isFinite(heartbeat)||now-checked>300000||now-checked< -30000||now-heartbeat>120000||now-heartbeat< -30000)throw Error('Fresh real 288 node login, natural heartbeat and policy proof required');
}
async function checkLive(component){const versions=await getHealth();validate288Phase(component,versions);for(const name of Object.keys(slugs)){const hash=await downloadSource(name),expected=versions[name]==='2.0.288'?newHashes[name]:oldHashes[name];if(hash!==expected)throw Error('Live function source changed; no deployment submitted');}if(component!=='control'){const deployment=await deployedHealth('control'),root=await safeWork(),path=await checkPath(root,join(root,'control-live-protocol-proof.json'),'file');validate288ControlProof(JSON.parse(await readFile(path,'utf8')),deployment);}return versions;}
async function verifiedPackage(){
 const inputs=await validateInputs(),dir=await checkPath(inputs.root,join(inputs.root,'site-packages',inputs.treeSha256),'dir'),manifestPath=await checkPath(dir,join(dir,'manifest-288.json'),'file'),raw=await readFile(manifestPath);
 if(!validHash(sealedManifestSha256)||sha(raw)!==sealedManifestSha256)throw Error('Manifest not pinned or changed');const manifest=JSON.parse(raw);
 const archive=await checkPath(dir,join(dir,'foart-site-2.0.288.zip'),'file'),zip=checkZip(inputs.dist,archive,'verify');
 validate288Manifest(manifest,{version:'2.0.288',baselineTreeSha256:baselineTree,treeSha256:inputs.treeSha256,files:zip.files,componentSha256:inputs.componentSha256,zipSha256:zip.zipSha256});if(zip.treeSha256!==inputs.treeSha256)throw Error('Archive contents changed');return {...inputs,archive};
}
async function stageSite(inputs){
 const dir=await stage(),assets=join(dir,'web-dist');await mkdir(assets);
 const unpack=String.raw`import pathlib,sys,zipfile
target=pathlib.Path(sys.argv[2]);target_abs=target.resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for entry in z.infolist():
  p=pathlib.PurePosixPath(entry.filename)
  if p.is_absolute() or any(part in ('','.', '..') for part in p.parts) or '\\' in entry.filename:raise SystemExit('unsafe zip path')
  path=target.joinpath(*p.parts)
  if target_abs not in path.resolve().parents:raise SystemExit('escaped extraction')
  path.parent.mkdir(parents=True,exist_ok=True)
  with path.open('xb') as out:out.write(z.read(entry))`;
 run('python',['-B','-c',unpack,inputs.archive,assets],repo,180000);const rows=await rowsFor(assets);if(rows.length!==739||treeHash(rows)!==inputs.treeSha256)throw Error('Site staging content changed');
 const rel=relative(join(repo,'novaflow-web'),assets).replace(/\\/g,'/');if(!/^\.\.\/work\/xiaotao-local-288-20261104\/release-stages\/stage-[A-Za-z0-9]+\/web-dist$/.test(rel))throw Error('Unsafe site stage');return rel;
}
export async function execute288(component,args){
 parse288Execute(component,args);if(sha(await readFile(cli))!==cliSha)throw Error('Supabase CLI changed');
 let inputs=await verifiedPackage();await checkLive(component);inputs=await verifiedPackage();await checkLive(component);
 if(component==='site'){
  const assets=await stageSite(inputs);await verifiedPackage();await checkLive(component);
  run(process.env.ComSpec||'C:/Windows/System32/cmd.exe',['/d','/s','/c','npx --offline wrangler@4.156.0 deploy --config wrangler.toml --assets '+assets],join(repo,'novaflow-web'));
  const versions=await getHealth(),response=await fetch('https://foart.net/',{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)}),html=await response.text();if(Object.values(versions).some(version=>version!=='2.0.288')||!response.ok||!html.includes('window.NOVAFLOW_RELEASE_VERSION = "2.0.288"'))throw Error('Site submitted but verification failed');return {component,version:versions.web,productionSubmitted:true,requiresRealUserFlows:true};
 }
 const dir=await stage(),fn=join(dir,'supabase/functions',slugs[component]);await mkdir(fn,{recursive:true});await writeFile(join(dir,'supabase/config.toml'),`project_id = "${project}"\n[functions.${slugs[component]}]\nverify_jwt = false\n`,{flag:'wx'});
 await writeFile(join(fn,'index.ts'),await readFile(join(inputs.root,names[component])),{flag:'wx'});if(sha(await readFile(join(fn,'index.ts')))!==newHashes[component])throw Error('Staged source changed');
 run(cli,['--workdir',dir,'functions','deploy',slugs[component],'--project-ref',project,'--use-api'],dir);const deployment=await deployedHealth(component);if(await downloadSource(component)!==newHashes[component])throw Error('Function submitted but verification failed');
 return {component,version:'2.0.288',deployment,sourceSha256:newHashes[component],productionSubmitted:true,requiresRealUserFlows:true};
}
