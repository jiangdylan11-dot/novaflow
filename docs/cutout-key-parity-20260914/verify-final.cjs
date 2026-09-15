const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'logs/cutout-key-parity-20260914/package-verification.json')));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
(async()=>{
 const records=[];
 for(const [id,dir,count]of [['athena','athena-packaged',117],['blue','blue',73],['minimax','minimax',73],['gloweyes','gloweyes',121],['scatter','scatter',73]]){
  const base=path.join(__dirname,dir),r=JSON.parse(fs.readFileSync(path.join(base,'report.json')));
  assert.equal(r.toolMode,'key');assert.equal(r.liveBackend,true);assert.equal(r.writes.length,count);assert.deepEqual(r.errors,[]);assert.deepEqual(r.startupErrors,[]);
  assert.equal(r.mattingSha256,pkg.files.find(f=>f.file.endsWith('ai-sequence-green-screen-matting.js')).sha256);
  const fixture=fs.readFileSync(path.join(base,'fixture-bundle.mjs'),'utf8').replace('window.nfCutoutTest={React:_,jsx:X.jsx,createRoot:g.createRoot,Dock:zt};','(0,g.createRoot)(document.getElementById(`root`)).render((0,X.jsx)(_.StrictMode,{children:(0,X.jsx)(Ed,{})}));');
  assert.equal(hash(fixture),pkg.files.find(f=>f.file.endsWith('index-BbIa-2NM.js')).sha256);
  for(const name of r.writes){const m=await sharp(path.join(base,'frames',name)).metadata();assert.equal(m.width,r.w);assert.equal(m.height,r.h);assert.equal(m.channels,4);}
  const backend=JSON.parse(fs.readFileSync(path.join(base,'backend/result.json')));
  assert.equal(backend.width,r.w);assert.equal(backend.height,r.h);
  records.push({id,directory:dir,frames:count,width:r.w,height:r.h,nativeModelMasks:true,actualKeyButton:true,exportErrors:0,startupErrors:0,materialReferences:r.materialReferences,bundleMatchesInstaller:true});
 }
 const result={installer:pkg.installer,sha256:pkg.sha256,frames:records.reduce((s,r)=>s+r.frames,0),clips:records,modeParity:JSON.parse(fs.readFileSync(path.join(root,'logs/cutout-key-parity-20260914/mode-parity.json'))),limits:'Isolated Electron tests of the real renderer and production cutout backend. Full 4783 entry gate remains NO-GO; visual acceptance remains with the user.'};
 fs.writeFileSync(path.join(__dirname,'acceptance.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({pass:true,clips:records.length,frames:result.frames,installer:pkg.installer}));
})().catch(e=>{console.error(e);process.exitCode=1;});
