import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createDomSandbox} from '../../worker/src/comfy/dom-shim.mjs';

const source = await readFile(new URL('../../renderer/home-shell.js',import.meta.url),'utf8');
const tick = () => new Promise(resolve=>setTimeout(resolve,10));
const names = ['骨骼动画','音视频','特效制作','UI 设计','图片编辑','常用工具'];
function fixture({authenticated=true,href='https://foart.invalid/'}={}) {
  const listeners = new Map(), calls = [], navigations = [], buttons = names.map(name=>({dataset:{name},isConnected:true,focus(){},addEventListener(type,fn){this[type]=fn;}}));
  let frames=0, gate=0, auth=authenticated, booting=false;
  const home={hidden:true},status={textContent:''};
  const editor={location:{origin:'https://foart.invalid'},document:{querySelector:()=>({}),body:{classList:{contains:name=>name==='novaflow-boot-splash-active'&&booting}}},NovaFlowFoartTools:{open:async surface=>{assert.equal(host.hidden,false,'editor must have a layout viewport before opening');calls.push(surface);return {phase:'opened',surface};}}};
  const host={hidden:true,style:{visibility:''},appendChild(child){this.child=child;}};
  const doc={getElementById:id=>({'foart-home':home,'foart-editor-host':host,'foart-home-status':status})[id],querySelectorAll:()=>buttons,
    createElement:tag=>{assert.equal(tag,'iframe');frames++;return {contentWindow:editor,focus(){},title:'',src:''};}};
  const location=new URL(href), root={document:doc,location,URL,Set,Date,setTimeout:(fn)=>setTimeout(fn,0),
    electronAPI:{clientAuthStatus:async()=>({ok:true,result:{authenticated:auth}})},NovaFlowWebAccount:{guard:async()=>{gate++;}},
    history:{pushState(_state,_title,value){navigations.push(value);const u=new URL(value,location.href);location.href=u.href;}},
    addEventListener(type,fn){listeners.set(type,fn);}};
  root.window=root;createContext(root);runInContext(source,root);
  return {root,doc,home,host,status,buttons,calls,navigations,editor,listeners,get frames(){return frames;},get gate(){return gate;},setAuth(value){auth=value;},setBooting(value){booting=value;}};
}

