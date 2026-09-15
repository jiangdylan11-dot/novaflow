const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.json'))),moduleName='ai-sequence-green-screen-matting.js',bundleName='assets/index-BbIa-2NM.js';
const moduleBytes=fs.readFileSync(path.join(root,'particle-editor',moduleName)),bundleBytes=fs.readFileSync(path.join(root,'particle-editor',bundleName));
const boot='(0,g.createRoot)(document.getElementById(`root`)).render((0,X.jsx)(_.StrictMode,{children:(0,X.jsx)(Ed,{})}));',testBoot='window.nfCutoutTest={React:_,jsx:X.jsx,createRoot:g.createRoot,Dock:zt};';
assert.equal(hash(moduleBytes),manifest.mattingSha256);
const fixtureHash=hash(bundleBytes.toString().replace(boot,testBoot));
let count=0;for(const c of manifest.clips){const dir=path.join(__dirname,c.id),r=JSON.parse(fs.readFileSync(path.join(dir,'report.json')));assert.equal(r.mattingSha256,manifest.mattingSha256);assert.equal(hash(fs.readFileSync(path.join(dir,'fixture-bundle.mjs'))),fixtureHash);assert.equal(r.writes.length,c.frames);assert.equal(r.errors.length,0);count+=r.writes.length;}
for(const folder of ['particle-editor-desktop/renderer','particle-editor-desktop/dist/win-unpacked/resources/app/renderer']){assert.equal(hash(fs.readFileSync(path.join(root,folder,moduleName))),hash(moduleBytes));assert.equal(hash(fs.readFileSync(path.join(root,folder,bundleName))),hash(bundleBytes));}
const report={mattingSha256:hash(moduleBytes),bundleSha256:hash(bundleBytes),fixtureBundleSha256:fixtureHash,clips:manifest.clips.length,exportedFrames:count,sourceRendererUnpackedParity:true};
fs.writeFileSync(path.join(__dirname,'artifact-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
