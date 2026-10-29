// CPU-only callbacks from the real editor/UI source: no browser, workers or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=name=>readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8');
const uiSource=source('aifx-template-maker.ui.js');
const editorSource=source('spine-skeleton-editor.js');
const copy=value=>JSON.parse(JSON.stringify(value));

function declarations(text,spaces) {
  const out=[];
  const header=new RegExp('^'+ ' '.repeat(spaces) +'(?:async )?function \\w+\\([^\\n]*\\) \\{[^\\n]*','gm');
  for(const match of text.matchAll(header)) {
    if(/\}\s*$/.test(match[0])){out.push(match[0]);continue;}
    const tail=text.slice(match.index+match[0].length);
    const end=tail.match(new RegExp('^'+ ' '.repeat(spaces) +'\\}\\r?$','m'));
    assert.ok(end,'function closing line missing');
    out.push(text.slice(match.index,match.index+match[0].length+end.index+end[0].length));
  }
  return out;
}

function fixture() {
  const w=160,h=80,data=new Uint8ClampedArray(w*h*4);
  for(let y=12;y<68;y++)for(let x=18;x<142;x++) {
    // An asymmetric notch catches position/shape changes that a centered box hides.
    if(x<54&&y<37)continue;
    data[(y*w+x)*4+3]=255;
  }
  return {w,h,data};
}

function uiHarness(sweep=true) {
  const context=vm.createContext({console,setTimeout,clearTimeout});
  for(const name of ['sweep-light.core.js','aifx-template-maker.core.js'])vm.runInContext(source(name),context);
  const FX=context.NovaFlowFxMaker,pixels=fixture();
  const calls={projectPicker:0,filePicker:0,changed:0,pickedEffect:null};
  const settings={frames:24,pad:0,duration:60};
  const state={project:FX.defaultProject(),base:null,history:[],playhead:3,lastTick:1};
  const effectButton={dataset:{fx:'base-base'},setAttribute(){}};
  context.FX=()=>FX;
  context.S=state;
  context.SW=sweep?{
    fps:30,settings:()=>settings,setSettings:patch=>Object.assign(settings,patch),
    autoPad:(w,h)=>Math.round(Math.min(240,Math.max(24,.2*Math.max(w,h)))),
    pickBase:async()=>{calls.projectPicker++;return calls.cancel?null:{name:'project/base',w:pixels.w,h:pixels.h,data:'fixture-pixels'};},
  }:null;
  const baseButtons=Object.fromEntries(['pick','fit','path','clear'].map(name=>[name,{dataset:{base:name}}]));
  context.E={file:{click(){calls.filePicker++;}},effects:{
    innerHTML:'',querySelectorAll:selector=>selector==='[data-fx]'?[effectButton]:[],
  },shapes:{innerHTML:'',querySelectorAll:()=>[]},basetools:{
    innerHTML:'',querySelector:selector=>baseButtons[selector.match(/data-base="(\w+)"/)?.[1]]||null,
  }};
  context.options={};
  context.size=()=>FX.canvasSize(state.project);
  const canvasSnapshot=uiSource.match(/^    const canvasSnapshot = [^\n]+/m);
  if(canvasSnapshot)vm.runInContext(canvasSnapshot[0],context);
  context.fx=()=>FX.effectOf(state.project.effect);
  context.baseOnly=()=>!!FX.effectOf(state.project.effect).baseOnly;
  context.centered=()=>!!FX.effectOf(state.project.effect).centered;
  context.n=()=>FX.frameCount(state.project);
  context.allPoints=()=>state.project.outlines.flatMap(outline=>outline.points);
  context.esc=String;
  // Declarations stay in the actual open() closure's scope. DOM/preview work is
  // replaced below, while the base-routing and timing callbacks run unchanged.
  for(const declaration of declarations(uiSource,4))vm.runInContext(declaration,context);
  const renderEffects=context.renderEffects,renderShapes=context.renderShapes,loadBase=context.loadBase,pickEffect=context.pickEffect;
  for(const name of ['drawBase','layout','renderShapes','renderParams','renderEffects','drawOverlay','setInfo','setHint','syncTime'])context[name]=()=>{};
  context.changed=()=>{calls.changed++;};
  context.snapshot=()=>{};
  context.cancelDrawing=()=>false;
  context.pickEffect=id=>{calls.pickedEffect=id;pickEffect(id);};
  context.loadBase=async(base,request)=>{state.project.base=base;state.base={rgba:pixels};return request;};
  return {context,FX,state,settings,calls,pixels,effectButton,renderEffects,renderShapes,baseButtons,loadBase};
}

