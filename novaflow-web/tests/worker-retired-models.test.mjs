import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker} from '../worker/src/worker-core.mjs';
import {inspectAllModels, WORKER_MODEL_MANIFEST} from '../worker/src/models/model-manager.mjs';
import {assertSupportedDrawingGraph} from '../worker/src/retired-rapid-guard.mjs';
import {PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID} from '../packages/shared/src/protocol.mjs';

test('retired Next is excluded from node inspection while Qwen 9B stays ready', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'foart-model-retired-'));
  const status={enabled:true,localModels:[{id:PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID, enabled:true,
    configured:true,identityVerified:true,trial:{backend:'cpu',chat:true,images:true,tools:false,business:true,foartReadonly:true,foartSeekCandidate:true}}]};
  const worker=createWorker({controlUrl:'http://127.0.0.1:9',dataDir:dir,workflowDir:dir,configPath:join(dir,'identity.json'),
    modelsRoot:dir,tunnel:false,promptAssistant:{status:()=>status}});
  try {
    const scanned=await inspectAllModels(dir);
    assert.equal(scanned.some(x=>['prompt-assistant','qwen-image-2511'].includes(x.model_id)),false);
    assert.ok(WORKER_MODEL_MANIFEST.some(x=>x.model_id==='qwen-image-2.1'));
    const report=await worker.reportModels();
    assert.equal(report.some(x=>['prompt-assistant','qwen-image-2511'].includes(x.model_id)),false);
    assert.equal(report.find(x=>x.model_id===PROMPT_ASSISTANT_QWEN_CPU_MODEL_ID)?.status,'ready');
    assert.equal(report.find(x=>x.model_id==='qwen-image-2.1')?.status,'missing');
  } finally { await worker.stop().catch(()=>{}); await rm(dir,{recursive:true,force:true}); }
});

test('retired Rapid AIO is rejected only for matching drawing graphs', () => {
  const oldGraph={1:{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'Qwen-Rapid-AIO-NSFW-v20.safetensors'}}};
  const normalGraph={1:{class_type:'UNETLoader',inputs:{unet_name:'qwen_image_2.1.safetensors'}}};
  assert.throws(()=>assertSupportedDrawingGraph({module:'NovaFlowArtGenerateProviderWorkflow',method:'buildWorkflow'},oldGraph),{errorCode:'retired-rapid-drawing'});
  assert.doesNotThrow(()=>assertSupportedDrawingGraph({module:'NovaFlowArtGenerateProviderWorkflow',method:'buildWorkflow'},normalGraph));
  const mixedGraph={...normalGraph,2:{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'Qwen-Rapid-AIO-NSFW-v20.safetensors'}}};
  assert.throws(()=>assertSupportedDrawingGraph({module:'NovaFlowArtGenerateProviderWorkflow',method:'buildRunWorkflow'},mixedGraph),{errorCode:'retired-rapid-drawing'});
  assert.doesNotThrow(()=>assertSupportedDrawingGraph({module:'NovaFlowArtGenerateProviderWorkflow',method:'buildRunWorkflow'},normalGraph));
  assert.throws(()=>assertSupportedDrawingGraph({module:'NovaFlowSplitInpaintNsfwWorkflow',method:'buildWorkflow'},oldGraph),{errorCode:'retired-rapid-drawing'});
  assert.doesNotThrow(()=>assertSupportedDrawingGraph({module:'shared-split',method:'buildWorkflow'},oldGraph));
});
