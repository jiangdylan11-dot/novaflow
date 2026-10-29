const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.env.FOART_APPEARANCE_OUTPUT||path.join(root,'../work/control-appearance'));
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
app.commandLine.appendSwitch('force-device-scale-factor','1');
let server;
const inventories=[];
async function auditButtons(win,name){
 const result=await win.webContents.executeJavaScript(`(()=>{const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(n=>window.FoartButtonTheme?.isButton(n)&&n.getBoundingClientRect().width&&n.getBoundingClientRect().height);return {name:${JSON.stringify(name)},notes:[...document.querySelectorAll('[data-novaflow-left-content-root] div,[data-novaflow-left-content-root] p')].filter(n=>n.getBoundingClientRect().height&&!n.children.length&&n.textContent.trim().length>20).map(n=>({text:n.textContent,tag:n.tagName,cls:n.className})),buttons:buttons.map(n=>{const s=getComputedStyle(n);return {text:n.innerText.slice(0,45),id:n.id,attrs:[...n.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]),bg:s.backgroundColor,border:s.borderTopWidth,opacity:s.opacity,image:s.backgroundImage}})}})()`);
 inventories.push(result);
 await fs.writeFile(path.join(out,'button-inventory.json'),JSON.stringify(inventories,null,2));
 const bad=result.buttons.filter(b=>b.border!=='0px');
 assert.deepEqual(bad,[],name+' buttons must be borderless');
}

const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(win,code){await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const timer=setInterval(()=>{if(${code}){clearInterval(timer);resolve()}else if(Date.now()>end){clearInterval(timer);reject(Error('UI timeout'))}},80)})`)}
async function main(){
 await fs.mkdir(out,{recursive:true});
 await app.whenReady();
 const state={version:JSON.parse(await fs.readFile(path.join(root,'worker/package.json'),'utf8')).version,status:'offline',registration:{status:'new'},localRunning:false,sharing:false,hardware:{},gpu:{detected:false}};
 const workerRoot=process.env.FOART_WORKER_ROOT||path.join(root,'worker');
 for(const name of new Set([...await fs.readFile(path.join(workerRoot,'electron/preload.cjs'),'utf8').then(s=>s.matchAll(/ipcRenderer\.invoke\('([^']+)'/g))].map(m=>m[1])))ipcMain.handle(name,()=>name==='worker:getState'?state:name==='worker:getConfig'?{controlUrl:'https://fixture.invalid'}:name==='worker:getLogs'?[]:{ok:true,state:{status:'licensed',locked:false}});
 const worker=new BrowserWindow({show:false,width:760,height:800,webPreferences:{preload:path.join(workerRoot,'electron/preload.cjs'),offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
 await worker.loadFile(path.join(workerRoot,'electron/ui.html'));
 await wait(worker,`document.querySelector('.titlebar img')?.complete && document.querySelector('.titlebar img').naturalWidth>0`);
 const wm=await worker.webContents.executeJavaScript(`({title:document.title,text:document.body.innerText,logo:document.querySelector('.titlebar img').getAttribute('src')})`);
 assert.equal(wm.title,'Foart');assert(wm.text.includes('启动Foart'));assert(!wm.text.includes('NovaFlow'));assert(wm.logo.includes('foart-logo-dark'));
 await auditButtons(worker,'worker');await fs.writeFile(path.join(out,'worker-ui.png'),(await worker.webContents.capturePage()).toPNG());worker.destroy();
 const adminRoot=process.env.FOART_ADMIN_ROOT||path.join(root,'admin');
 for(const name of new Set([...await fs.readFile(path.join(adminRoot,'license-admin-gui/preload.js'),'utf8').then(s=>s.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g))].map(m=>m[1])))ipcMain.handle(name,()=>name==='admin-default-paths'?{}:{ok:true,config:{},status:{},result:{status:'ok',records:[]}});
 const admin=new BrowserWindow({show:false,width:1440,height:880,webPreferences:{preload:path.join(adminRoot,'license-admin-gui/preload.js'),offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
 await admin.loadFile(path.join(adminRoot,'license-admin-gui/index.html'));
 await wait(admin,`document.querySelector('.brandLogo')?.complete && document.querySelector('.brandLogo').naturalWidth>0 && document.querySelector('.brandMark').naturalWidth>0`);
 const am=await admin.webContents.executeJavaScript(`({title:document.title,text:document.body.innerText,logo:document.querySelector('.brandLogo').getBoundingClientRect().width})`);
 assert.equal(am.title,'Foart 后台管理');assert(!am.text.includes('NovaFlow'));assert(am.logo>0);
 await auditButtons(admin,'admin');await fs.writeFile(path.join(out,'admin-ui.png'),(await admin.webContents.capturePage()).toPNG());admin.destroy();
 const webRoot=process.env.FOART_WEB_ROOT||path.join(root,'web-dist');
 const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
 server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;const file=path.resolve(webRoot,'.'+(p==='/'?'/index.html':p));if(!file.startsWith(webRoot+path.sep))return res.writeHead(403).end();let bytes=await fs.readFile(file);
if(path.basename(file)==='novaflow-brand-runtime.js'){
 let src=bytes.toString(),i=src.indexOf('className:"novaflow-art-export-action"');
 if(i>=0){const match=[...src.slice(0,i).matchAll(/function (\w+)\(\)\{/g)].pop();if(match)src=src.slice(0,match.index)+'window.__appearanceOpenArtExport='+match[1]+';'+src.slice(match.index);bytes=Buffer.from(src);}
}
if(path.basename(file)==='video-frame-edit.tool.js'){
 let src=bytes.toString();
 const literal=[...src.matchAll(/\.textContent\s*=\s*(`(?:\\.|[^`])*`)/g)].find(m=>m[1].includes('.nf-vfe-apply'));
 if(literal&&literal[1].includes('.nf-vfe-apply')){
   const bindings={};for(const match of src.matchAll(/(?:const\s+|,)\s*(\w+)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)){try{bindings[match[1]]=new Function('return '+match[2])()}catch{}}
   const css=new Function(...Object.keys(bindings),'return '+literal[1])(...Object.values(bindings));
   src+=';window.__appearanceFrameStyle=function(){const n=document.createElement("style");n.textContent='+JSON.stringify(css)+';document.head.appendChild(n)};';
 }
