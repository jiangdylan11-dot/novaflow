'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'../../renderer').replace(/\\/g,'/')+'/';
vm.runInThisContext(fs.readFileSync(root+'spine-sequence-atlas.js','utf8'));
const atlas=globalThis.NovaFlowSequenceAtlas;
async function atlasWriterChecks(){
 const rgba=new Uint8Array(512*512*4),concurrent=atlas.createWriter({baseName:'synthetic',packed:true,settings:{dedupe:false},write:async()=>{}});
 const first=concurrent.addRgba(rgba,512,512,'first');
 await assert.rejects(concurrent.addRgba(rgba,512,512,'second'),/already processing/);await first;concurrent.dispose();
 const ctl=new AbortController(),original=globalThis.CompressionStream;let writes=0;
 try{
  globalThis.CompressionStream=class{constructor(){return new TransformStream({transform(chunk,c){c.enqueue(chunk)},async flush(){ctl.abort();await new Promise(r=>setTimeout(r,0))}})}};
  const w=atlas.createWriter({baseName:'late',packed:false,signal:ctl.signal,write:async()=>{writes++}});
  await assert.rejects(w.addRgba(rgba,512,512,'late'),{name:'AbortError'});assert.equal(writes,0);w.dispose();
 }finally{globalThis.CompressionStream=original}
 const endCtl=new AbortController(),endWrites=[];
 const end=atlas.createWriter({baseName:'end',packed:false,signal:endCtl.signal,write:async(name)=>{endWrites.push(name);if(name.endsWith('.json'))endCtl.abort()}});
 await end.addRgba(new Uint8Array([0,0,0,0]),1,1,'last');
 await assert.rejects(end.finish({skeleton:{spine:'3.8.99'},bones:[{name:'root'}],slots:[],skins:[{name:'default',attachments:{}}],animations:{}}),{name:'AbortError'});
 assert.deepEqual(endWrites,['images/last.png','end.json']);end.dispose();
}
async function fileWriterChecks(){
 const ctl=new AbortController();let opened=0,aborted=0,closed=0;
 const handle={async getFileHandle(){opened++;return {async createWritable(){return {async write(){ctl.abort()},async close(){closed++},async abort(){aborted++}}}}}};
 await assert.rejects(atlas.createFileWriter({handle,signal:ctl.signal})('out.png',new Uint8Array([1])),{name:'AbortError'});
 assert.equal(opened,1);assert.equal(aborted,1);assert.equal(closed,0);
 await assert.rejects(atlas.createFileWriter({handle,signal:ctl.signal})('next.png',new Uint8Array([2])),{name:'AbortError'});assert.equal(opened,1);
 const other=new AbortController();let calls=0;
 await assert.rejects(atlas.createFileWriter({api:{async writeBinaryFile(){calls++;other.abort();return {ok:true}}},dir:'safe',signal:other.signal})('out.png',new Uint8Array([1])),{name:'AbortError'});assert.equal(calls,1);
 for(const stage of ['directory','file','writable']){
  const cancel=new AbortController();let fileCalls=0,openCalls=0,writeCalls=0,abortCalls=0;
  const folder={async getDirectoryHandle(){if(stage==='directory')cancel.abort();return folder},async getFileHandle(){fileCalls++;if(stage==='file')cancel.abort();return {async createWritable(){openCalls++;if(stage==='writable')cancel.abort();return {async write(){writeCalls++},async close(){},async abort(){abortCalls++}}}}}};
  await assert.rejects(atlas.createFileWriter({handle:folder,signal:cancel.signal})('folder/out.png',new Uint8Array([1])),{name:'AbortError'});
  assert.equal(writeCalls,0);assert.equal(fileCalls,stage==='directory'?0:1);assert.equal(openCalls,stage==='writable'?1:0);assert.equal(abortCalls,stage==='writable'?1:0);
 }
 const blobCancel=new AbortController();let invoked=0;
 class CanceledBlob extends Blob{async arrayBuffer(){blobCancel.abort();return new Uint8Array([1]).buffer}}
 await assert.rejects(atlas.createFileWriter({api:{async writeBinaryFile(){invoked++;return {ok:true}}},dir:'safe',signal:blobCancel.signal})('x.png',new CanceledBlob(['x'])),{name:'AbortError'});assert.equal(invoked,0);
}
async function projectChecks(){
 const source=fs.readFileSync(root+'spine-skeleton-editor.js','utf8'),a=source.indexOf('  async function exportSelectedProjects('),b=source.indexOf('  function createMediaRenderer(',a);assert(a>=0&&b>a);
 const ctl=new AbortController(),written=[];let exports=0,success=0;
 const ctx={DOMException,mediaExportPlans:()=>[{name:'one',entries:[{src:{}}]},{name:'two',entries:[{src:{}}]}],pickDirectory:async()=>null,window:{NovaFlowSequenceAtlas:{}},atlasSettings:()=>({}),status(){success++},exportProject:async(_options,write)=>{exports++;await write('first.png',new Uint8Array([1]));return {missing:[]}}};
 vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
 await assert.rejects(ctx.exportSelectedProjects({signal:ctl.signal,write:async(name)=>{written.push(name);ctl.abort()}}),{name:'AbortError'});
 assert.deepEqual(written,['one/first.png']);assert.equal(exports,1);assert.equal(success,0);
}
async function hostChecks(){
 const source=fs.readFileSync(root+'spine-skeleton-editor.host.js','utf8'),a=source.indexOf('  function onExportClick('),b=source.indexOf('  /** The dialog opened:',a);assert(a>=0&&b>a);
 class Element {constructor(){this.disabled=false;this.textContent='导出动画工程';this.listeners={};this.attributes={};this.removed=false}closest(){return this}setAttribute(k,v){this.attributes[k]=v}addEventListener(k,f){this.listeners[k]=f}insertAdjacentElement(_where,e){this.next=e}remove(){this.removed=true}}
 let calls=0,signal;const alerts=[];const button=new Element();
 const ctx={Element,AbortController,DOMException,document:{createElement:()=>new Element()},window:{NovaFlowSkeletonEditor:{active:()=>true},alert:s=>alerts.push(s)},isExportRun:()=>true,isSpineExportRun:()=>true,exportRunLabel:b=>b.textContent,packMode:()=> 'atts',chosenVersion:'3.8',exportSkel:()=>false,api:{exportSelectedProjects(opts){calls++;signal=opts.signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Export cancelled','AbortError'))))}}};
 vm.createContext(ctx);vm.runInContext('let bypass=false,nativeProjectExporting=false;\n'+source.slice(a,b),ctx);
 const event={target:button,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}};
 ctx.onExportClick(event);ctx.onExportClick(event);assert.equal(calls,1,'repeat click must not start another export');assert.equal(button.disabled,true);
 const cancel=button.next;assert(cancel);cancel.listeners.click({preventDefault(){},stopPropagation(){}});await new Promise(r=>setImmediate(r));
 assert.equal(signal.aborted,true);assert.equal(button.disabled,false);assert.equal(cancel.removed,true);assert(alerts[0].includes('保留'));
}
(async()=>{await atlasWriterChecks();await fileWriterChecks();await projectChecks();await hostChecks();console.log(JSON.stringify({synthetic:true,noUserFiles:true,preStartCancel:true,abortAfterCompressionNoWrite:true,inFlightWriteAborted:true,existingWrittenFilesPreserved:true,repeatClickSingleExport:true,cancelReenablesUi:true}));})().catch(e=>{console.error(e);process.exitCode=1});
