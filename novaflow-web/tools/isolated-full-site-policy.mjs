// A fresh, offline, full-site output. This does not alter the shared web-dist.
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {lstat,link,mkdir,realpath,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';

const models=Object.freeze({
 'vendor/mediapipe/blaze_face_short_range.tflite':'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f',
 'vendor/mediapipe/pose_landmarker_full.task':'5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
 'vendor/mediapipe/pose_landmarker_heavy.part1.bin':'661356183ca061086c49a424854d4bc8e4bacbc9e8bf75cc5fc5b54192942488',
 'vendor/mediapipe/pose_landmarker_heavy.part2.bin':'a95494a3babfeeb7ee6f090f8ae415294c0f865e7afbdd4e3aaf38da8ecca7bb',
 'vendor/matting/model.bin.part0':'9c520caa1a523d5b6e9163b4355430880b89545dcb73bc63e181e0e351665557',
 'vendor/matting/model.bin.part1':'4aa238eb493690d55d591edd54f61b173760fe831066df8499a89f95f90be761',
 'vendor/matting/model.bin.part2':'595cf8db706b3a92fa5cbb9a9f77da1cf9b63c86617945e35317ec63d8ba0d89',
 'vendor/matting/model.bin.part3':'b4c5a5684158556f5ef7ca3463b9be878dba2c95244f99556fdefab058e2b939',
 'vendor/matting/model.bin.part4':'754125f606dc39917271df53a3674aae933784b012fbb58676ac264f2c151cc7',
 'vendor/matting/model.bin.parts.json':'4ae8063976594e3728bacc800c504ecbb6233a99eee2151c67dd50609405a66f'
});
const omitted=new Set(['vendor/mediapipe/blaze_face_short_range.tflite','vendor/mediapipe/pose_landmarker_full.task','vendor/mediapipe/pose_landmarker_heavy.part1.bin','vendor/mediapipe/pose_landmarker_heavy.part2.bin','vendor/matting/model.bin']);
const sourceModels=Object.freeze({
 'vendor/mediapipe/blaze_face_short_range.tflite':models['vendor/mediapipe/blaze_face_short_range.tflite'],
 'vendor/mediapipe/pose_landmarker_full.task':models['vendor/mediapipe/pose_landmarker_full.task'],
 'vendor/mediapipe/pose_landmarker_heavy.part1.bin':models['vendor/mediapipe/pose_landmarker_heavy.part1.bin'],
 'vendor/mediapipe/pose_landmarker_heavy.part2.bin':models['vendor/mediapipe/pose_landmarker_heavy.part2.bin'],
 'vendor/matting/model.bin':'e57500ba79f07373543de9d8345a1085644e15ca0b0c44eeaf75b7906163c919'
});
const reviewed265=Object.freeze({
 'spine-skeleton-editor.js':{path:'site-265-overrides-20261102/novaflow-web/renderer/spine-skeleton-editor.js',sha:'8037b7ecb80645d47a2d7ad38805f2bc2a9e04da243b94f115cb1a512273437a'},
 'novaflow-web-runtime.js':{path:'xiaotao-online-freeze-20261102/no-idle-web/renderer/novaflow-web-runtime.js',sha:'8fac42d57122d804bc147a1c1dc012e4d4813cf278646abb63916db1cb1635d5'}
});
export function assertNoSensitiveSource(source){
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{30,}\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/.test(source))throw Error('Sensitive material detected in reviewed source');
}
export function assertFullDestinations({controlUrl,authUrl,artKnowledgeUrl,artKnowledgeEnabled,out,allowLocal}={}){
 if(controlUrl!=='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web'
    ||authUrl!=='https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend'
    ||artKnowledgeUrl!=null||artKnowledgeEnabled!=null||out||allowLocal){
  throw Error('Isolated full package requires the approved production control and auth URLs, fixed output and no feature overrides');
 }
}
export function fullPlan(root,args=process.argv,env=process.env){
 const stages=args.filter(s=>s.startsWith('--isolated-full-stage='));
 const versions=args.filter(s=>s.startsWith('--isolated-version='));
 const reviewed=args.filter(s=>s==='--use-reviewed-overrides-265');
 if(!stages.length&&!versions.length){if(reviewed.length)throw Error('Reviewed overrides require isolated full build');return null;}
 if(stages.length!==1||versions.length!==1||!args.includes('--check')||env.FOART_ISOLATED_BUILD_TAG||env.FOART_ISOLATED_UI_ONLY||String(env.NOVAFLOW_EMBED_SESSION_SECRET||'').trim())throw Error('Invalid full-isolation options');
 const tag=stages[0].slice('--isolated-full-stage='.length),version=versions[0].slice('--isolated-version='.length);
 if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(tag)||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid isolated stage or version');
 if(reviewed.length>1||(reviewed.length&&version!=='2.0.265')||(version==='2.0.265'&&reviewed.length!==1)||args.some(s=>s.startsWith('--')&&/override/i.test(s.split('=')[0])&&s!=='--use-reviewed-overrides-265'))throw Error('Unapproved source override');
 const work=resolve(root,'../work');
 return {tag,version,work,stage:join(work,tag),reviewedOverrides:reviewed.length===1};
}
export async function loadReviewedOverrides(plan){
 if(!plan?.reviewedOverrides)return new Map();
 if(plan.version!=='2.0.265')throw Error('Reviewed source version mismatch');
 const workEntry=await lstat(plan.work),work=await realpath(plan.work);
 if(!workEntry.isDirectory()||workEntry.isSymbolicLink()||work!==plan.work)throw Error('Unsafe override workspace');
 const sources=new Map();
 for(const [name,spec] of Object.entries(reviewed265)){
  const target=join(work,...spec.path.split('/')),entry=await lstat(target),actual=await realpath(target);
  if(!entry.isFile()||entry.isSymbolicLink()||actual!==target||!actual.startsWith(work+sep)||entry.size>4*1024*1024)throw Error('Unsafe reviewed source: '+name);
  const bytes=await readFile(actual);if(createHash('sha256').update(bytes).digest('hex')!==spec.sha)throw Error('Reviewed source hash mismatch: '+name);
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);assertNoSensitiveSource(source);sources.set(name,source);
 }
 return sources;
}
export function omitFullAsset(srcRoot,path){return omitted.has(path.slice(srcRoot.length+1).replace(/\\/g,'/'));}
export async function prepareFullStage(plan){
 const st=await lstat(plan.work);if(!st.isDirectory()||st.isSymbolicLink()||await realpath(plan.work)!==plan.work)throw Error('Unsafe full-isolation workspace');
 await mkdir(plan.stage); // No recursive create; existing output must fail.
 const out=await lstat(plan.stage);if(!out.isDirectory()||out.isSymbolicLink()||await realpath(plan.stage)!==plan.stage)throw Error('Unsafe full-isolation stage');
}
export async function createVersionView(plan,root,baseVersion){
 const dir=join(plan.stage,'version-view');await mkdir(dir);
 const moduleFiles=['packages/shared/src/release.mjs','supabase/functions/novaflow-web/release.mjs','supabase/functions/_art-shared/release.mjs'];
 const jsonFiles=['package.json','package-lock.json','web/package.json','worker/package.json','worker/package-lock.json'];
 for(const name of moduleFiles){
  const source=await readFile(join(root,...name.split('/')),'utf8');
  const needle=`export const RELEASE_VERSION = "${baseVersion}";`;
  if(source.split(needle).length!==2)throw Error('Version view base mismatch: '+name);
  const dest=join(dir,...name.split('/'));await mkdir(dirname(dest),{recursive:true});
  await writeFile(dest,source.replace(needle,`export const RELEASE_VERSION = "${plan.version}";`),{flag:'wx'});
 }
 for(const name of jsonFiles){
  const obj=JSON.parse(await readFile(join(root,...name.split('/')),'utf8'));
  if(obj.version!==baseVersion)throw Error('Version view base mismatch: '+name);
  obj.version=plan.version;
  if(name.endsWith('package-lock.json')){
   const keys=name==='package-lock.json'?['','web','worker']:[''];
   for(const key of keys){if(obj.packages?.[key]?.version!==baseVersion)throw Error('Lock version mismatch: '+name+' '+key);obj.packages[key].version=plan.version;}
  }
  const dest=join(dir,...name.split('/'));await mkdir(dirname(dest),{recursive:true});await writeFile(dest,JSON.stringify(obj,null,2)+'\n',{flag:'wx'});
 }
 return dir;
}
async function digest(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
export async function linkFullAssets(plan,root,webOut){
 const out=await realpath(webOut),base=await realpath(join(root,'web-dist'));
 if(out!==join(plan.stage,'web-dist')||!out.startsWith(plan.stage+sep))throw Error('Unsafe full-isolation output');
 const src=await realpath(join(root,'renderer'));
 for(const [name,expected] of Object.entries(sourceModels)){
  const path=join(src,...name.split('/')),entry=await lstat(path);
  if(!entry.isFile()||entry.isSymbolicLink()||!(await realpath(path)).startsWith(src+sep)||await digest(path)!==expected)throw Error('Source model asset missing or hash mismatch: '+name);
 }
 for(const [name,expected] of Object.entries(models)){
  const source=join(base,...name.split('/')),dest=join(out,...name.split('/'));
  const st=await lstat(source);if(!st.isFile()||st.isSymbolicLink()||!(await realpath(source)).startsWith(base+sep)||await digest(source)!==expected)throw Error('Published model asset missing or hash mismatch: '+name);
  await mkdir(dirname(dest),{recursive:true});const parent=await realpath(dirname(dest));if(!parent.startsWith(out+sep))throw Error('Unsafe asset output');
  await link(source,dest); // Must be last writer; these links share the original inode.
 }
}
