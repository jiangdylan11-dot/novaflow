// Read-only 286 release preflight. No deployment, packaging, mutation or file writes.
// The official tool entry points invoke this only with the explicit prepare-only flag.
import {readFile,readdir,lstat,realpath,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
const repo=resolve('D:/AI_APP/NovaFlow-Web'),work=join(repo,'work/local-qwen-aligned-286-20261104');
const base='https://cjakoblszlmbmotchzva.supabase.co/functions/v1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fixed={
 'release-candidate/backend-286.mjs':'fd6c65ef497d650acb66b52cf6b06fef04588c6c33dc604184c20da6d05fba2d',
 'release-candidate/companion-286.mjs':'b4e226900b6a6a0861a928278b9753a3baef60839b22244dc8d677933b84c2bd',
 'release-candidate/control-286-disabled.ts':'46e6821d422fb6c1cab60aeb2f2816ee5fab29425c6f175b51b7e133b54f57ed',
 'web-source/compiled-review/manifest.json':'932aa79e39742bf9267548383c33f6d6c1e102f7abbf4d58782bbfad64ae72c1',
};
const migration={
 '20261104010000_qwen_image_edit_ownership_generation.sql':'9fbbac13f655cd00a54fd5f7313f655aad750e61ff56589e1556c8ab3372581a',
 '20261104011000_qwen_image_edit_lease.sql':'1b486aa42af9fc17cfb87a3a9e7d5d14e225a953c292cccac19c487985599c04',
};
const allowed=['editor.html','index.html','novaflow-brand-runtime.js','novaflow-smart-ai.js','novaflow-web-runtime.js','release.json','xiaotao-art-agent.js','xiaotao-foart-tools.js'].sort();
const outside=(root,path)=>{let rel=relative(root,path);return !rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)};
async function checked(base,path){const st=await lstat(path);if(st.isSymbolicLink())throw Error('Path is a link: '+path);const p=await realpath(path);if(outside(base,p))throw Error('Path escaped expected directory: '+path);return p;}
async function files(dir,base=dir,prefix=''){let rows=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink()||(!e.isDirectory()&&!e.isFile()))throw Error('Unexpected asset: '+e.name);const p=join(dir,e.name),n=prefix+e.name;await checked(base,p);if(e.isDirectory())rows.push(...await files(p,base,n+'/'));else rows.push([n,sha(await readFile(p))]);}return rows;}
function treeHash(rows){return sha(Buffer.from(rows.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([n,h])=>h+'  '+n+'\n').join('')))}
async function readJSON(url,expect,property){const r=await fetch(url,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Live health HTTP '+r.status+' '+url);const b=await r.json();if(b?.[property]!==expect)throw Error('Unexpected live '+url+' version '+b?.[property]);return {version:b[property],deployment:r.headers.get('x-foart-deployment')};}
export async function verify286(args,{site=false,expectedLive={web:'2.0.285',control:'2.0.263',companion:'2.0.285',backend:'2.0.263'}}={}){
 const expected=['--local-qwen-286','--prepare-only',...(site?['--control-url='+base+'/novaflow-web','--auth-url='+base+'/novaflow-backend']:[])];
 if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(v=>!args.includes(v)))throw Error('286 supports only explicit prepare-only with required production URLs');
 const canonical=(await realpath(repo)).toLowerCase();if(canonical!==repo.toLowerCase())throw Error('Repository path alias rejected');
 const workReal=await checked(repo,work);
 for(const [name,digest] of Object.entries(fixed)){const p=await checked(workReal,join(work,name));if(sha(await readFile(p))!==digest)throw Error('Frozen hash mismatch: '+name);}
 for(const [name,digest] of Object.entries(migration)){const p=await checked(repo,join(repo,'novaflow-web/supabase/optional-migrations',name));if(sha(await readFile(p))!==digest)throw Error('Migration hash mismatch: '+name);}
 for(const [name,digest] of [['novaflow-web/wrangler.toml','5d5848ac47cec74644a550b1862232614b4688c8df757ac4e69d3f029993d7b7'],['novaflow-web/deploy/_worker.js','8bdf853b0505460c96ba69a25e8f4d02eb2df5f3acd0d753785251326ce5bb0b']])if(sha(await readFile(await checked(repo,join(repo,name))))!==digest)throw Error('Gateway target mismatch: '+name);
 const manifest=JSON.parse(await readFile(join(work,'web-source/compiled-review/manifest.json'),'utf8'));
 if(manifest.baselineVersion!=='2.0.285'||manifest.baselineByteMatches!==true||Object.keys(manifest.artifacts).sort().join()!==allowed.filter(x=>x.endsWith('.js')).join())throw Error('Review manifest invalid');
 for(const [name,item] of Object.entries(manifest.artifacts)){
  const a=await checked(workReal,join(work,'web-source/novaflow-web/renderer',name)),b=await checked(workReal,join(work,'web-source/compiled-review',name)),c=await checked(workReal,join(work,'release-candidate/web-dist',name));
  const [source,compiled,deployed]=await Promise.all([readFile(a),readFile(b),readFile(c)]);
  if(sha(source)!==item.sourceSha256||sha(compiled)!==item.compiledSha256||sha(deployed)!==item.compiledSha256||deployed.length!==item.bytes)throw Error('Reviewed asset mismatch: '+name);
 }
 const baseline=await checked(repo,join(repo,'work/qwen21-edit-285-20261104/web-dist')),candidate=await checked(workReal,join(work,'release-candidate/web-dist'));
 const [oldRows,newRows]=await Promise.all([files(baseline),files(candidate)]);
 if(oldRows.length!==739||newRows.length!==739||treeHash(oldRows)!=='a878a1829507841bc8dd9a045092cdccdc9386da008f26dae2e7df83618a7d3f'||treeHash(newRows)!=='2cdff2df180a594c4c91ea4878418e06c3f7b78d4581a0800454cf01ae351752')throw Error('Frozen full web inventory changed');
 const old=new Map(oldRows),changed=newRows.filter(([n,h])=>old.get(n)!==h).map(([n])=>n).sort();
 if(changed.join()!==allowed.join())throw Error('Unexpected web changes');
 const release=JSON.parse(await readFile(join(candidate,'release.json'),'utf8'));if(release.version!=='2.0.286')throw Error('Candidate version mismatch');
 const html=await readFile(join(candidate,'index.html'),'utf8');if(!html.includes('controlUrl: "'+base+'/novaflow-web"')||!html.includes('authUrl: "'+base+'/novaflow-backend"'))throw Error('Candidate production URLs mismatch');
 const control=await readFile(join(work,'release-candidate/control-286-disabled.ts'),'utf8');if(!control.includes('qwen21LocalImageEditEnabled=false'))throw Error('Image scope must stay disabled');
 const [web,controlLive,companion,backend]=await Promise.all([readJSON('https://foart.net/release.json',expectedLive.web,'version'),readJSON(base+'/novaflow-web/health',expectedLive.control,'releaseVersion'),readJSON(base+'/novaflow-companion/health',expectedLive.companion,'releaseVersion'),readJSON(base+'/novaflow-backend/health',expectedLive.backend,'releaseVersion')]);
 return {mode:'read-only-prepare',productionMutation:false,web,control:controlLive,companion,backend,reviewedAssets:5,webInventory:newRows.length,changedAssets:changed,migrationFilesVerified:true,migrationLiveVerified:false,liveSourceHashesVerified:false,candidateScopeEnabled:false,liveScopeEnabled:null,readyToDeploy:false};
}

// Generates only a local archive; never deploys. The read-only preflight runs
// first, and the archive itself is read back and checked against the full
// frozen inventory before its hash is returned.
export async function package286(args){
 const expected=['--local-qwen-286','--package-only','--control-url='+base+'/novaflow-web','--auth-url='+base+'/novaflow-backend'];
 if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(v=>!args.includes(v)))throw Error('286 package requires explicit production URLs and package-only');
 const proof=await verify286(args.map(x=>x==='--package-only'?'--prepare-only':x),{site:true});
 const root=await realpath(work),outdir=join(root,'site-packages');
 try{await mkdir(outdir);}catch(e){if(e.code!=='EEXIST')throw e;}
 const checkedDir=await checked(root,outdir);if(!(await lstat(checkedDir)).isDirectory())throw Error('Unsafe package directory');
 const assetDir=await checked(root,join(root,'release-candidate/web-dist'));
 const archive=join(checkedDir,'foart-site-2.0.286.zip');
 const python=String.raw`import hashlib,json,pathlib,sys,zipfile
base=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2])
files=sorted((p for p in base.rglob('*') if p.is_file()),key=lambda p:p.relative_to(base).as_posix())
if len(files)!=739:raise SystemExit('asset inventory changed')
with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED,allowZip64=True) as z:
 for p in files:z.write(p,p.relative_to(base).as_posix())
with zipfile.ZipFile(target,'r') as z:
 if z.testzip() is not None:raise SystemExit('zip CRC failed')
 names=z.namelist()
 if len(names)!=739 or len(set(names))!=739:raise SystemExit('zip inventory invalid')
 entries=sorted((n,hashlib.sha256(z.read(n)).hexdigest()) for n in names)
 tree=hashlib.sha256(''.join(h+'  '+n+'\n' for n,h in entries).encode()).hexdigest()
 if tree!='2cdff2df180a594c4c91ea4878418e06c3f7b78d4581a0800454cf01ae351752':raise SystemExit('zip bytes differ from frozen candidate')
print(json.dumps({'files':len(entries),'treeSha256':tree,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size}))`;
 const run=spawnSync(process.platform==='win32'?'python':'python3',['-c',python,assetDir,archive],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:1024*1024});
 if(run.error||run.status!==0)throw Error('Local package creation or verification failed; inspect local archive before retry');
 const result=JSON.parse(run.stdout.trim());
 if(sha(await readFile(archive))!==result.sha256)throw Error('Package hash changed after verification');
 return {...proof,mode:'local-package-only',archive,...result,productionMutation:false,readyToDeploy:false};
}
