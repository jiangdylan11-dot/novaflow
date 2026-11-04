// Lightweight readiness checks for shared image workflows. Never load or download models.
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
export const RMBG_CAPABILITY = 'foart-rmbg-birefnet-general-v1';
export const SAM_B_CAPABILITY = 'foart-sam-vit-b-v1';
export const SAM_L_CAPABILITY = 'foart-sam-vit-l-v1';
export const SAM_H_CAPABILITY = 'foart-sam-vit-h-v1';
export const SAM_AUTO_CAPABILITY = 'foart-sam-auto-v1';
export const QWEN_INPAINT_CAPABILITY = 'foart-qwen21-inpaint-v1';
export const SEEDVR_CAPABILITY = 'foart-seedvr2-upscale-v1';
export const SEETHROUGH_CAPABILITY = 'foart-seethrough-v1';
export const SEETHROUGH_LAMA_CAPABILITY = 'foart-seethrough-lama-v1';
export const FLUX_FILL_CAPABILITY = 'foart-flux-fill-v1';
export const FLUX_REMOVAL_CAPABILITY = 'foart-flux-removal-v1';

export async function detectSharedImageCapabilities(comfy, modelsRoot, {fetcher=fetch, statFile=stat}={}) {
  const missing = {rmbg:false,samB:false,samL:false,samH:false,samAuto:false,qwenInpaintNodes:false,seedvr:false,seeThrough:false,seeThroughLama:false,fluxFill:false,fluxRemoval:false};
  if (!comfy?.baseUrl) return missing;
  let info;
  try {
    const response = await fetcher(comfy.baseUrl+'/object_info', {signal:AbortSignal.timeout(5000)});
    if (!response.ok) return missing;
    info = await response.json();
    if (!info || typeof info !== 'object' || Array.isArray(info)) return missing;
  } catch {return missing;}
  let localEndpoint=false;
  try { localEndpoint=['localhost','127.0.0.1','::1','[::1]'].includes(new URL(comfy.baseUrl).hostname.toLowerCase()); } catch { /* fail closed */ }
  const has=(...names)=>names.every(name=>Boolean(info[name]));
  const choice=(node,key,value)=>{
    const field=info[node]?.input?.required?.[key];
    if(!Array.isArray(field) || field.length<1 || field.length>2 || typeof value!=='string') return false;
    let choices;
    if(Array.isArray(field[0])) choices=field[0];
    else if(field.length===2 && field[0]==='COMBO' && field[1] && typeof field[1]==='object' && !Array.isArray(field[1]) && Object.hasOwn(field[1],'options')) choices=field[1].options;
    return Array.isArray(choices) && choices.every(item=>typeof item==='string') && choices.includes(value);
  };
  const files=async(entries)=>{
    // Local file checks cannot verify a remote ComfyUI host.
    if(!modelsRoot || !localEndpoint) return false;
    try {
      const results=await Promise.all(entries.map(async([path,min])=>{const s=await statFile(join(modelsRoot,...path.split('/')));return s.isFile() && s.size>=min;}));
      return results.every(Boolean);
    } catch {return false;}
  };
  const samOutput=has('JoinImageWithAlpha') ? has('InvertMask','SaveImage')
    : has('LayerUtility: ImageCombineAlpha') ? has('SaveImage')
    : has('SaveImageWithAlpha') ? true : has('MaskToImage','SaveImage');
  const rmbgNodes=has('BiRefNetRMBG','LoadImage','SaveImage') && choice('BiRefNetRMBG','model','BiRefNet-general');
  const samNodes=has('SAM Model Loader','SAM Parameters','SAM Image Mask','LoadImage') && samOutput;
  const seedNodes=has('LoadImage','SaveImage','SeedVR2LoadDiTModel','SeedVR2LoadVAEModel','SeedVR2VideoUpscaler')
    && choice('SeedVR2LoadDiTModel','model','seedvr2_ema_3b_fp8_e4m3fn.safetensors') && choice('SeedVR2LoadVAEModel','model','ema_vae_fp16.safetensors');
  const seeNodes=has('LoadImage','PreviewImage','SeeThrough_LoadLayerDiffModel','SeeThrough_LoadDepthModel','SeeThrough_GenerateLayers','SeeThrough_GenerateDepth','SeeThrough_PostProcess','SeeThrough_SavePSD')
    && choice('SeeThrough_LoadLayerDiffModel','model','seethroughv0.0.2_layerdiff3d') && choice('SeeThrough_LoadDepthModel','model','seethroughv0.0.1_marigold');
  const fluxNodes=has('LoadImage','ImageToMask','UNETLoader','DualCLIPLoader','VAELoader','CLIPTextEncode','ConditioningZeroOut','FluxGuidance','InpaintModelConditioning','DifferentialDiffusion','KSampler','VAEDecode','SaveImage')
    && choice('UNETLoader','unet_name','fill-dev-OneReward-fp8.safetensors') && choice('VAELoader','vae_name','ae.safetensors')
    && choice('DualCLIPLoader','clip_name1','clip_l.safetensors') && choice('DualCLIPLoader','clip_name2','t5xxl_fp8_e4m3fn.safetensors');
  const seeRequired=[];
  for (const model of ['seethroughv0.0.1_marigold','seethroughv0.0.2_layerdiff3d']) {
    const base=`SeeThrough/${model}`;
    for (const rel of ['scheduler/scheduler_config.json','text_encoder/config.json','tokenizer/merges.txt','tokenizer/special_tokens_map.json','tokenizer/tokenizer_config.json','tokenizer/vocab.json','unet/config.json','vae/config.json']) seeRequired.push([`${base}/${rel}`,1]);
    if (model==='seethroughv0.0.2_layerdiff3d') for (const rel of ['text_encoder_2/config.json','tokenizer_2/merges.txt','tokenizer_2/special_tokens_map.json','tokenizer_2/tokenizer_config.json','tokenizer_2/vocab.json','trans_vae/config.json']) seeRequired.push([`${base}/${rel}`,1]);
  }
  const [rmbgFiles,samFiles,samLFiles,samHFiles,seedFiles,seeFiles,lamaFiles]=await Promise.all([
    rmbgNodes && files([['RMBG/BiRefNet/BiRefNet-general.safetensors',800000000],['RMBG/BiRefNet/config.json',100],['RMBG/BiRefNet/birefnet.py',1000],['RMBG/BiRefNet/BiRefNet_config.py',100]]),
    samNodes && choice('SAM Model Loader','model_size','ViT-B') && files([['sam/sam_vit_b_01ec64.pth',370000000]]),
    samNodes && choice('SAM Model Loader','model_size','ViT-L') && files([['sam/sam_vit_l_0b3195.pth',1200000000]]),
    samNodes && choice('SAM Model Loader','model_size','ViT-H') && files([['sam/sam_vit_h_4b8939.pth',2500000000]]),
    seedNodes && files([['SEEDVR2/seedvr2_ema_3b_fp8_e4m3fn.safetensors',3300000000],['SEEDVR2/ema_vae_fp16.safetensors',490000000]]),
    seeNodes && files([['SeeThrough/seethroughv0.0.1_marigold/model_index.json',100],['SeeThrough/seethroughv0.0.1_marigold/text_encoder/model.safetensors',600000000],['SeeThrough/seethroughv0.0.1_marigold/unet/diffusion_pytorch_model.safetensors',2300000000],['SeeThrough/seethroughv0.0.1_marigold/vae/diffusion_pytorch_model.safetensors',160000000],['SeeThrough/seethroughv0.0.2_layerdiff3d/model_index.json',100],['SeeThrough/seethroughv0.0.2_layerdiff3d/text_encoder/model.safetensors',240000000],['SeeThrough/seethroughv0.0.2_layerdiff3d/text_encoder_2/model.safetensors',1300000000],['SeeThrough/seethroughv0.0.2_layerdiff3d/unet/diffusion_pytorch_model.safetensors',8000000000],['SeeThrough/seethroughv0.0.2_layerdiff3d/vae/diffusion_pytorch_model.safetensors',160000000],['SeeThrough/seethroughv0.0.2_layerdiff3d/trans_vae/diffusion_pytorch_model.safetensors',200000000],...seeRequired]),
    seeNodes && localEndpoint && (async()=>{try{const s=await statFile(join(process.env.TORCH_HOME || join(process.env.XDG_CACHE_HOME || join(homedir(),'.cache'),'torch'),'hub','checkpoints','lama_large_512px.ckpt'));return s.isFile() && s.size>=200000000;}catch{return false;}})()
  ]);
  const fluxRemoval=fluxNodes && has('LoraLoaderModelOnly') && choice('LoraLoaderModelOnly','lora_name','removal_timestep_alpha-2-1740.safetensors');
  const samAuto=choice('SAM Model Loader','model_size','ViT-H') ? samHFiles : choice('SAM Model Loader','model_size','ViT-L') ? samLFiles : samFiles;
  return {rmbg:Boolean(rmbgFiles),samB:Boolean(samFiles),samL:Boolean(samLFiles),samH:Boolean(samHFiles),samAuto:Boolean(samAuto),qwenInpaintNodes:has('LoadImage','SaveImage','VAEDecode','VAEEncode','SetLatentNoiseMask','ImageToMask','KSampler','SplitImageWithAlpha','InvertMask','ImageCompositeMasked','ImagePadForOutpaint','ImageCrop','MaskComposite'),seedvr:Boolean(seedFiles),seeThrough:Boolean(seeFiles),seeThroughLama:Boolean(seeFiles && lamaFiles),fluxFill:fluxNodes,fluxRemoval};
}
