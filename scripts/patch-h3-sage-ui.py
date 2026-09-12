"""Verify the fixed beta5 SageAttention UI policy; the selector has been retired."""
from pathlib import Path
s = (Path(__file__).resolve().parents[1] / 'particle-editor/assets/index-BbIa-2NM.js').read_text(encoding='utf-8')
assert 'data-novaflow-h3-acceleration' not in s
assert 'nfSetH3Acceleration' not in s
assert 'nfH3Acceleration=nfH3Profile===`classic`?`off`:`sage`' in s
print('Beta5 SageAttention enabled automatically; no user-facing selector')
