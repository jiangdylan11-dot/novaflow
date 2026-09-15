const fs=require('fs'),path=require('path'),{app,BrowserWindow}=require('electron');
app.setPath('userData',path.join(__dirname,'gallery-test-profile'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1280,height:1250,webPreferences:{offscreen:true,backgroundThrottling:false}});
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  await win.loadFile(path.join(__dirname,'index.html'));
  const report=await win.webContents.executeJavaScript(`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async(f,label)=>{for(let i=0;i<400;i++){if(f())return;await sleep(25);}throw Error('gallery timeout: '+label);};
    const v=document.getElementById('video'),c=document.getElementById('canvas'),videos=[];
    for(const [id,n] of [['gloweyes',121],['athena',117],['blue',73],['minimax',73],['scatter',73]]){
      document.querySelector('[data-clip="'+id+'"]').click();
      await wait(()=>v.readyState>=2&&v.currentSrc.endsWith(id+'-compare.mp4'),'video '+id);
      if(Math.abs(v.duration-n/24)>.06||v.videoWidth!==1200||v.videoHeight!==1212)throw Error('video dimensions/duration '+id);
      videos.push({id,duration:v.duration,width:v.videoWidth,height:v.videoHeight});
    }
    document.querySelector('[data-clip="gloweyes"]').click();
    document.querySelector('[data-mode="png"]').click();
    await wait(()=>c.dataset.frame==='53'&&c.dataset.background==='scene','initial PNG');
    for(const bg of ['black','white','checker','scene']){
      document.querySelector('[data-bg="'+bg+'"]').click();await wait(()=>c.dataset.background===bg,'background '+bg);
    }
    document.getElementById('next').click();await wait(()=>c.dataset.frame==='54','next');
    document.getElementById('prev').click();await wait(()=>c.dataset.frame==='53','previous');
    document.getElementById('focus').click();await wait(()=>c.width===1080&&c.height===1920,'full PNG');
    document.getElementById('focus').click();await wait(()=>c.width===1020&&c.height===870,'subject crop');
    return{videos,png:{width:c.width,height:c.height,frame:c.dataset.frame,background:c.dataset.background}};
  })()`);
  report.errors=errors;if(errors.length)throw Error(JSON.stringify(errors));
  fs.writeFileSync(path.join(__dirname,'gallery-test.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(__dirname,'gallery-screenshot.png'),(await win.webContents.capturePage()).toPNG());
  win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
