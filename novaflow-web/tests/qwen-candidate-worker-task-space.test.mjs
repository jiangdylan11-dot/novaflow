import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker,validateQwenRotationCandidateTask,workerTaskDirectory} from '../worker/src/worker-core.mjs';
import {candidateTaskDirectory} from '../worker/src/gateway/candidate-task-path.mjs';

const candidate='fa047a0a-1234-8123-8123-123456789abc';
const active='fa047a0a-1234-8123-8123-123456789abd';
const legacy='a1b2c3d4-1234-4123-8123-123456789abc';

test('worker paths agree with gateway candidate namespace while preserving legacy v4',()=>{
 const root=join(tmpdir(),'fixture-root');
 assert.equal(join(workerTaskDirectory(root,candidate),'input'),candidateTaskDirectory(root,candidate,'input'));
 assert.equal(join(workerTaskDirectory(root,candidate),'output'),candidateTaskDirectory(root,candidate,'output'));
 assert.equal(workerTaskDirectory(root,legacy),join(root,'tasks',legacy));
 assert.throws(()=>workerTaskDirectory(root,candidate.toUpperCase()),/noncanonical/);
});

test('reserved task ids remain fail-closed even if the model or scope is mislabelled',()=>{
 for(const id of [candidate,candidate.toUpperCase()]) {
  assert.throws(()=>validateQwenRotationCandidateTask({id,task_type:'renderer_workflow',parameters:{}}),e=>e.code==='qwen-rotation-lease-unavailable');
 }
 assert.equal(validateQwenRotationCandidateTask({id:legacy,parameters:{}}),false);
});

test('worker sweeps both namespaces while preserving an active candidate task',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'foart-worker-candidate-space-'));
 try {
  const stale=new Date(Date.now()-60000);
  const file=async(path)=>{await mkdir(join(path,'output'),{recursive:true});const f=join(path,'output','result.json');await writeFile(f,'fixture');await utimes(f,stale,stale);return f;};
  const legacyFile=await file(workerTaskDirectory(dir,legacy));
  const candidateFile=await file(workerTaskDirectory(dir,candidate));
  const activeFile=await file(workerTaskDirectory(dir,active));
  const worker=createWorker({dataDir:dir,configPath:join(dir,'identity.json'),workflowDir:dir,rendererDir:dir,
   tunnel:false,localTasks:{list:()=>[{id:active}]}});
  const result=await worker.sweepFiles({input:1,image:1,video:1});
  assert.equal(result.removedFiles,2);
  assert.deepEqual(new Set(result.expiredTasks),new Set([legacy,candidate]));
  await assert.rejects(readFile(legacyFile));await assert.rejects(readFile(candidateFile));
  assert.equal(await readFile(activeFile,'utf8'),'fixture');
 } finally { await rm(dir,{recursive:true,force:true}); }
});
