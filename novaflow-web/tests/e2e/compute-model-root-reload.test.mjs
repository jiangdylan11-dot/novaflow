import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {createComputeAssistant} from '../../worker/src/compute-assistant.mjs';

const listen = server => new Promise(resolveUrl => server.listen(0, '127.0.0.1', () => resolveUrl(`http://127.0.0.1:${server.address().port}`)));

async function withAssistant({explicit}, verify) {
  const dataDir = await mkdtemp(join(tmpdir(), 'foart-root-reload-'));
  const oldRoot = join(dataDir, 'old-models'), newRoot = join(dataDir, 'new-models');
  const explicitRoot = join(dataDir, 'fixed-models');
  await Promise.all([oldRoot, newRoot, explicitRoot].map(path => mkdir(path)));
  const runtimeJsonPath = join(dataDir, 'runtime.json'), strataConfigPath = join(dataDir, 'strata.json');
  const setRoot = root => writeFile(runtimeJsonPath, JSON.stringify({installPath:dataDir, modelsPath:root}));
  await setRoot(oldRoot);
  await writeFile(strataConfigPath, JSON.stringify({enabled:false, analysisBackend:'strata', modelFiles:[], expectedModel:{ids:['fixture-disabled']}}));
  const policy = {enabled:true, owner_enabled:true, sharing_enabled:false, sharing_scope:'pool', allowed_user_ids:[]};
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* consume request body */ }
    let value = {ok:true, worker:{policy, pending_approval:false}};
    if (req.url === '/api/worker/register') value = {...value, workerToken:'fixture-worker', grantKey:'fixture-compute-grant-key'};
    if (req.url === '/api/worker/claim') value = {task:null};
    if (req.url === '/system_stats') value = {system:{comfyui_version:'fixture'},devices:[]};
    res.setHeader('content-type','application/json'); res.end(JSON.stringify(value));
  });
  const url = await listen(server);
  const services = {start:async()=>[{kind:'image',url}], stop:async()=>{}};
  let assistant;
  try {
    assistant = await createComputeAssistant({controlUrl:url,dataDir,configPath:join(dataDir,'identity.json'),
      ...(explicit ? {modelsRoot:explicitRoot} : {}), comfyImageUrl:url, comfyVideoUrl:url,
      services,tunnel:false,gatewayPort:0,gatewayHost:'127.0.0.1',pollIntervalMs:100000,
      promptAssistant:{analysisBackend:'strata',runtimeJsonPath,strataConfigPath},logger() {}});
    const calls = [], original = assistant.worker.retargetModelsRoot.bind(assistant.worker);
    assistant.worker.retargetModelsRoot = root => { calls.push(root); return original(root); };
    await verify({assistant, calls, setRoot, oldRoot, newRoot, explicitRoot});
  } finally {
    await assistant?.stop().catch(()=>{});
    server.closeAllConnections?.();
    await new Promise(done=>server.close(done));
    if (dirname(resolve(dataDir)) !== resolve(tmpdir()) || !basename(dataDir).startsWith('foart-root-reload-')) {
      throw new Error('Refusing to remove unexpected test directory');
    }
    await rm(dataDir,{recursive:true,force:true});
  }
}

test('auto-discovered models root follows runtime changes when services restart', async()=>{
  await withAssistant({explicit:false}, async ({assistant,calls,setRoot,oldRoot,newRoot})=>{
    await assistant.start();
    assert.ok(calls.includes(oldRoot), 'initial runtime config is used');
    await assistant.stop();
    await setRoot(newRoot);
    await assistant.start();
    assert.equal(calls.at(-1),newRoot,'restart retargets the worker to the updated model root');
  });
});

test('an explicitly supplied models root is not replaced by runtime config', async()=>{
  await withAssistant({explicit:true}, async ({assistant,calls,setRoot,newRoot})=>{
    await setRoot(newRoot);
    await assistant.start();
    assert.deepEqual(calls,[], 'explicit caller configuration keeps priority');
  });
});
