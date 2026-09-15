"""Validate the files and graph identity of a recorded Q5 comparison; no inference."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image


def verify(folder):
    folder = Path(folder)
    results = []
    for record_path in sorted(folder.glob('remix-*-run.json')):
        record = json.loads(record_path.read_text(encoding='utf-8-sig'))
        name = record['case']
        graph = json.loads((folder / f'{name}-workflow.json').read_text(encoding='utf-8-sig'))
        output = folder / f'{name}.png'
        assert record['status'] == 'success', name
        assert graph['3']['inputs']['gguf_name'].replace('\\', '/') == 'Wan22/wan22RemixT2VI2V_t2vLowV20-Q5_K_M.gguf', name
        assert graph['11']['inputs']['seed'] == 9122026, name
        assert graph['11']['inputs']['denoise'] == record['strength'], name
        assert graph['11']['inputs']['latent_image'] == ['8', 0], name
        assert graph['8']['class_type'] == 'VAEEncode', name
        with Image.open(output) as image:
            size = list(image.size)
            image.verify()
        results.append({'case': name, 'promptId': record['promptId'], 'seconds': record['seconds'],
                        'size': size, 'strength': record['strength'],
                        'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
    assert results, 'No completed comparisons found'
    report = {'sourceSha256': hashlib.sha256((folder / 'source.png').read_bytes()).hexdigest(),
              'verification': 'PNG integrity, Q5 model, original-image latent and seed; not a visual-quality score',
              'results': results}
    (folder / 'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'verified': len(results), 'cases': [item['case'] for item in results]}))


if __name__ == '__main__':
    verify(sys.argv[1])