const m=src.match(/function (\w+)\(\)\{if\(!?document\.getElementById/);if(m)src=src.replace(m[0],'window.__appearanceFrameStyle='+m[1]+';'+m[0]);bytes=Buffer.from(src);
}
if(path.basename(file)==='novaflow-brand-runtime.js')bytes=Buffer.from(bytes.toString().replace('function openNovaflowArtExportModal() {','window.__appearanceOpenArtExport = openNovaflowArtExportModal; function openNovaflowArtExportModal() {'));if(path.basename(file)==='video-frame-edit.tool.js')bytes=Buffer.from(bytes.toString().replace('function installStyle() {','window.__appearanceFrameStyle=installStyle; function installStyle() {'));res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const isolated=session.fromPartition('foart-brand-verification');isolated.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)&&!d.url.startsWith(base)&&!d.url.startsWith('https://cdnjs.cloudflare.com/')}));
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{session:isolated,offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=2)console.error('main:',message)});await win.loadURL(base+'/');await wait(win,`document.querySelector('.nf-login-logo')?.complete && document.querySelector('.nf-login-logo').naturalWidth>0 && !document.getElementById('novaflow-boot-splash')`);
 assert.equal(await win.webContents.executeJavaScript('document.title'),'Foart');
 await fs.writeFile(path.join(out,'login-ui.png'),(await win.webContents.capturePage()).toPNG());
 await win.webContents.executeJavaScript(`(async()=>{const who={authenticated:true,user:{display_name:'品牌验收'},credits:{balance:100}};electronAPI.clientAuthStatus=async()=>({ok:true,result:who});electronAPI.clientAuthAccountDetails=async()=>({ok:true,result:who});await NovaFlowWebAccount.guard();await NovaFlowWebAccount.refresh()})()`);
 await wait(win,`document.querySelector('.nf-brand img')?.complete && document.querySelector('.nf-brand img').naturalWidth>0 && !document.getElementById('novaflow-web-login-gate')`);
 await delay(700);
 await wait(win,`!document.getElementById('novaflow-boot-splash')`);
 const em=await win.webContents.executeJavaScript(`(()=>{const image=document.querySelector('.nf-brand img'),r=image.getBoundingClientRect(),v=document.querySelector('.nf-brand-version').getBoundingClientRect();return {title:document.title,logo:image.getAttribute('src'),rect:JSON.parse(JSON.stringify(r)),versionGap:v.left-r.right,oldVisible:document.body.innerText.includes('NovaFlow')}})()`);
 assert(em.logo.includes('foart-logo-dark'));assert.equal(em.oldVisible,false);assert(em.rect.height>=25&&em.rect.width>=70);
 assert(em.rect.x>=0 && em.rect.x<=18, 'logo must sit close to the left rail');
 assert(em.versionGap>=0 && em.versionGap<=12, 'version must sit close to the logo');
 const transparent=await win.webContents.executeJavaScript(`(()=>{const selectors=['[data-novaflow-primary-entry="1"][data-novaflow-primary-active="0"]','.nf-panel-header','.nf-brand-version'];return selectors.map(selector=>({selector,items:[...document.querySelectorAll(selector)].filter(n=>n.getBoundingClientRect().width).map(n=>({text:n.innerText,bg:getComputedStyle(n).backgroundColor}))}))})()`);
 await fs.writeFile(path.join(out,'transparent-controls.json'),JSON.stringify(transparent,null,2));
 for(const group of transparent)for(const item of group.items)assert.equal(item.bg,'rgba(0, 0, 0, 0)',group.selector+' must keep its original transparent fill');

 const separator=await win.webContents.executeJavaScript(`(()=>{const s=getComputedStyle(document.querySelector('.nf-brand-version'),'::before');return {width:s.width,height:s.height,content:s.content,opacity:s.opacity}})()`);
 assert.equal(separator.width,'1px');assert.equal(separator.height,'16px');assert.equal(separator.opacity,'1');
 const meshHeader=await win.webContents.executeJavaScript(`(()=>{const h=document.querySelector('[data-novaflow-auto-mesh-panel="1"] .nf-panel-header');h?.click();return !!h})()`);
 assert(meshHeader,'mesh panel header');await delay(300);
 const mesh=await win.webContents.executeJavaScript(`(()=>{const root=document.querySelector('[data-novaflow-auto-mesh-panel="1"]');return [...root.querySelectorAll('[data-foart-action]')].map(n=>({text:n.textContent,bg:getComputedStyle(n).backgroundColor,border:getComputedStyle(n).borderTopWidth}))})()`);
 await fs.writeFile(path.join(out,'mesh-appearance.json'),JSON.stringify(mesh,null,2));
 assert.equal(mesh.find(n=>n.text==='自动蒙皮')?.bg,'rgba(30, 166, 114, 0.24)');
 assert.equal(mesh.find(n=>n.text==='还原初始图层')?.bg,'rgb(39, 39, 39)');
 const placeholders=await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-novaflow-spine-inline-import-status]')].map(n=>getComputedStyle(n).fontSize)`);
 assert.equal(placeholders.length,3);assert(placeholders.every(s=>s==='11px'));
 await auditButtons(win,'animation');
 await fs.writeFile(path.join(out,'editor-ui.png'),(await win.webContents.capturePage()).toPNG());
 for(const label of ['特效','音视','美工','工具']){
   const clicked=await win.webContents.executeJavaScript(`(()=>{const n=${JSON.stringify(label)}==='音视'?document.querySelector('[data-novaflow-audio-entry="1"]'):[...document.querySelectorAll('[data-novaflow-primary-entry="1"], [data-novaflow-audio-entry="1"]')].find(n=>n.innerText.trim()===${JSON.stringify(label)});if(!n)return false;n.click();return true})()`);
   if(!clicked)continue;await delay(900);await auditButtons(win,label);
   const sep=await win.webContents.executeJavaScript(`(()=>{const n=document.querySelector('.nf-brand-version'),s=getComputedStyle(n,'::before');return {html:n.outerHTML,style:s.cssText,width:s.width,height:s.height,display:s.display,bg:s.backgroundColor,overflow:getComputedStyle(n).overflow,ancestors:[n.parentElement,n.parentElement.parentElement].map(a=>({cls:a.className,overflow:getComputedStyle(a).overflow}))}})()`);
   await fs.writeFile(path.join(out,'separator-'+label+'.json'),JSON.stringify(sep,null,2));assert.equal(sep.overflow,'visible','version separator must not be clipped in '+label);

   if(label==='特效'){
     await win.webContents.executeJavaScript(`NovaFlowWebWarehouse.save({blob:new Blob(['fixture'],{type:'image/png'}),name:'appearance-pending-fixture.png'})`);
     assert.equal(await win.webContents.executeJavaScript(`document.getElementById('novaflow-warehouse-notice')?.hidden`),false);

     await win.webContents.executeJavaScript(`[...document.querySelectorAll('.aifx-section[data-open="0"] .aifx-section-header')].forEach(n=>n.click())`);await delay(300);
     const bodies=await win.webContents.executeJavaScript(`[...document.querySelectorAll('#novaflow-aifx-mvp .aifx-section-body')].map(n=>getComputedStyle(n).backgroundColor)`);
     const hover=await win.webContents.executeJavaScript(`(()=>{const n=[...document.querySelectorAll('.aifx-button:not(.aifx-primary):not(:disabled)')].find(n=>n.checkVisibility());n.id='appearance-fx-hover';const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseMove',...hover});await delay(80);assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.getElementById('appearance-fx-hover')).backgroundColor`),'rgb(55, 55, 55)');win.webContents.sendInputEvent({type:'mouseMove',x:900,y:300});
     const fxGen=await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.aifx-primary')).backgroundColor`);assert.equal(fxGen,'rgb(30, 166, 114)');
     for(const kind of ['template','style']){
       await win.webContents.executeJavaScript(`NovaFlowAifxMvp.openLibrary(${JSON.stringify(kind)})`);await delay(100);
       const close=await win.webContents.executeJavaScript(`(()=>{const n=document.querySelector('[data-action="close-library"]');return {text:n.textContent,label:n.getAttribute('aria-label'),width:getComputedStyle(n).width}})()`);assert.equal(close.text,'×');assert.equal(close.label,'关闭');assert(['20px','24px'].includes(close.width));await win.webContents.executeJavaScript(`NovaFlowAifxMvp.closeLibrary()`);
     }
     assert(bodies.length>=2);assert(bodies.every(s=>s==='rgba(0, 0, 0, 0)'),'FX expanded groups should not add a second plate');
   }
   if(label==='音视'){
     assert.equal(await win.webContents.executeJavaScript(`document.getElementById('novaflow-warehouse-notice')?.hidden`),true,'pending FX reminder must disappear after module switch');

     const toggles=await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-novaflow-ai-state-toggle]')].filter(n=>n.checkVisibility()).map(n=>({on:n.getAttribute('data-novaflow-ai-state-toggle'),bg:getComputedStyle(n).backgroundColor,html:n.outerHTML}))`);
     await fs.writeFile(path.join(out,'video-switches.json'),JSON.stringify(toggles,null,2));
     assert(toggles.length);assert(toggles.every(n=>n.bg===(n.on==='on'?'rgb(30, 166, 114)':'rgb(62, 62, 62)')),'video switches keep solid fills');

     await win.webContents.executeJavaScript(`(()=>{const host=document.createElement('div');host.id='appearance-video-host';host.style.cssText='position:fixed;inset:80px 10px 20px 90px;z-index:100;display:grid;grid-template-columns:220px minmax(0,1fr);gap:10px;background:#161616';const left=document.createElement('aside'),stage=document.createElement('div');left.style.cssText='position:relative;overflow:auto';stage.style.cssText='position:relative;min-width:0;min-height:0';host.append(left,stage);document.body.append(host);NovaFlowAiSequenceVideoMergeWorkspace.open({previewHost:stage,postSection:left});})()`);await wait(win,`document.querySelector('#ve-save')?.checkVisibility()`);await delay(150);
     const videoEditor=await win.webContents.executeJavaScript(`(()=>{const save=document.querySelector('#ve-save');return {save:getComputedStyle(save).backgroundColor,names:[...document.querySelectorAll('.nf-tl-track-name')].map(n=>getComputedStyle(n).fontSize),add:[...document.querySelectorAll('.nf-tl-add-track')].map(n=>({align:getComputedStyle(n).alignItems,justify:getComputedStyle(n).justifyContent})),audio:getComputedStyle(document.querySelector('.nf-tl-header[data-kind="audio"]')).backgroundColor}})()`);
     assert.equal(videoEditor.save,'rgb(39, 39, 39)');assert(videoEditor.names.every(n=>n==='11px'));assert(videoEditor.add.every(n=>n.align==='center'&&n.justify==='center'));assert.equal(videoEditor.audio,'rgb(27, 27, 27)');await fs.writeFile(path.join(out,'video-editor-appearance.json'),JSON.stringify(videoEditor,null,2));await fs.writeFile(path.join(out,'video-editor-ui.png'),(await win.webContents.capturePage()).toPNG());
     await win.webContents.executeJavaScript(`NovaFlowAiSequenceVideoMergeWorkspace.close();document.getElementById('appearance-video-host')?.remove()`);
     const frame=await win.webContents.executeJavaScript(`(()=>{__appearanceFrameStyle();const p=document.createElement('div');p.setAttribute('data-novaflow-video-frame-edit-panel','1');p.innerHTML='<button class="nf-vfe-apply" disabled>生成新资源</button>';document.body.append(p);const s=getComputedStyle(p.firstElementChild);const r={bg:s.backgroundColor,opacity:s.opacity};p.remove();return r})()`);assert.equal(frame.bg,'rgb(30, 166, 114)');assert(Number(frame.opacity)>0&&Number(frame.opacity)<1);
     const videoSpacing=await win.webContents.executeJavaScript(`(()=>{const a=document.querySelector('[data-novaflow-ai-main-model-section="1"]'),b=document.querySelector('[data-novaflow-ai-lora-section="1"]');const label=[...document.querySelectorAll('[data-novaflow-ai-mode-section="1"] label')].find(n=>n.textContent.trim()==='模型方式');const field=label?.parentElement;return {modelHeight:field?.getBoundingClientRect().height,loraGap:b&&field?b.getBoundingClientRect().y-field.getBoundingClientRect().bottom:null}})()`);
     await fs.writeFile(path.join(out,'video-spacing.json'),JSON.stringify(videoSpacing));
     await win.webContents.executeJavaScript(`[...document.querySelectorAll('#novaflow-av-sub-toggle button')].find(n=>n.textContent.trim()==='音频')?.click()`);
     await wait(win,`document.querySelector('#novaflow-audio-studio .nf-as-mode-kind button')?.checkVisibility()`);
     assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('#novaflow-audio-studio .nf-as-mode button[aria-pressed="true"]')).backgroundColor`),'rgb(28, 65, 54)');
     await win.webContents.executeJavaScript(`[...document.querySelectorAll('#novaflow-audio-studio .nf-as-row-head')].find(n=>n.innerText.trim()==='音频编辑')?.click()`);await delay(100);
     const audioSave=await win.webContents.executeJavaScript(`(()=>{const n=[...document.querySelectorAll('#novaflow-audio-studio button')].find(n=>n.innerText==='保存到资源列表');return n?getComputedStyle(n).backgroundColor:null})()`);assert.equal(audioSave,'rgb(39, 39, 39)');
     await win.webContents.executeJavaScript(`[...document.querySelectorAll('#novaflow-audio-studio .nf-as-row-head')].find(n=>n.innerText.trim()==='音频生成')?.click()`);await delay(100);

     const audio=await win.webContents.executeJavaScript(`(()=>{const n=document.querySelector('#novaflow-audio-studio .nf-as-mode-kind button[aria-pressed="true"]'),s=getComputedStyle(n);return {bg:s.backgroundColor,border:s.borderTopWidth,shadow:s.boxShadow}})()`);
     assert.equal(audio.bg,'rgb(28, 65, 54)');assert.equal(audio.border,'0px');assert.equal(audio.shadow,'none');
     await win.webContents.executeJavaScript(`document.querySelector('#novaflow-audio-studio .nf-as-select')?.click()`);
     await wait(win,`document.querySelector('.nf-as-dd-item[aria-selected="true"]')`);
     assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.nf-as-dd-item[aria-selected="true"]')).backgroundColor`),'rgba(30, 166, 114, 0.24)');
     await fs.writeFile(path.join(out,'audio-dropdown-ui.png'),(await win.webContents.capturePage()).toPNG());
     await win.webContents.executeJavaScript(`document.body.click();[...document.querySelectorAll('.nf-as-mode-kind button')].find(n=>n.textContent.trim()==='音效')?.click()`);await delay(100);
     const audioModes=await win.webContents.executeJavaScript(`[...document.querySelectorAll('.nf-as-mode-kind button')].map(n=>({text:n.textContent,pressed:n.getAttribute('aria-pressed'),bg:getComputedStyle(n).backgroundColor,border:getComputedStyle(n).borderTopWidth}))`);assert(audioModes.some(n=>n.text==='音效'&&n.pressed==='true'));assert(audioModes.every(n=>n.bg===(n.pressed==='true'?'rgb(28, 65, 54)':'rgba(0, 0, 0, 0)')&&n.border==='0px'));await fs.writeFile(path.join(out,'audio-modes.json'),JSON.stringify(audioModes,null,2));

     await win.webContents.executeJavaScript(`document.querySelector('.nf-as-dd-dim')?.click()`);
     await fs.writeFile(path.join(out,'audio-appearance.json'),JSON.stringify(audio,null,2));
   }
   if(label==='美工'){
     await win.webContents.executeJavaScript(`document.querySelector('.nf-xiaotao-robot').click()`);await delay(100);
     const peach=await win.webContents.executeJavaScript(`(()=>{const robot=document.querySelector('.nf-xiaotao-robot'),send=document.querySelector('.nf-xiaotao-compose-actions .nf-xiaotao-primary'),title=document.querySelector('.nf-xiaotao-header strong');return {robot:getComputedStyle(robot).color,send:getComputedStyle(send).backgroundColor,brain:getComputedStyle(document.querySelector('.nf-xiaotao-brains button[aria-pressed="true"]')).backgroundColor,title:getComputedStyle(title).color}})()`);assert.equal(peach.brain,'rgb(28, 65, 54)');assert.equal(peach.robot,'rgb(199, 199, 199)');assert.equal(peach.send,'rgb(39, 39, 39)');assert.equal(peach.title,'rgb(234, 234, 234)');await fs.writeFile(path.join(out,'xiaotao-ui.png'),(await win.webContents.capturePage()).toPNG());await win.webContents.executeJavaScript(`document.querySelector('.nf-xiaotao-panel .nf-xiaotao-icon')?.click()`);
     const art=await win.webContents.executeJavaScript(`(()=>{const model=document.querySelector('[data-novaflow-art-generate-model-field="1"]'),lora=document.querySelector('[data-novaflow-art-lora="1"]'),button=document.querySelector('[data-novaflow-art-generate-submit="1"]'),s=getComputedStyle(button),i=getComputedStyle(button,'::before');return {modelHeight:model.getBoundingClientRect().height,loraGap:lora.getBoundingClientRect().y-model.getBoundingClientRect().bottom,bg:s.backgroundColor,icon:{content:i.content,width:i.width,mask:i.webkitMaskImage},shadow:getComputedStyle(document.querySelector('.nf-xiaotao-robot')).boxShadow,plates:[...document.querySelectorAll('[data-novaflow-ai-top-mode-tabs],[data-novaflow-zoom-controls],[data-novaflow-ai-board-controls-top-left],.novaflow-art-generate-top')].map(n=>getComputedStyle(n).boxShadow)}})()`);
     await fs.writeFile(path.join(out,'art-appearance.json'),JSON.stringify(art,null,2));
     assert.equal(art.modelHeight,56.5);assert.equal(art.loraGap,10);assert.equal(art.bg,'rgb(30, 166, 114)');assert.equal(art.icon.width,'14px');assert.notEqual(art.icon.mask,'none');assert.notEqual(art.icon.content,'none');assert.notEqual(art.shadow,'none');assert(art.plates.every(s=>s==='none'));
   }
   if(label==='美工'){
     const ref=await win.webContents.executeJavaScript(`(()=>{const n=document.querySelector('.novaflow-art-generate-ref')||[...document.querySelectorAll('button')].find(n=>n.innerText.includes('添加参考图'));return n?{html:n.outerHTML,border:getComputedStyle(n).borderTopStyle,width:getComputedStyle(n).borderTopWidth}:null})()`);
     await fs.writeFile(path.join(out,'art-ref.json'),JSON.stringify(ref,null,2));
     await win.webContents.executeJavaScript(`window.__appearanceOpenArtExport()`);await delay(100);
     const exports=await win.webContents.executeJavaScript(`[...document.querySelectorAll('.novaflow-art-export-action')].map(n=>({text:n.textContent,bg:getComputedStyle(n).backgroundColor,border:getComputedStyle(n).borderTopWidth}))`);
     assert.equal(exports.length,4);assert(exports.every(n=>n.bg==='rgb(39, 39, 39)'&&n.border==='0px'));await fs.writeFile(path.join(out,'art-export-appearance.json'),JSON.stringify(exports,null,2));
     await fs.writeFile(path.join(out,'art-export-ui.png'),(await win.webContents.capturePage()).toPNG());
     await win.webContents.executeJavaScript(`document.querySelector('[data-novaflow-art-export-modal-root]')?.remove();[...document.querySelectorAll('button')].find(n=>n.innerText.trim()==='UI'&&n.checkVisibility())?.click()`);await delay(700);
     await win.webContents.executeJavaScript(`[...document.querySelectorAll('.nf-panel-header')].filter(n=>['布局编辑','拆图'].includes(n.innerText.trim())).forEach(n=>n.click())`);await delay(200);
     const ui=await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-foart-action]')].filter(n=>n.checkVisibility()).map(n=>({text:n.textContent,bg:getComputedStyle(n).backgroundColor,border:getComputedStyle(n).borderTopWidth}))`);
     await fs.writeFile(path.join(out,'ui-submode-appearance.json'),JSON.stringify(ui,null,2));assert(ui.some(n=>n.text==='对象识别'));assert(ui.filter(n=>['对象识别','确认拆图','生成布局参考'].includes(n.text)).every(n=>n.bg==='rgba(30, 166, 114, 0.24)'&&n.border==='0px'));
     const refUi=await win.webContents.executeJavaScript(`(()=>{const n=[...document.querySelectorAll('.novaflow-art-generate-ref,.nf-upload-dropzone')].find(n=>n.checkVisibility()&&n.textContent.includes('添加参考图'));return n?{html:n.outerHTML,border:getComputedStyle(n).borderTopStyle,width:getComputedStyle(n).borderTopWidth}:null})()`);assert(refUi);assert.equal(refUi.border,'dashed');assert.equal(refUi.width,'1px');await fs.writeFile(path.join(out,'art-ref.json'),JSON.stringify(refUi,null,2));
     await win.webContents.executeJavaScript(`[...document.querySelectorAll('.nf-panel-header')].find(n=>n.innerText.trim()==='布局编辑')?.click()`);await delay(100);
     const layout=await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-foart-action="primary"]')].filter(n=>n.checkVisibility()).map(n=>({text:n.textContent,bg:getComputedStyle(n).backgroundColor}))`);assert(layout.some(n=>n.text==='生成布局参考'&&n.bg==='rgba(30, 166, 114, 0.24)'));
     await fs.writeFile(path.join(out,'ui-submode.png'),(await win.webContents.capturePage()).toPNG());
   }
   if(label==='工具'){
     const tools=[];
     for(const name of ['PNG 压缩','JPG 压缩','PNG 去黑','MP4 压缩','视频格式转换','SPINE 图集转换']){
       const ok=await win.webContents.executeJavaScript(`(()=>{const n=[...document.querySelectorAll('[data-novaflow-tools-entry],.nf-panel-header,button,[role="button"]')].find(n=>n.innerText.trim()===${JSON.stringify(name)}&&n.getBoundingClientRect().width);n?.click();return !!n})()`);
       assert(ok,'tool entry missing: '+name);await delay(200);
       const solid=await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].filter(n=>n.checkVisibility()&&window.FoartButtonTheme.isButton(n)).filter(n=>{const c=getComputedStyle(n).backgroundColor;const m=c.match(/^rgb\\((\\d+), (\\d+), (\\d+)\\)/);return m&&Number(m[2])>100&&Number(m[1])<90&&Number(m[3])>70}).map(n=>({text:n.textContent,bg:getComputedStyle(n).backgroundColor}))`);
       assert.deepEqual(solid,[],name+' contains solid green action buttons');
       const actions=await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-novaflow-tools-start-button],.nf-prb-btn,.nf-mp4-btn,.nf-vfc-btn,.nf-saw-btn')].filter(n=>n.checkVisibility()).map(n=>({text:n.textContent,bg:getComputedStyle(n).backgroundColor}))`);
       assert(actions.length,name+' run control missing');assert(actions.every(n=>n.bg==='rgb(39, 39, 39)'),name+' execution controls must be grey');tools.push({name,actions});
     }
     await fs.writeFile(path.join(out,'tools-appearance.json'),JSON.stringify(tools,null,2));
   }
   await fs.writeFile(path.join(out,'page-'+label+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 const embedded=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{session:isolated,offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
 embedded.webContents.on('console-message',(_e,level,message)=>{if(level>=2)console.error('embedded:',message)});
 await embedded.loadURL(base+'/spine-skeleton-editor.html');
 await wait(embedded,`window.NovaFlowSkeletonEditorAPI && window.NovaFlowParticleFxUI`);
 await embedded.webContents.executeJavaScript(`(async()=>{const json={"skeleton": {"spine": "3.8.99"}, "bones": [{"name": "root"}, {"name": "child", "parent": "root", "length": 30}], "slots": [], "skins": {"default": {}}, "animations": {"idle": {"bones": {"child": {"rotate": [{"time": 0, "angle": 0}, {"time": 1, "angle": 10}]}}}}};try { await NovaFlowSkeletonEditorAPI.loadSource({skeleton:{fileName:'appearance-fixture.json',text:JSON.stringify(json)},images:[]},{operation:'replace'});NovaFlowSkeletonEditorAPI.selectBone('child');document.querySelector('.xt[data-t="rotate"]')?.click(); } catch(e) { console.error(e.stack);throw e; }})()`);
 await delay(300);
 const embeddedStyle=await embedded.webContents.executeJavaScript(`(()=>{const style=n=>{const s=getComputedStyle(n);return {text:n.textContent,bg:s.backgroundColor,border:s.borderTopWidth,height:s.height,weight:s.fontWeight}};const filter=document.getElementById('dopeFilter');filter.setAttribute('aria-pressed','true');const rotation=document.querySelector('.xt[data-t="rotate"]');const props=[...document.querySelectorAll('.props .btns .btn.small')].map(style);return {filter:style(filter),rotation:style(rotation),transport:[...document.querySelectorAll('.tp')].map(style),props,scrollbar:getComputedStyle(document.querySelector('.tree')).scrollbarColor}})()`);
 await fs.writeFile(path.join(out,'embedded-appearance.json'),JSON.stringify(embeddedStyle,null,2));
 assert.equal(embeddedStyle.filter.bg,'rgb(39, 39, 39)');assert.equal(embeddedStyle.rotation.bg,'rgba(30, 166, 114, 0.24)');assert(embeddedStyle.transport.every(x=>x.border==='0px'));assert(embeddedStyle.props.length>=4);assert(embeddedStyle.props.every(x=>x.border==='0px'&&x.height==='24px'&&x.weight==='500'));assert(embeddedStyle.scrollbar.includes('58, 58, 58'));
 await embedded.webContents.executeJavaScript(`(()=>{const host=document.createElement('div');host.style.cssText='position:fixed;inset:0 0 0 auto;width:300px;height:100%;';document.body.appendChild(host);NovaFlowParticleFxUI.openDock({host,last:{systems:[{}]}})})()`);
 await delay(200);
 await embedded.webContents.executeJavaScript(`(()=>{const p=window.__NovaFlowParticleFxOpen;p.state.open.add('look');p.rerender();document.querySelector('.pfx-builtin-tiles button')?.click()})()`);await delay(100);
 const particle=await embedded.webContents.executeJavaScript(`(()=>{const root=document.querySelector('.pfx-dock'),get=n=>({text:n.textContent,bg:getComputedStyle(n).backgroundColor,border:getComputedStyle(n).borderTopWidth});return {cards:[...root.querySelectorAll('.pfx-card-hd')].map(n=>getComputedStyle(n).backgroundColor),icons:[...root.querySelectorAll('.pfx-builtin-tiles img')].map(n=>getComputedStyle(n).width),bg:getComputedStyle(root).backgroundColor,selected:[...root.querySelectorAll('.fxm-btn[data-on="1"],.fxm-primary')].map(get)}})()`);
 await fs.writeFile(path.join(out,'particle-appearance.json'),JSON.stringify(particle,null,2));assert.equal(particle.bg,'rgb(22, 22, 22)');assert(particle.cards.length);assert(particle.cards.every(c=>c==='rgb(39, 39, 39)'));assert(particle.icons.length);assert(particle.icons.every(w=>w==='24px'));assert(particle.selected.length>=3);assert(particle.selected.every(x=>x.bg==='rgba(30, 166, 114, 0.24)'&&x.border==='0px'));
 await fs.writeFile(path.join(out,'particle-ui.png'),(await embedded.webContents.capturePage()).toPNG());embedded.destroy();
 win.destroy();server.close();
 if(process.env.FOART_CHECK_LIVE){
 const liveSession=session.fromPartition('foart-online-brand-verification');
 liveSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)&&!d.url.startsWith('https://novaflow.jiangdylan11.workers.dev/')&&!d.url.startsWith('https://cdnjs.cloudflare.com/')}));
 const live=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{session:liveSession,offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
 await live.loadURL('https://novaflow.jiangdylan11.workers.dev/?foart_brand_accept=158');
 await wait(live,`document.querySelector('.nf-login-logo')?.complete && document.querySelector('.nf-login-logo').naturalWidth>0 && !document.getElementById('novaflow-boot-splash')`);
 assert.equal(await live.webContents.executeJavaScript('document.title'),'Foart');
 await fs.writeFile(path.join(out,'online-login-ui.png'),(await live.webContents.capturePage()).toPNG());live.destroy();
 }
 await fs.writeFile(path.join(out,'ui-verification.json'),JSON.stringify({ok:true,fixtureOnly:true,worker:wm,admin:am,editor:em},null,2));
 console.log('PASS: real control surfaces preserve transparency, unify action colors, match art/video spacing, remove outlines, and style the embedded editor; isolated fixtures, no live mutations');app.exit(0);
}
main().catch(e=>{console.error(e);server?.close();app.exit(1)});
