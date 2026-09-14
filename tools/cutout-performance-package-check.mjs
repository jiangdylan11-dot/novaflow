import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'docs/cutout-performance-20260914');
const installer=path.join(root,'particle-editor-desktop/dist/NovaFlow Setup 2.3.214 - 视频抠图加速与导出修复.exe');
const seven=path.join(root,'particle-editor-desktop/node_modules/7zip-bin/win/x64/7za.exe');
const run=args=>{const r=spawnSync(seven,args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr||r.stdout);};
const nsis=path.join(out,'nsis');let target=path.join(out,'installer');fs.mkdirSync(out,{recursive:true});
run(['x','-y',installer,'-o'+nsis]);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
if(fs.existsSync(path.join(nsis,'resources/app/main.js')))target=nsis;else{const archive=walk(nsis).filter(f=>/app-64\.7z$/.test(f));assert.equal(archive.length,1,'Expected installer x64 application archive');run(['x','-y',archive[0],'-o'+target]);}
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const previous=JSON.parse(fs.readFileSync(path.join(root,'docs/h3-history-15-validation/package-validation.json')));
const files=[...new Set([...previous.files.map(x=>x.file),'renderer/novaflow-brand-runtime.js','main/spine-atlas-webp-converter.js'])];
const results=files.map(file=>{const src=file.startsWith('renderer/')?path.join(root,'particle-editor',file.slice(9)):path.join(root,'particle-editor-desktop',file),shipped=path.join(target,'resources/app',file);assert.equal(hash(src),hash(shipped),file);return{file,sha256:hash(shipped),match:true};});
const report={installer,bytes:fs.statSync(installer).size,sha256:hash(installer),files:results};fs.writeFileSync(path.join(out,'package-validation.json'),JSON.stringify(report,null,2));
const r=spawnSync(process.execPath,['--test',path.join(root,'particle-editor-desktop/tests/prompt-history-display-limit.test.mjs')],{encoding:'utf8',env:{...process.env,NOVAFLOW_HISTORY_TEST_BUNDLE:path.join(target,'resources/app/renderer/assets/index-BbIa-2NM.js')},windowsHide:true});assert.equal(r.status,0,r.stderr||r.stdout);
console.log(JSON.stringify({ok:true,files:results.length,installer,bytes:report.bytes,sha256:report.sha256,packagedHistoryTest:'PASS'}));