async function settleCallbacks() {
  // A shape click may start the async project picker without returning its promise.
  for(let i=0;i<8;i++)await Promise.resolve();
}

function decodeHarness(sweep=true) {
  const h=uiHarness(sweep),decodes=[],pickers=[],bitmaps=[];
  let editorBase=null;
  h.context.pool=[];
  h.context.loadBase=h.loadBase;
  h.context.Image=class {
    set src(value){this.source=value;decodes.push({source:value,finish:()=>this.onload(),fail:()=>this.onerror()});}
  };
  h.context.document={createElement:()=>{
    let drawn;
    return {getContext:()=>({drawImage:image=>{drawn=image;},getImageData:()=>({data:h.pixels.data})}),toDataURL:()=> 'fixture:'+drawn.name};
  }};
  h.context.document.removeEventListener=()=>{};
  h.context.cancelAnimationFrame=()=>{};
  h.context.overlayRaf=0;
  h.context.preview={cache:new Map(),frames:new Map(),next:new Map(),pending:new Set()};
  h.context.ro={disconnect(){}};
  h.context.overlay={remove(){}};
  h.context.createImageBitmap=file=>new Promise(resolve=>bitmaps.push({name:file.name,finish:()=>resolve({name:file.name,width:h.pixels.w,height:h.pixels.h,close(){}})}));
  if(sweep)h.context.SW.pickBase=()=>new Promise(resolve=>pickers.push({
    select:name=>{editorBase=name;resolve({name,w:h.pixels.w,h:h.pixels.h,data:name});},
    cancel:()=>resolve(null),
  }));
  const start=uiSource.indexOf('    E.file.onchange = async () => {');
  const end=uiSource.indexOf('    async function loadBase(',start);
  vm.runInContext(uiSource.slice(start,end),h.context);
  return {...h,decodes,pickers,bitmaps,get editorBase(){return editorBase;}};
}

test('reverse image decodes cannot replace a newer Spine base or its effect callback',async()=>{
  const h=decodeHarness();
  const first=h.context.chooseBase('effect:edge-meteor');h.pickers[0].select('first');await settleCallbacks();
  const second=h.context.chooseBase('effect:edge-twin');h.pickers[1].select('second');await settleCallbacks();
  h.decodes.find(decode=>decode.source==='second').finish();
  assert.equal(await second,true);
  h.decodes.find(decode=>decode.source==='first').finish();
  assert.equal(await first,false);
  assert.equal(h.editorBase,'second');
  assert.equal(h.state.project.base.name,'second');
  assert.equal(h.state.base.img.source,'second');
  assert.equal(h.calls.pickedEffect,'edge-twin');
});

test('opening then cancelling another picker does not invalidate an already selected image decode',async()=>{
  const h=decodeHarness();
  const first=h.context.chooseBase('effect:edge-meteor');h.pickers[0].select('first');await settleCallbacks();
  const request=h.state.baseRequest;
  const cancelled=h.context.chooseBase('effect:edge-twin');
  assert.equal(h.state.baseRequest,request,'opening a picker is not a new selected image');
  // A real project picker can close without resolving its Promise. It must not
  // lock or invalidate the first decode, even while that Promise stays pending.
  h.decodes[0].finish();assert.equal(await first,true);
  assert.equal(h.state.project.base.name,'first');
  assert.equal(h.editorBase,'first');
  h.pickers[1].cancel();assert.equal(await cancelled,false);
  assert.equal(h.calls.pickedEffect,null,'a newer effect intent supersedes only the old effect callback');
});

