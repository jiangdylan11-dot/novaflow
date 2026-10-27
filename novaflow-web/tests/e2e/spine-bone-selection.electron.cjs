// Run with novaflow-web/node_modules/electron/dist/electron.exe; exercises actual canvas pointer handlers.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const proof=path.resolve(__dirname,'../../../work/spine-bone-selection-verification');fs.mkdirSync(proof,{recursive:true});
app.setPath('userData',path.join(proof,'profile'));
app.whenReady().then(async()=>{try{
 const w=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{backgroundThrottling:false}});await w.loadFile(path.resolve(__dirname,'../../renderer/spine-skeleton-editor.html'));
 const result=await w.webContents.executeJavaScript(`(async()=>{
  while(!window.NovaFlowSkeletonEditorAPI)await new Promise(r=>setTimeout(r,20));const api=window.NovaFlowSkeletonEditorAPI;
  await api.loadSource({skeleton:{fileName:'selection.json',text:JSON.stringify({skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:'A',parent:'root',x:40,length:30},{name:'B',parent:'root',x:90,length:30}],slots:[],skins:[{name:'default',attachments:{}}],animations:{idle:{}}})},images:[]});
  const lab=window.__SkeletonLab,c=document.querySelector('#overlay');c.setPointerCapture=()=>{};
  const group=()=>{lab.state.multi=['A','B'];lab.state.sel={kind:'bone',name:'A'};lab.state.opt.boneSel=true;lab.state.opt.boneVis=true;lab.setTool('move');lab.rt.cam.zoom=1;lab.rt.cam.x=60;lab.rt.cam.y=0;lab.refresh();lab.draw()};
  const point=name=>{const b=lab.rt.skeleton.findBone(name),r=c.getBoundingClientRect();return{x:r.left+(b.worldX+lab.state.offset.x-lab.rt.cam.x)/lab.rt.cam.zoom+lab.rt.w/2,y:r.top+lab.rt.h/2-(b.worldY+lab.state.offset.y-lab.rt.cam.y)/lab.rt.cam.zoom}};
  const emit=(type,p,extra={})=>c.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,buttons:type==='pointerup'?0:1,pointerId:1,clientX:p.x,clientY:p.y,...extra}));
  group();let p=point('B');emit('pointerdown',p);emit('pointerup',p);const clicked={selected:lab.state.sel.name,multi:[...lab.state.multi]};
  group();p=point('A');emit('pointerdown',p);emit('pointermove',{x:p.x+20,y:p.y+10});emit('pointerup',{x:p.x+20,y:p.y+10});const dragged={multi:[...lab.state.multi],positions:api.json().bones.filter(b=>b.name!=='root').map(b=>({name:b.name,x:b.x,y:b.y}))};
  group();p=point('B');emit('pointerdown',p);emit('pointercancel',p);const canceled=[...lab.state.multi];
  group();p=point('B');emit('pointerdown',p,{ctrlKey:true});emit('pointerup',p,{ctrlKey:true});const ctrl=[...lab.state.multi];
  return{clicked,dragged,canceled,ctrl};
 })()`);
 assert.deepEqual(result.clicked,{selected:'B',multi:['B']});assert.equal(result.dragged.multi.length,2);assert.equal(result.dragged.positions[0].x,60);assert.equal(result.dragged.positions[1].x,110);assert.equal(result.canceled.length,2);assert.deepEqual(result.ctrl,['A']);
 fs.writeFileSync(path.join(proof,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(0);
}catch(e){console.error(e);app.exit(1)}});setTimeout(()=>app.exit(2),30000);
