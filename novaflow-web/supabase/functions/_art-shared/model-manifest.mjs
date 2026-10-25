// GENERATED COPY - source: packages/shared/src/model-manifest.mjs
// NovaFlow Web - model manifest (spec 22).
//
// The worker checks this against what the local ComfyUI can actually load,
// and reports ready / missing / invalid / updating. The scheduler only ever
// hands a task to a worker that reports 'ready' for the required model, so a
// machine with half a model installed is simply not eligible - a user task is
// never spent discovering that.
//
// The filenames below were read from the live runtimes this project targets
// (/object_info on 127.0.0.1:8188 and :8189), not invented. `sha256: null`
// means we have not pinned a digest for that file; the worker then verifies
// presence and size and SAYS so, rather than implying it checked a hash.

export const MODEL_MANIFEST = Object.freeze([
  {
    model_id: 'qwen-image-2511',
    display_name: 'Qwen Image (Rapid AIO)',
    version: '2511.1',
    runtime: 'image',
    min_vram_mb: 16000,
    compatible_workflows: ['qwen_t2i.json', 'qwen2511_edit.json'],
    required_files: [
      {
        path: 'checkpoints/Qwen-Rapid-AIO-NSFW-v20.safetensors',
        min_bytes: 4_000_000_000,
        sha256: null
      }
    ],
    download: {
      // These weights are licensed per user, so this project does not
      // redistribute them. The Model Manager imports them from an existing
      // ComfyUI models folder or a URL the operator configures.
      mode: 'import_or_configured_url',
      hint: 'Point the worker at an existing ComfyUI models folder, or set a download URL in worker settings.'
    }
  },
  {
    model_id: 'minimax-h3',
    display_name: 'MiniMax H3 (image to video)',
    version: '0.31.1',
    runtime: 'video',
    // The shipped H3 weights are int8/nvfp4 quantised; the reference runtime
    // serves them on a 16 GB card, so the floor is set from what actually
    // runs rather than from the bf16 model's footprint.
    min_vram_mb: 15000,
    compatible_workflows: ['h3_i2v.json'],
    required_files: [
      {
        path: 'diffusion_models/Minimax_H3/10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors',
        min_bytes: 5_000_000_000,
        sha256: null
      },
      {
        path: 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
        min_bytes: 4_000_000_000,
        sha256: null
      },
      { path: 'vae/minimax_h3_video_vae_fp16.safetensors', min_bytes: 50_000_000, sha256: null },
      { path: 'vae/minimax_h3_audio_vae_fp32.safetensors', min_bytes: 10_000_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: 'Import from an existing NovaFlow H3 runtime (e.g. E:/NovaFlow/models) or configure a URL.'
    }
  },
  {
    model_id: 'minimax-h3-beta6',
    display_name: 'MiniMax H3 beta6 (reference)' ,
    version: '0.31.1',
    runtime: 'video',
    // The shipped H3 weights are int8/nvfp4 quantised; the reference runtime
    // serves them on a 16 GB card, so the floor is set from what actually
    // runs rather than from the bf16 model's footprint.
    min_vram_mb: 15000,
    compatible_workflows: ['h3_i2v.json'],
    required_files: [
      {
        path: 'diffusion_models/Minimax_H3/10Eros_Max_h3_8stepTURBO_beta6_int8.safetensors',
        min_bytes: 21_709_633_539,
        sha256: 'e2c5493e5997726ab12f17caecd6fe88c7e64b135bd3435c0f158c8f1b632a5f'
      },
      {
        path: 'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
        min_bytes: 4_000_000_000,
        sha256: null
      },
      { path: 'vae/minimax_h3_video_vae_fp16.safetensors', min_bytes: 50_000_000, sha256: null },
      { path: 'vae/minimax_h3_audio_vae_fp32.safetensors', min_bytes: 10_000_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: 'Import from an existing NovaFlow H3 runtime (e.g. E:/NovaFlow/models) or configure a URL.'
    }
  },
  {
    model_id: 'birefnet-matting',
    display_name: 'BiRefNet (AI 抠图)',
    version: '2.0.0',
    // 'local' on purpose, and it is load-bearing. reportModels only asks
    // ComfyUI about runtimes 'image' and 'video'; a model tagged 'local' is
    // never looked for in a node catalogue that could not answer for it
    // anyway, and is never falsely matched by a checkpoint whose filename
    // happens to end the same way. Readiness comes from the files on disk.
    runtime: 'local',
    min_vram_mb: 4000,
    compatible_workflows: ['video_matting'],
    required_files: [
      // BiRefNet_lite (MIT), the ZhengPeng7/BiRefNet_lite folder as published; RMBG-2.0 is CC BY-NC.
      { path: 'RMBG/BiRefNet_lite/model.safetensors', min_bytes: 150_000_000, sha256: null },
      { path: 'RMBG/BiRefNet_lite/config.json', min_bytes: 100, sha256: null },
      { path: 'RMBG/BiRefNet_lite/birefnet.py', min_bytes: 10_000, sha256: null },
      { path: 'RMBG/BiRefNet_lite/BiRefNet_config.py', min_bytes: 100, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '从模型包导入 models/RMBG/BiRefNet_lite（整个文件夹）。'
    }
  },
  {
    // Shared local Flash brain; image/video/audio generation encoders stay separate.
    model_id: 'prompt-assistant',
    display_name: '本地 AI 大脑 (Flash-Next)',
    version: 'swift-1.5-flash-next',
    runtime: 'local',
    min_vram_mb: 16000,
    compatible_workflows: ['prompt_assistant'],
    required_files: [
      { path: 'LLM/qwen38_swift15_strata/Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf', min_bytes: 39_788_473_344, sha256: 'ca3b302d3d1eb6eddce3ea4acc79854e6cc5fdc0583e374a6a8b6bb67327743b' },
      { path: 'LLM/qwen38_swift15_strata/Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00002-of-00002.gguf', min_bytes: 28_363_693_824, sha256: 'e4996a6de18fd49c58d9a0040fcfd73787db6407c51973f29884bee7b14c9dbb' },
      { path: 'LLM/qwen38_swift15_strata/mmproj-Swift-Qwen3.8-Flash-Next-BF16.gguf', min_bytes: 907_543_520, sha256: 'cd1140f4abba943ce8d9fa92fed8407e389954d26907efde7b72153c75bd8a60' },
      { path: 'LLM/qwen38_swift15_strata/strata-pack-resident/dense.bin', min_bytes: 100_000_000, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/strata-pack-resident/experts.bin', min_bytes: 30_000_000_000, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/strata-pack/tokenizer/vocab.json', min_bytes: 100_000, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/strata-pack-resident/index.txt', min_bytes: 100, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/mtp/rt/dense.bin', min_bytes: 100_000_000, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/mtp/rt/dense.txt', min_bytes: 100, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/mtp/rt/experts.bin', min_bytes: 700_000_000, sha256: null },
      { path: 'LLM/qwen38_swift15_strata/mtp/rt/draft_vocab.bin', min_bytes: 400_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '导入 Flash-Next 模型目录（含 resident pack、tokenizer、MTP 与视觉投影），并安装环境包中的 Strata 引擎。'
    }
  },
  {
    // Drawing and UI design on Qwen-Image-2.1. A node reports it ready exactly when it can build the
    // 2.1 graph (detectQwenImage21, the check the builder itself makes), and the control plane queues
    // a run that asks for 2.1 on this model, so only such a node claims it.
    model_id: 'qwen-image-2.1',
    display_name: 'Qwen-Image-2.1',
    version: '2.1',
    runtime: 'image',
    min_vram_mb: 16000,
    compatible_workflows: ['novaflow-brand-runtime.buildArtGenerateRunWorkflow'],
    required_files: [
      { path: 'diffusion_models/qwen-image-2.1-UC-BF16.gguf', min_bytes: 14_000_000_000, sha256: null },
      { path: 'text_encoders/qwen3vl_8b_bf16_heretic.safetensors', min_bytes: 17_000_000_000, sha256: null },
      { path: 'vae/qwen_image_2.1_vae_bf16.safetensors', min_bytes: 600_000_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '从已有的 NovaFlow 模型目录导入（例如 E:/NovaFlow/models），并安装支持 Qwen 2.1 BF16 的 ComfyUI 节点。'
    }
  },
  {
    model_id:'qwen-image-2.1-turbo', display_name:'Qwen-Image-2.1 Turbo GGUF BF16', version:'2.1-turbo', runtime:'image', min_vram_mb:16000,
    compatible_workflows:['novaflow-brand-runtime.buildArtGenerateRunWorkflow','spine-split-runtime'],
    required_files:[
      {path:'diffusion_models/Qwen-Image-2.1-Turbo-BF16.gguf',min_bytes:14_000_000_000,sha256:null},
      {path:'text_encoders/qwen3vl_8b_bf16_heretic.safetensors',min_bytes:17_000_000_000,sha256:null},
      {path:'vae/qwen_image_2.1_vae_bf16.safetensors',min_bytes:600_000_000,sha256:null}
    ],download:{mode:'import_or_configured_url',hint:'导入 Qwen-Image-2.1-Turbo-BF16.gguf、BF16 编码器和 VAE；需要 ManualSigmas 与 SamplerCustom 节点。'}
  },
  {
    // 音频 · 音乐. The medium text-to-audio checkpoint plus its text encoder.
    // Open weights, community licence; the panel never names it.
    model_id: 'audio-music',
    display_name: '音频生成 (音乐)',
    version: '3.0',
    runtime: 'image',
    min_vram_mb: 8000,
    compatible_workflows: ['audio_music.json'],
    required_files: [
      { path: 'checkpoints/stable_audio_3_medium.safetensors', min_bytes: 9_000_000_000, sha256: null },
      { path: 'text_encoders/t5gemma_b_b_ul2.safetensors', min_bytes: 1_100_000_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '从已有的 NovaFlow 模型目录导入 checkpoints/stable_audio_3_medium.safetensors 、text_encoders/t5gemma_b_b_ul2.safetensors，并安装 novaflow_audio 节点。'
    }
  },
  {
    // 音频 · 音效. The small effects checkpoint shares the text encoder above.
    model_id: 'audio-sfx',
    display_name: '音频生成 (音效)',
    version: '3.0',
    runtime: 'image',
    min_vram_mb: 4000,
    compatible_workflows: ['audio_sfx.json'],
    required_files: [
      { path: 'checkpoints/stable_audio_3_small_sfx.safetensors', min_bytes: 1_300_000_000, sha256: null },
      { path: 'text_encoders/t5gemma_b_b_ul2.safetensors', min_bytes: 1_100_000_000, sha256: null }
    ],
    download: {
      mode: 'import_or_configured_url',
      hint: '从已有的 NovaFlow 模型目录导入 checkpoints/stable_audio_3_small_sfx.safetensors 、text_encoders/t5gemma_b_b_ul2.safetensors，并安装 novaflow_audio 节点。'
    }
  }
]);

export const QWEN21_MODEL_ID = 'qwen-image-2.1';

export function findModel(modelId) {
  return MODEL_MANIFEST.find((m) => m.model_id === String(modelId || '')) || null;
}

export function manifestModelIds() {
  return MODEL_MANIFEST.map((m) => m.model_id);
}

/** Which ComfyUI runtime a model needs: the image node or the video node. */
export function runtimeFor(modelId) {
  return findModel(modelId)?.runtime || 'image';
}