test('a newer effect intent still applies when the older image finishes before the newer picker selects',async()=>{
  const h=decodeHarness();
  const first=h.context.chooseBase('effect:edge-meteor');h.pickers[0].select('first');await settleCallbacks();
  const second=h.context.chooseBase('effect:edge-twin');
  h.decodes[0].finish();assert.equal(await first,true);
  assert.equal(h.state.project.base.name,'first','the newer picker has not selected an image yet');
  assert.equal(h.calls.pickedEffect,null,'the newer intent prevents the older effect from changing revision');
  h.pickers[1].select('second');await settleCallbacks();
  h.decodes[1].finish();assert.equal(await second,true);
  assert.equal(h.state.project.base.name,'second');
  assert.equal(h.state.project.effect,'edge-twin');
});

test('an explicitly chosen effect is not overwritten by an earlier pending base request',async()=>{
  const h=decodeHarness();
  const pending=h.context.chooseBase('effect:edge-meteor');h.pickers[0].select('first');await settleCallbacks();
  h.context.pickEffect('edge-twin');
  h.decodes[0].finish();assert.equal(await pending,true);
  assert.equal(h.state.project.base.name,'first');
  assert.equal(h.state.project.effect,'edge-twin');
  assert.equal(h.calls.pickedEffect,'edge-twin');
});

test('closing a window or removing its base prevents an unfinished decode from committing',async()=>{
  for(const action of ['close','removeSweepBase']) {
    const h=decodeHarness();
    const pending=h.context.chooseBase();h.pickers[0].select('first');await settleCallbacks();
    h.context[action]();
    h.decodes[0].finish();assert.equal(await pending,false,action);
    assert.equal(h.state.base,null,action);
    assert.equal(h.state.project.base,null,action);
  }
});

test('stale and closed-window decode errors do not write failure messages over current state',async()=>{
  for(const action of ['new-selection','close']) {
    const h=decodeHarness(),errors=[];h.context.setInfo=message=>errors.push(message);
    const first=h.context.chooseBase();h.pickers[0].select('first');await settleCallbacks();
    if(action==='close')h.context.close();
    else {
      const second=h.context.chooseBase();h.pickers[1].select('second');await settleCallbacks();
      h.decodes[1].finish();assert.equal(await second,true);
    }
    h.decodes[0].fail();assert.equal(await first,false);
    assert.deepEqual(errors,[],action);
  }
});

test('a decode error for the current selected image remains visible',async()=>{
  const h=decodeHarness(),errors=[];h.context.setInfo=message=>errors.push(message);
  const pending=h.context.chooseBase();h.pickers[0].select('current');await settleCallbacks();
  h.decodes[0].fail();assert.equal(await pending,false);
  assert.equal(errors.length,1);
  assert.match(errors[0],/图片解码失败/);
  assert.equal(h.state.project.base,null);
});

test('out-of-order local bitmap reads cannot supersede a later chosen local file',async()=>{
  const h=decodeHarness(false);
  h.context.chooseBase('effect:edge-meteor');h.context.E.file.files=[{name:'first'}];const first=h.context.E.file.onchange();
  h.context.chooseBase('effect:edge-twin');h.context.E.file.files=[{name:'second'}];const second=h.context.E.file.onchange();
  h.bitmaps[1].finish();await settleCallbacks();h.decodes[0].finish();await second;
  h.bitmaps[0].finish();await first;
  assert.equal(h.decodes.length,1,'the stale bitmap never starts another image decode');
  assert.equal(h.state.project.base.name,'second');
  assert.equal(h.calls.pickedEffect,'edge-twin');
});

test('a completed local upload consumes only its captured intent and preserves a later picker intent',async()=>{
  const h=decodeHarness(false);
  h.context.chooseBase('effect:edge-meteor');h.context.E.file.files=[{name:'first'}];const first=h.context.E.file.onchange();
  assert.equal(h.state.afterBase,'');
  h.context.chooseBase('effect:edge-twin');
  h.bitmaps[0].finish();await settleCallbacks();h.decodes[0].finish();await first;
  assert.equal(h.state.afterBase,'effect:edge-twin');
  h.context.E.file.files=[{name:'second'}];const second=h.context.E.file.onchange();
  h.bitmaps[1].finish();await settleCallbacks();h.decodes[1].finish();await second;
  assert.equal(h.state.project.base.name,'second');
  assert.equal(h.calls.pickedEffect,'edge-twin');
});

