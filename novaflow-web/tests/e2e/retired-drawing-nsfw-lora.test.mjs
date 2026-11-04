import test from 'node:test';
import assert from 'node:assert/strict';
await import('../../renderer/art-generate-lora.js');
const lora = globalThis.NovaFlowArtGenerateLora;
const target = lora.NSFW_LORA;
const uc = 'qwen/qwen-image-2.1-uncensored-lora.safetensors';
const base = {provider:'local', mode:'txt2img', nsfw:false, nsfwLoraEnabled:true, nsfwLoraName:target};
const graph = () => ({base:{class_type:'UnetLoaderGGUF',inputs:{unet_name:'Qwen-Image-2.1-Turbo-BF16.gguf'}}, sampler:{class_type:'KSampler',inputs:{model:['base',0]}}});

test('verified switch adds both LoRAs without changing manually selected items', () => {
  const manual=[{name:'qwen/style.safetensors',strength:0.7,enabled:true}];
  const before=structuredClone(manual), workflow=graph();
  lora.apply(workflow,{...base,loras:manual});
  assert.deepEqual(manual,before);
  assert.equal(workflow.nf_art_lora_1.inputs.lora_name,uc);
  assert.equal(workflow.nf_art_lora_2.inputs.lora_name,manual[0].name);
  assert.equal(workflow.nf_art_lora_3.inputs.lora_name,target);
  assert.equal(workflow.nf_art_lora_3.inputs.strength_model,1);
  assert.deepEqual(workflow.sampler.inputs.model,['nf_art_lora_3',0]);
  const off=graph();lora.apply(off,{...base,nsfwLoraEnabled:false,loras:manual});
  assert.equal(off.nf_art_lora_2,undefined);
  assert.deepEqual(manual,before);
});

test('manual same LoRA is reused once at its chosen strength and remains after switch off', () => {
  const manual=[{name:target.replaceAll('/','\\'),strength:0.45,enabled:true}];
  const before=structuredClone(manual), workflow=graph();
  lora.apply(workflow,{...base,loras:manual});
  assert.equal(workflow.nf_art_lora_1.inputs.lora_name,uc);
  assert.equal(workflow.nf_art_lora_2.inputs.strength_model,0.45);
  assert.equal(workflow.nf_art_lora_3,undefined);
  assert.deepEqual(manual,before);
  assert.deepEqual(lora.effectiveSelection({...base,nsfwLoraEnabled:false,loras:manual}),[{name:manual[0].name,strength:0.45}]);
});

test('switch rejects a missing, unverified, incompatible or excessive LoRA selection', () => {
  const feature = 'qwen21-nsfw-lora-v1';
  assert.equal(lora.verifiedNsfwName({ok:true,items:[{name:target},{name:uc}]}),feature);
  assert.equal(lora.verifiedNsfwName({ok:true,features:{qwen21_nsfw_lora:true,qwen21_uc_lora:true},items:[]}),feature);
  assert.throws(()=>lora.verifiedNsfwName({ok:true,features:{qwen21_nsfw_lora:false},items:[{name:target}]}));
  assert.deepEqual(lora.effectiveSelection({...base,nsfwLoraName:feature,loras:[{name:target,strength:0.45}]}),[{name:uc,strength:1},{name:target,strength:0.45}]);
  assert.throws(()=>lora.verifiedNsfwName({ok:true,items:[{name:target}]}),/缺少破限所需的 LoRA/);
  assert.throws(()=>lora.verifiedNsfwName({ok:false,error:'目录不可用'}),/目录不可用/);
  assert.throws(()=>lora.effectiveSelection({...base,nsfwLoraName:'qwen/other.safetensors'}),/尚未验证/);
  assert.throws(()=>lora.effectiveSelection({...base,nsfw:true}),/仅支持当前本地/);
  const full=Array.from({length:8},(_,i)=>({name:`qwen/style${i}.safetensors`,strength:1}));
  assert.throws(()=>lora.effectiveSelection({...base,loras:full}),/最多添加 8/);
});
