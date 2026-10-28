// Real Chromium panel, browser file decoding and bridge; fixture drawing slots
// and inference responses. Does not load a GPU or use cloud/user credentials.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
app.disableHardwareAcceleration();
const ROOT=path.resolve(__dirname,'../../..'),OUT=path.join(ROOT,'work/art-fidelity-speed-20261026/ui');
app.setPath('userData',path.join(OUT,'attachment-profile'));
(async()=>{
 await fs.mkdir(OUT,{recursive:true});await app.whenReady();
 const script=await fs.readFile(path.join(ROOT,'novaflow-web/renderer/xiaotao-art-agent.js'),'utf8'),css=await fs.readFile(path.join(ROOT,'novaflow-web/renderer/xiaotao-art-agent.css'),'utf8');
 const bootstrap=`window.__test={requests:[]};const refs=[],state={active:true,provider:'local',mode:'img2img',nsfw:false,prompt:'',negativePrompt:'原负向',width:1280,height:960,seed:54792256,randomSeed:false,count:1,localDrawEngine:'qwen-2.1',localQwen21Variant:'turbo',drawingTask:'style'};
 window.__NovaFlowArtGenerate={state,captureContext:()=>({state,references:refs,referenceLimit:3,generationSurface:'drawing'}),capturePrompt(){},clearAgentPrepared(){},selectedResult:()=>null,setMode:mode=>state.mode=mode,setReference:(i,ref)=>refs[i]=ref,render(){document.getElementById('slots').replaceChildren(...refs.filter(Boolean).map((ref,i)=>{const span=document.createElement('span'),img=new Image();img.src=ref.dataUrl;img.width=90;span.append(document.createTextNode('参考图'+(i+1)+' · '+ref.drawingRole),img);return span;}));}};
 window.NovaFlowArtGenerateModels={capabilityFor:()=>({engine:'qwen-2.1'}),localSamplingFor:()=>({cfg:3,steps:8})};window.NovaFlowArtDirection={input:ctx=>({references:ctx.references.map((r,i)=>({source:i+1,roles:[r.drawingRole]}))})};
 window.electronAPI={pickXiaotaoUploads:async()=>({canceled:false,files:window.__resources}),artAgentChat:async p=>{__test.requests.push(p);return {ok:true,data:{reply:'已经按完整图片分析了五官差别。',conversationId:'fixture-'+p.provider,history:[...p.history,{role:'user',content:p.message},{role:'assistant',content:'已经分析。'}],toolTrace:[]}};}};`;
 const upload=await fs.readFile(path.join(ROOT,'novaflow-web/renderer/xiaotao-upload.js'),'utf8');
 const html=path.join(OUT,'attachments.html');await fs.writeFile(html,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{background:#171717;color:#ccc;font:14px Microsoft YaHei;padding:24px}#slots{display:flex;gap:20px}#slots span{display:flex;flex-direction:column;gap:10px}${css}</style><h2>上传 → 图生图参考</h2><div id="slots"></div><script>${bootstrap}</script><script>${upload}</script><script>${script}</script></html>`);
 const win=new BrowserWindow({show:false,width:1180,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}}),run=code=>win.webContents.executeJavaScript(code);
 await win.loadFile(html);await run('NovaFlowXiaotaoArtAgent.panel.open();void 0');
 const input=JSON.parse(await fs.readFile(path.join(ROOT,'work/art-fidelity-speed-20261026/v2-old-profile/dark/inputs.json'),'utf8'));
 const resources=await Promise.all([input.source,input.reference].map(async(item,i)=>({name:i?'画风.png':'主体.jpg',mime:i?'image/png':'image/jpeg',base64:(await fs.readFile(item.path)).toString('base64')})));
 await run(`window.__resources=${JSON.stringify(resources.map(item=>({name:item.name,mimeType:item.mime,base64:item.base64,size:Buffer.from(item.base64,'base64').length})))}`);
 await run(`(async()=>{const panel=document.getElementById('nf-xiaotao-art-panel');await panel.querySelector('.nf-xiaotao-upload').onclick();})()`);
 const staged=await run(`(()=>{const c=NovaFlowXiaotaoArtAgent.panel.controller;return {names:c.state.staged.map(item=>item.name),messages:c.state.messages.length,slots:__NovaFlowArtGenerate.captureContext().references.filter(Boolean).length};})()`);
 assert.deepEqual(staged.names,['主体.jpg','画风.png']);assert.equal(staged.messages,0);assert.equal(staged.slots,0);
 await run(`NovaFlowXiaotaoArtAgent.panel.controller.send('这两张放到图生图')`);
 const observed=await run(`(()=>{const panel=document.getElementById('nf-xiaotao-art-panel'),title=panel.querySelector('strong').getBoundingClientRect(),brains=panel.querySelector('.nf-xiaotao-brains').getBoundingClientRect();return {headerBrains:panel.querySelector('.nf-xiaotao-header').contains(panel.querySelector('.nf-xiaotao-brains')),noSubtitle:!panel.querySelector('header small'),rightOfName:brains.left>title.right,uploadBeforeNew:[...panel.querySelector('.nf-xiaotao-compose-actions').children].map(n=>n.textContent).slice(0,2),slotCount:__NovaFlowArtGenerate.captureContext().references.filter(Boolean).length,error:NovaFlowXiaotaoArtAgent.panel.controller.state.error};})()`);
 assert.equal(observed.headerBrains,true);assert.equal(observed.noSubtitle,true);assert.equal(observed.rightOfName,true);assert.deepEqual(observed.uploadBeforeNew,['上传','新对话']);assert.equal(observed.slotCount,2);assert.equal(observed.error,'');
 const sha=url=>createHash('sha256').update(Buffer.from(url.split(',')[1],'base64')).digest('hex');
 const slotBytes=await run(`__NovaFlowArtGenerate.captureContext().references.filter(Boolean).map(ref=>ref.dataUrl)`);
 assert.equal(sha(slotBytes[0]),input.source.sha256);assert.equal(sha(slotBytes[1]),input.reference.sha256);
 await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await fs.writeFile(path.join(OUT,'xiaotao-attachments.png'),(await win.webContents.capturePage()).toPNG());
 await fs.writeFile(path.join(OUT,'attachment-proof.json'),JSON.stringify({...observed,slotSHA256:slotBytes.map(sha),fixtureInference:false},null,2));
 console.log('Real panel: upload stages until send, then lands in two drawing slots with the original bytes.');win.destroy();app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});