test('cold homepage authenticates without creating an editor or probing a node',async()=>{
  const f=fixture();await tick();assert.equal(f.home.hidden,false);assert.equal(f.host.hidden,true);assert.equal(f.frames,0);assert.deepEqual(f.calls,[]);
});
test('light-home mode suppresses the actual web runtime node prefetch',async()=>{
  const runtime=await readFile(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
  const calls=[];const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,TextEncoder,TextDecoder,crypto:webcrypto,
    NOVAFLOW_LIGHT_HOME:true,NOVAFLOW_WEB_CONFIG:{controlUrl:'https://control.invalid'},
    fetch:async url=>{calls.push(String(url));return Response.json({features:{},taskTypes:[]});}});
  runInContext(runtime,createContext(sandbox));await tick();
  assert.deepEqual(calls,[]);assert.equal(typeof sandbox.electronAPI.clientAuthLogin,'function');
});
test('unauthenticated homepage stays hidden and uses the existing login gate',async()=>{
  const f=fixture({authenticated:false});await tick();assert.equal(f.home.hidden,true);assert.equal(f.frames,0);assert.equal(f.gate,1);
});
test('six buttons dispatch the existing native surface and reuse one editor',async()=>{
  const f=fixture();await tick();const expected=['animation','video','effects','ui','drawing','tools'];
  for(let i=0;i<names.length;i++){f.buttons[i].click();await tick();assert.equal(f.calls.at(-1),expected[i]);assert.equal(f.host.hidden,false);
    f.listeners.get('message')({origin:'https://foart.invalid',source:f.editor,data:{type:'foart:return-home'}});assert.equal(f.home.hidden,false);}
  assert.equal(f.frames,1);assert.equal(f.calls.length,6);
});
test('deep link retains unrelated query and hash, and return never reloads the frame',async()=>{
  const f=fixture({href:'https://foart.invalid/?surface=ui&other=1#preserve'});await tick();assert.equal(f.frames,1);assert.equal(f.calls[0],'ui');
  assert.match(f.host.child.src,/editor\.html\?surface=ui&other=1#preserve$/);f.listeners.get('message')({origin:'https://foart.invalid',source:f.editor,data:{type:'foart:return-home'}});
  assert.equal(f.frames,1);assert.equal(f.host.hidden,true);assert.match(f.navigations.at(-1),/other=1#preserve$/);
});
test('untrusted messages cannot hide the editor and unload is guarded',async()=>{
  const f=fixture();await tick();f.buttons[0].click();await tick();
  f.listeners.get('message')({origin:'https://other.invalid',source:f.editor,data:{type:'foart:return-home'}});assert.equal(f.host.hidden,false);
  const event={preventDefault(){this.prevented=true;}};f.listeners.get('beforeunload')(event);assert.equal(event.prevented,true);assert.equal(event.returnValue,'');
});

test('editor boot splash prevents opening an incompletely initialized surface',async()=>{const f=fixture();await tick();f.setBooting(true);f.buttons[0].click();await tick();assert.equal(f.frames,1);assert.deepEqual(f.calls,[]);f.setBooting(false);await tick();assert.deepEqual(f.calls,['animation']);});

test('each entry keeps the editor loading state without a duplicate home toast',async()=>{
  for(let i=0;i<names.length;i++){
    const f=fixture();await tick();f.setBooting(true);f.buttons[i].click();await tick();
    assert.equal(f.host.hidden,false);assert.equal(f.status.textContent,'');assert.deepEqual(f.calls,[]);
    f.setBooting(false);await tick();assert.equal(f.calls.length,1);assert.equal(f.status.textContent,'');
  }
});

test('repeated entry clicks open the last requested surface without an interim toast',async()=>{
  const f=fixture();await tick();f.setBooting(true);f.buttons[0].click();await tick();
  f.buttons[4].click();await tick();assert.equal(f.status.textContent,'');assert.deepEqual(f.calls,[]);
  f.setBooting(false);await tick();await tick();
  assert.deepEqual(f.calls,['drawing']);assert.equal(f.status.textContent,'');assert.equal(f.frames,1);
});

test('entry failures remain visible and a new attempt clears the stale failure',async()=>{
  const f=fixture();await tick();const open=f.editor.NovaFlowFoartTools.open;
  f.editor.NovaFlowFoartTools.open=async()=>{throw new Error('fixture failure');};
  f.buttons[0].click();await tick();assert.equal(f.status.textContent,'fixture failure');assert.equal(f.home.hidden,false);
  f.editor.NovaFlowFoartTools.open=open;f.buttons[0].click();
  assert.equal(f.status.textContent,'');await tick();assert.equal(f.host.hidden,false);assert.equal(f.status.textContent,'');
});

test('each cold deep link passes its target to the first editor document',async()=>{
  for(const surface of ['animation','video','effects','ui','drawing','tools']) {
    const f=fixture({href:`https://foart.invalid/?surface=${surface}`});
    await tick();
    assert.equal(f.frames,1, surface);
    assert.equal(new URL(f.host.child.src).searchParams.get('surface'),surface);
    assert.deepEqual(f.calls,[surface]);
  }
});

test('signed-in deep link opens the requested surface and home navigation retains the same editor state',async()=>{
  const guest=fixture({authenticated:false,href:'https://foart.invalid/?surface=drawing'});
  await tick();assert.equal(guest.gate,1);assert.equal(guest.frames,0);
  // A signed-in refresh keeps its surface. Login itself lands on the homepage (web-account test).
  const f=fixture({href:'https://foart.invalid/?surface=drawing'});await tick();
  assert.equal(f.calls[0],'drawing');
  const frame=f.host.child;f.editor.unsavedProject={name:'temporary',value:31};
  f.listeners.get('message')({origin:'https://foart.invalid',source:f.editor,data:{type:'foart:return-home'}});
  assert.equal(f.home.hidden,false);assert.equal(f.host.hidden,true);
  f.buttons[4].click();await tick();
  assert.equal(f.host.child,frame);assert.deepEqual(f.editor.unsavedProject,{name:'temporary',value:31});
  assert.equal(f.frames,1);assert.equal(f.calls.at(-1),'drawing');
});

test('logo is accessible and returns home; the version is not an action',async()=>{
  const bridge=await readFile(new URL('../../renderer/home-frame-bridge.js',import.meta.url),'utf8');
  const events=new Map(), messages=[], attrs={};
  const style={getPropertyValue:()=>'',getPropertyPriority:()=>'',setProperty(){},removeProperty(){}};
  const logo={style,setAttribute:(name,value)=>{attrs[name]=value;},addEventListener(){},closest(selector){return selector.includes('img[alt="logo"]')?this:null;}};
  const version={tagName:'BUTTON',setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];},closest(selector){return selector.includes('nf-brand-version')?this:null;}};
  const head={appendChild(child){this.child=child;}};
  const doc={head,documentElement:{},getElementById:()=>null,createElement:()=>({}),
    querySelector:selector=>selector.includes('img[alt="logo"]')?logo:selector.includes('nf-brand-version')?version:null,
    addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);}};
  const root={document:doc,location:{origin:'https://foart.invalid'},parent:{postMessage:(payload,origin)=>messages.push({type:payload.type,origin})}};
  root.window=root;runInContext(bridge,createContext(root));
  assert.equal(logo.tabIndex,0);assert.equal(attrs.role,'button');assert.match(head.child.textContent,/cursor:pointer/);
  assert.equal(version.disabled,true);assert.equal(version.tabIndex,-1);assert.equal(version.role,'none');
  const dispatch=(type,target,key)=>{const e={type,target,key,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};for(const fn of events.get(type)||[])fn(e);return e;};
  assert.equal(dispatch('click',logo).prevented,true);
  assert.equal(dispatch('keydown',logo,'Enter').prevented,true);
  assert.equal(dispatch('keydown',logo,' ').prevented,true);
  assert.deepEqual(messages.map(x=>x.type),['foart:return-home','foart:return-home','foart:return-home']);
  assert(messages.every(x=>x.origin==='https://foart.invalid'));
  assert.equal(dispatch('click',version).stopped,true);
  assert.equal(dispatch('keydown',version,'Enter').stopped,true);
});

