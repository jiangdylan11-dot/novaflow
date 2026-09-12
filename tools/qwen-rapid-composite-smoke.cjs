'use strict';
const fs=require('node:fs');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const {loadSpine}=require('./qwen-rapid-migration-smoke.cjs');
const s=loadSpine('particle-editor/spine-split-runtime.js');
s.document={createElement:()=>createCanvas(1,1)};
s.loadImage=loadImage;
s.IMAGE_OUTPAINT_ORIGINAL_EDGE_FEATHER_PX=24;
const data=file=>'data:image/png;base64,'+fs.readFileSync(file).toString('base64');
async function main(){
 const base=await s.canvasFromDataUrl(data('.tmp-rapid-scene.png'),512,512);
 const mask=await s.canvasFromDataUrl(data('.tmp-rapid-transfer-mask.png'),512,512);
 for(const family of ['ordinary','rapid']){
  const url=await s.objectTransferProtectedResultDataUrl(data('.tmp-rapid-transfer-'+family+'-silhouette.png'),{size:{width:512,height:512},baseCanvas:base,transferMaskCanvas:mask,bounds:{x:10,y:290,width:150,height:150}});
  fs.writeFileSync('.tmp-rapid-transfer-'+family+'-final.png',Buffer.from(url.split(',')[1],'base64'));
  const out=await s.canvasFromDataUrl(url,512,512);
  const orig=base.getContext('2d').getImageData(0,0,512,512).data, actual=out.getContext('2d').getImageData(0,0,512,512).data;
  let outside=0;
  for(let y=0;y<512;y++)for(let x=0;x<512;x++)if(x>180||y<270||y>460){let i=(y*512+x)*4;for(let c=0;c<4;c++)if(orig[i+c]!==actual[i+c])outside++;}
  if(outside)throw new Error('Outside-region pixel changes: '+outside);
  console.log({family,outsideChanged:outside,debug:s.state.lastProcessingDebug.objectTransfer});
  const expanded=await s.canvasFromDataUrl(data('.tmp-rapid-outpaint-'+family+'.png'),768,512);
  const stats=s.restoreOriginalRegionWithOutpaintFeather(expanded,base,{left:128,right:128,top:0,bottom:0});
  fs.writeFileSync('.tmp-rapid-outpaint-'+family+'-final.png',expanded.toBuffer('image/png'));
  console.log({family,outpaint:stats});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
