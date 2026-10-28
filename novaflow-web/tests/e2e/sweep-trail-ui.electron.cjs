// Native sweep dialog + worker preview + real PNG imports; CPU only, no AI.
const { app, BrowserWindow }=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const renderer=path.resolve(process.env.NF_SWEEP_RENDERER||path.join(root,'renderer'));
const output=path.resolve(process.env.NF_SWEEP_OUTPUT||path.join(root,'../work/sweep-trail-20261028/ui'));
fs.mkdirSync(output,{recursive:true});app.disableHardwareAcceleration();app.setPath('userData',path.join(output,'profile'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const server=http.createServer((request,response)=>{
  const file=path.resolve(renderer,'.'+decodeURIComponent(new URL(request.url,'http://local').pathname));
  if(!file.startsWith(renderer+path.sep)||!fs.existsSync(file)){response.writeHead(404);return response.end();}
  response.setHeader('Content-Type',path.extname(file)==='.js'?'application/javascript':path.extname(file)==='.html'?'text/html; charset=utf-8':'application/octet-stream');fs.createReadStream(file).pipe(response);
});
app.whenReady().then(async()=>{
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const win=new BrowserWindow({show:false,width:1440,height:980,webPreferences:{backgroundThrottling:false}});
    const run=code=>win.webContents.executeJavaScript(code);
    async function until(code,message){for(let i=0;i<100;i++){if(await run(code))return;await pause(300);}throw Error(message);}
    await win.loadURL('http://127.0.0.1:'+server.address().port+'/spine-skeleton-editor.html');
    await until('!!window.__SkeletonLab && !!window.NovaFlowFxMakerUI','Editor not ready');
    await run(`NovaFlowSkeletonEditorAPI.newProject('扫光验证',{operation:'append'})`);
    await run(`__SkeletonLab.state.sweepParams={frames:4,pad:0};__SkeletonLab.state.sweepLast={effect:'edge-stardust'};__SkeletonLab.openSweepPanel(null)`);
    await until('!!window.__NovaFlowFxMakerOpen','Sweep dialog missing');
    const form=await run(`(() => {
      const api=__NovaFlowFxMakerOpen;api.state.playing=false;
      const name=document.querySelector('[data-resource-name]');name.value='星尘 拖尾-A';name.dispatchEvent(new Event('input'));
      const row=document.querySelector('[data-key="p.trail"]'),slider=row.querySelector('input[type="range"]');
      slider.value=.3;slider.dispatchEvent(new Event('input'));
      return {label:row.querySelector('label').textContent,min:slider.min,max:slider.max,detail:!!document.querySelector('[data-key="p.extra"]'),name:api.project.resourceName};
    })()`);
    assert.deepEqual(form,{label:'拖尾长度',min:'0',max:'5',detail:true,name:'星尘 拖尾-A'});
    const snapshot=async label=>{
      await until(`(() => {const s=__NovaFlowFxMakerOpen.previewStats();return s.frontVersion===s.version&&!s.waiting;})()`,'Preview not ready');
      await run(`document.querySelector('[data-scrub]').value=2;document.querySelector('[data-scrub]').dispatchEvent(new Event('input'))`);await pause(100);
      const state=await run(`(() => {const c=document.querySelector('[data-fxcanvas]'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let energy=0;for(let i=0;i<d.length;i+=4)energy+=d[i]+d[i+1]+d[i+2];return {energy,name:__NovaFlowFxMakerOpen.project.resourceName,trail:__NovaFlowFxMakerOpen.project.params.trail};})()`);
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await pause(350);
      fs.writeFileSync(path.join(output,label+'.png'),(await win.webContents.capturePage()).toPNG());return state;
    };
    const short=await snapshot('short-tail');
    await run(`const slider=document.querySelector('[data-key="p.trail"] input[type="range"]');slider.value=3;slider.dispatchEvent(new Event('input'));__NovaFlowFxMakerOpen.rerender()`);
    const long=await snapshot('long-tail');assert(long.energy>short.energy*1.15,'Preview tail length must change the image');
    for(let i=0;i<2;i++){
      if(i){await run('__SkeletonLab.openSweepPanel(null)');await until('!!document.querySelector("[data-act=generate]")','Second sweep dialog missing');}
      await run(`document.querySelector('[data-act="generate"]').click()`);
      await until('!document.querySelector(".fxm-overlay")','PNG generation did not finish');
      const names=await run('__SkeletonLab.state.sweepGen.names');
      const suffix=i?'_2':'';
      assert.equal(names.length,4);assert(names.every((name,index)=>name===`sweep/星尘 拖尾-A${suffix}/星尘 拖尾-A${suffix}_${String(index+1).padStart(2,'0')}`),'Generated folder and PNG names must match exactly');
      const sizes=await run(`__SkeletonLab.state.sweepGen.names.map(name=>{const region=__SkeletonLab.rt.atlas.findRegion(name);return [region.originalWidth,region.originalHeight]})`);
      assert(sizes.every(([w,h])=>w===640&&h===640));
    }
    const result={ok:true,form,short,long,generated:await run('__SkeletonLab.state.sweepGen.names'),animation:await run('NovaFlowSkeletonEditorAPI.json().animations')};
    assert.equal(Object.keys(result.animation.animation).length,0,'Generating resources must wait for explicit 写入动画');
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}finally{server.close();}
});
setTimeout(()=>app.exit(2),180000);
