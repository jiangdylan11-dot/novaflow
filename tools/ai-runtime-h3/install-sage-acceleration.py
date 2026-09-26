"""Install the pinned Windows attention packages (SageAttention + Triton) the H3 video nodes use.

H3 runs on the single AI-Runtime (ComfyUI 0.37) since 2026-09-26; --runtime targets another install
and --wheel-cache reuses wheels already downloaded (the SHA256 is still checked).
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

PACKAGES = [
    ('sageattention-2.2.0+cu130torch2.9.0andhigher.post4-cp39-abi3-win_amd64.whl',
     'https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows.post4/sageattention-2.2.0%2Bcu130torch2.9.0andhigher.post4-cp39-abi3-win_amd64.whl',
     'f7261c53a1d46202059daff6b8feac5ee806274d47e3e7fb7abf8c5f6d410c92'),
    ('triton_windows-3.6.0.post26-cp312-cp312-win_amd64.whl',
     'https://files.pythonhosted.org/packages/62/1e/8d9814e67ba3f20094cf3c69e7815a491f20beb86469a647550ba86728b0/triton_windows-3.6.0.post26-cp312-cp312-win_amd64.whl',
     '189d8c57911aa9d2ff983a715e5c967b325f576307db60924cab22b501a36515'),
]

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', default=r'C:\ProgramData\NovaFlow\AI-Runtime')
    parser.add_argument('--wheel-cache', default='')
    args = parser.parse_args()
    RUNTIME = Path(args.runtime)
    PYTHON = RUNTIME / 'engine/python/python.exe'
    cache = Path(args.wheel_cache) if args.wheel_cache else RUNTIME / 'generated/sage-packages'
    cache.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(PYTHON), '-c', "import sys,importlib.metadata as m; assert sys.version_info[:2]==(3,12); assert m.version('torch')=='2.10.0+cu130'"], check=True)
    wheels = []
    for name, url, digest in PACKAGES:
        path = cache / name
        if not path.exists():
            urllib.request.urlretrieve(url, path)
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise RuntimeError('Package SHA256 mismatch: ' + name)
        wheels.append(str(path))
    subprocess.run([str(PYTHON), '-m', 'pip', 'install', '--no-deps', *wheels], check=True)
    subprocess.run([str(PYTHON), '-c', 'import torch,sageattention,triton; print(torch.__version__,triton.__version__); print("SageAttention import passed; no generation performed")'], check=True)
    (cache / 'manifest.json').write_text(json.dumps([dict(name=n, url=u, sha256=h) for n,u,h in PACKAGES], indent=2), encoding='utf-8')
