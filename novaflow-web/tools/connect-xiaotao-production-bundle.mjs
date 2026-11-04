// Narrow adapter for the maintained compression React closure (no TSX source).
// Keep native encoders, input rules and batch behavior. Fail on bundle drift.
import {readFile,writeFile} from 'node:fs/promises';
const file=new URL('../renderer/assets/index-BbIa-2NM.js',import.meta.url);
let source=await readFile(file,'utf8');
const original=source;
// Native loop export used 60 simulation ticks multiplied by fps/30, doubling
// both PNG frame count and encoded video duration. Keep the render loop and
// warm-up; sample exactly one cycle at the requested delivery frame rate.
for(const [before,after] of [
  ['if(e.loopAnimation){let e=Math.max(1,Math.round(b*60)),t=x/30;C=Math.max(1,Math.round(e*t)),S=C,F=b/C}','if(e.loopAnimation){C=Math.max(1,Math.round(b*x)),S=C,F=b/C}'],
  ['if(t.loopAnimation){let e=Math.max(1,Math.round(o*60)),t=u/30;p=Math.max(1,Math.round(e*t)),f=p,O=o/p}','if(t.loopAnimation){p=Math.max(1,Math.round(o*u)),f=p,O=o/p}']
]){if(source.includes(before)){if(source.split(before).length!==2)throw Error('Native loop export anchor is ambiguous');source=source.replace(before,after);}else if(!source.includes(after))throw Error('Native loop export timing changed');}
if(!source.includes('nfXiaotaoCompressionBridge=')){
  const anchor='Ce=A===`png_compress`?l===`spine`?';
  if(source.split(anchor).length!==2)throw new Error('Native compression closure changed');
  source=source.replace(anchor,`nfXiaotaoCompressionBridge=((window.NovaFlowProductionTools||={})[A]={
    snapshot:()=>({name:A,active:!!document.querySelector('[data-novaflow-tools-entry="'+A+'"][data-novaflow-tools-entry-active="1"]')&&!document.querySelector('#novaflow-png-remove-black-root:not([hidden]),#novaflow-mp4-compress-root:not([hidden]),#novaflow-video-format-convert-root:not([hidden]),#novaflow-spine-atlas-webp-root:not([hidden]),#novaflow-spine-viewer-root:not([hidden])')&&document.body.classList.contains('novaflow-primary-target-tools'),busy:w||E,selectedId:p,settings:{mode:l,strength:A==='jpg_compress'?h:v,alpha:Q},items:d.map(e=>({id:e.id,name:e.name,status:e.status,message:e.message,sourceMaterialId:e.sourceMaterialId,inputBytes:e.inputSize,output:e.output?{id:e.id,name:e.output.fileName,bytes:e.output.blob?.size||e.output.size,width:e.output.width,height:e.output.height}:e.status==='done'&&!e.output?{id:e.id,name:e.name,bytes:e.inputSize,width:e.width,height:e.height,keptOriginal:true}:null}))}),
    run:ids=>ve(ids?d.filter(e=>ids.includes(e.id)):d),export:()=>Se(),files:()=>d.filter(e=>e.output?.blob||e.status==='done'&&!e.output).map(e=>({id:e.id,name:e.output?.fileName||e.name,blob:e.output?.blob,url:e.output?.url||e.dataUrl}))
  }),`+anchor);
}
if(!source.includes('window.NovaFlowParticleAgent={snapshot:')){
  const anchor='[A]),{systems:n,activeIndex:i,activeConfig:s,addSystem:p';
  if(source.split(anchor).length!==2)throw new Error('Native particle state closure changed');
  source=source.replace(anchor,`[A]),window.NovaFlowParticleAgent={snapshot:()=>({activeIndex:i,systems:n.map(c=>({id:c.id,name:c.systemName,enabled:c.enabled})),config:Object.fromEntries(Object.entries(s||{}).filter(([k,v])=>typeof v==='string'?v.length<1000:!v||typeof v!=='object'||Array.isArray(v)&&JSON.stringify(v).length<12000))}),exportConfig:D,exportAllConfigs:O},{systems:n,activeIndex:i,activeConfig:s,addSystem:p`);
}
if(!source.includes('return{id:Ni(),name:e.name,dataUrl:t,sourceMaterialId:')){
  const anchor='return{id:Ni(),name:e.name,dataUrl:t,inputSize:e.size';
  if(source.split(anchor).length!==2)throw new Error('Native compression file identity closure changed');
  source=source.replace(anchor,'return{id:Ni(),name:e.name,dataUrl:t,sourceMaterialId:e.__nfFoartMaterialId,inputSize:e.size');
}
{
  const anchor='exportFrameSequence:He,exportVideo:Ue';
  const marker='exportFrameSequence:(window.NovaFlowParticleExportAgent=',tail='},He),exportVideo:Ue',start=source.indexOf(marker),end=start<0?-1:source.indexOf(tail,start);
  if(start<0&&source.split(anchor).length!==2||start>=0&&end<0)throw new Error('Native particle export closure changed');
  const current=start<0?anchor:source.slice(start,end+tail.length);
  source=source.replace(current,`exportFrameSequence:(window.NovaFlowParticleExportAgent={
    snapshot:()=>({fps:D,seconds:k,width:N,height:F,scale:L,transparent:!te,format:G,busy:!!Ce}),
    configure:settings=>{const bounds={fps:[1,120],seconds:[.01,60],width:[16,2048],height:[16,2048],scale:[10,200]};for(const [key,value]of Object.entries(settings)){if(bounds[key]){if(typeof value!=='number'||!Number.isFinite(value)||value<bounds[key][0]||value>bounds[key][1]||key!=='seconds'&&!Number.isInteger(value))throw Error('粒子导出参数超出原生范围');}else if(key==='transparent'){if(typeof value!=='boolean')throw Error('粒子透明参数无效');}else if(key==='format'){if(!['mp4','webm'].includes(value))throw Error('粒子视频格式无效');}else throw Error('粒子导出含未知参数');}if(settings.fps!==undefined)O(settings.fps);if(settings.seconds!==undefined)A(settings.seconds);if(settings.width!==undefined)P(settings.width);if(settings.height!==undefined)I(settings.height);if(settings.transparent!==undefined)ne(!settings.transparent);if(settings.format!==undefined)K(settings.format);if(settings.scale!==undefined)ee(settings.scale);else if(settings.width!==undefined||settings.height!==undefined)ee(100);z(false);H('particle');W('particle');},
    sequence:He,video:Ue,close:()=>Se(null)
  },He),exportVideo:Ue`);
}
if(source!==original){if(process.env.FOART_ISOLATED_BUILD_TAG)throw Error('Isolated build refuses to modify production bundle source');await writeFile(file,source);}
