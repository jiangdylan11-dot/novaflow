const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
const source=fs.readFileSync(process.env.NOVAFLOW_CUTOUT_TEST_BUNDLE||path.join(__dirname,'../../particle-editor/assets/index-BbIa-2NM.js'),'utf8'),ast=ts.createSourceFile('bundle',source,ts.ScriptTarget.Latest,true);let code;
function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='nfOpenCutoutTool')code=node.initializer.getText(ast);ts.forEachChild(node,walk);}walk(ast);assert(code);
function fixture(meta,masks){let started=0,opened=0;const cap={frame:{width:16,height:16}};
 const context={Vn:true,or:false,N:true,V:false,nfCutoutMode:'ai',nfGreenScreen:true,zn:true,Rn:false,G:{current:meta},U:{current:new Map(masks)},H:value=>{if(value)opened++;},ci:()=>({cap}),nfStartCutoutSubject:value=>{assert.equal(value,cap);started++;}};
 return {open:vm.runInNewContext('('+code+')',context),stats:()=>({started,opened})};}
test('enabled dock with cleared source metadata performs inference when reopened',async()=>{const f=fixture(null,[]);await f.open('ai');assert.deepEqual(f.stats(),{started:1,opened:1});});
test('missing masks also require inference; a complete same-source result can reopen directly',async()=>{
 const missing=fixture({fps:24},[]);await missing.open('ai');assert.equal(missing.stats().started,1);
 const ready=fixture({fps:24},[[0,new Uint8Array(16)]]);await ready.open('ai');assert.deepEqual(ready.stats(),{started:0,opened:1});
});
