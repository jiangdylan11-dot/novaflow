// IK target pick: a press off every bone creates the target there; a press on a bone still picks it.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const renderer=path.resolve(process.env.NF_IK_TARGET_RENDERER||path.join(__dirname,'../../renderer'));
const output=path.resolve(process.env.NF_IK_TARGET_OUTPUT||path.join(__dirname,'../../../work/ik-empty-target-20261104'));
fs.mkdirSync(output,{recursive:true});app.disableHardwareAcceleration();app.setPath('userData',path.join(output,'profile'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{try{
  const win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{backgroundThrottling:false}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.error(message);});
  await win.loadFile(path.join(renderer,'spine-skeleton-editor.html'));
  const run=code=>win.webContents.executeJavaScript(code);
  const capture=async name=>{await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await pause(350);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  const setup=await run(`(async()=>{
    while(!window.__SkeletonLab)await new Promise(r=>setTimeout(r,20));
    const api=NovaFlowSkeletonEditorAPI,lab=__SkeletonLab,c=document.createElement('canvas');c.width=200;c.height=200;
    const g=c.getContext('2d');g.fillStyle='#d59443';g.fillRect(0,0,200,200);
    const json={skeleton:{spine:'3.8.99'},bones:[{name:'root',x:60,y:-40,rotation:17},{name:'upper',parent:'root',length:120,rotation:40},{name:'lower',parent:'upper',x:120,length:100,rotation:-30},{name:'other',parent:'root',x:-220,y:-80,length:80,rotation:180}],
      slots:[{name:'body',bone:'root',attachment:'picture'}],
      skins:[{name:'default',attachments:{body:{picture:{path:'picture',x:-100,y:120,width:200,height:200}}}}],animations:{idle:{}}};
    await api.loadSource({skeleton:{fileName:'ik-target.json',text:JSON.stringify(json)},images:[{fileName:'picture.png',dataUrl:c.toDataURL()}]},{operation:'append'});
    lab.setMode('setup');lab.state.offset.x=35;lab.state.offset.y=-20;
    const overlay=document.getElementById('overlay');
    window.screenOf=(x,y)=>{const {rt,state}=lab;return [(x+state.offset.x-rt.cam.x)/rt.cam.zoom+rt.w/2,rt.h/2-(y+state.offset.y-rt.cam.y)/rt.cam.zoom]};
    window.pressAt=(x,y)=>{const r=overlay.getBoundingClientRect(),[sx,sy]=screenOf(x,y),o={bubbles:true,button:0,buttons:1,pointerId:1,clientX:r.left+sx,clientY:r.top+sy};overlay.dispatchEvent(new PointerEvent('pointerdown',o));overlay.dispatchEvent(new PointerEvent('pointerup',{...o,buttons:0}))};
    window.openIk=(names)=>{lab.select({kind:'bone',name:names[names.length-1]});lab.state.multi=names.slice();lab.refresh&&lab.refresh();[...document.querySelectorAll('#props button')].find(b=>b.textContent.trim()==='新建…').click();[...document.querySelectorAll('#menu button')].find(b=>b.textContent.trim()==='IK 约束').click();return document.getElementById('pickText').textContent};
    window.snap=()=>JSON.parse(JSON.stringify(api.json()));
    return {before:snap()};
  })()`);
  const text=await run(`openIk(['lower'])`);assert.match(text,/空白处新建目标骨骼/);
  await capture('pick');
  // empty canvas, far from every bone and picture
  const empty=await run(`(()=>{const lab=__SkeletonLab,target=[260,240];pressAt(...target);const j=snap(),ik=j.ik[0],m=lab.setupMatrices()[ik.target];
    return {target,ik,bone:j.bones.at(-1),world:[m.worldX,m.worldY],sel:lab.state.sel,pick:lab.state.pick,history:lab.state.history.length,pickHidden:document.getElementById('pickbar').hidden}})()`);
  assert.equal(empty.ik.target,empty.bone.name);assert.deepEqual(empty.ik.bones,['lower']);assert.equal(empty.bone.parent,'root');
  assert(Math.abs(empty.world[0]-empty.target[0])<.02&&Math.abs(empty.world[1]-empty.target[1])<.02,JSON.stringify(empty));
  assert.equal(empty.sel.kind,'ik');assert.equal(empty.sel.name,empty.ik.name);assert.equal(empty.pick,null);assert(empty.pickHidden);assert.equal(empty.history,1);
  await capture('created');
  const undone=await run(`(()=>{NovaFlowSkeletonEditorAPI.undo();return snap()})()`);assert.deepEqual(undone,setup.before);
  // over a picture is still "not on a bone"
  await run(`openIk(['lower'])`);
  const onImage=await run(`(()=>{const lab=__SkeletonLab,p=lab.Ops.toWorld(lab.setupMatrices().root,-100,120);pressAt(p[0],p[1]);const j=snap();return {ik:j.ik[0],bones:j.bones.length,slotSel:lab.state.sel}})()`);
  assert.equal(onImage.bones,setup.before.bones.length+1);assert.equal(onImage.slotSel.kind,'ik');
  await run(`NovaFlowSkeletonEditorAPI.undo()`);
  // on a bone: that bone is the target, nothing new
  await run(`openIk(['lower'])`);
  const onBone=await run(`(()=>{const m=__SkeletonLab.setupMatrices().other;pressAt(m.worldX+40*m.a,m.worldY+40*m.c);const j=snap();return {ik:j.ik[0],bones:j.bones.length}})()`);
  assert.equal(onBone.ik.target,'other');assert.equal(onBone.bones,setup.before.bones.length);
  await run(`NovaFlowSkeletonEditorAPI.undo()`);
  // the other picks keep ignoring an empty press
  const other=await run(`(()=>{const lab=__SkeletonLab;lab.select({kind:'bone',name:'other'});[...document.querySelectorAll('#props button')].find(b=>b.textContent.trim()==='新建…').click();[...document.querySelectorAll('#menu button')].find(b=>b.textContent.trim()==='变换约束').click();pressAt(260,240);const j=snap();return {bones:j.bones.length,transform:(j.transform||[]).length,picking:!!lab.state.pick}})()`);
  assert.equal(other.bones,setup.before.bones.length);assert.equal(other.transform,0);assert(other.picking);
  const proof={ok:true,empty,onImage,onBone,other};fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({ok:true,bone:empty.bone,ik:empty.ik,world:empty.world}));app.exit(0);
}catch(error){console.error(error);app.exit(1);}});setTimeout(()=>app.exit(2),60000);
