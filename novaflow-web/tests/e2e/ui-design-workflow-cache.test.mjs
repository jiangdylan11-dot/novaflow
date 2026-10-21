import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createWorkflowHost} from '../../worker/src/comfy/workflow-host.mjs';
test('cached UI host refuses changed on-disk builder and fresh host uses the new implementation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'novaflow-ui-cache-')),file=join(dir,'novaflow-brand-runtime.js');
 const code=version=>`globalThis.__nfBuilders={'novaflow-brand-runtime':{buildArtGenerateRunWorkflow:()=>({workflow:{'1':{class_type:'FixtureVersion${version}',inputs:{}}}})}};`;
 await writeFile(file,code(1));const old=await createWorkflowHost({rendererDir:dir,objectInfo:{}}),input={module:'novaflow-brand-runtime',method:'buildArtGenerateRunWorkflow',options:{__args:['local','img2img',[], '', '', '', '', [], {}, 10, {taskProfile:'ui-design'}]}};
 assert.equal((await old.buildGraph(input))['1'].class_type,'FixtureVersion1');await writeFile(file,code(2));
 await assert.rejects(()=>old.buildGraph(input),/旧缓存未执行/);await assert.rejects(()=>old.replay({module:input.module,fn:input.method,args:input.options.__args}),/旧缓存未执行/);
 const fresh=await createWorkflowHost({rendererDir:dir,objectInfo:{}});assert.equal((await fresh.buildGraph(input))['1'].class_type,'FixtureVersion2');
});
