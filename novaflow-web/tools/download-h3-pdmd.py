"""Download and SHA-256 verify the independent PDMD test chain (model bytes stay outside Git)."""
import argparse
import hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from huggingface_hub import hf_hub_download

FILES = [
    ("Kijai/MiniMax-H3-experimental", "loras/minimax_h3_pdmd_2step_lora_avg_rank_38_bf16.safetensors", "loras/minimax_h3_pdmd", 381015376, "a17f3eb45ab16be56fce79a522604a8ec1ce41d732022ad398c5908b230eec55"),
    ("Kijai/MiniMax-H3-experimental", "loras/minimax_h3_pdmd_4step_lora_avg_rank_57_bf16.safetensors", "loras/minimax_h3_pdmd", 558735392, "b5c62eb228a4f604890566ad698713703ed221302e0df1c067725c39f11efc37"),
    ("Comfy-Org/MiniMax-H3", "diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors", "diffusion_models/Minimax_H3", 34038892334, "7ad4c73e6e378b822ffd1629f27f632d3787d95f5e468e3af958f98c58df96a5"),
]


def download(entry, root):
    repo, remote, folder, size, digest = entry
    target = root / folder / Path(remote).name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        # The Hub client resumes partial downloads; use a cache on the model drive.
        cached = Path(hf_hub_download(repo, remote, cache_dir=str(root / ".hf-pdmd-cache")))
    else:
        cached = target
    if cached.stat().st_size != size:
        raise RuntimeError(f"Size mismatch: {cached}")
    hasher = hashlib.sha256()
    with cached.open("rb") as stream:
        for chunk in iter(lambda: stream.read(16 * 1024 * 1024), b""):
            hasher.update(chunk)
    if hasher.hexdigest() != digest:
        raise RuntimeError(f"SHA-256 mismatch: {cached}")
    if cached != target:
        # Keep one copy: move the verified cache blob into the ComfyUI model folder.
        cached.resolve().replace(target)
    print(f"VERIFIED {target} {size} {digest}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-root", required=True)
    args = parser.parse_args()
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda entry: download(entry, Path(args.models_root).resolve()), FILES))
