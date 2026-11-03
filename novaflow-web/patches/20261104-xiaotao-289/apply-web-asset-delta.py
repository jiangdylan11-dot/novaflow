"""Rebuild the exact reviewed 289 JS asset from its verified 288 baseline."""
import base64
import hashlib
import json
import sys
from pathlib import Path

BASELINE = 'fc1c6758e60a3077e56e1f3c72a4aed8e08f2e007e79d087851916792309ce2e'
TARGET = '575c616866efaa7a2589d18523bc9811277c54d10635b0f2a9ed67f649918ffd'

def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python apply-web-asset-delta.py BASELINE_JS OUTPUT_JS')
    old = Path(sys.argv[1]).read_bytes()
    if hashlib.sha256(old).hexdigest() != BASELINE:
        raise SystemExit('Unexpected 288 baseline')
    data = json.loads(Path(__file__).with_name('xiaotao-art-agent-asset-delta.json').read_text(encoding='utf-8'))
    if data.get('baselineSha256') != BASELINE or data.get('targetSha256') != TARGET:
        raise SystemExit('Unexpected delta metadata')
    out = bytearray()
    for op in data['ops']:
        if op[0] == 'c' and len(op) == 3 and isinstance(op[1], int) and isinstance(op[2], int) and 0 <= op[1] <= len(old) and 0 <= op[2] <= len(old) - op[1]:
            out.extend(old[op[1]:op[1] + op[2]])
        elif op[0] == 'i' and len(op) == 2:
            out.extend(base64.b64decode(op[1], validate=True))
        else:
            raise SystemExit('Invalid delta operation')
    if len(out) != data.get('targetBytes') or hashlib.sha256(out).hexdigest() != TARGET:
        raise SystemExit('Target verification failed')
    with Path(sys.argv[2]).open('xb') as result:
        result.write(out)
    print('Rebuilt and SHA256-verified 289 webpage asset')

if __name__ == '__main__':
    main()
