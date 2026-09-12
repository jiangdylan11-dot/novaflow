'use strict';
// Replays the actual saved generation through the production pixel join; no resampling.
const fs = require('node:fs');
const path = require('node:path');
const {createCanvas, loadImage} = require('@napi-rs/canvas');
function loadModule(file) {
  const mod={exports:{}};
  new Function('module',fs.readFileSync(path.join(__dirname,'../particle-editor',file),'utf8'))(mod);
  return mod.exports;
}
const pixels = loadModule('split-inpaint-nsfw-pixels.helper.js');
const workflow = loadModule('split-inpaint-nsfw.workflow.js');
const {loadSpine} = require('./qwen-rapid-migration-smoke.cjs');
const input = process.argv[2];
const prefix = process.argv[3];
if (!input || !prefix) throw new Error('Usage: node tools/completion-seam-replay.cjs <debug input directory> <run prefix>');
async function read(name) {
  const img = await loadImage(path.join(input, prefix + '_' + name + '.png'));
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas;
}
async function main() {
  const [original, mask, raw, alpha, guide] = await Promise.all([
    read('02_crop_image'), read('03_crop_mask'), read('05_qwen_result_crop'),
    read('05c_rmbg_alpha_source'), read('05d_source_subject_guide'),
  ]);
  const s = loadSpine('particle-editor/spine-split-runtime.js');
  s.window = {NovaFlowSplitInpaintNsfwPixels:pixels};
  s.document = {createElement:()=>createCanvas(1,1)};
  const w = raw.width, h = raw.height;
  const rgba = c=>c.getContext('2d').getImageData(0,0,w,h);
  const generated = rgba(raw), foregroundAlpha = rgba(alpha);
  for(let i=3;i<generated.data.length;i+=4) generated.data[i]=foregroundAlpha.data[i];
  const fg = createCanvas(w,h);fg.getContext('2d').putImageData(generated,0,0);
  const clean = s.cleanRapidAioNsfwForeground(fg,mask);
  const policy = workflow.resolveSubjectJoinPolicy('completion',Math.min(w,h));
  const outDir = path.resolve('docs/completion-seam');fs.mkdirSync(outDir,{recursive:true});
  const output = {};
  for (const mode of ['before','after']) {
    const canvas = s.cloneCanvas(clean);
    s.blendRapidAioNsfwSubjectJoin(canvas,original,mask,guide,{...policy,sourceEdgeFeather:mode==='before'?0:policy.sourceEdgeFeather});
    const patch = s.fullCanvasWithLayerMask(canvas,mask);
    const result = s.cloneCanvas(original);result.getContext('2d').drawImage(patch,0,0);
    output[mode] = result;
    fs.writeFileSync(path.join(outDir,mode+'.png'),result.toBuffer('image/png'));
  }
  const old=rgba(output.before).data, next=rgba(output.after).data, orig=rgba(original).data, m=rgba(mask).data;
  let outsideChanged=0, unselectedChanged=0;
  for(let i=0;i<next.length;i+=4) {
    if(m[i]<=8 && next.slice(i,i+4).some((v,c)=>v!==old[i+c]))outsideChanged++;
    if(m[i]===0 && next.slice(i,i+4).some((v,c)=>v!==orig[i+c]))unselectedChanged++;
  }
  const seam=(d,x,y)=>[0,1,2].reduce((n,c)=>n+Math.abs(d[(y*w+x)*4+c]-d[((y-1)*w+x)*4+c]),0);
  const metrics={width:w,height:h,outsideChanged,unselectedChanged,policy,seams:[180,365].map(x=>({x,y:313,before:seam(old,x,313),after:seam(next,x,313)}))};
  fs.writeFileSync(path.join(outDir,'replay.json'),JSON.stringify(metrics,null,2));
  console.log(metrics);
  if(outsideChanged || unselectedChanged)throw new Error('Unselected pixels changed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
