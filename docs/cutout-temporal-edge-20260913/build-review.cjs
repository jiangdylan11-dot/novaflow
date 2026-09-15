const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp')),ffmpeg=require(path.join(root,'particle-editor-desktop/node_modules/ffmpeg-static'));
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'))),previous=path.join(root,'docs/cutout-material-recovery-20260913');
const holder={exports:{}};new Function('module',fs.readFileSync(path.join(root,'logs/cutout-temporal-edge-20260913/before-matting.js'),'utf8'))(holder);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const crops={gloweyes:[60,880,1020,870],athena:[60,940,1020,850]},summary=[];
const label=(s,w)=>Buffer.from(`<svg width="${w}" height="32"><rect width="100%" height="100%" fill="#252b35"/><text x="12" y="23" font-family="Microsoft YaHei" font-size="18" fill="white">${s}</text></svg>`);
(async()=>{
 fs.copyFileSync(path.join(previous,'scene.png'),path.join(__dirname,'scene.png'));
 for(const c of manifest.clips.filter(c=>!process.argv.slice(2).length||process.argv.slice(2).includes(c.id))){
  const dir=path.join(__dirname,c.id),report=JSON.parse(fs.readFileSync(path.join(dir,'report.json'))),prior=JSON.parse(fs.readFileSync(path.join(previous,c.id,'report.json')));
  assert.equal(report.mattingSha256,manifest.mattingSha256);assert.equal(report.writes.length,c.frames);assert.equal(report.errors.length,0);
  if(['athena','gloweyes'].includes(c.id))assert.equal(report.materialReferences.length,1,'one deterministic clip material reference is required');
  const cached=new Map;for(const m of prior.maskMatches){const file=path.join(previous,c.id,'captured',`frame_${String(m.decodedFrameIndex).padStart(4,'0')}.png`);cached.set(hash(fs.readFileSync(file))+'|'+m.fileName,path.join(previous,c.id,'frames',`clean_${String(m.timelineIndex).padStart(4,'0')}.png`));}
  const scene=await sharp(path.join(__dirname,'scene.png')).resize(c.width,c.height,{fit:'fill'}).png().toBuffer();
  const crop=crops[c.id]||[c.reviewCrop[0],c.reviewCrop[1],c.reviewCrop[2]-c.reviewCrop[0],c.reviewCrop[3]-c.reviewCrop[1]],extract={left:crop[0],top:crop[1],width:crop[2],height:crop[3]};
  const preview=path.join(dir,'review'),beforeDir=path.join(dir,'before');fs.mkdirSync(preview,{recursive:true});fs.mkdirSync(beforeDir,{recursive:true});
  let reused=0;
  for(let n=0;n<c.frames;n++){
   const m=report.maskMatches.find(m=>m.timelineIndex===n),name=String(n).padStart(4,'0'),bytes=fs.readFileSync(path.join(dir,'captured',`frame_${String(m.decodedFrameIndex).padStart(4,'0')}.png`)),file=path.join(dir,'frames',`clean_${name}.png`);
   let baseline=cached.get(hash(bytes)+'|'+m.fileName);
   if(baseline){baseline=fs.readFileSync(baseline);reused++;}else{
    const data=await sharp(bytes).ensureAlpha().raw().toBuffer(),mask=await sharp(path.join(c.maskDir,m.fileName)).extractChannel(3).resize(Math.round(c.width/2),Math.round(c.height/2)).raw().toBuffer();
    const r=holder.exports.matte({width:c.width,height:c.height,data},{subjectMask:{width:Math.round(c.width/2),height:Math.round(c.height/2),data:mask}});
    baseline=await sharp(r.data,{raw:{width:c.width,height:c.height,channels:4}}).png().toBuffer();
   }
   fs.writeFileSync(path.join(beforeDir,`frame_${name}.png`),baseline);
   const pictures=[];
   for(const input of [baseline,file]){
    const comp=await sharp(scene).composite([{input}]).png().toBuffer();
    pictures.push({input:await sharp(comp).extract(extract).resize(640,548,{fit:'contain',background:'#20242a'}).png().toBuffer(),left:(pictures.length%2)*640,top:32});
   }
   const detail=['athena','gloweyes'].includes(c.id);let height=580;
   if(detail){height=918;for(const [k,input] of [baseline,file].entries()){
    const comp=await sharp(scene).composite([{input}]).png().toBuffer();
    pictures.push({input:await sharp(comp).extract({left:440,top:1430,width:280,height:260}).resize(640,306,{fit:'contain',background:'#20242a'}).png().toBuffer(),left:k*640,top:612});
   }pictures.push({input:label('薄纱局部 · 同一帧放大',1280),left:0,top:580});}
   pictures.push({input:label('修改前 · 相同输入',640),left:0,top:0},{input:label('当前程序导出 · '+(n+1)+' / '+c.frames,640),left:640,top:0});
   const grid=await sharp({create:{width:1280,height,channels:3,background:'#20242a'}}).composite(pictures).png().toBuffer();fs.writeFileSync(path.join(preview,name+'.png'),grid);
   if(n===(c.id==='gloweyes'?53:c.id==='athena'?0:34)){fs.writeFileSync(path.join(__dirname,c.id+'-compare.png'),grid);for(const background of ['black','white'])await sharp(file).flatten({background}).extract(extract).png().toFile(path.join(__dirname,c.id+'-'+background+'.png'));}
  }
  const r=cp.spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-framerate','24','-i',path.join(preview,'%04d.png'),'-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',path.join(__dirname,c.id+'-compare.mp4')],{windowsHide:true,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  summary.push({id:c.id,frames:c.frames,reusedBaselineFrames:reused,materialReferences:report.materialReferences,review:c.id+'-compare.mp4'});console.log('REVIEW',c.id,reused,c.frames);
 }
 const summaryFile=path.join(__dirname,'review-summary.json'),existing=fs.existsSync(summaryFile)?JSON.parse(fs.readFileSync(summaryFile)):[];
 const all=[...existing.filter(r=>!summary.some(s=>s.id===r.id)),...summary].sort((a,b)=>manifest.clips.findIndex(c=>c.id===a.id)-manifest.clips.findIndex(c=>c.id===b.id));
 fs.writeFileSync(summaryFile,JSON.stringify(all,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
