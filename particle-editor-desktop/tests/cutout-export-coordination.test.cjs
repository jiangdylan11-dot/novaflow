const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const text=fs.readFileSync(require('node:path').join(__dirname,'../../particle-editor/novaflow-brand-runtime.js'),'utf8');
const ast=ts.createSourceFile('brand.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const names=['completeAiSequenceCutoutMediaSaveAndClose','deferAiSequenceCutoutExportUntilSaved'],code=[];
function visit(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)){code.push(n.getText(ast));return;}ts.forEachChild(n,visit);}visit(ast);
function fixture(){
 let active=true,lane=true,replay=0,commits=0,releases=0,errors=0,resolve,reject;
 const pending=new Promise((yes,no)=>{resolve=()=>{active=false;yes(true)};reject=no;});
 const ctx={window:{NovaFlowAiCutoutSessionBridge:{isActive:()=>active,tool:()=> 'ai'}},document:{body:{classList:{contains:()=>lane}}},
  stopNovaflowExportDialogEvent:e=>{e.stopped=true},getAiSequenceStateController:()=>({}),
  beginAiSequenceCutoutSavingLock:()=>()=>{releases++},showAiSequenceCutoutSaveError:()=>{errors++},showTopbarExportAvailabilityNotice:()=>{errors++},
  requestAnimationFrame:cb=>queueMicrotask(cb),triggerNovaflowExportShortcutAction:()=>{replay++},
  performAiSequenceCutoutMediaSaveAndClose:()=>{commits++;return pending}};
 vm.createContext(ctx);vm.runInContext('let AI_SEQUENCE_CUTOUT_SAVE_PROMISE=null,AI_SEQUENCE_CUTOUT_EXPORT_PENDING=null;'+code.join('\n'),ctx);
 const button={isConnected:true,disabled:false,click:()=>{replay++}};
 return {ctx,button,resolve,reject,setLane:v=>lane=v,setActive:v=>active=v,stats:()=>({replay,commits,releases,errors})};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
function declaration(name){let result;function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name){result=n.getText(ast);return;}ts.forEachChild(n,walk);}walk(ast);assert(result,name);return result;}
test('cold export saves once, closes, then resumes exactly once despite double click',async()=>{
 const f=fixture();assert.equal(code.length,2);
 assert.equal(f.ctx.deferAiSequenceCutoutExportUntilSaved({type:'pointerdown'},f.button),true);
 assert.equal(f.stats().commits,0);
 for(let i=0;i<2;i++)assert.equal(f.ctx.deferAiSequenceCutoutExportUntilSaved({type:'click'},f.button),true);
 assert.deepEqual(f.stats(),{replay:0,commits:1,releases:0,errors:0});
 f.resolve();await settled();assert.deepEqual(f.stats(),{replay:1,commits:1,releases:1,errors:0});
});
test('export joins manual save; failed save keeps editing and never exports',async()=>{
 const f=fixture();const manual=f.ctx.completeAiSequenceCutoutMediaSaveAndClose({},'ai-cutout');
 f.ctx.deferAiSequenceCutoutExportUntilSaved({type:'click'},f.button);
 f.reject(Error('disk full'));await assert.rejects(manual,/disk full/);await settled();
 assert.deepEqual(f.stats(),{replay:0,commits:1,releases:1,errors:1});
 assert.equal(f.ctx.window.NovaFlowAiCutoutSessionBridge.isActive(),true);
});
test('ordinary assets and non-animation exports keep their original path',()=>{
 const f=fixture();f.setLane(false);assert.equal(f.ctx.deferAiSequenceCutoutExportUntilSaved({type:'click'},f.button),false);
 f.setLane(true);f.setActive(false);assert.equal(f.ctx.deferAiSequenceCutoutExportUntilSaved({type:'click'},f.button),false);
 assert.equal(f.stats().commits,0);
});
test('toolbar and already-open export dialog both defer their actual action handlers',async()=>{
 for(const handler of ['handleTopbarExportAvailabilityEvent','handleNovaflowExportDialogActionEvent']){
  const f=fixture();class Element{} class Button extends Element{}
  const button=Object.assign(new Button(),f.button);button.closest=()=>button;
  Object.assign(f.ctx,{Element,HTMLElement:Element,HTMLButtonElement:Button,
   findTopbarParticleProjectFileButtonFromEventTarget:()=>null,findTopbarExportButtonFromEventTarget:()=>button,
   isTopbarExportAuthorized:()=>true,getTopbarExportAvailability:()=>({allowed:true}),syncTopbarExportMenuItemState:()=>{},
   isAifxTopbarExportContext:()=>false,isNovaflowAifxSecondaryActiveContext:()=>false,
   findNovaflowExportModalRootFromEventTarget:()=>new Element(),isNovaflowExportTabButton:()=>false,getNovaflowExportActionModeFromButton:()=> 'seq'});
  vm.runInContext(declaration(handler),f.ctx);
  const event={type:'click',target:button};f.ctx[handler](event);
  assert.equal(event.stopped,true,handler);assert.equal(f.stats().commits,1,handler);
  f.resolve();await settled();assert.equal(f.stats().replay,1,handler);
 }
 // Syncing menu appearance is not a user export action.
 assert(!declaration('syncTopbarExportMenuItemState').includes('deferAiSequenceCutoutExportUntilSaved'));
});
