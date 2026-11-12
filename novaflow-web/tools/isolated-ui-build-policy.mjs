import {lstat,mkdir,readdir,realpath,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,relative,resolve,isAbsolute,extname} from 'node:path';

const ASSET_DIRS=['assets','templates','aifx-styles','fx-library','vendor','public'];
const HOME_FILES=new Set(['home-shell.html','home-shell.js','home-frame-bridge.js']);
// This one untracked source was independently reviewed against the published
// 271 prompt resolver; any byte change invalidates this approval.
const PINNED_UNTRACKED = new Map([['xiaotao-prompt-source.js','602feb4a193b65a7b3275c5e41bc68a059153953acd1424c78e9b4c22a60d7ce']]);
const approvedPins = new WeakMap();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const omittedDirs=['vendor/ffmpeg/core','vendor/onnxruntime-web','vendor/matting'];
const omittedModels=new Set(['vendor/mediapipe/blaze_face_short_range.tflite','vendor/mediapipe/pose_landmarker_full.task','vendor/mediapipe/pose_landmarker_heavy.part1.bin','vendor/mediapipe/pose_landmarker_heavy.part2.bin']);
const modelExt=/\.(?:gguf|ggml|safetensors|bin|task|onnx|tflite|pth|pt|ckpt|pkl|model|weights)$/i;
const privateName=/(?:^|[._-])(?:secret|credentials?|private|token|apikey|api[-_]?key)(?:[._-]|$)|^\.env|\.(?:pem|p12|pfx|key)$/i;
const allowedExt=new Set(['.json','.webp','.png','.mp4','.js','.ico','.css','.wasm','.txt','.svg','.mjs','.md','.jpg','.jpeg','.html','.ts','.wrapper','.ffmpeg-core','.libimagequant']);
const allowedBare=new Set(['LICENSE','NOTICE','VERSION','.gitattributes','.assetsignore']);

export function isolatedUiPlan(projectRoot,env=process.env,args=process.argv){
 const tag=env.FOART_ISOLATED_BUILD_TAG,flag=env.FOART_ISOLATED_UI_ONLY;
 if(!tag&&!flag)return null;
 if(typeof tag!=='string'||!/^[a-z0-9][a-z0-9-]{0,47}$/.test(tag))throw Error('Invalid isolated build tag');
 if(flag!=='1')throw Error('Isolated build only supports UI-only validation');
 if(!args.includes('--check'))throw Error('Isolated build requires --check');
 if(String(env.NOVAFLOW_EMBED_SESSION_SECRET||'').trim())throw Error('Isolated build cannot embed secrets');
 return {tag,stage:join(resolve(projectRoot),'.artifacts','isolated-builds',tag)};
}
function inside(root,path){const rel=relative(root,path);return !!rel&&rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(rel);}
async function safeDirectory(parent,name,root){
 const target=join(parent,name);try{await mkdir(target)}catch(e){if(e.code!=='EEXIST')throw e;}
 const entry=await lstat(target);if(!entry.isDirectory()||entry.isSymbolicLink())throw Error('Unsafe reparse output directory');
 const actual=await realpath(target);if(!inside(root,actual))throw Error('Unsafe isolated output directory');return actual;
}
export async function prepareIsolatedUiStage(projectRoot,tag){
 isolatedUiPlan(projectRoot,{FOART_ISOLATED_BUILD_TAG:tag,FOART_ISOLATED_UI_ONLY:'1'},['--check']);
 const root=await realpath(resolve(projectRoot)),artifacts=await safeDirectory(root,'.artifacts',root),base=await safeDirectory(artifacts,'isolated-builds',root),stage=join(base,tag);
 await mkdir(stage);const entry=await lstat(stage),actual=await realpath(stage);
 if(!entry.isDirectory()||entry.isSymbolicLink()||!inside(root,actual))throw Error('Unsafe isolated stage');return actual;
}
export function omitIsolatedUiAsset(path){const name=String(path).replace(/\\/g,'/');return omittedDirs.some(d=>name===d||name.startsWith(d+'/'))||omittedModels.has(name);}
export async function inspectIsolatedUiInputs(renderer,{tracked}={}){
 const root=await realpath(resolve(renderer));
 if(!tracked){
  const project=resolve(root,'..');const raw=execFileSync('git',['ls-files','-z','--','renderer'],{cwd:project,encoding:'utf8',maxBuffer:16*1024*1024});
  tracked=new Set(raw.split('\0').filter(Boolean).map(v=>v.replace(/\\/g,'/').replace(/^renderer\//,'')));
 }
 const omitted=[],approved=new Set(),pins=new Map();
 async function walk(dir,rel=''){
  for(const name of await readdir(dir)){
   const path=join(dir,name),part=rel?rel+'/'+name:name,entry=await lstat(path);
   if(entry.isSymbolicLink())throw Error('Input contains reparse or symbolic link: '+part);
   if(omitIsolatedUiAsset(part)){omitted.push(part);continue;}
   if(entry.isDirectory()){
    if(!rel&&!ASSET_DIRS.includes(name))continue;
    approved.add(part);await walk(path,part);continue;
   }
   if(!entry.isFile())throw Error('Unsafe input type: '+part);
   if(privateName.test(name)||modelExt.test(name))throw Error('Unapproved private or model artifact: '+part);
   if(!allowedExt.has(extname(name).toLowerCase())&&!allowedBare.has(name))throw Error('Unapproved input extension: '+part);
   if(!tracked.has(part)&&!(HOME_FILES.has(part)&&!rel)){
    const expected=PINNED_UNTRACKED.get(part);
    if(!expected||sha256(await readFile(path))!==expected)throw Error('Unapproved untracked input: '+part);
    pins.set(part,expected);
   }
   approved.add(part);
  }
 }
 await walk(root);approvedPins.set(approved,pins);return {omitted,approved};
}
export async function permitIsolatedUiInput(renderer,path,approved){
 const root=await realpath(resolve(renderer)),candidate=resolve(path),part=relative(root,candidate).replace(/\\/g,'/');
 if(!inside(root,candidate)||!approved?.has(part))throw Error('Isolated input changed or is unapproved: '+part);
 const entry=await lstat(candidate);if(entry.isSymbolicLink()||(!entry.isFile()&&!entry.isDirectory()))throw Error('Input became a reparse or unsafe type: '+part);
 const actual=await realpath(candidate);if(!inside(root,actual))throw Error('Input escaped renderer: '+part);
 const expected=approvedPins.get(approved)?.get(part);
 if(expected&&sha256(await readFile(candidate))!==expected)throw Error('Pinned untracked input changed: '+part);
 return true;
}