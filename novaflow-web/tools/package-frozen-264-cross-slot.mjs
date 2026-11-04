// Repackage only the independently reviewed cross-slot fix over frozen 264.
// This never reads the current renderer or modifies the frozen site directory.
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {lstat,link,mkdir,readFile,readdir,realpath,stat,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve,sep} from 'node:path';
import {minify} from 'terser';
import {readConfig} from './set-web-config.mjs';

const EXPECTED={zip:'2531ab11ca044c31edc3f69d2bbc1982c5ffaeba81ffd0b7ebe88eacc0d247c5',manifest:'b9af7f1f9d86863fe0f910f3d83c5a62842b39f06f5a1e35c89de581d4cc1326',base:'eb3f9e67243a7d3008c83f1c6befeeb7276c52e84124559eed4f8a6f49e4bdc0',patch:'d1a59a33be1a8dbcc9888547b29b94320bf64ecd7aef938d8e19378d7ce6ef13',modified:'8037b7ecb80645d47a2d7ad38805f2bc2a9e04da243b94f115cb1a512273437a'};
const options={module:false,compress:{passes:2},mangle:{toplevel:false},format:{comments:false,ascii_only:true,ecma:2020}};
export function assertSafeMember(name){
 if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..')||/[:\x00-\x1f]/.test(name))throw Error('Unsafe frozen member');
 return name;
}
async function hash(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
async function checkedFile(path,expected,within){
 const e=await lstat(path),actual=await realpath(path);
 if(!e.isFile()||e.isSymbolicLink()||!actual.startsWith(within+sep)||await hash(actual)!==expected)throw Error('Frozen input failed verification: '+path);
 return actual;
}
async function listTree(dir,base=dir,result=[]){
 for(const e of await readdir(dir,{withFileTypes:true}) ){
  const path=join(dir,e.name);if(e.isSymbolicLink())throw Error('Frozen site has a symlink');
  if(e.isDirectory())await listTree(path,base,result);else if(e.isFile())result.push(path.slice(base.length+1).split(sep).join('/'));else throw Error('Unexpected frozen site member');
 }
 return result;
}
export function onlyCrossSlotChange(base,modified){
 let text=base.replace(/\r\n/g,'\n');
 const needle='  function selectAttachment(sel, e) {\n';
 const added="  function visibleAttachmentRange(sel) {\n    return [...document.querySelectorAll('#tree .row[data-att-name]')].map((row) => ({ kind: 'att', skin: row.dataset.attSkin, slot: row.dataset.attSlot, name: row.dataset.attName }))\n      .filter((a) => a.skin === sel.skin)\n  }\n\n";
 if(text.split(needle).length!==2)throw Error('Ambiguous attachment function');
 text=text.replace(needle,added+needle);
 const before='      const rows = visibleAttachments(sel), anchor = state.attachmentAnchor || state.sel\n';
 const after='      const rows = visibleAttachmentRange(sel), anchor = state.attachmentAnchor || state.sel\n';
 if(text.split(before).length!==2)throw Error('Ambiguous range replacement');
 text=text.replace(before,after);
 if(text!==modified.replace(/\r\n/g,'\n'))throw Error('Modified editor contains an unexpected change');
}
export async function packageFrozenCrossSlot({root,tag,controlUrl,authUrl,logger=()=>{}}){
 if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(tag))throw Error('Invalid frozen tag');
 const work=resolve(root,'../work'),ws=await realpath(work),st=await lstat(work);
 if(!st.isDirectory()||st.isSymbolicLink()||ws!==work)throw Error('Unsafe work directory');
 const previous=join(work,'animation-export-full-264-20261102-retry');
 const previousReal=await realpath(previous);if(previousReal!==previous)throw Error('Unsafe frozen 264 directory');
 const zip=await checkedFile(join(previous,'foart-site-2.0.264.zip'),EXPECTED.zip,work);
 const manifestPath=await checkedFile(join(work,'frozen-264-cross-slot-input-manifest.json'),EXPECTED.manifest,work);
 const snap=join(work,'draw-order-slot-20261102','skin-target-v1','combined-check');
 const raw=await checkedFile(join(snap,'novaflow-web/renderer/spine-skeleton-editor.js'),EXPECTED.base,work);
 await checkedFile(join(snap,'cross-slot-v1/spine-cross-slot-shift-v1.patch'),EXPECTED.patch,work);
 const revised=await checkedFile(join(snap,'cross-slot-v1/modified/novaflow-web/renderer/spine-skeleton-editor.js'),EXPECTED.modified,work);
 const [baseSource,newSource,manifestText]=await Promise.all([readFile(raw,'utf8'),readFile(revised,'utf8'),readFile(manifestPath,'utf8')]);
 onlyCrossSlotChange(baseSource,newSource);
 const manifest=JSON.parse(manifestText),names=Object.keys(manifest).sort();if(names.length!==738)throw Error('Unexpected frozen site count');
 for(const name of names)assertSafeMember(name);
 const baseDir=await realpath(join(previous,'web-dist'));if(!baseDir.startsWith(previousReal+sep))throw Error('Unsafe frozen site');
 const actualNames=(await listTree(baseDir)).sort();if(JSON.stringify(actualNames)!==JSON.stringify(names))throw Error('Frozen site member list changed');
 for(const name of names)await checkedFile(join(baseDir,...name.split('/')),manifest[name],baseDir);
 const config=readConfig(await readFile(join(baseDir,'index.html'),'utf8')),editorHtml=await readFile(join(baseDir,'editor.html'),'utf8');
 if(JSON.stringify(config)!==JSON.stringify(readConfig(editorHtml))||config?.controlUrl!==controlUrl||config?.authUrl!==authUrl)throw Error('Frozen 264 service URLs do not match');
 if(JSON.parse(await readFile(join(baseDir,'release.json'),'utf8')).version!=='2.0.264')throw Error('Frozen version mismatch');
 const oldMin=(await minify({'spine-skeleton-editor.js':baseSource},options)).code;
 if(oldMin!==await readFile(join(baseDir,'spine-skeleton-editor.js'),'utf8'))throw Error('Frozen editor does not match tested base source');
 const next=(await minify({'spine-skeleton-editor.js':newSource},options)).code;if(!next)throw Error('Could not minify editor');
 const oldToken=createHash('sha1').update(oldMin).digest('hex').slice(0,10),newToken=createHash('sha1').update(next).digest('hex').slice(0,10);
 const before='spine-skeleton-editor.js?v='+oldToken,after='spine-skeleton-editor.js?v='+newToken;
 if(editorHtml.split(before).length!==2)throw Error('Frozen editor cache token mismatch');
 const newHtml=editorHtml.replace(before,after);
 const stage=join(work,tag);await mkdir(stage);const stageReal=await realpath(stage);if(stageReal!==stage)throw Error('Unsafe frozen output stage');
 const out=join(stage,'web-dist');await mkdir(out);
 for(const name of names){
  const dest=join(out,...name.split('/'));await mkdir(dirname(dest),{recursive:true});
  const parent=await realpath(dirname(dest));if(parent!==out&&!parent.startsWith(out+sep))throw Error('Unsafe frozen output member');
  if(name==='spine-skeleton-editor.js')await writeFile(dest,next,{flag:'wx'});
  else if(name==='editor.html')await writeFile(dest,newHtml,{flag:'wx'});
  else {const source=await checkedFile(join(baseDir,...name.split('/')),manifest[name],baseDir);await link(source,dest);}
 }
 const output=join(stage,'foart-site-2.0.264-cross-slot.zip');
 const tar=process.platform==='win32'?join(process.env.SystemRoot||'C:/Windows','System32','tar.exe'):'tar';
 execFileSync(tar,['-a','-c','-f',output,'.'],{cwd:out,stdio:'pipe'});
 const bytes=(await stat(output)).size;logger('frozen cross-slot package',{baseSha256:EXPECTED.zip,members:names.length,changed:['spine-skeleton-editor.js','editor.html'],output});
 return {zip:output,bytes,config,files:{frozen:true,members:names.length}};
}
