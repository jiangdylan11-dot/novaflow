const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp'));
const ffmpeg=require(path.join(root,'particle-editor-desktop/node_modules/ffmpeg-static'));
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json')));
const m={exports:{}};new Function('module',fs.readFileSync(path.join(root,'logs/cutout-material-recovery-20260913/before-matting.js'),'utf8'))(m);
const label=t=>Buffer.from(`<svg width="600" height="36"><rect width="100%" height="100%" fill="#242931"/><text x="14" y="25" font-family="Microsoft YaHei" fill="#fff" font-size="19">${t}</text></svg>`);
const crops={athena:[60,940,1020,850],gloweyes:[60,880,1020,870]};
const labelNames={athena:'雅典娜 DivinePower',gloweyes:'雅典娜 Gloweyes',blue:'蓝幕金树',minimax:'青蓝剑光',scatter:'黑底 Scatter'};
const selected=process.argv.slice(2),summary=[];
(async()=>{
 const sceneFile=path.join(root,'logs/divinepower-matting-study/background-check/background-fit.png');
 fs.copyFileSync(sceneFile,path.join(__dirname,'scene.png'));
 for(const c of manifest.clips.filter(c=>!selected.length||selected.includes(c.id))){
  const dir=path.join(__dirname,c.id),report=JSON.parse(fs.readFileSync(path.join(dir,'report.json')));
  assert.equal(report.mattingSha256,manifest.mattingSha256,'review must use the tested algorithm revision');assert.equal(report.writes.length,c.frames);assert.equal(report.errors.length,0);
  const reviewDir=path.join(dir,'review');fs.mkdirSync(reviewDir,{recursive:true});
  const scene=await sharp(sceneFile).resize(c.width,c.height,{fit:'fill'}).png().toBuffer();
  const crop=crops[c.id]||[c.reviewCrop[0],c.reviewCrop[1],c.reviewCrop[2]-c.reviewCrop[0],c.reviewCrop[3]-c.reviewCrop[1]];
  const extract={left:crop[0],top:crop[1],width:crop[2],height:crop[3]};
  const tile=async input=>sharp(input).extract(extract).resize(600,570,{fit:'contain',background:'#fff'}).png().toBuffer();
  const stats=[];
  for(let n=0;n<c.frames;n++){
    const padded=String(n).padStart(4,'0'),match=report.maskMatches.find(f=>f.timelineIndex===n);assert(match);
    const data=await sharp(path.join(dir,'captured',`frame_${String(match.decodedFrameIndex).padStart(4,'0')}.png`)).ensureAlpha().raw().toBuffer();
    const mask=await sharp(path.join(c.maskDir,match.fileName)).ensureAlpha().extractChannel(3).resize(Math.round(c.width/2),Math.round(c.height/2)).raw().toBuffer();
    const before=m.exports.matte({width:c.width,height:c.height,data},{subjectMask:{width:Math.round(c.width/2),height:Math.round(c.height/2),data:mask},preserveShadow:true});
    const old=await sharp(before.data,{raw:{width:c.width,height:c.height,channels:4}}).png().toBuffer(),file=path.join(dir,'frames',`clean_${padded}.png`);
    const now=await sharp(file).ensureAlpha().raw().toBuffer();let changed=0,empty=0,soft=0;
    for(let p=0;p<before.alpha.length;p++){const i=p*4;if(now[i+3]!==before.alpha[p])changed++;if(!now[i+3])empty++;else if(now[i+3]<255)soft++;}
    stats.push({frame:n,sourceFrame:match.sourceIndex,changedAlphaPixels:changed,transparentPixels:empty,softPixels:soft});
    const panels=[];for(let row=0;row<2;row++)for(let col=0;col<2;col++){
      const input=col?file:old,bg=row?await sharp(scene).composite([{input}]).png().toBuffer():await sharp(input).flatten({background:'#fff'}).png().toBuffer();
      panels.push({input:label(`${col?'修复后 · 程序导出':'修复前 · 相同输入'} · ${row?'场景':'白底'}`),left:col*600,top:row*606},{input:await tile(bg),left:col*600,top:row*606+36});
    }
    const grid=await sharp({create:{width:1200,height:1212,channels:3,background:'#fff'}}).composite(panels).png().toBuffer();
    fs.writeFileSync(path.join(reviewDir,padded+'.png'),grid);
    if(n===(c.id==='gloweyes'?53:c.id==='athena'?0:34)){
      fs.writeFileSync(path.join(__dirname,c.id+'-compare.png'),grid);
      for(const bg of ['white','black','scene']){
        const picture=bg==='scene'?await sharp(scene).composite([{input:file}]).png().toBuffer():await sharp(file).flatten({background:bg==='white'?'#fff':'#000'}).png().toBuffer();
        await sharp(picture).extract(extract).png().toFile(path.join(__dirname,c.id+'-'+bg+'.png'));
      }
    }
  }
  const out=path.join(__dirname,c.id+'-compare.mp4'),r=cp.spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-framerate','24','-i',path.join(reviewDir,'%04d.png'),'-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',out],{windowsHide:true,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  fs.writeFileSync(path.join(dir,'review-metrics.json'),JSON.stringify(stats,null,2));
  summary.push({id:c.id,label:labelNames[c.id],frames:c.frames,width:c.width,height:c.height,review:c.id+'-compare.mp4',focus:c.id==='gloweyes'?53:0});console.log('REVIEW',c.id,c.frames);
 }
 fs.writeFileSync(path.join(__dirname,'review-summary.json'),JSON.stringify(summary,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
