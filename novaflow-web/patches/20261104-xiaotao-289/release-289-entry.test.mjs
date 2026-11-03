import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {resolve} from 'node:path';
const base='https://cjakoblszlmbmotchzva.supabase.co/functions/v1',tools=resolve('D:/AI_APP/NovaFlow-Web/novaflow-web/tools');
const entries=[['package-site.mjs',['--local-qwen-289','--package-only','--control-url='+base+'/novaflow-web','--auth-url='+base+'/novaflow-backend']],...['deploy-control-plane.mjs','deploy-backend.mjs','deploy-companion.mjs','deploy-site.mjs'].map(file=>[file,['--local-qwen-289','--execute']])];
for(const [file,args] of entries)test(file+' refuses invalid and unreviewed release without falling through',()=>{
 for(const [argv,expected] of [[args,'289 release helper not pinned or changed'],[[...args,'--unexpected'],'Invalid 289 release arguments'],[['--local-qwen-289extra'],'Invalid 289 release arguments']]){
  const p=spawnSync(process.execPath,[resolve(tools,file),...argv],{encoding:'utf8',windowsHide:true,timeout:10000});assert.notEqual(p.status,0);assert.match(p.stderr,new RegExp(expected));
 }
});
