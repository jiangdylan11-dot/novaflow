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
equal(bundled.length,19);
let api=boot([{id:'custom',name:'我的模板',config:{systemName:'test'}}]);
equal((await api.saveUserData({key:'templates',data:[]})).skipped,true);
equal((await api.loadUserData('templates')).data.length,20);
const edited=[{...bundled[0],name:'我的修改'}];
equal((await api.saveUserData({key:'templates',data:edited})).ok,true);
api=boot();equal((await api.loadUserData('templates')).data[0].name,'我的修改');
equal((await api.templatesResetToBundled()).data.length,19);
await api.saveUserData({key:'templates',data:[]});
equal((await boot().loadUserData('templates')).data.length,0); // intentional empty library survives reload
equal(data.get('templates').length,0);
console.log(checks+' passed, 0 failed: bundled template seed, startup race, migration and local persistence');
