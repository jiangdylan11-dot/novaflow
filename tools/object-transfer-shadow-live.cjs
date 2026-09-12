'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const {loadSpine}=require('./qwen-rapid-migration-smoke.cjs');
const dir=path.resolve(process.argv.includes('--style')?'docs/object-transfer-integration':'docs/object-transfer-shadow');fs.mkdirSync(dir,{recursive:true});
if(process.argv.includes('--style'))for(const name of ['reference-cutout','source-foreground']){
 const from=path.resolve('docs/object-transfer-shadow',name+'.png'),to=path.join(dir,name+'.png');
 if(fs.existsSync(from)&&!fs.existsSync(to))fs.copyFileSync(from,to);
}
const baseUrl='http://127.0.0.1:8188';
const data=file=>'data:image/png;base64,'+fs.readFileSync(file).toString('base64');
async function json(route,options){const r=await fetch(baseUrl+route,{...options,signal:AbortSignal.timeout(30000)});const x=await r.json();if(!r.ok)throw Error(JSON.stringify(x));return x;}
async function upload(file,name){const f=new FormData();f.append('image',new Blob([fs.readFileSync(file)],{type:'image/png'}),name);f.append('overwrite','true');return (await json('/upload/image',{method:'POST',body:f})).name;}
async function run(name,graph){
 const file=path.join(dir,name+'.png');if(fs.existsSync(file)&&fs.statSync(file).size>100)return file;
 const q=await json('/queue');if(q.queue_running.length||q.queue_pending.length)throw Error('Runtime busy; retry after current user job finishes');
 fs.writeFileSync(path.join(dir,name+'-workflow.json'),JSON.stringify(graph,null,2));
 const p=await json('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:'novaflow-transfer-shadow-validation'})});
 console.log(name,'submitted',p.prompt_id);
 const start=Date.now();let v;
 while(Date.now()-start<900000){v=(await json('/history/'+p.prompt_id))[p.prompt_id];if(v?.status?.completed||v?.status?.status_str==='error')break;await new Promise(r=>setTimeout(r,2000));}
 if(v?.status?.status_str!=='success')throw Error(JSON.stringify(v?.status||'timeout'));
 const image=Object.values(v.outputs||{}).flatMap(o=>o.images||[])[0];if(!image)throw Error('No image');
 const r=await fetch(baseUrl+'/view?'+new URLSearchParams(image));if(!r.ok)throw Error('Image unavailable');
 fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));
 fs.writeFileSync(path.join(dir,name+'-run.json'),JSON.stringify({id:p.prompt_id,status:v.status.status_str,seconds:(Date.now()-start)/1000,output:image},null,2));
 console.log(name,'success',Math.round((Date.now()-start)/1000),'seconds');return file;
}
async function cutout(name,file){if(fs.existsSync(path.join(dir,name+'.png')))return path.join(dir,name+'.png');const input=await upload(file,'transfer_shadow_'+name+'.png');return run(name,{
 '1':{class_type:'LoadImage',inputs:{image:input}},
 '2':{class_type:'RMBG',inputs:{image:['1',0],model:'RMBG-2.0',sensitivity:1,process_res:1024,mask_blur:0,mask_offset:0,invert_output:false,refine_foreground:false,background:'Alpha',background_color:'#222222'}},
 '3':{class_type:'SaveImage',inputs:{images:['2',0],filename_prefix:'NovaFlow_validation/transfer_shadow_'+name}}
});}
function sandbox(file){const s=loadSpine(file);s.document={createElement:()=>createCanvas(1,1)};s.loadImage=loadImage;s.setSplitBusyDetail=()=>{};return s;}
async function main(){
 const baseFile=process.argv[2],refFile=process.argv[3];if(!baseFile||!refFile)throw Error('Provide base and reference PNG paths');
 const s=sandbox('particle-editor/spine-split-runtime.js'),old=sandbox('.tmp-rapid-baseline-spine-split-runtime.js');
 const img=await loadImage(baseFile),size={width:img.width,height:img.height};
 const base=await s.canvasFromDataUrl(data(baseFile),size.width,size.height);
 const ref=await loadImage(refFile),refCutout=await cutout('reference-cutout',refFile);
 const bounds={x:Math.round(size.width*.524),y:Math.round(size.height*.536),width:Math.round(size.width*.45),height:Math.round(size.width*.45)};
 s.objectTransferState=()=>({referenceCutoutDataUrl:data(refCutout),referenceOriginalDataUrl:data(refFile),referenceWidth:ref.width,referenceHeight:ref.height});
 s.sourceSize=async()=>size;s.clampObjectTransferPlacement=()=>bounds;s.sourceFullCanvas=async()=>base;
 const assets=await s.objectTransferBuildInputCanvases();
 fs.writeFileSync(path.join(dir,'placement.png'),Buffer.from(assets.placementGuideDataUrl.split(',')[1],'base64'));
 fs.writeFileSync(path.join(dir,'mask.png'),assets.transferMaskCanvas.toBuffer('image/png'));
 const info=await json('/object_info');
 let generatedFile=path.join(dir,'generated.png');
 if(!fs.existsSync(generatedFile)){
  const placementName=await upload(path.join(dir,'placement.png'),'transfer_shadow_placement.png'),referenceName=await upload(refFile,'transfer_shadow_reference.png');
  const graph=s.buildObjectTransferQwenWorkflow(info,{placementName,referenceName},'NovaFlow_validation/transfer_shadow_generated',s.resolveObjectTransferQwenRuntime(info));
  Object.values(graph).filter(n=>n.class_type==='KSampler').forEach(n=>n.inputs.seed=9122026);
  generatedFile=await run('generated',graph);
 }
 const normalized=await s.objectTransferNormalizeResultDataUrl(data(generatedFile),size);
 fs.writeFileSync(path.join(dir,'normalized.png'),Buffer.from(normalized.split(',')[1],'base64'));
 const sourceFg=await cutout('source-foreground',baseFile),generatedFg=await cutout('generated-foreground',path.join(dir,'normalized.png'));
 assets.sourceForegroundCanvas=await s.canvasFromDataUrl(data(sourceFg),size.width,size.height);
 assets.generatedForegroundCanvas=await s.canvasFromDataUrl(data(generatedFg),size.width,size.height);
 for(const [name,api]of [['before',old],['after',s]]){
  const url=await api.objectTransferProtectedResultDataUrl(normalized,assets);
  fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(url.split(',')[1],'base64'));
 }
 const out=await s.canvasFromDataUrl(data(path.join(dir,'after.png')),size.width,size.height);
 const rgba=c=>c.getContext('2d').getImageData(0,0,size.width,size.height).data;
 const a=rgba(base),b=rgba(out),protectedFg=rgba(assets.sourceForegroundCanvas),explicit=rgba(assets.subjectMaskCanvas);
 const stats=s.state.lastProcessingDebug.objectTransfer.pasteMask;
 let protectedChanged=0,outsideChanged=0;
 for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
  const i=(y*size.width+x)*4,changed=[0,1,2,3].some(c=>a[i+c]!==b[i+c]);
  if(protectedFg[i+3]>32&&explicit[i]<=8&&changed)protectedChanged++;
  if((x<stats.region.left||x>stats.region.right||y<stats.region.top||y>stats.region.bottom)&&changed)outsideChanged++;
 }
 const metrics={size,bounds,...stats,protectedChanged,outsideChanged};
 fs.writeFileSync(path.join(dir,'metrics.json'),JSON.stringify(metrics,null,2));console.log(metrics);
 if(protectedChanged||outsideChanged)throw Error('Protected original pixels changed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
