"""Install pinned, checksum-verified H3 Turbo adapters without replacing legacy files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', default=r'C:\ProgramData\NovaFlow\AI-Runtime-H3')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(Path(__file__).with_name('lightx-turbo-manifest.json').read_text())
    runtime = Path(args.runtime)
    config = json.loads((runtime / 'runtime.json').read_text(encoding='utf-8-sig'))
    destination = Path(config['modelsPath']) / 'loras' / 'minimax_h3' / 'lightx_768'
    destination.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
    os.environ.setdefault('HF_HUB_DOWNLOAD_TIMEOUT', '120')
    from huggingface_hub import hf_hub_download

    def install(entry):
        target = destination / entry['name']
        if not target.exists() or target.stat().st_size != entry['bytes']:
            if args.verify_only:
                raise RuntimeError('Missing or incomplete: ' + str(target))
            print('Downloading ' + entry['name'], flush=True)
            hf_hub_download(manifest['repository'], entry['name'], revision=manifest['revision'], local_dir=destination)
        with target.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != entry['sha256']:
            raise RuntimeError('SHA256 mismatch: ' + str(target))
        print('Verified ' + entry['name'], flush=True)
        return {'path': str(target.resolve()), 'sha256': digest, 'bytes': target.stat().st_size}

    with ThreadPoolExecutor(max_workers=2) as pool:
        files = list(pool.map(install, manifest['files']))
    result = {'profile': manifest['profile'], 'revision': manifest['revision'], 'files': files}
    report = runtime / 'generated' / 'lightx-turbo-install.json'
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print('Install verified: ' + str(report), flush=True)


if __name__ == '__main__':
    main()
