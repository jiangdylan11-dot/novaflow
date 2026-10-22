// Run with the project's existing Electron. This renders only the H3 component,
// never the authenticated app, and never connects to a model or service.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const args=process.argv.slice(2),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const project=path.resolve(__dirname,'../..');
const renderer=arg('--renderer-root',path.join(project,'renderer'));
const output=arg('--output-dir',path.join(process.env.TEMP,'novaflow-h3-layout'));
const fixtures=arg('--fixtures',path.join(process.env.TEMP,'novaflow-h3-fixtures'));
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'isolated-profile'));app.commandLine.appendSwitch('disable-gpu');
const url=p=>'file:///'+p.replace(/\\/g,'/');
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
let win;
app.whenReady().then(async()=>{
 const index=fs.readFileSync(path.join(renderer,'index.html'),'utf8');
 assert.match(index,/href="\.\/ai-sequence-h3-media\.css(?:\?[^"]*)?"/);
 const htmlStyles=[...index.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map(x=>x[0]).join('\n');
 const css=[...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="(\.\/[^"?]+)[^"]*"[^>]*>/gi)].map(x=>x[1]);
 assert(css.includes('./ai-sequence-h3-media.css'));
 const fixture=path.join(output,'fixture.html');
 fs.writeFileSync(fixture,`<!doctype html><html><head><meta charset="utf-8">${htmlStyles}${css.map(x=>`<link rel="stylesheet" href="${url(path.join(renderer,x))}">`).join('')}<style>
 html,body{display:block!important;margin:0!important;padding:0!important;width:100%!important;min-width:0!important;max-width:100%!important;height:auto!important;min-height:100vh!important;overflow:auto!important;background:#202020!important;color:#ccc;font:12px "Segoe UI","Microsoft YaHei",sans-serif}
 #fixture{padding:22px;max-width:1200px;margin:auto;box-sizing:border-box}h1{font:500 15px "Segoe UI","Microsoft YaHei",sans-serif;margin:0 0 18px;color:#ccc}.fixture-settings{padding:10px 0;display:flex;flex-wrap:wrap;gap:20px;color:#aaa}.fixture-progress{height:4px;background:#353535;margin:8px 0 12px;border-radius:4px}.fixture-prompt{border:1px solid #3b3b3b;background:#242424;border-radius:8px;padding:10px;margin:0;min-height:92px;box-sizing:border-box}.fixture-prompt label{display:block;margin-bottom:7px;color:#ccc}.fixture-prompt textarea{background:none;border:0;color:#aaa;width:100%;height:45px;resize:none;box-sizing:border-box;font:11px "Segoe UI","Microsoft YaHei",sans-serif}
 </style></head><body><div id="fixture"></div><script src="${url(path.join(renderer,'ai-sequence-h3-media.js'))}"></script><script>
 const React=require(${JSON.stringify(path.join(project,'node_modules/react'))});const ReactDOM=require(${JSON.stringify(path.join(project,'node_modules/react-dom/client'))});
 const h=React.createElement;window.fixtureBoard='fixture-board';window.fixturePrompt='';
 function App(){const [prompt,setPrompt]=React.useState('');window.fixturePrompt=prompt;return h('div',{'data-preview-ui':'1','data-novaflow-ai-bottom-workspace':'1','data-novaflow-source-layout':'1'},h('h1',null,'动画 · AI 序列动画'),h('div',{'data-novaflow-ai-bottom-main-row':'1',style:{display:'flex',gap:10}},h('div',{'data-novaflow-ai-reference-column':'1',style:{flex:'0 0 132px',width:132,height:132}}),h('div',{style:{flex:'1 1 0',minWidth:0}},h('div',{'data-novaflow-ai-settings-row':'1',className:'fixture-settings'},h('span',null,'模型方式：本地 beta6'),h('span',null,'生成模式：多参视频'),h('span',null,'8 步 · 1 秒')),h('div',{'data-novaflow-ai-generation-progress':'1',className:'fixture-progress'}),h(NovaFlowH3Media.Panel,{react:React,boardId:fixtureBoard,prompt,onPromptChange:setPrompt}),h('div',{'data-novaflow-ai-prompt-grid':'1',style:{display:'grid',gridTemplateColumns:'minmax(0,1fr)',gap:10,marginTop:-28}},h('div',{className:'fixture-prompt'},h('label',null,'提示词'),h('textarea',{value:prompt,readOnly:true,placeholder:'输入画面、动作与声音描述…'})),h('div',{className:'fixture-prompt'},h('label',null,'避免内容'),h('textarea',{value:'',readOnly:true,placeholder:'输入不希望出现的内容…'}))))))}
 ReactDOM.createRoot(document.getElementById('fixture')).render(h(App));
 window.fixtureReady=async()=>{await NovaFlowH3Media.store.load(fixtureBoard);return true};
 window.fixtureLayout=()=>NovaFlowH3Media.applyBottomLayout(document.querySelector('[data-novaflow-ai-bottom-workspace]'));
 </script></body></html>`);
 win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
 const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)});
 await win.loadFile(fixture);await win.webContents.executeJavaScript('fixtureReady().then(()=>NovaFlowH3Media.store.restore({version:1,items:[]}))');await pause(150);
 const evaluate=code=>win.webContents.executeJavaScript(code,true);
 async function inspect(name,width,height){
  win.setContentSize(width,height);await pause(100);await evaluate('fixtureLayout()');await pause(100);
  const result=await evaluate(`(()=>{const root=document.querySelector('.nf-h3-media'),groups=root.querySelector('.nf-h3-media-groups'),prompt=document.querySelector('[data-novaflow-ai-prompt-grid]');const rect=x=>{const r=x.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};return {name:${JSON.stringify(name)},viewport:innerWidth,cssLoaded:[...document.styleSheets].some(x=>x.href?.includes('ai-sequence-h3-media.css')&&x.cssRules.length>20),hiddenInputs:[...root.querySelectorAll('input[type=file]')].every(x=>getComputedStyle(x).display==='none'&&x.getBoundingClientRect().width===0),counts:[...root.querySelectorAll('[data-novaflow-h3-count]')].map(x=>x.textContent),cards:root.querySelectorAll('[data-novaflow-h3-source-id]').length,root:rect(root),groups:rect(groups),prompt:rect(prompt),help:rect(root.querySelector('.nf-h3-media-help')),tile:[...root.querySelectorAll('.nf-h3-media-add,.nf-h3-media-preview')].map(rect),scrollWidth:document.documentElement.scrollWidth,groupScrollWidth:groups.scrollWidth,groupClientWidth:groups.clientWidth,durations:[...root.querySelectorAll('.nf-h3-media-duration')].map(x=>x.textContent)}})()`);
  fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  assert(result.cssLoaded,'H3 stylesheet must actually load');assert(result.hiddenInputs,'native inputs must be hidden');
  assert(result.root.bottom<=result.prompt.y+1,'reference area must not overlap prompts');assert(result.help.width>width*.65,'help must occupy its own full-width line');
  assert(result.scrollWidth<=width+1,'page must not overflow horizontally');assert(result.groupScrollWidth<=result.groupClientWidth+1,'cards must wrap within scroll area');
  assert(result.tile.every(x=>x.width===87&&x.height===59),'upload and media tiles must use the existing 87x59 style');
  assert(result.tile.every(x=>x.x>=result.groups.x-1&&x.right<=result.groups.right+1),'tiles must stay within the responsive group');
  fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());return result;
 }
 const results=[];results.push(await inspect('empty-wide',1200,850));results.push(await inspect('empty-narrow',480,900));
 assert.equal(await evaluate(`(()=>{let clicks=0;const input=document.querySelector('[data-novaflow-h3-upload=image]');input.click=()=>clicks++;document.querySelector('[data-novaflow-h3-add=image]').click();return clicks})()`),1,'plus card must trigger its hidden file input');
 for(const [kind,n,prefix,ext,type]of [['image',9,'robot','png','image/png'],['video',3,'motion','mp4','video/mp4'],['audio',3,'tone','wav','audio/wav']]){
  const values=Array.from({length:n},(_,i)=>({name:prefix+'-'+(i+1)+'.'+ext,base64:fs.readFileSync(path.join(fixtures,prefix+'-'+(i+1)+'.'+ext)).toString('base64')}));
  await evaluate(`(()=>{const dt=new DataTransfer();for(const x of ${JSON.stringify(values)})dt.items.add(new File([Uint8Array.from(atob(x.base64),c=>c.charCodeAt(0))],x.name,{type:${JSON.stringify(type)}}));const input=document.querySelector('[data-novaflow-h3-upload=${kind}]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  for(let i=0;i<100;i++){if(await evaluate(`NovaFlowH3Media.getResources().filter(x=>x.kind===${JSON.stringify(kind)}).length===${n}`))break;await pause(40);}
 }
 await pause(250);results.push(await inspect('full-wide',1200,1000));results.push(await inspect('full-narrow',480,1100));
 for(const result of results.slice(2)){assert.equal(result.cards,15);assert.deepEqual(result.counts,['9/9','3/3','3/3']);assert(result.durations.length===6&&result.durations.every(x=>x==='2.0s'),'video/audio cards must show actual durations');}
 await evaluate(`document.querySelector('.nf-h3-media-groups').scrollTop=9999`);await pause(60);fs.writeFileSync(path.join(output,'full-narrow-bottom.png'),(await win.webContents.capturePage()).toPNG());
 const bindings=await evaluate(`NovaFlowH3Media.snapshot()`);assert.equal(new Set(bindings.map(x=>x.sourceId)).size,15);
 await evaluate(`document.querySelector('[data-novaflow-h3-slot="multi_ref_video_3"] .nf-h3-media-preview').click()`);await pause(50);assert.equal(await evaluate('fixturePrompt'),' @视频参考3');
 await evaluate(`document.querySelector('[aria-label="删除视频参考2"]').click()`);await pause(120);
 assert.equal(await evaluate('fixturePrompt'),' @视频参考2');assert.equal(await evaluate(`NovaFlowH3Media.getResources().find(x=>x.key==='multi_ref_video_2').fileName`),'motion-3.mp4');
 const snapshot=await evaluate(`NovaFlowH3Media.snapshot()`);assert.equal(snapshot.length,14);
 await win.loadFile(fixture);await evaluate('fixtureReady()');await pause(100);
 assert.deepEqual(await evaluate('NovaFlowH3Media.snapshot().then(xs=>xs.map(x=>x.sourceId))'),snapshot.map(x=>x.sourceId),'real IndexedDB reload must retain the remaining bindings');
 const restored=await evaluate(`(()=>{fixtureLayout();const bottom=document.querySelector('[data-novaflow-ai-bottom-workspace]'),column=bottom.querySelector('[data-novaflow-ai-reference-column]');bottom.querySelector('.nf-h3-media').remove();const result=NovaFlowH3Media.applyBottomLayout(bottom);return {result,display:column.style.display,width:column.style.width}})()`);
 assert.equal(restored.result,false);assert.notEqual(restored.display,'none');assert.equal(restored.width,'132px','leaving H3 multi-reference must restore the original reference column');
 assert.deepEqual(errors,[],'fixture must have no renderer exceptions');
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({renderer,results,bindingCount:bindings.length,deleteRenumberPassed:true,errors},null,2));
 console.log('PASS H3 visual layout: 4 width/state cases, 5 screenshots; stylesheet loaded, native inputs hidden, 87x59 cards, 15 real uploads, durations, insertion and deletion renumbering.');
 win.destroy();app.quit();
}).catch(e=>{console.error(e.stack);if(win)win.destroy();app.exit(1)});