test('removing a standalone base invalidates a local bitmap read still in progress',async()=>{
  const h=decodeHarness(false);
  h.state.project.base={name:'previous',data:'previous',w:h.pixels.w,h:h.pixels.h,scale:.7};
  h.state.base={rgba:h.pixels};
  h.context.chooseBase();h.context.E.file.files=[{name:'pending'}];const pending=h.context.E.file.onchange();
  h.renderShapes();h.baseButtons.clear.onclick();
  h.bitmaps[0].finish();await pending;
  assert.equal(h.state.base,null);
  assert.equal(h.state.project.base,null);
  assert.equal(h.decodes.length,0);
});

test('an initial project-image decode cannot overwrite an image selected after the window opened',async()=>{
  const h=decodeHarness();
  h.state.project.base={name:'initial',data:'initial',w:h.pixels.w,h:h.pixels.h,scale:.7,opacity:1};
  const start=uiSource.lastIndexOf('    if (S.project.base && S.project.base.data) {');
  const end=uiSource.indexOf('    layout(); changed()',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(uiSource.slice(start,end),h.context);
  const pending=h.context.chooseBase();h.pickers[0].select('chosen');await settleCallbacks();
  h.decodes.find(decode=>decode.source==='chosen').finish();assert.equal(await pending,true);
  h.decodes.find(decode=>decode.source==='initial').finish();await settleCallbacks();
  assert.equal(h.state.project.base.name,'chosen');
  assert.equal(h.state.base.img.source,'chosen');
});

test('empty Spine sweep uses the project-image picker for 图片轮廓 before tracing',async()=>{
  const h=uiHarness();
  h.context.setShape('trace');
  await settleCallbacks();
  assert.equal(h.calls.projectPicker,1,'sweep image selection must update the editor base identity');
  assert.equal(h.calls.filePicker,0,'the standalone upload path does not maintain Spine base identity');
  assert.equal(h.state.project.shape.kind,'trace');
  const placement=h.FX.basePlacement(h.state.project);
  assert.equal(placement.w,h.pixels.w,'Spine sweep traces after fitting to native pixels plus padding');
  assert.equal(placement.h,h.pixels.h);
  assert.ok(h.state.project.outlines[0].points.length>3);
  const spatial=copy({canvas:h.state.project.canvas,base:h.state.project.base,outlines:h.state.project.outlines,start:h.state.project.start});
  h.context.setSweep('frames',48);
  assert.deepEqual(copy({canvas:h.state.project.canvas,base:h.state.project.base,outlines:h.state.project.outlines,start:h.state.project.start}),spatial);
  assert.equal(h.state.project.frames,48);
});

test('base-dependent sweep effects also use the project-image picker',async()=>{
  const h=uiHarness();
  assert.equal(h.FX.effectOf('base-base').needsBase,true);
  h.renderEffects();
  h.effectButton.onclick();
  await settleCallbacks();
  assert.equal(h.calls.projectPicker,1);
  assert.equal(h.calls.filePicker,0);
  assert.equal(h.calls.pickedEffect,'base-base');
});

test('the sweep toolbar uses the same project picker while standalone templates upload locally',async()=>{
  for(const sweep of [true,false]) {
    const h=uiHarness(sweep);
    h.renderShapes();
    h.baseButtons.pick.onclick();
    await settleCallbacks();
    assert.equal(h.calls.projectPicker,sweep?1:0);
    assert.equal(h.calls.filePicker,sweep?0:1);
  }
});

test('cancelling any sweep base request leaves the project and effect unchanged',async()=>{
  for(const action of ['trace','effect','toolbar']) {
    const h=uiHarness();h.calls.cancel=true;
    const before=copy(h.state.project);
    if(action==='trace')h.context.setShape('trace');
    else if(action==='effect'){h.renderEffects();h.effectButton.onclick();}
    else {h.renderShapes();h.baseButtons.pick.onclick();}
    await settleCallbacks();
    assert.equal(h.calls.projectPicker,1,action);
    assert.equal(h.calls.filePicker,0,action);
    assert.equal(h.calls.pickedEffect,null,action);
    assert.deepEqual(copy(h.state.project),before,action);
    assert.equal(h.state.history.length,0,action);
  }
});

test('changing sample frames or duration preserves all spatial state, including an already loaded base',()=>{
  const h=uiHarness();
  // The public loadBase path can carry an existing placement. A temporal edit
  // must never resize that image, canvas or user-adjusted contour.
  h.state.base={rgba:h.pixels};
  Object.assign(h.state.project,{
    canvas:{preset:'custom',w:640,h:384},
    base:{w:h.pixels.w,h:h.pixels.h,data:'fixture-pixels',scale:.7,opacity:.8,dx:11,dy:-7},
    start:{x:201,y:66},offset:13,corner:0,
  });
  const before=copy({canvas:h.state.project.canvas,base:h.state.project.base,outlines:h.state.project.outlines,start:h.state.project.start,offset:h.state.project.offset});
  const phase=h.state.playhead/h.FX.frameCount(h.state.project);
  h.context.setSweep('frames',60);
  assert.equal(h.settings.frames,60);
  assert.equal(h.state.project.frames,60);
  assert.ok(Math.abs(h.state.playhead/h.FX.frameCount(h.state.project)-phase)<1e-12);
  assert.deepEqual(copy({canvas:h.state.project.canvas,base:h.state.project.base,outlines:h.state.project.outlines,start:h.state.project.start,offset:h.state.project.offset}),before);
  const playhead=h.state.playhead;
  h.context.setSweep('duration',96);
  assert.equal(h.settings.duration,96);
  assert.equal(h.state.project.frames,60);
  assert.equal(h.state.project.effectDuration,96/30);
  assert.equal(h.state.playhead,playhead);
  assert.deepEqual(copy({canvas:h.state.project.canvas,base:h.state.project.base,outlines:h.state.project.outlines,start:h.state.project.start,offset:h.state.project.offset}),before);
});

function meteor(h,lifecycle,count,playhead) {
  Object.assign(h.state.project,{
    effect:'edge-meteor',params:h.FX.effectDefaults('edge-meteor'),lifecycle,
    framesFree:true,frames:count,effectDuration:h.settings.duration/h.context.SW.fps,
  });
  h.settings.frames=count;
  h.state.playhead=playhead;
}

// Only a single simple effect at 80x80 is rendered. The callback is exercised
// with several sample counts; a fractional playhead tests continuous phase too.
function meteorFrame(h) {
  return Buffer.from(h.FX.renderFrame(h.FX.prepare(copy(h.state.project),.125),h.state.playhead));
}

test('loop sample-count changes preserve phase and real meteor pixels, including wraparound',()=>{
  const h=uiHarness();
  for(const [oldCount,newCount,oldPlayhead,expectedPlayhead] of [
    [24,60,6,15],
    [60,12,45,9],
    [12,48,33,36],
    [24,60,9,22.5],
    [2,120,1,60],
  ]) {
    meteor(h,'loop',oldCount,oldPlayhead);
    const before=meteorFrame(h),project=copy(h.state.project);
    h.context.setSweep('frames',newCount);
    assert.ok(Math.abs(h.state.playhead-expectedPlayhead)<1e-12,`${oldCount} -> ${newCount}`);
    assert.deepEqual(meteorFrame(h),before,'same phase must render the same meteor at another sampling count');
    assert.deepEqual(copy({...h.state.project,frames:oldCount}),project,'sample-count edit changes no spatial or effect parameters');
    assert.ok(before.some((value,index)=>index%4!==3&&value>0),'loop comparison contains a visible meteor');
  }
});

test('once sample-count changes preserve phase and real meteor pixels, including endpoints',()=>{
  const h=uiHarness();
  for(const [oldCount,newCount,oldPlayhead,expectedPlayhead] of [
    [25,61,6,15],
    [61,13,45,9],
    [13,49,12,48],
    [49,25,50,24],
    [25,61,0,0],
    [2,120,.5,59.5],
  ]) {
    meteor(h,'once',oldCount,oldPlayhead);
    const before=meteorFrame(h),project=copy(h.state.project);
    h.context.setSweep('frames',newCount);
    assert.ok(Math.abs(h.state.playhead-expectedPlayhead)<1e-12,`${oldCount} -> ${newCount}`);
    assert.deepEqual(meteorFrame(h),before,'once phase uses count - 1 and retains the rendered endpoint');
    assert.deepEqual(copy({...h.state.project,frames:oldCount}),project);
    if(oldPlayhead>0&&oldPlayhead<oldCount-1)assert.ok(before.some((value,index)=>index%4!==3&&value>0),'interior once comparison contains a visible meteor');
  }
});

test('duration changes preserve exact fractional playhead and meteor pixels for loop and once',()=>{
  const h=uiHarness();
  for(const lifecycle of ['loop','once']) {
    h.settings.duration=60;
    meteor(h,lifecycle,48,17.25);
    const before=meteorFrame(h),project=copy(h.state.project);
    h.context.setSweep('duration',135);
    assert.equal(h.state.playhead,17.25);
    assert.equal(h.state.project.effectDuration,4.5);
    assert.equal(h.state.project.frames,48);
    assert.deepEqual(meteorFrame(h),before);
    assert.deepEqual(copy({...h.state.project,effectDuration:project.effectDuration}),project);
  }
});

test('standalone template 图片轮廓 keeps its local upload path',()=>{
  const h=uiHarness(false);
  h.context.setShape('trace');
  assert.equal(h.calls.projectPicker,0);
  assert.equal(h.calls.filePicker,1);
  assert.equal(h.state.afterBase,'trace');
});

test('Spine pickBase and sample settings remain preview-only until explicit generation',async()=>{
  const context=vm.createContext({console});
  for(const name of ['sweep-light.core.js','aifx-template-maker.core.js'])vm.runInContext(source(name),context);
  const FX=context.NovaFlowFxMaker,pixels=fixture();
  const json={bones:[{name:'root'}],slots:[],skins:[{name:'default',attachments:{}}],animations:{animation:{}}};
  const state={json,history:[],future:[],skin:'default',sweepStart:0,sweepEnd:60,sweepParams:{frames:24,pad:0}};
  let options;
  Object.assign(context,{
    state,FxMaker:()=>FX,FxMakerUI:()=>({open:opts=>{options=opts;return {project:opts.project};}}),
    FPS:30,lastFrame:()=>60,sweepEndFrame:()=>state.sweepEnd,
    sweepEffectOk:effect=>effect.kind==='edge'||effect.kind==='basesweep'||(effect.kind==='lib'&&!effect.centered),
    basePixels:()=>({w:pixels.w,h:pixels.h,rgba:pixels.data}),sweepDataUrl:()=> 'fixture-pixels',
    openImagePicker:(_title,choose)=>choose('project/base'),
    renderLayerDock:()=>{},status:message=>{throw Error(message);},
  });
  const showing=editorSource.match(/^  function slotsShowingAll\([^\n]*\) \{[\s\S]*?^  \}/m);
  const open=editorSource.match(/^  function openSweepPanel\([^\n]*\) \{[\s\S]*?^  \}/m);
  assert.ok(showing&&open,'real Spine sweep callbacks remain available');
  vm.runInContext(showing[0]+'\n'+open[0],context);
  const before=JSON.stringify(state.json);
  context.openSweepPanel(null);
  assert.equal(options.project.base,null);
  const picked=await options.sweep.pickBase();
  assert.equal(picked.name,'project/base');
  assert.equal(picked.w,pixels.w);
  assert.equal(picked.h,pixels.h);
  options.sweep.setSettings({frames:48});
  assert.equal(options.sweep.settings().frames,48);
  assert.equal(JSON.stringify(state.json),before,'no skeleton, attachment or animation write during preview');
  assert.equal(state.history.length,0,'preview does not create a project undo entry');
  assert.equal(state.sweepGen,undefined,'slices require explicit 确定生成');
});