test('animation handoff waits for a settling transaction and does not reselect the active tab',async()=>{
  const tools=await readFile(new URL('../../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8');
  let ticks=0,secondaryClicks=0;
  const secondary={isConnected:true,textContent:'骨骼动画',getBoundingClientRect:()=>({width:20,height:20,left:0,top:0}),closest:()=>null,
    getAttribute:name=>name==='aria-pressed'?'true':null,dispatchEvent:e=>{if(e.type==='click')secondaryClicks++;}};
  class FakeEvent {constructor(type){this.type=type;}}
  const root={document:{body:{classList:{contains:name=>name==='novaflow-primary-target-animation'}},
    querySelectorAll:selector=>selector.includes('secondary-entry')?[secondary]:[]},
    NovaFlowSkeletonEditor:{active:()=>ticks>=6},NovaFlowPrimaryAnimationEntrySettling:()=>ticks<3,
    getComputedStyle:()=>({}),setTimeout:fn=>{ticks++;queueMicrotask(fn);},PointerEvent:FakeEvent,MouseEvent:FakeEvent};
  root.window=root;runInContext(tools,createContext(root));
  assert.equal((await root.NovaFlowFoartTools.open('animation')).phase,'opened');
  assert.equal(secondaryClicks,0,'an already selected tab must not be clicked again');
  assert(ticks>=6,'opening must wait for the real editor to become active');
});

test('animation handoff retries a primary click at most once after the transaction becomes idle',async()=>{
  const tools=await readFile(new URL('../../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8');
  let ticks=0,clicks=0,active=false;
  const primary={isConnected:true,textContent:'动画',getBoundingClientRect:()=>({width:20,height:20,left:0,top:0}),closest:()=>null,
    getAttribute:()=>null,dispatchEvent:e=>{if(e.type==='click'){clicks++;if(clicks===2)active=true;}}};
  class FakeEvent {constructor(type){this.type=type;}}
  const root={document:{body:{classList:{contains:()=>false}},querySelectorAll:selector=>selector.includes('primary-entry')?[primary]:[]},
    NovaFlowSkeletonEditor:{active:()=>active},NovaFlowPrimaryAnimationEntrySettling:()=>ticks<3,
    getComputedStyle:()=>({}),setTimeout:fn=>{ticks++;queueMicrotask(fn);},PointerEvent:FakeEvent,MouseEvent:FakeEvent};
  root.window=root;runInContext(tools,createContext(root));
  assert.equal((await root.NovaFlowFoartTools.open('animation')).phase,'opened');
  assert.equal(clicks,2);assert(ticks>=5,'retry must wait for idle samples');
});
