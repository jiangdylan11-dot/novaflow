const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{app,BrowserWindow}=require('electron'),sharp=require('sharp');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'logs/cutout-prerender-20260914/worker-parity');
app.setPath('userData',path.join(out,'profile'));
app.whenReady().then(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const fixture=path.join(root,'docs/cutout-blade-glow-final-20260914/athena/backend/job-qt9Nlz');
 const inputs=[];
 for(const index of [0,58,116]){
  const name='f_'+String(index).padStart(6,'0')+'.png';
  const {data,info}=await sharp(path.join(fixture,'frames_in',name)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const mask=await sharp(path.join(fixture,'frames_out',name)).ensureAlpha().extractChannel(3).raw().toBuffer();
  inputs.push({index,width:info.width,height:info.height,pixels:data.toString('base64'),mask:mask.toString('base64')});
 }
 const html=path.join(out,'test.html');fs.writeFileSync(html,'<!doctype html><html><head></head><body></body></html>');
 const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});await win.loadFile(html);
 const load=async file=>win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=${JSON.stringify(pathToFileURL(file).href)};s.onload=()=>resolve(true);s.onerror=()=>reject(Error("script load failed"));document.head.append(s)})`);
 await load(path.join(root,'logs/cutout-prerender-20260914/baseline/ai-sequence-green-screen-matting.js'));
 await win.webContents.executeJavaScript('window.baselineMatting=window.NovaFlowGreenScreenMatting;true');
 await load(path.join(root,'particle-editor/ai-sequence-green-screen-matting.js'));
 const report=await win.webContents.executeJavaScript(`(async()=>{
  const decode=s=>Uint8ClampedArray.from(atob(s),c=>c.charCodeAt(0));
  const inputs=${JSON.stringify(inputs)}.map(f=>({...f,data:decode(f.pixels),alpha:decode(f.mask)}));
  const frames=new Map(inputs.map(f=>[f.index,{frame:{data:f.data,width:f.width,height:f.height}}])),masks=new Map(inputs.map(f=>[f.index,f.alpha]));
  const sequence={frames,masks,maskWidth:inputs[0].width,maskHeight:inputs[0].height};
  const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
  const options=(f,shadow,edit)=>({enabled:true,preserveShadow:shadow,subjectMask:{data:f.alpha,width:f.width,height:f.height},requireSubjectMask:true,sequence,maskCanvas:canvas(f.width,f.height),rgbaCanvas:canvas(f.width,f.height),frameEdit:edit});
  const pixels=r=>r.rgbaCanvas.getContext('2d').getImageData(0,0,r.rgbaCanvas.width,r.rgbaCanvas.height).data;
  const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const checks=[];
  for(const shadow of [true,false]){
    const expected=inputs.map(f=>baselineMatting.render(f,options(f,shadow)));
    const results=await Promise.all(inputs.map(f=>NovaFlowGreenScreenMatting.renderAsync(f,options(f,shadow))));
    for(let i=0;i<inputs.length;i++){
      const same=equal(pixels(expected[i]),pixels(results[i]))&&equal(expected[i].finalAlpha,results[i].finalAlpha);
      if(!same)throw Error('Worker pixels differ, frame '+inputs[i].index+' shadow '+shadow);
      if(!equal(inputs[i].data,decode(inputs[i].pixels)))throw Error('Worker detached or changed source pixels');
      checks.push({frame:inputs[i].index,preserveShadow:shadow,pixelIdentical:same});
    }
  }
  const f=inputs[1],edit=canvas(f.width,f.height),c=edit.getContext('2d');c.fillStyle='rgba(0,0,0,.5)';c.fillRect(300,850,300,500);c.fillStyle='white';c.fillRect(400,900,80,80);
  const expected=baselineMatting.render(f,options(f,false,edit)),actual=await NovaFlowGreenScreenMatting.renderAsync(f,options(f,false,edit));
  if(!equal(pixels(expected),pixels(actual))||!equal(expected.finalAlpha,actual.finalAlpha))throw Error('Manual edit differs');
  return {checks,manualEditsIdentical:true,workerStats:NovaFlowGreenScreenMatting.workerStats()};
 })()`);
 assert.equal(report.workerStats.failed,0);assert.equal(report.workerStats.completed,7);assert.ok(report.workerStats.maxActive>=2&&report.workerStats.maxActive<=4);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
