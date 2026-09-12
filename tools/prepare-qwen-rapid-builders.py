"""Prepare native Rapid builders; apply only after comparison acceptance."""
from pathlib import Path
import re

CKPT = 'Qwen-Rapid-AIO-NSFW-v20.safetensors'

def function(s, name, transform):
    pattern = r'^  (?:async )?function ' + name + r'\([^\n]*\) \{[\s\S]*?^  \}'
    old = re.search(pattern, s, re.M).group(0)
    new = transform(old)
    return s.replace(old, new, 1)

def loaders(f, model_id, clip_id, vae_id, use_resolved=False):
    for name in ['UNETLoader', 'CLIPLoader', 'VAELoader']:
        f = f.replace("      '" + name + "',\n", '')
    f = f.replace("      'LoadImage',", "      'LoadImage',\n      'CheckpointLoaderSimple',", 1)
    f = re.sub(r"    const (?:unet|clip|vae|vaeLoader) = (?:requiredComfyNode\(info, '[^']+'\)|info\.[A-Za-z]+)\n", '', f)
    f = re.sub(r"    const (?:lora|aura|cfgNorm) = info\.[^\n]+\n", '', f)
    f = re.sub(r"    const unetName = comfyChoiceFromCandidates\([\s\S]*?    const workflow =", "    const checkpoint = requiredComfyNode(info, 'CheckpointLoaderSimple')\n    const checkpointName = requireComfyChoice(checkpoint, 'ckpt_name', IMAGE_WASH_QWEN_CHECKPOINT, 'Qwen Rapid checkpoint')\n    const workflow =", f)
    if use_resolved:
        f = f.replace('    const workflow =', "    const checkpoint = requiredComfyNode(info, 'CheckpointLoaderSimple')\n    const checkpointName = resolved.checkpointName\n    const workflow =", 1)
    f = re.sub(r"      '" + model_id + r"': \{ class_type: 'UNETLoader',[^\n]+", "      '"+model_id+"': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpointName } },", f)
    f = re.sub(r"      '(?:"+clip_id+'|'+vae_id+r")': \{ class_type: '(?:CLIPLoader|VAELoader)',[^\n]+\n", '', f)
    for name in ['lora', 'aura', 'cfgNorm']:
        f = re.sub(r'    if \('+name+r'[^\n]*\) \{[\s\S]*?^    \}\n', '', f, flags=re.M)
    f = f.replace("['"+clip_id+"', 0]", "['"+model_id+"', 1]").replace("['"+vae_id+"', 0]", "['"+model_id+"', 2]")
    f = f.replace("steps: 5,", "steps: 6,").replace("steps: resolved.loraName ? 6 : 30,", "steps: 6,")
    f = f.replace("sampler_name: 'euler'", "sampler_name: 'euler_ancestral'").replace("scheduler: 'simple'", "scheduler: 'beta'")
    f = f.replace('unet: unetName,\n        clip: clipName,\n        vae: vaeName,\n        lora: lightningLora,', 'checkpoint: checkpointName,')
    f = f.replace('unet: resolved.unetName,\n        lora: resolved.loraName,\n        clip: resolved.clipName,\n        vae: resolved.vaeName,', 'checkpoint: checkpointName,')
    return f

def angle(f):
    for name in ['UNETLoader','CLIPLoader','VAELoader','ModelSamplingAuraFlow','CFGNorm']:
        f=f.replace("      '"+name+"',\n",'')
        f=re.sub(r"    const \w+ = requiredComfyNode\(info, '"+name+r"'\)\n",'',f)
    f=f.replace("      'LoadImage',", "      'LoadImage',\n      'CheckpointLoaderSimple',",1)
    f=re.sub(r'    const unetName =[\s\S]*?    const multiangleLora =', "    const checkpoint = requiredComfyNode(info, 'CheckpointLoaderSimple')\n    const checkpointName = requiredImageAngleChoice(checkpoint, 'ckpt_name', IMAGE_WASH_QWEN_CHECKPOINT, 'Qwen Rapid checkpoint')\n    const multiangleLora =", f)
    f=re.sub(r"      '2': \{ class_type: 'UNETLoader',[^\n]+", "      '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpointName } },", f)
    for key in ['3','5','6','7','8']:
        f=re.sub(r"      '"+key+r"': \{[^\n]+\n",'',f)
    f=f.replace("model: ['3', 0]", "model: ['2', 0]").replace("model: ['6', 0]", "model: ['4', 0]")
    f=f.replace("['8', 0]", "['2', 1]").replace("['7', 0]", "['2', 2]")
    f=f.replace("sampler_name: 'euler'", "sampler_name: 'euler_ancestral'").replace("scheduler: 'simple'", "scheduler: 'beta'")
    f=f.replace('unet: unetName,\n        clip: clipName,\n        vae: vaeName,\n        loras: [lightningLora, multiangleLora],', 'checkpoint: checkpointName,\n        loras: [multiangleLora],')
    return f

