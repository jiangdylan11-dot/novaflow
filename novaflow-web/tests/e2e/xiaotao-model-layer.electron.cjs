// Isolated Electron hit-testing of the real panel against the documented Foart layers.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'foart-model-layer-'));
  app.setPath('userData',path.join(dir,'profile'));await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith('file:')}));
  const base=path.resolve(__dirname,'../..'),js=await fs.readFile(path.join(base,'renderer/xiaotao-art-agent.js'),'utf8'),css=await fs.readFile(path.join(base,'renderer/xiaotao-art-agent.css'),'utf8');
  const html=path.join(dir,'fixture.html');
  await fs.writeFile(html,`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}.workspace{position:fixed;inset:0;z-index:2147483628;background:#333}.modal{position:fixed;inset:0;z-index:2147483640;background:#444}${css}</style><div class="workspace"></div><script>window.workspaceClicks=0;document.querySelector('.workspace').onclick=()=>workspaceClicks++;window.electronAPI={promptAssistantGetStatus:async()=>({ok:true,result:{features:{qwen35CpuTrial:true}}})};</script><script>${js}</script>`);
  const win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}}),run=code=>win.webContents.executeJavaScript(code);
  await win.loadFile(html);await run('NovaFlowXiaotaoArtAgent.panel.open();void 0');
  await run(`document.querySelector('.nf-xiaotao-model-trigger').focus()`);
  assert.match(await run(`document.querySelectorAll('.nf-xiaotao-model-group-label')[1].textContent`),/操作级最低 1 积分待上线/);
  await run(`(()=>{const c=NovaFlowXiaotaoArtAgent.panel.controller;c.state.pricingPolicy={version:'sha256:'+'a'.repeat(64),expiresAt:Date.now()+60000,config:{xiaotao_online:{minimum_positive_credits:1,billing_scope:'operation'}},models:[]};document.querySelector('.nf-xiaotao-model-trigger').dispatchEvent(new FocusEvent('focus'))})()`);
  assert.match(await run(`document.querySelectorAll('.nf-xiaotao-model-group-label')[1].textContent`),/正费用每次操作最低 1 积分/);
  assert.match(await run(`document.querySelector('[data-model-id="qwen3.5-9b-heretic"]').textContent`),/本地·免费/);
  const position=async(x,y)=>run(`(()=>{let p=document.querySelector('.nf-xiaotao-panel');Object.assign(p.style,{position:'fixed',left:${x}+'px',top:${y}+'px',right:'auto',bottom:'auto',transform:''})})()`);
  const hit=()=>run(`(()=>{let s=document.querySelector('.nf-xiaotao-model-trigger'),r=s.getBoundingClientRect(),e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {inside:s===e||s.contains(e),hit:e?.className,x:r.left+r.width/2,y:r.top+r.height/2,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},viewport:{width:innerWidth,height:innerHeight}}})()`);
  const key=code=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:code});win.webContents.sendInputEvent({type:'keyUp',keyCode:code});};
  await position(280,40);let h=await hit();assert.equal(h.inside,true,'workspace must not cover the model selector: '+JSON.stringify(h));
  for(const zoom of [0.8,1,1.25]){win.webContents.setZoomFactor(zoom);await new Promise(r=>setTimeout(r,40));
    const dims=await run(`(()=>{let p=document.querySelector('.nf-xiaotao-panel').getBoundingClientRect();return {w:p.width,h:p.height,vw:innerWidth,vh:innerHeight}})()`);
    for(const [x,y] of [[0,0],[Math.max(0,dims.vw-dims.w),0],[0,Math.max(0,dims.vh-dims.h)],[Math.max(0,dims.vw-dims.w),Math.max(0,dims.vh-dims.h)]]){
      await position(x,y);h=await hit();assert(h.inside&&h.rect.left>=0&&h.rect.right<=h.viewport.width+1&&h.rect.top>=0&&h.rect.bottom<=h.viewport.height+1,JSON.stringify({zoom,h}));
      await run(`document.querySelector('.nf-xiaotao-model-trigger').focus()`);key('Space');await new Promise(r=>setTimeout(r,50));
      const options=await run(`(()=>{const p=document.querySelector('.nf-xiaotao-model-popup');return {hidden:p.hidden,rows:[...p.querySelectorAll('[data-model-id]')].map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {inside:hit===e||e.contains(hit),left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}})}})()`);
      assert(!options.hidden&&options.rows.length===4&&options.rows.every(o=>o.inside&&o.left>=0&&o.right<=o.w+1&&o.top>=0&&o.bottom<=o.h+1),JSON.stringify({zoom,options}));key('Escape');
    }
  }
  win.webContents.setZoomFactor(1);await position(280,40);await run(`document.querySelector('.nf-xiaotao-model-trigger').focus()`);
  for(let i=0;i<2;i++){key('Space');key('Escape');}
  assert.equal(await run(`document.querySelector('.nf-xiaotao-model-select').value`),'qwen3.5-9b-heretic');
  // DOM listbox keyboard selection must update only the selected model.
  key('Space');key('Down');key('Enter');
  await new Promise(r=>setTimeout(r,50));
  const chosen=await run(`(()=>({value:document.querySelector('.nf-xiaotao-model-select').value,model:NovaFlowXiaotaoArtAgent.panel.controller.state.modelId,clicks:workspaceClicks}))()`);
  assert.notEqual(chosen.model,'qwen3.5-9b-heretic',JSON.stringify(chosen));assert.equal(chosen.model,chosen.value);assert.equal(chosen.clicks,0);
  const header=await run(`(()=>{let r=document.querySelector('.nf-xiaotao-title strong').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  const before=await run(`document.querySelector('.nf-xiaotao-panel').getBoundingClientRect().left`);
  win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(header.x),y:Math.round(header.y)});
  win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(header.x),y:Math.round(header.y),button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(header.x+60),y:Math.round(header.y+20),button:'left'});
  win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(header.x+60),y:Math.round(header.y+20),button:'left',clickCount:1});
  await new Promise(r=>setTimeout(r,50));const after=await run(`document.querySelector('.nf-xiaotao-panel').getBoundingClientRect().left`);
  assert(after>before+20,JSON.stringify({before,after}));assert.equal(await run('workspaceClicks'),0);
  // The DOM picker consumes its outside dismissal click instead of activating
  // the workspace underneath; a subsequent explicit click can reach it.
  h=await hit();win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(h.x),y:Math.round(h.y),button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(h.x),y:Math.round(h.y),button:'left',clickCount:1});
  await new Promise(r=>setTimeout(r,150));
  console.log('picker state',JSON.stringify(await run(`(()=>{const s=document.querySelector('.nf-xiaotao-model-trigger');return {open:s.getAttribute('aria-expanded'),focused:document.activeElement===s}})()`)));
  assert.equal(await run(`document.querySelector('.nf-xiaotao-model-trigger').getAttribute('aria-expanded')`),'true');
  await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await new Promise(r=>setTimeout(r,200));
  await fs.writeFile(path.join(dir,'picker.png'),(await win.capturePage()).toPNG());console.log('picker image',path.join(dir,'picker.png'));
  win.webContents.sendInputEvent({type:'mouseDown',x:10,y:10,button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'mouseUp',x:10,y:10,button:'left',clickCount:1});
  await new Promise(r=>setTimeout(r,50));assert.equal(await run('workspaceClicks'),0,'outside dismissal must not activate workspace');
  win.webContents.sendInputEvent({type:'mouseDown',x:10,y:10,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:10,y:10,button:'left',clickCount:1});
  await new Promise(r=>setTimeout(r,50));assert.equal(await run('workspaceClicks'),1,'workspace should work after dismissal');
  await run(`(()=>{let m=document.createElement('div');m.className='modal';document.body.append(m)})()`);
  const modalTop=await run(`(()=>{let s=document.querySelector('.nf-xiaotao-model-trigger'),r=s.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.className})()`);
  assert.equal(modalTop,'modal','modal must remain above the assistant');
  console.log('PASS: workspace hit test, viewport edges/zoom, keyboard selection/Escape, outside dismissal, panel drag and modal priority');win.destroy();app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});
setTimeout(()=>app.exit(2),30000).unref();
