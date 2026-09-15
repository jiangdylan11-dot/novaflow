const fs=require('fs'),path=require('path'),sharp=require('../../particle-editor-desktop/node_modules/sharp');
(async()=>{
  for(const [id,frames,top,height] of [['athena',[0,23,46,69,92,116],940,850],['gloweyes',[0,24,48,72,96,120],880,870]]){
    const scene=await sharp(path.join(__dirname,'scene.png')).resize(1080,1920,{fit:'fill'}).png().toBuffer(),parts=[];
    for(let i=0;i<frames.length;i++){
      const n=frames[i],picture=await sharp(scene).composite([{input:path.join(__dirname,id,'frames',`clean_${String(n).padStart(4,'0')}.png`)}]).png().toBuffer();
      const crop=await sharp(picture).extract({left:60,top,width:1020,height}).resize(500,430,{fit:'contain',background:'#242931'}).png().toBuffer();
      const label=Buffer.from(`<svg width="500" height="30"><rect width="500" height="30" fill="#242931"/><text x="12" y="22" fill="white" font-size="18">${id} / frame ${n+1}</text></svg>`);
      parts.push({input:label,left:i%3*500,top:Math.floor(i/3)*460},{input:crop,left:i%3*500,top:Math.floor(i/3)*460+30});
    }
    await sharp({create:{width:1500,height:920,channels:3,background:'#242931'}}).composite(parts).png().toFile(path.join(__dirname,id+'-contact.png'));
  }
})().catch(e=>{console.error(e);process.exit(1)});
