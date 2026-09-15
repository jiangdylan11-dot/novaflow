// Validate and package the real renderer exports for the supplied black-screen clip.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp'));
const ffmpeg=require(path.join(root,'particle-editor-desktop/node_modules/ffmpeg-static'));
const input=process.argv[2],frames=path.resolve(process.argv[3]),out=path.resolve(process.argv[4]);
const run=args=>{const r=cp.spawnSync(ffmpeg,['-v','error','-y',...args],{windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error(r.stderr);};
(async()=>{
  fs.mkdirSync(out,{recursive:true});const sequence=path.join(out,'PNG序列'),previews=path.join(root,'logs/multiscreen-preview-frames');
  fs.mkdirSync(sequence,{recursive:true});fs.mkdirSync(previews,{recursive:true});
  const names=fs.readdirSync(frames).filter(n=>/^clean_\d{4}\.png$/.test(n)).sort();
  if(names.length!==122)throw Error('Expected all 122 renderer-exported frames');
  const perFrame=[];
  for(let n=0;n<names.length;n++){
    const source=path.join(frames,names[n]),dest=path.join(sequence,names[n]);fs.copyFileSync(source,dest);
    const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let visible=0,soft=0,corner=0;for(let i=3;i<data.length;i+=4){if(data[i])visible++;if(data[i]>0&&data[i]<255)soft++;}
    for(let y=0;y<100;y++)for(let x=0;x<100;x++)corner=Math.max(corner,data[(y*info.width+x)*4+3]);
    if(!visible||!soft||corner!==0)throw Error('Invalid alpha at frame '+n);
    const bodyAlpha=data[(1300*info.width+360)*4+3];
    perFrame.push({frame:n,visible,soft,corner,bodyAlpha});
    const panels=[];
    for(const bg of ['#919191','#ffffff'])panels.push({input:await sharp(source).flatten({background:bg}).extract({left:170,top:1100,width:480,height:500}).png().toBuffer(),left:panels.length*480,top:0});
    await sharp({create:{width:960,height:500,channels:3,background:'#919191'}}).composite(panels).png().toFile(path.join(previews,`frame_${String(n).padStart(4,'0')}.png`));
  }
  const frameInput=['-framerate','24','-start_number','0','-i',path.join(sequence,'clean_%04d.png'),'-i',input,'-map','0:v:0','-map','1:a:0?','-t',String(122/24)];
  run([...frameInput,'-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','16','-c:a','aac',path.join(out,'clean-alpha.mov')]);
  run(['-framerate','24','-start_number','0','-i',path.join(previews,'frame_%04d.png'),'-i',input,'-map','0:v:0','-map','1:a:0?','-t',String(122/24),'-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',path.join(out,'灰底-白底预览.mp4')]);
  for(const n of [0,48,96])fs.copyFileSync(path.join(previews,`frame_${String(n).padStart(4,'0')}.png`),path.join(out,`对比-${n}.png`));
  const report={frames:122,fps:24,width:980,height:2116,method:'actual React AI cutout with real local RMBG-2.0 masks replayed through binary IPC, including half-size mask resampling',perFrame};
  fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(out,'验收说明.txt'),'黑底石头精灵样片，共 122 帧。\r\nPNG 序列由真实 NovaFlow AI 抠图组件导出，遮罩使用本机 RMBG-2.0 的实际结果，并通过二进制 IPC 回放。\r\n预览左灰底、右白底；预览视频本身不透明。MOV 为 ProRes 4444，包含 Alpha。\r\n程序中启用“光效透明保留”，含角色的黑底或白底素材请使用 AI 抠图；色键模式适合纯光效。\r\n白底与蓝底另有合成测试，尚未拿到这两类真实原视频。白底上已与背景融成纯白的光无法凭空恢复。\r\n');
  console.log(JSON.stringify({out,frames:122,minBodyAlpha:Math.min(...perFrame.map(f=>f.bodyAlpha)),maxCornerAlpha:Math.max(...perFrame.map(f=>f.corner))}));
})().catch(e=>{console.error(e);process.exit(1);});