s=Path('particle-editor/spine-split-runtime.js').read_text(encoding='utf-8')
s=function(s,'buildQwenImageOutpaintWorkflow',lambda f:loaders(f,'8','9','10'))
s=function(s,'buildObjectTransferQwenWorkflow',lambda f:loaders(f,'4','5','6',True))
s=function(s,'resolveObjectTransferQwenRuntime',lambda f: re.sub(r'    const unetName =[\s\S]*?    return \{[^\n]+', "    const checkpointName = objectTransferChoice(info.CheckpointLoaderSimple, 'ckpt_name', IMAGE_WASH_QWEN_CHECKPOINT, 'Qwen Rapid checkpoint')\n    return { checkpointName }",f.replace("      'UNETLoader',\n      'CLIPLoader',\n      'VAELoader',", "      'CheckpointLoaderSimple',")))
s=function(s,'buildImageAngleAdjustWorkflow',angle)
# Old default and explicit local callers converge on the tested existing Rapid paths.
s=function(s,'buildStoryboardSceneWorkflow',lambda f: "  function buildStoryboardSceneWorkflow(info, imageName, prefix, promptText, frameSize, modelMode, options = {}) {\n    return buildStoryboardNsfwSceneWorkflow(info, imageName, prefix, promptText, normalizeStoryboardFrameSize(frameSize), options)\n  }")
s=function(s,'defaultQwenInpaintWorkflow',lambda f: "  async function defaultQwenInpaintWorkflow(baseUrl, imageName, maskName, prefix, promptText, options) {\n    return defaultRapidAioNsfwInpaintWorkflow(baseUrl, imageName, maskName, prefix, promptText, options)\n  }")
for name in ['IMAGE_ANGLE_ADJUST_UNET','IMAGE_ANGLE_ADJUST_CLIP','IMAGE_ANGLE_ADJUST_VAE','OBJECT_TRANSFER_QWEN_UNETS','OBJECT_TRANSFER_QWEN_CLIP','OBJECT_TRANSFER_QWEN_VAE']:
    s=re.sub(r'^  const '+name+r' = [^\n]+\n','',s,flags=re.M)
for name in ['IMAGE_ANGLE_ADJUST_LIGHTNING_LORAS','OBJECT_TRANSFER_QWEN_LIGHTNING_LORAS']:
    s=re.sub(r'^  const '+name+r' = \[[\s\S]*?^  \]\n','',s,flags=re.M)
s=s.replace('let nsfwEnabled = false','const nsfwEnabled = true')
s=s.replace("'aria-pressed': 'false',\n        'aria-label': 'NSFW',\n        onclick: () => {\n          nsfwEnabled = !nsfwEnabled\n          updateNsfwToggle()\n        },", "'aria-pressed': 'true',\n        'aria-label': 'Rapid',\n        disabled: true,\n        title: '分镜图统一使用 Qwen Rapid AIO',")
Path('.tmp-rapid-candidate-spine-split-runtime.js').write_text(s,encoding='utf-8',newline='\r\n')

s=Path('particle-editor/aifx-local.workflow.js').read_text(encoding='utf-8')
s=s.replace("'qwen-image-edit-2511-spritesheet-conditioned-v1'", "'qwen-rapid-aio-spritesheet-conditioned-v2'")
s=s.replace("    'UNETLoader',\n    'LoraLoaderModelOnly',\n    'CLIPLoader',\n    'VAELoader',", "    'CheckpointLoaderSimple',")
s=re.sub(r'    const unet = selectModel\([\s\S]*?    const controlNet = selectModel\(', "    const checkpoint = selectModel(\n      comboOptions(info.CheckpointLoaderSimple, 'ckpt_name'),\n      (name) => name === '"+CKPT.lower()+"',\n      () => 1,\n      'Qwen Rapid AIO checkpoint',\n    )\n    const controlNet = selectModel(",s)
s=re.sub(r'    const weightDtypeOptions =[\s\S]*?    const samplerName =', '    const samplerName =',s)
s=s.replace("['euler'], 'Qwen sampler'", "['euler_ancestral'], 'Qwen Rapid sampler'").replace("['simple'], 'Qwen scheduler'", "['beta'], 'Qwen Rapid scheduler'")
s=s.replace('      unet,\n      lora,\n      clip,\n      vae,','      checkpoint,').replace('      weightDtype,\n      clipType,\n','')
s=re.sub(r"      '3': \{[\s\S]*?      '7': \{", "      '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: models.checkpoint } },\n      '7': {",s)
s=s.replace("['5', 0]","['3', 1]").replace("['6', 0]","['3', 2]").replace("model: ['4', 0]","model: ['3', 0]")
s=s.replace('steps: 4,','steps: 6,').replace('[PIPELINE, models.unet, models.lora, models.controlNet]', '[PIPELINE, models.checkpoint, models.controlNet]')
s=s.replace('The four-step sampler quantizes every tail window below 0.25 to its first', 'The Rapid sampler keeps the short tail reference window at its first')
Path('.tmp-rapid-candidate-aifx-local.workflow.js').write_text(s,encoding='utf-8',newline='\r\n')
