# Isolated layer-window QA

CPU preflight has passed. The preparing agent has not used --run or started ComfyUI/GPU inference.

The default command and `--preflight-only` perform read-only endpoint checks and prepare files under this folder. Only explicit `--run` starts the owned 8192 server and submits four fixed jobs in this order: Bright v3 OFF, Bright v3 ON, accepted Dark r10 OFF, accepted Dark r10 ON.

```powershell
& 'C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe' 'D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/layer-window-fastdisk-probe-20261025/run-isolated-layer-window.py' --preflight-only --min-ram-gib 4 --min-vram-free-mib 768 --low-headroom-seconds 2

& 'C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe' 'D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/layer-window-fastdisk-probe-20261025/run-isolated-layer-window.py' --run --min-ram-gib 4 --min-vram-free-mib 768 --low-headroom-seconds 2
```

Preflight refuses an occupied 8192, active 8191/8198, occupied 8188/8189/8190 queues, missing models, changed frozen baselines or changed prototype hashes. It does not unload or interrupt another service. An existing `load.json`, `result.json` or `owned-server.json` prevents rerunning this experiment. Directory/file preparation is otherwise idempotent.

All input/output/temp/user/custom-node directories are under `comfy-root/`. Model weights and the two known loader packages are searched read-only under `E:/NovaFlow`; bytecode writes are disabled. The custom-node whitelist contains only `ComfyUI-GGUF-leejet`, `novaflow_qwen_bf16_loader` and the staged `prototype_frequency_layers_v2`. The prototype source is pinned to the finalized 16-pass CPU package, including `reference_frequency_layers.py` SHA256 `ff04b5547da3695b99dc2cd06e80de030e123641268fd454dc5dfa05e4210b4a`.

Each frozen graph gains only node `901` between model cache `4` and sampler `7`; all node inputs are explicit: style index 1, high 0.5, low 1.5, beta 2, inclusive layers 24–31, audit logging true, cap false, minimum sigma 0. OFF/ON changes `enabled`. Prompt, negative, original source/style bytes, CFG3, the dedicated Turbo8 sigmas, seed54792256, image scaling and source-aligned 1280×960 latent remain unchanged. The live `/object_info` schema and required model choices must match before the first job.

Actual submitted graphs, history, downloads, SHA/RGBA hashes, upload receipts, graph differences, runtime node audits and individual full timings are saved per job. `/free` is followed by an idle/headroom check before the next job. Cold/warm differences are explicitly excluded from speedup claims. No new AI analysis is performed and no result is automatically accepted or published to the gallery.

The monitor samples `nvidia-smi` and available physical RAM about once a second. Defaults abort after five seconds below 3GiB available RAM or 384MiB free VRAM, immediately below 1GiB RAM, or on fatal CUDA/driver messages. A monitor failure aborts without retry. The finalizer interrupts/frees only 8192 while its PID identity matches, then terminates only its captured PID/create-time/cmdline identities. Owner command, logs, process cleanup and sampled resource summaries remain in this folder. Existing services, accepted Dark files and gallery data are not changed.

## Fast-disk resource-profile follow-up

This is a fresh sibling, not a resumed or overwritten run. Only the original runner source and README were copied; no previous logs, inputs, results or directory tree were copied. The only launch-code difference is the additional ComfyUI `--fast-disk` flag. HERE derives this sibling path naturally.

Use the explicit commands above to retain the previous execution guard: 4GiB available RAM, 768MiB free VRAM, sustained for 2 seconds. The original source default values remain unchanged; the reviewed execution uses these explicit CLI values. The original abort at Bright OFF initialization remains independently archived.

The same four jobs, frozen graphs/native prompts, original reference bytes, model weights, dtype, sampling and prototype SHA pins remain unchanged. `--fast-disk` is a resource/loading-profile change, with no guarantee of RAM savings. No server or GPU inference has been started by the preparing agent. Root will review preflight and explicitly choose `--run`. See `resource-profile-change.json`.
