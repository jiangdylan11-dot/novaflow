"""Offline ComfyUI worker: new reference experiment without restarting port 8188."""
import argparse
import asyncio
import hashlib
import gc
import json
import os
import subprocess
from pathlib import Path
import sys
import time
import urllib.request
from contextlib import nullcontext
from types import SimpleNamespace
from itertools import product

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--size', type=int, default=512)
    parser.add_argument('--production-size', action='store_true', help='Use the exact 1 MP preprocessing from the API comparison')
    parser.add_argument('--strength', type=float, default=.65)
    parser.add_argument('--strengths', help='Comma-separated redraw strengths, reusing loaded models')
    parser.add_argument('--preserve-aspect', action='store_true')
    parser.add_argument('--reference', default='0,.6')
    parser.add_argument('--reference-mode', choices=['statistics', 'shared-kv', 'flowedit'], default='statistics')
    parser.add_argument('--source', type=Path, default=ROOT / 'docs/image-wash-q5-optimization/source.png')
    parser.add_argument('--profile', type=Path, default=ROOT / 'docs/image-wash-q5-optimization/qwen3-analysis/style-profile.json')
    parser.add_argument('--source-cfg', type=float, default=3)
    parser.add_argument('--target-cfg', type=float, default=3)
    parser.add_argument('--steps', type=int, default=20)
    parser.add_argument('--shift', type=float, default=1)
    parser.add_argument('--distilled', action='store_true', help='Ablation with the existing Wan step-distillation LoRA')
    parser.add_argument('--node', action='store_true', help='Exercise the actual reusable Comfy node')
    parser.add_argument('--refine-sigma', type=float, default=.1)
    parser.add_argument('--reserve-vram', type=float, default=0, help='Optional isolated-worker VRAM reservation in GiB')
    parser.add_argument('--max-sigma', type=float, default=.55)
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/image-wash-q5-reference')
    args = parser.parse_args()
    queue = json.load(urllib.request.urlopen('http://127.0.0.1:8188/queue', timeout=10))
    if queue['queue_running'] or queue['queue_pending']:
        raise RuntimeError('Runtime busy; experiment not started')
    request = urllib.request.Request('http://127.0.0.1:8188/free', data=b'{"unload_models":true,"free_memory":true}', headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(request, timeout=15).read()
    config = json.loads(Path(r'C:\ProgramData\NovaFlow\AI-Runtime\runtime.json').read_text(encoding='utf-8'))
    comfy_root = Path(config['installPath']) / 'engine/ComfyUI'
    sys.path.insert(0, str(comfy_root))
    # Do not pass this worker's arguments into Comfy's optional CLI parser.
    sys.argv = [sys.argv[0]]
    import numpy as np
    import torch
    from PIL import Image
    import folder_paths
    import nodes
    import comfy.model_management
    if args.reserve_vram:
        comfy.model_management.EXTRA_RESERVED_VRAM = args.reserve_vram * 1024 ** 3
    from comfy_extras.nodes_model_advanced import ModelSamplingSD3
    from wan_wash_reference import attach_source_style, attach_shared_kv

    models = Path(config['modelsPath'])
    for category, dirs in {'diffusion_models': ['unet', 'diffusion_models'], 'text_encoders': ['text_encoders', 'clip'], 'vae': ['vae'], 'loras': ['loras']}.items():
        for directory in dirs:
            folder_paths.add_model_folder_path(category, str(models / directory))
    if not asyncio.run(nodes.load_custom_node(str(Path(config['customNodesPath']) / 'gguf'))):
        raise RuntimeError('GGUF loader could not be loaded')
    if args.node and not asyncio.run(nodes.load_custom_node(str(ROOT / 'particle-editor-desktop/main/wan-wash-node'))):
        raise RuntimeError('Source redraw node could not be loaded')
    graph = json.loads((ROOT / 'docs/image-wash-q5-optimization/remix-auto-cfg4-no-lora-medium-workflow.json').read_text(encoding='utf-8'))
    args.output.mkdir(parents=True, exist_ok=True)
    image = Image.open(args.source).convert('RGB')
    if not args.production_size:
        if args.preserve_aspect:
            scale = args.size / max(image.size)
            size = (max(8, round(image.width * scale)), max(8, round(image.height * scale)))
        else:
            size = (args.size, args.size)
        image = image.resize(size, Image.Resampling.LANCZOS)
    image.save(args.output / 'source.png')
    pixels = torch.from_numpy(np.asarray(image).copy()).float().div(255).unsqueeze(0)
    if args.production_size:
        from comfy_extras.nodes_post_processing import ImageScaleToTotalPixels
        pixels = ImageScaleToTotalPixels.execute(pixels, 'lanczos', 1, 1)[0]
    print('Loading the installed text encoder and VAE...', flush=True)
    clip = nodes.CLIPLoader().load_clip(graph['6']['inputs']['clip_name'], 'wan')[0]
    positive = nodes.CLIPTextEncode().encode(clip, graph['9']['inputs']['text'])[0]
    negative = nodes.CLIPTextEncode().encode(clip, graph['10']['inputs']['text'])[0]
    if args.reference_mode == 'flowedit':
        profile = json.loads(args.profile.read_text(encoding='utf-8'))
        # Use the same observed-medium exclusions as the actual wash UI. The
        # old anime fixture's negative prompt is not valid for photo/CG inputs.
        prompts = json.loads(subprocess.check_output(
            ['node', '-e', "const {loadWash}=require('./tools/qwen-image-wash-smoke.cjs');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(loadWash().buildWanSourceRedrawPrompts(JSON.parse(input)))));"],
            input=json.dumps(profile), text=True, encoding='utf-8', cwd=ROOT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0))
        negative_prompt = prompts['negative']
        negative = nodes.CLIPTextEncode().encode(clip, negative_prompt)[0]
        source_prompt = prompts['source']
        target_prompt = prompts['target']
        source_conditioning = nodes.CLIPTextEncode().encode(clip, source_prompt)[0]
        positive = nodes.CLIPTextEncode().encode(clip, target_prompt)[0]
    vae = nodes.VAELoader().load_vae(graph['7']['inputs']['vae_name'])[0]
    latent = nodes.VAEEncode().encode(vae, pixels)[0]
    # All text encodings and source latents are now materialized. Release their
    # GPU models before preparing a second guider's conditioning on 16 GB GPUs.
    comfy.model_management.unload_all_models()
    del clip
    gc.collect()
    comfy.model_management.soft_empty_cache()
    print('Loading Remix Q5; no extra model weights...', flush=True)
    model = nodes.NODE_CLASS_MAPPINGS['LoaderGGUF']().load_model(graph['3']['inputs']['gguf_name'])[0]
    lora_name = None
    if args.distilled:
        lora_name = r'Wan21\Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors'
        model = nodes.LoraLoaderModelOnly().load_lora_model_only(model, lora_name, 1)[0]
    model = ModelSamplingSD3().patch(model, args.shift)[0]
    strengths = [float(s) for s in args.strengths.split(',')] if args.strengths else [args.strength]
    for redraw_strength, value in product(strengths, args.reference.split(',')):
        args.strength = redraw_strength
        amount = float(value)
        size_label = '1mp' if args.production_size else str(args.size)
        name = f'q5-reference-{amount:g}-{args.strength:g}-{size_label}'
        print(f'{name}: started', flush=True)
        if args.reference_mode == 'flowedit':
            patched, reference = model, SimpleNamespace(telemetry={})
        else:
            attach = attach_shared_kv if args.reference_mode == 'shared-kv' else attach_source_style
            patched, reference = attach(model, latent, amount, args.max_sigma, 9122026)
        record = {'case': name, 'model': graph['3']['inputs']['gguf_name'], 'status': 'running',
                  'size': size_label, 'inputShape': list(pixels.shape), 'latentShape': list(latent['samples'].shape),
                  'strength': args.strength, 'referenceStrength': amount,
                  'referenceMaxSigma': args.max_sigma, 'referenceMode': args.reference_mode, 'seed': 9122026, 'steps': args.steps, 'cfg': 4,
                  'sampler': 'euler', 'scheduler': 'beta', 'shift': args.shift, 'lora': lora_name,
                  'positive': graph['9']['inputs']['text'], 'negative': graph['10']['inputs']['text'],
                  'execution': 'offline ComfyUI common_ksampler and installed GGUF node',
                  'clip': graph['6']['inputs']['clip_name'], 'vae': graph['7']['inputs']['vae_name'],
                  'sourceSha256': hashlib.sha256((args.output / 'source.png').read_bytes()).hexdigest(),
                  'referenceCodeSha256': hashlib.sha256((ROOT / 'tools/wan_wash_reference.py').read_bytes()).hexdigest(),
                  'inferenceMode': torch.is_inference_mode_enabled(), 'outputBlend': False}
        record['reservedVramGiB'] = args.reserve_vram or comfy.model_management.EXTRA_RESERVED_VRAM / 1024 ** 3
        record_path = args.output / f'{name}-run.json'
        if args.reference_mode == 'flowedit':
            record.update({'positive': target_prompt, 'sourcePrompt': source_prompt, 'sourceCfg': args.source_cfg,
                           'negative': negative_prompt,
                           'cfg': args.target_cfg, 'refineSigma': args.refine_sigma, 'referenceStrength': None,
                           'referenceCodeSha256': hashlib.sha256((ROOT / 'particle-editor-desktop/main/wan-wash-node/sampler.py').read_bytes()).hexdigest()})
        record_path.write_text(json.dumps(record, indent=2), encoding='utf-8')
        started = time.monotonic()
        try:
            if args.reference_mode == 'flowedit':
                if args.node:
                    if args.source_cfg != args.target_cfg or args.refine_sigma != .1:
                        raise ValueError('The reusable node uses symmetric CFG and refinement sigma 0.1')
                    node_result = nodes.NODE_CLASS_MAPPINGS['NovaFlowWanSourceRedraw']().redraw(
                        model, source_conditioning, positive, negative, latent, 9122026,
                        args.strength, args.steps, args.target_cfg)
                    samples = node_result['result'][0]
                    reference.telemetry = json.loads(node_result['ui']['text'][0])
                    record['execution'] = 'offline ComfyUI NovaFlowWanSourceRedraw node and installed GGUF loader'
                else:
                    from wan_wash_flowedit import sample
                    samples, reference.telemetry = sample(model, latent, positive, negative, source_conditioning,
                                                          args.strength, args.steps, args.source_cfg, args.target_cfg,
                                                          args.refine_sigma, 9122026)
            else:
                with reference.installed(patched) if args.reference_mode == 'shared-kv' else nullcontext():
                    samples = nodes.common_ksampler(patched, 9122026, args.steps, 4, 'euler', 'beta', positive, negative, latent, denoise=args.strength)[0]
            result = nodes.VAEDecode().decode(vae, samples)[0]
            output = np.clip(result[0].detach().cpu().numpy() * 255, 0, 255).astype(np.uint8)
            Image.fromarray(output).save(args.output / f'{name}.png')
            record['status'] = 'success'
        except Exception as exc:
            record['status'] = 'error'
            record['error'] = str(exc)
            raise
        finally:
            record['seconds'] = round(time.monotonic() - started, 3)
            record['telemetry'] = reference.telemetry
            record_path.write_text(json.dumps(record, indent=2), encoding='utf-8')
        print(json.dumps(record | {'positive': '[recorded]', 'negative': '[recorded]'}), flush=True)
        del patched, reference
    comfy.model_management.unload_all_models()


if __name__ == '__main__':
    import torch
    import logging
    logging.basicConfig(level=logging.INFO)
    # Match ComfyUI's PromptExecutor: without this, offline VAE decoding can
    # retain an autograd graph and prevent the next model load freeing VRAM.
    with torch.inference_mode():
        main()
