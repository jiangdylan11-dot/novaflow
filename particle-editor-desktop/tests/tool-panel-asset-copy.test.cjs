const fs=require('fs'),path=require('path'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const file=path.resolve(__dirname,'../../particle-editor/assets/index-BbIa-2NM.js'),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let commit;function walk(n){if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==='commitCutoutFile')commit=n.initializer.getText(ast);ts.forEachChild(n,walk)}walk(ast);assert(commit);
let assets=[],activated=0,selected=0,serial=0;
const context={File,Date,vn:files=>files.map(f=>({id:++serial,file:f})),$e:fn=>assets=fn(assets),Ze:()=>selected++,Oe:()=>{},dn:async()=>activated++};
const fn=vm.runInNewContext('('+commit+')',context);
(async()=>{const f=new File(['test'],'copy.webm');await fn(f,{activate:false});await fn(f,{activate:false});assert.equal(assets.length,2);assert.notEqual(assets[0].id,assets[1].id);assert.equal(activated,0);assert.equal(selected,0);await fn(f,{});assert.equal(activated,1);assert.equal(selected,1);console.log('production asset bridge: append-only copies and default activation PASS')})().catch(e=>{console.error(e);process.exitCode=1});
