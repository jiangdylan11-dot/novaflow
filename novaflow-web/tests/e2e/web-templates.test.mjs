import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
const source=await readFile(new URL('../../renderer/novaflow-web-templates.js',import.meta.url),'utf8');
const bundled=JSON.parse(await readFile(new URL('../../web-dist/templates/particle-bundled.json',import.meta.url),'utf8'));
const data=new Map();let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
function boot(legacy) {
  const sandbox={structuredClone,electronAPI:{},localStorage:{getItem:()=>legacy?JSON.stringify(legacy):null},fetch:async()=>({ok:true,json:async()=>bundled}),indexedDB:{open(){const req={};queueMicrotask(()=>{
    req.result={transaction(){const tx={};tx.objectStore=()=>({get(key){const request={result:structuredClone(data.get(key))};queueMicrotask(()=>tx.oncomplete());return request;},put(value,key){data.set(key,structuredClone(value));queueMicrotask(()=>tx.oncomplete());return {};}});return tx;}};req.onsuccess();});return req;}}};
  sandbox.window=sandbox;runInContext(source,createContext(sandbox));return sandbox.electronAPI;
}
equal(bundled.length,15);
equal(bundled.filter((t)=>['NovaFlow项目_光点','21_UI_按钮环绕流光','NovaFlow项目_线团','NovaFlow项目_雷电魔法球'].includes(t.name)).length,0);
equal(bundled.some((t)=>t.name==='NovaFlow项目_漩涡'),true);
let api=boot([{id:'custom',name:'我的模板',config:{systemName:'test'}}]);
equal((await api.saveUserData({key:'templates',data:[]})).skipped,true);
equal((await api.loadUserData('templates')).data.length,16);
const edited=[{...bundled[0],name:'我的修改'}];
equal((await api.saveUserData({key:'templates',data:edited})).ok,true);
api=boot();equal((await api.loadUserData('templates')).data[0].name,'我的修改');
equal((await api.templatesResetToBundled()).data.length,15);
// a library seeded before 2026-10-16 still holding retired built-ins: they leave on the next load
data.set('templates',[{id:'file_NovaFlow项目_光点',name:'NovaFlow项目_光点'},{id:'file_NovaFlow项目_线团',name:'NovaFlow项目_线团'},{id:'mine',name:'我的'}]);
equal((await boot().loadUserData('templates')).data.map((t)=>t.id),['mine']);
equal(data.get('templates').length,1);
await api.saveUserData({key:'templates',data:[]});
equal((await boot().loadUserData('templates')).data.length,0); // intentional empty library survives reload
equal(data.get('templates').length,0);
console.log(checks+' passed, 0 failed: bundled template seed, startup race, migration, retired built-ins and local persistence');
