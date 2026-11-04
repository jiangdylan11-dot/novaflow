import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalControlPlane, mintLocalSessionToken } from '../../control-local/src/server.mjs';
import { seedUser } from '../../control-local/src/db.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';

test('real scheduler SQL respects Qwen capability, target and owner permissions', async () => {
  const {db,plane,sessionSecret}=await createLocalControlPlane();
  try {
    const alice=await seedUser(db,{email:'qwen-alice@example.test'});
    const bob=await seedUser(db,{email:'qwen-bob@example.test'});
    const aliceToken=await mintLocalSessionToken(alice,3600,sessionSecret);
    const bobToken=await mintLocalSessionToken(bob,3600,sessionSecret);
    const call=(method,path,token,body={},query={})=>plane.handle({method,path,headers:{authorization:'Bearer '+token},body,query});
    async function worker(name,models) {
      const id=randomUUID();
      const response=await call('POST','/api/worker/register',aliceToken,{worker_id:id,worker_name:name,worker_secret:generateWorkerSecret(),
        hardware:{gpu_name:'fixture',vram_mb:16384,ram_mb:65536,transport:'direct',endpoint_url:'http://127.0.0.1:9999'}});
      assert.equal(response.status,200,JSON.stringify(response.body));
      await db.query('update public.gpu_workers set enabled=true,owner_enabled=true,sharing_enabled=false where id=$1',[id]);
      const token=response.body.workerToken;
      assert.equal((await call('POST','/api/worker/models',token,{models:models.map(model_id=>({model_id,status:'ready'}))})).status,200);
      assert.equal((await call('POST','/api/worker/heartbeat',token,{status:'idle'})).status,200);
      return {id,token};
    }
    const legacy=await worker('legacy',['prompt-assistant']);
    const qwen=await worker('qwen',['prompt-assistant','qwen3.5-9b-heretic']);
    // A ready node with selected sharing is visible to its owner but not to
    // another account until that account is explicitly in its allow-list.
    await db.query("update public.gpu_workers set sharing_enabled=true,sharing_scope='selected',allowed_user_ids='{}'::uuid[] where id=$1",[qwen.id]);
    const caps=async(token,id)=>call('GET','/api/web/capabilities',token,{},id?{worker:id}:{});
    assert.equal((await caps(aliceToken,qwen.id)).body.features.qwen35CpuTrial,true);
    assert.equal((await caps(aliceToken,legacy.id)).body.features.qwen35CpuTrial,false);
    assert.equal((await caps(bobToken,qwen.id)).body.features.qwen35CpuTrial,false);
    await db.query('update public.gpu_workers set allowed_user_ids=array[$2::uuid] where id=$1',[qwen.id,bob.id]);
    assert.equal((await caps(bobToken,qwen.id)).body.features.qwen35CpuTrial,true);
    await db.query("update public.gpu_workers set allowed_user_ids='{}'::uuid[] where id=$1",[qwen.id]);
    assert.equal((await plane.handle({method:'GET',path:'/api/web/capabilities',query:{worker:qwen.id}})).body.features.qwen35CpuTrial,false);
    const body={task_type:'prompt_assistant',parameters:{action:'art-agent-chat',model_id:'qwen3.5-9b-heretic'},
      references:[{name:'request.json',kind:'json',bytes:10}]};
    assert.equal((await call('POST','/api/web/tasks',aliceToken,{...body,target_worker_id:legacy.id})).status,409);
    assert.equal((await call('POST','/api/web/tasks',bobToken,{...body,target_worker_id:qwen.id})).status,403);
    const task=await call('POST','/api/web/tasks',aliceToken,{...body,target_worker_id:qwen.id});
    assert.equal(task.status,200,JSON.stringify(task.body));
    const wrong=await call('POST','/api/worker/claim',legacy.token);
    assert.equal(wrong.body.task,null);
    const right=await call('POST','/api/worker/claim',qwen.token);
    assert.equal(right.body.task.id,task.body.task.id);
    assert.equal(right.body.task.model_id,'qwen3.5-9b-heretic');
    await db.query('delete from public.worker_models where worker_id=$1 and model_id=$2',[qwen.id,'qwen3.5-9b-heretic']);
    assert.equal((await caps(aliceToken,qwen.id)).body.features.qwen35CpuTrial,false);
    assert.equal((await call('POST','/api/web/tasks',aliceToken,{...body,target_worker_id:qwen.id})).status,409);
  } finally {await db.close();}
});
