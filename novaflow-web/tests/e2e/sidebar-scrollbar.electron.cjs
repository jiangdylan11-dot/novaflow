// Actual renderer navigation, expanded panels and scrollbar hit testing.
// No inference or generation requests are submitted.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const renderer=path.resolve(process.env.NF_SCROLL_RENDERER||path.join(__dirname,'../../renderer'));
const output=path.resolve(process.env.NF_SCROLL_OUTPUT||path.join(__dirname,'../../../work/sidebar-scroll-20261028/acceptance'));
fs.mkdirSync(output,{recursive:true});app.disableHardwareAcceleration();app.setPath('userData',path.join(output,'profile'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer((request,response)=>{
 const file=path.resolve(renderer,'.'+decodeURIComponent(new URL(request.url,'http://local').pathname));
 if(!file.startsWith(renderer+path.sep)||!fs.existsSync(file)){response.writeHead(404);return response.end();}
 response.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(response);
});
app.whenReady().then(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const win=new BrowserWindow({show:false,width:1480,height:950,webPreferences:{backgroundThrottling:false}}),origin='http://127.0.0.1:'+server.address().port;
 // The real icon font is a static CDN dependency of index.html. Allow it so
 // screenshots reflect the product instead of showing missing-font squares.
 win.webContents.session.webRequest.onBeforeRequest((request,done)=>done({cancel:/^https?:/.test(request.url)&&!request.url.startsWith(origin+'/')&&!request.url.startsWith('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/')}));
 const run=code=>win.webContents.executeJavaScript(code);
 await win.loadURL(origin+'/index.html');await pause(2500);
 const results=[];
 for(const [width,height]of [[1480,950],[1100,740],[900,650]]){
  win.setSize(width,height);await win.loadURL(origin+'/index.html');await pause(2500);
  for(const name of ['动画','美工','音视','特效']){
   const clicked=await run(`(()=>{const b=[...document.querySelectorAll('[data-novaflow-primary-entry],[data-novaflow-audio-entry]')].find(b=>{if(!(b.dataset.novaflowPrimaryLabel===${JSON.stringify(name)}||b.getAttribute('aria-label')===${JSON.stringify(name)}||b.textContent.trim()===${JSON.stringify(name)}))return false;const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
   assert(clicked,name+' navigation');
   win.webContents.sendInputEvent({type:'mouseDown',...clicked,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...clicked,button:'left',clickCount:1});await pause(700);
   await run(`(()=>{const root=document.querySelector('[data-novaflow-left-content-root="1"]');if(!root)return;
    if(${JSON.stringify(name)}==='美工')for(const label of ['编辑','拆图']){const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===label);if(b&&b.closest('.nf-panel')?.getAttribute('data-open')!=='1')b.click();}
    if(${JSON.stringify(name)}==='音视'){const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='视频编辑');if(b)b.click();}
    if(${JSON.stringify(name)}==='特效')document.querySelectorAll('#novaflow-aifx-mvp [data-section-toggle]').forEach(b=>{if(b.getAttribute('aria-expanded')==='false')b.click();});
   })()`);await pause(1100);
   const read=`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
    const root=${JSON.stringify(name)}==='特效'?document.querySelector('#novaflow-aifx-mvp .aifx-side'):document.querySelector('[data-novaflow-left-content-root="1"]');
    if(!root)throw Error('Missing scroll viewport');
    const shell=document.querySelector('[data-novaflow-left-content-shell="1"]'),r=rect(root),p=rect(shell),style=getComputedStyle(root);
    const fields=[...root.querySelectorAll('button,input,textarea,select')].filter(e=>{const b=e.getBoundingClientRect();return b.width&&b.height&&b.y>=r.y&&b.bottom<=r.bottom}).map(e=>({label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,20),...rect(e)}));
    const track=document.elementFromPoint(r.right-3,r.y+Math.min(80,r.h/2)),outside=document.elementFromPoint(p.right+3,r.y+Math.min(80,r.h/2));
    const main=document.querySelector('#novaflow-aifx-mvp .aifx-main');const fxStyle=main?{background:getComputedStyle(main,'::before').backgroundImage,perspective:getComputedStyle(main,'::after').display}:null;
    return {root:r,shell:p,clientWidth:root.clientWidth,clientHeight:root.clientHeight,scrollHeight:root.scrollHeight,scrollTop:root.scrollTop,gutter:root.offsetWidth-root.clientWidth,fields,fxStyle,trackOwner:track&&{tag:track.tagName,id:track.id,className:track.className},trackHitsSidebar:root.contains(track),outsideHitsSidebar:root.contains(outside),scrollbarWidth:style.scrollbarWidth,scrollbarColor:style.scrollbarColor};})()`;
   const state=await run(read);fs.writeFileSync(path.join(output,'current.json'),JSON.stringify({width,height,name,...state},null,2));
   assert(state.root.right<=state.shell.right+.5,name+': scrollbar crosses into the workspace');
   assert(state.gutter>=0&&state.gutter<=11,name+': scrollbar keeps the reference thin style');
   assert(state.fields.every(f=>f.right<=state.root.right-state.gutter+.5),name+': scrollbar overlaps a field');
   assert(!state.outsideHitsSidebar,name+': sidebar captures pointer input in the workspace');
   if(name==='特效'){assert.equal(state.fxStyle.perspective,'none','FX perspective floor must stay hidden');assert(state.fxStyle.background.includes('radial-gradient'),'FX keeps its dot field');}
   if(name!=='特效'&&!state.trackHitsSidebar){fs.writeFileSync(path.join(output,'covered.png'),(await win.webContents.capturePage()).toPNG());assert.fail(name+': scrollbar is clipped or covered by '+JSON.stringify(state.trackOwner));}
   const target=name==='特效'?'#novaflow-aifx-mvp .aifx-side':'[data-novaflow-left-content-root="1"]';
   if(state.scrollHeight>state.clientHeight+1){
    win.webContents.sendInputEvent({type:'mouseWheel',x:Math.round(state.root.x+35),y:Math.round(state.root.y+state.root.h/2),deltaX:0,deltaY:160,canScroll:true});await pause(200);
    await run(`document.querySelector(${JSON.stringify(target)}).scrollTop=100000`);await pause(150);
    const bottom=await run(read);fs.writeFileSync(path.join(output,'scroll.json'),JSON.stringify({name,width,...bottom},null,2));
    if(bottom.scrollHeight>bottom.clientHeight+1){
     assert(bottom.scrollTop>0,name+': expanded panel must remain scrollable');
     assert(bottom.scrollTop+bottom.clientHeight>=bottom.scrollHeight-2,name+': bottom of panel is unreachable');
    }
   }
   await run(`document.querySelector(${JSON.stringify(target)}).scrollTop=0`);
   await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await pause(150);
   fs.writeFileSync(path.join(output,width+'-'+name+'.png'),(await win.webContents.capturePage()).toPNG());
   results.push({width,height,name,...state});fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(results,null,2));
   console.log(width,height,name,'gutter:',state.gutter,'workspace hit test: passed');
  }
 }
 app.exit(0);
}catch(e){console.error(e);app.exit(1)}finally{server.close()}});setTimeout(()=>app.exit(2),120000);
