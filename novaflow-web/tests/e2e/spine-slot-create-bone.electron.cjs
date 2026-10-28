// Actual slot menu, region geometry, parenting and atomic undo/redo.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const renderer=path.resolve(process.env.NF_SLOT_BONE_RENDERER||path.join(__dirname,'../../renderer'));
const output=path.resolve(process.env.NF_SLOT_BONE_OUTPUT||path.join(__dirname,'../../../work/slot-create-bone-20261028'));
fs.mkdirSync(output,{recursive:true});app.disableHardwareAcceleration();app.setPath('userData',path.join(output,'profile'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{try{
  const win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{backgroundThrottling:false}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.error(message);});
  await win.loadFile(path.join(renderer,'spine-skeleton-editor.html'));
  const run=code=>win.webContents.executeJavaScript(code);
  const capture=async name=>{await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await pause(350);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  const result=await run(`(async()=>{
    while(!window.__SkeletonLab)await new Promise(r=>setTimeout(r,20));
    const api=NovaFlowSkeletonEditorAPI,lab=__SkeletonLab,c=document.createElement('canvas');c.width=96;c.height=64;
    const g=c.getContext('2d');g.fillStyle='#d59443';g.fillRect(0,0,96,64);g.fillStyle='#6b371b';g.fillRect(10,10,20,40);
    const json={skeleton:{spine:'3.8.99'},bones:[{name:'root',x:60,y:-40,rotation:17},{name:'arm',parent:'root',x:50,y:30,rotation:-32,scaleX:-1.2,scaleY:.8,shearY:18}],
      slots:[{name:'arm',bone:'arm',attachment:'picture'},{name:'empty',bone:'root'}],
      skins:[{name:'default',attachments:{arm:{picture:{path:'picture',x:32,y:-19,rotation:23,width:96,height:64}}}},
        {name:'red',attachments:{arm:{picture:{path:'picture',x:45,y:10,rotation:-15,width:96,height:64}}}}],
      animations:{idle:{bones:{arm:{rotate:[{angle:2},{time:1,angle:15}]}}}}};
    await api.loadSource({skeleton:{fileName:'slot-bone.json',text:JSON.stringify(json)},images:[{fileName:'picture.png',dataUrl:c.toDataURL()}]},{operation:'append'});
    lab.setMode('setup');
    window.readSlot=()=>{const s=lab.rt.skeleton.findSlot('arm'),a=s.getAttachment(),v=new Float32Array(8);a.computeWorldVertices(s.bone,v,0,2);return Array.from(v)};
    window.openSlotMenu=name=>{lab.select({kind:'slot',name});[...document.querySelectorAll('#props button')].find(b=>b.textContent.trim()==='新建…').click();return [...document.querySelectorAll('#menu button')].find(b=>b.textContent.trim()==='骨骼')};
    const before=JSON.parse(JSON.stringify(api.json())),world=readSlot(),m=lab.setupMatrices().arm;
    const expected=lab.Ops.toWorld(m,32,-19);
    const emptyDisabled=openSlotMenu('empty').disabled;
    openSlotMenu('arm');
    return {before,world,expected,emptyDisabled,menu:[...document.querySelectorAll('#menu button')].map(b=>({text:b.textContent.trim(),disabled:b.disabled}))};
  })()`);
  assert(result.emptyDisabled);assert(result.menu.some(b=>b.text==='骨骼'&&!b.disabled));
  await capture('menu');
  await run(`[...document.querySelectorAll('#menu button')].find(b=>b.textContent.trim()==='骨骼').click()`);
  const created=await run(`({json:JSON.parse(JSON.stringify(NovaFlowSkeletonEditorAPI.json())),world:readSlot(),bone:__SkeletonLab.setupMatrices().arm2,selection:__SkeletonLab.state.sel,history:__SkeletonLab.state.history.length})`);
  assert.equal(created.json.slots[0].bone,'arm2');assert.equal(created.json.bones.at(-1).parent,'arm');assert(!created.json.bones.at(-1).length);
  assert.equal(created.selection.kind,'bone');assert.equal(created.selection.name,'arm2');assert.equal(created.history,1);
  assert(Math.abs(created.bone.worldX-result.expected[0])<.02&&Math.abs(created.bone.worldY-result.expected[1])<.02);
  assert(created.world.every((v,i)=>Math.abs(v-result.world[i])<.02));
  assert.deepEqual(created.json.animations,result.before.animations);assert.deepEqual(created.json.slots.map(s=>s.name),result.before.slots.map(s=>s.name));
  await capture('created');
  const history=await run(`(() => {const api=NovaFlowSkeletonEditorAPI,lab=__SkeletonLab;
    lab.edit('move new bone',j=>lab.Ops.setBoneProps(j,'arm2',{x:j.bones.at(-1).x+10}));
    const moved=readSlot();api.undo();const unmoved=readSlot();api.undo();const undone=JSON.parse(JSON.stringify(api.json()));api.redo();const redone=readSlot();
    lab.setMode('animate');lab.select({kind:'slot',name:'arm'});const locked=[...document.querySelectorAll('#props button')].find(b=>b.textContent.trim()==='新建…').disabled;
    return {moved,unmoved,undone,redone,locked};})()`);
  assert(history.moved.some((v,i)=>Math.abs(v-created.world[i])>1));
  assert(history.unmoved.every((v,i)=>Math.abs(v-result.world[i])<.02));
  assert.deepEqual(history.undone,result.before);
  assert(history.redone.every((v,i)=>Math.abs(v-created.world[i])<.02));assert(history.locked);
  const proof={ok:true,...result,created,history};fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({ok:true,menu:result.menu,bone:created.json.bones.at(-1),undo:true,redo:true,pictureFollowsBone:true}));app.exit(0);
}catch(error){console.error(error);app.exit(1);}});setTimeout(()=>app.exit(2),60000);
