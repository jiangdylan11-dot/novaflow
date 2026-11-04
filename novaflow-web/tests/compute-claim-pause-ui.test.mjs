import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const requireTelemetry=createRequire(import.meta.url);
const wait=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};

test('compute IPC limits pause/resume to the trusted window and never stops the assistant',async()=>{
 const handlers=new Map(),windows=[],instances=[];
 const app=Object.assign(new EventEmitter(),{setName(){},setAppUserModelId(){},setPath(){},getPath:()=> 'C:/fixture',getVersion:()=> 'test',isPackaged:true,
  whenReady:()=>({then(){}}),requestSingleInstanceLock:()=>true,quit(){}});
 class Window extends EventEmitter {constructor(options){super();this.options=options;this.webContents={send(){},setWindowOpenHandler(){},on(){}};windows.push(this)}loadFile(){}show(){}focus(){}isDestroyed(){return false}}
 const fs={mkdirSync(){},appendFileSync(){},existsSync:()=>true,readFileSync:()=>JSON.stringify({}),writeFileSync(){}};
 const context=createContext({__dirname:'C:/fixture/app/electron',process:{env:{},resourcesPath:'C:/fixture/resources'},
  require(name){if(name==='node:fs')return fs;if(name==='node:path')return path;if(name==='node:url')return {pathToFileURL};
   if(name==='node:os')return {hostname:()=> 'fixture',totalmem:()=>16*1024**3,freemem:()=>4*1024**3,cpus:()=>[{times:{user:1,nice:0,sys:0,idle:1,irq:0}}]};
   if(name==='node:child_process')return {execFile:(_e,_a,_o,cb)=>cb(null,'Test GPU, 2048, 8192, 55, 18')};
   if(name==='../src/resource-telemetry.cjs')return requireTelemetry('../worker/src/resource-telemetry.cjs');
   if(name==='electron')return {app,BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},shell:{openExternal:async()=>{},openPath(){}},dialog:{},Tray:class{},Menu:{}};
   throw Error(name)},
  async fixtureFactory(){let sharing=false,claimsPaused=false,stopCalls=0;const value={onChange(){},getState:()=>({sharing,claimsPaused}),
   async start(){sharing=true},async stop(){sharing=false;stopCalls++},async pauseClaims(){claimsPaused=true;return {ok:true,paused:true,locallyIdle:true}},
   resumeClaims(){claimsPaused=false},get stopCalls(){return stopCalls}};instances.push(value);return value;}});
 const policy=await import(new URL('../worker/src/qwen-rotation-release-policy.mjs',import.meta.url));
 assert.equal(policy.QWEN_ROTATION_RELEASE_POLICY.verificationEnabled,false);assert.equal(policy.QWEN_ROTATION_RELEASE_POLICY.candidateEnabled,false);
 context.fixtureRotationPolicy=policy;
 const source=await readFile(new URL('../worker/electron/compute-main.cjs',import.meta.url),'utf8');
 const policyImport="import(pathToFileURL(path.join(__dirname, '../src/qwen-rotation-release-policy.mjs')).href)";
 assert.equal(source.split(policyImport).length,2,'launcher must load the managed rotation policy once');
 runInContext(source.replace(policyImport,'Promise.resolve(fixtureRotationPolicy)'),context);
 runInContext('assistantFactory = fixtureFactory; show();',context);
 const trusted=(name)=>handlers.get('compute:'+name)({sender:windows[0].webContents});
 assert.equal((await handlers.get('compute:pauseClaims')({sender:{}})).ok,false);
 assert.equal((await handlers.get('compute:resumeClaims')({sender:{}})).ok,false);
 assert.equal((await trusted('pauseClaims')).ok,false);
 await runInContext('serial(connect)',context);
 const paused=await trusted('pauseClaims');assert.equal(paused.ok,true);assert.equal(paused.state.claimsPaused,true);assert.equal(paused.state.sharing,true);
 const resumed=await trusted('resumeClaims');assert.equal(resumed.ok,true);assert.equal(resumed.state.claimsPaused,false);assert.equal(instances[0].stopCalls,0);
});

test('renderer shows draining and resumes without a stale pause result overwriting the latest state',async()=>{
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{id,textContent:'',disabled:false,hidden:false,dataset:{},style:{},classList:{toggle(){}},setAttribute(){},querySelector(){return {value:0}}});return elements.get(id)};
 const document={getElementById:element,querySelectorAll:()=>[]};
 const pending=deferred(),pendingFree=deferred();let stateListener,stops=0,pauses=0,resumes=0;
 let value={sharing:true,connected:true,runtimeReady:true,comfy:{image:true},policy:{enabled:true,owner_enabled:true,sharing_enabled:true},stats:{}};
 const api={state:async()=>value,getLogs:async()=>[],onLog(){},onState(fn){stateListener=fn},logs(){},website:async()=>{},freeMemory:async()=>pendingFree.promise,
  async pauseClaims(){pauses++;value={...value,claimsPaused:true,claimBusy:true};stateListener(value);return pending.promise},
  async resumeClaims(){resumes++;value={...value,claimsPaused:false,claimBusy:true};stateListener(value);return {ok:true,state:value}},stop(){stops++}};
 const context=createContext({window:{foartCompute:api},document,console,setTimeout,Promise});
 runInContext(await readFile(new URL('../worker/electron/compute-ui.js',import.meta.url),'utf8'),context);await wait();
 assert.equal(element('pauseClaims').textContent,'暂停接单');assert.equal(element('pauseClaims').disabled,false);
 const p=element('pauseClaims').onclick();await wait();
 assert.equal(element('pauseClaims').textContent,'恢复接单');assert.equal(element('activityBadge').textContent,'等待任务完成');assert.equal(element('freeMemory').disabled,true);
 await element('pauseClaims').onclick();pending.resolve({ok:false,error:'暂停已取消。',state:value});await p;
 assert.equal(element('pauseClaims').textContent,'暂停接单');assert.equal(element('error').textContent,'');assert.equal(pauses,1);assert.equal(resumes,1);assert.equal(stops,0);
 stateListener({...value,claimsPaused:true,claimBusy:false,claimOutcomeUnknown:true});
 assert.equal(element('activityBadge').textContent,'领取状态待核对');assert.equal(element('sharing').textContent,'接单已暂停');
 assert.equal(element('freeMemory').disabled,false);stateListener({...value,claimsPaused:true,claimBusy:false,claimOutcomeUnknown:false});assert.equal(element('freeMemory').disabled,false);
 const freeing=element('freeMemory').onclick();await wait();assert.equal(element('pauseClaims').disabled,true);assert.equal(element('freeMemory').disabled,true);
 pendingFree.resolve({ok:true});await freeing;assert.equal(element('pauseClaims').disabled,false);assert.equal(element('freeMemory').textContent,'已请求，完成未确认');
});
