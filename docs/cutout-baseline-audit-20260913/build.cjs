const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..'),sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp'));
const mat={};{const m={exports:{}};new Function('module',fs.readFileSync(path.join(root,'particle-editor/ai-sequence-green-screen-matting.js'),'utf8'))(m);Object.assign(mat,m.exports);}
const study=path.join(root,'logs/divinepower-matting-study'),review=path.join(root,'docs/cutout-review-current-20260913');
const label=(w,t)=>Buffer.from(`<svg width="${w}" height="40"><rect width="100%" height="100%" fill="#eee"/><text x="12" y="28" font-family="Microsoft YaHei,Arial" font-size="20">${t}</text></svg>`);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const panel=async(p,crop,bg,w)=>sharp(p).flatten({background:bg}).extract(crop).resize({width:w}).png().toBuffer();
async function pair(a,b,labels,file,crop,w=540){
 const [pa,pb]=await Promise.all([panel(a,crop,'#fff',w),panel(b,crop,'#fff',w)]);
 const h=(await sharp(pa).metadata()).height;
 await sharp({create:{width:w*2,height:h+40,channels:3,background:'#fff'}}).composite([{input:label(w,labels[0]),left:0,top:0},{input:label(w,labels[1]),left:w,top:0},{input:pa,left:0,top:40},{input:pb,left:w,top:40}]).png().toFile(path.join(__dirname,file));
}
(async()=>{
 const manifest={note:'Diagnostic comparison only. No production algorithm changes. Approved sample is offline material-aware processing, not the installed app.',production:hash(path.join(root,'particle-editor/ai-sequence-green-screen-matting.js')),approved:[],current:[]};
 for(const n of [0,54]){
  const name=`frame_${String(n).padStart(4,'0')}.png`,original=path.join(study,'source-frames',name),accepted=path.join(study,'temporal-refine/frames',name);
  const data=await sharp(original).ensureAlpha().raw().toBuffer(),mask=await sharp(path.join(study,'ai-frames',name)).extractChannel(3).raw().toBuffer();
  const current=mat.matte({width:1080,height:1920,data},{subjectMask:{width:1080,height:1920,data:mask},preserveShadow:true});
  const rgba=await sharp(current.data,{raw:{width:1080,height:1920,channels:4}}).png().toBuffer();
  fs.writeFileSync(path.join(__dirname,`current-${n}.png`),rgba);
  const scene=path.join(study,'background-check/background-fit.png');
  const oldScene=await sharp(scene).composite([{input:accepted}]).png().toBuffer(),nowScene=await sharp(scene).composite([{input:rgba}]).png().toBuffer();
  await pair(oldScene,nowScene,['图 3 认可样片（离线）','当前程序算法 · 同一原片同帧'],`athena-${n}-scene.png`,{left:80,top:960,width:980,height:810},600);
  await pair(accepted,rgba,['图 3 认可样片 · 白底','当前程序算法 · 白底'],`athena-${n}-white.png`,{left:80,top:960,width:980,height:810},600);
  manifest.approved.push({frame:n,path:accepted,sha256:hash(accepted)});manifest.current.push({frame:n,path:`current-${n}.png`,sha256:hash(path.join(__dirname,`current-${n}.png`))});
 }
 const tiles=[];
 for(let n=0;n<73;n++){
  const p=path.join(review,'scatter/frames',`clean_${String(n).padStart(4,'0')}.png`);
  const tile=await panel(p,{left:150,top:260,width:660,height:400},'#fff',240);
  const left=n%6*240,top=Math.floor(n/6)*186;
  tiles.push({input:tile,left,top:top+40},{input:label(240,String(n)),left,top});
 }
 await sharp({create:{width:1440,height:13*186,channels:3,background:'#ccc'}}).composite(tiles).png().toFile(path.join(__dirname,'scatter-frames.png'));
 fs.writeFileSync(path.join(__dirname,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log('Created approved-vs-current same-frame comparisons and Scatter frame sheet.');
})().catch(e=>{console.error(e);process.exit(1)});
