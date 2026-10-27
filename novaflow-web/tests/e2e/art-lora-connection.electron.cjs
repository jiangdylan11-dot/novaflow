// Real DOM catalogue lifecycle; no model, inference, or network is used.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const renderer = path.resolve(process.env.NF_SHELL_RENDERER || path.join(__dirname, '../../renderer'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await win.loadURL('data:text/html,<main id="host"></main>');
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(renderer, 'art-generate-lora.js'), 'utf8'));
    const brand=fs.readFileSync(path.join(renderer,'novaflow-brand-runtime.js'),'utf8');
    const bridge=brand.slice(brand.indexOf('  function isTopbarAiRuntimeConnected(status)'),brand.indexOf('  function topbarAiRuntimeEnsureBackoffMs('));
    // Run the actual topbar-to-catalogue connection bridge. Its DOM is absent,
    // so it returns after publishing the status to the catalogue.
    await win.webContents.executeJavaScript(`const TOPBAR_AI_RUNTIME_STATUS_ID='absent'; ${bridge}
      function health(online, id) { window.NovaFlowWebRuntime={computeNode:{id}}; updateTopbarAiRuntimeStatus({connected:online}); }`);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const api = NovaFlowArtGenerateLora, host = document.getElementById('host');
      const state = {provider:'local',mode:'txt2img',loras:[]};
      let calls=0, fail=false, pending=null;
      const options={host,state,loadCatalog:async () => {
        calls++; if(pending) return await pending;
        if(fail) throw new Error('暂无在线算力可读取 LoRA');
        return {ok:true,items:[{name:'qwen/style.safetensors'}]};
      }};
      const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
      const snapshots=[];
      const save=name=>snapshots.push({name,calls,text:host.textContent});
      api.mount(options);
      const clock=Date.now; Date.now=()=>clock()+120000;
      for(let i=0;i<30;i++) api.mount(options);
      await flush(); save('offline');
      health(true,'node-a'); await flush(); save('connected');
      state.loras=[{name:'qwen/style.safetensors',strength:0.75,enabled:true}];
      for(let i=0;i<30;i++){health(true,'node-a');api.mount(options);}
      const replacement=document.createElement('div'); document.body.append(replacement);
      api.mount({...options,host:replacement}); await flush(); save('stable-and-remounted');
      health(false,'node-a'); fail=true;
      for(let i=0;i<30;i++) api.mount(options);
      await flush(); save('disconnected');
      health(true,'node-a'); await flush(); save('failed-reconnect');
      for(let i=0;i<30;i++) api.mount(options);
      await flush(); save('no-error-retries');
      if(state.loras[0]?.strength!==0.75) throw new Error('Failure changed the selected LoRA');
      fail=false; health(false,'node-a'); health(true,'node-a');
      await flush(); save('reconnected');
      let finish; pending=new Promise(resolve=>finish=resolve);
      health(true,'old-node'); await flush(); save('inflight');
      health(true,'new-node'); pending=null;
      finish({ok:true,items:[{name:'qwen/stale.safetensors'}]});
      await flush(); await flush(); save('switched-during-request');
      Date.now=clock;
      return {snapshots,names:[...host.querySelectorAll('option')].map(o=>o.value),selected:state.loras,errors:[...document.querySelectorAll('button')].filter(b=>/列表读取失败|重试/.test(b.textContent)).length};
    })()`);
    assert.deepEqual(result.snapshots.map(s=>s.calls), [0,1,1,1,2,2,3,4,5]);
    assert.equal(result.errors,0);
    assert.deepEqual(result.selected,[{name:'qwen/style.safetensors',strength:0.75,enabled:true}]);
    assert(!result.names.includes('qwen/stale.safetensors'));
    console.log(JSON.stringify({ok:true,...result},null,2));
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
setTimeout(()=>app.exit(2),30000);
