// Real DOM with simulated policy/settlement; never uses a real account or network.
const {app,BrowserWindow,session}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'foart-price-visible-'));app.setPath('userData',path.join(dir,'profile'));await app.whenReady();session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file:')}));
 const {normalizeCreditConfig}=await import(pathToFileURL(path.join(root,'packages/shared/src/feature-credits.mjs')).href);
 const policy={version:'sha256:'+'a'.repeat(64),expiresAt:Date.now()+600000,config:normalizeCreditConfig({credits_per_usd:211,xiaotao_online:{markup:1.5}}),defaultModel:'xai/grok-4.7',models:[{id:'xai/grok-4.7',available:true},{id:'glm/glm-5.3-flash',available:true},{id:'openai/gpt-6.1-sol-saver',available:true},{id:'deepseek/deepseek-v4.1-flash',available:false},{id:'legacy-online',available:true}]};
 const [js,css,prices]=await Promise.all(['xiaotao-art-agent.js','xiaotao-art-agent.css','feature-credit-prices.js'].map(n=>fs.readFile(path.join(root,'renderer',n),'utf8')));
 const html=path.join(dir,'index.html');await fs.writeFile(html,`<!doctype html><meta charset="utf-8"><style>body{background:#171717;color:#ccc;font:14px Microsoft YaHei}${css}</style><body><script>window.__policy=${JSON.stringify(policy)};window.electronAPI={companionPricing:async()=>({ok:true,policy:__policy}),promptAssistantGetStatus:async()=>({ok:true,result:{}}),artAgentChat:p=>{p.onPricingQuote?.({requestId:p.requestId,estimatedCredits:7});return new Promise(resolve=>window.__resolve=resolve)}};</script><script>${prices}</script><script>${js}</script></body>`);
 const win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}}),run=code=>win.webContents.executeJavaScript(code);
 await win.loadFile(html);await run('NovaFlowXiaotaoArtAgent.panel.open();void 0');await new Promise(r=>setTimeout(r,30));
 const select=async id=>{await run(`(()=>{let s=document.querySelector('.nf-xiaotao-model-select');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,30));};
 const read=()=>run(`(()=>{const p=document.querySelector('.nf-xiaotao-pricing'),f=document.querySelector('.nf-xiaotao-compose'),r=p.getBoundingClientRect(),b=f.getBoundingClientRect();return {text:p.textContent,visible:!!p.getClientRects().length,bottom:r.bottom,footerTop:b.top,height:r.height,scroll:p.scrollHeight,client:p.clientHeight}})()`);
 const menu=await run(`Array.from(document.querySelectorAll('.nf-xiaotao-model-select option')).map(x=>({id:x.value,text:x.textContent,hidden:x.hidden}))`);
 assert(!menu.some(x=>x.id==='next'));assert.match(menu.find(x=>x.id==='qwen3.5-9b-heretic').text,/本地·免费/);
 assert.match(menu.find(x=>x.id==='xai/grok-4.7').text,/1M 输入约 538\.05 \/ 输出约 1614\.15 积分/);
 assert(!menu.some(x=>x.id==='glm/glm-5.3-flash'));
 assert.match(menu.find(x=>x.id==='openai/gpt-6.1-sol-saver').text,/1M 输入约 221\.55 \/ 输出约 1107\.75 积分/);
 assert.doesNotMatch(menu.find(x=>x.id==='deepseek/deepseek-v4.1-flash').text,/1M 输入/);assert(!menu.some(x=>x.id==='legacy-online'));
 assert.equal(await run(`document.querySelector('.nf-xiaotao-pricing-details').open`),false);
 await run(`document.querySelector('.nf-xiaotao-pricing-details').open=true`);
 const free=await read();assert.match(free.text,/对话免费.*工具按各自价格另计/);assert.equal(free.visible,true);
 for(const id of ['xai/grok-4.7','openai/gpt-6.1-sol-saver']){await select(id);const p=await read();assert.equal(p.visible,true);assert.match(p.text,/每百万 token/);assert.match(p.text,/优先使用接口返回的金额/);assert.match(p.text,/向上取整.*最低 1 积分.*最高 80 积分/);assert.ok(p.bottom<=p.footerTop);}
 await select('deepseek/deepseek-v4.1-flash');let unavailable=await read();assert.match(unavailable.text,/峰闲价格规则待确认/);assert.doesNotMatch(unavailable.text,/每百万 token/);
 await select('xai/grok-4.7');await run(`window.__pending=NovaFlowXiaotaoArtAgent.panel.controller.send('你好');void 0`);await new Promise(r=>setTimeout(r,20));assert.match((await read()).text,/每百万 token/);
 await run(`(async()=>{__resolve({ok:true,data:{reply:'模拟回复',history:[],quota:{status:'settled',billing_mode:'token',settled_credits:3,quote_estimated_credits:7}}});await __pending})()`);assert.match((await read()).text,/每百万 token/);assert.match(await run(`document.querySelector('.nf-xiaotao-messages').innerText`),/实扣 3.*估算预留 7/);
 await run(`__policy.version='sha256:'+'c'.repeat(64);__policy.config.xiaotao_online.grok_4_7_rates.input=2;NovaFlowXiaotaoArtAgent.panel.controller.state.pricingPolicy.expiresAt=Date.now()-1;void 0`);
 await new Promise(r=>setTimeout(r,650));assert.match((await read()).text,/输入约 633 积分/);
 win.setContentSize(360,700);await new Promise(r=>setTimeout(r,100));const narrow=await read();assert.equal(narrow.visible,true);assert.ok(narrow.bottom<=narrow.footerTop);assert.ok(narrow.height>0);assert.ok(narrow.scroll>=narrow.client);
 await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await fs.writeFile(path.join(dir,'narrow-expanded.png'),(await win.webContents.capturePage()).toPNG());
 await run(`document.querySelector('.nf-xiaotao-pricing-details').open=false`);
 const compact=await run(`(()=>{const r=document.querySelector('.nf-xiaotao-rate-summary'),d=document.querySelector('.nf-xiaotao-pricing-details'),f=document.querySelector('.nf-xiaotao-compose');return {text:r.textContent,visible:!!r.getClientRects().length,open:d.open,bottom:r.getBoundingClientRect().bottom,footerTop:f.getBoundingClientRect().top}})()`);
 assert.match(compact.text,/1M 输入约 633 \/ 输出约 1614\.15 积分/);assert.equal(compact.visible,true);assert.equal(compact.open,false);assert.ok(compact.bottom<=compact.footerTop);
 await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 await fs.writeFile(path.join(dir,'narrow-compact.png'),(await win.webContents.capturePage()).toPNG());
 console.log(JSON.stringify({result:'pass',compactScreenshot:path.join(dir,'narrow-compact.png'),expandedScreenshot:path.join(dir,'narrow-expanded.png'),compact,narrow},null,2));win.destroy();app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});setTimeout(()=>app.exit(2),30000);
