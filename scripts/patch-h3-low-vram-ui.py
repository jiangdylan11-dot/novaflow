"""Retire the H3 version selector in favor of one low-VRAM switch."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / 'particle-editor/assets/index-BbIa-2NM.js'
s = p.read_text(encoding='utf-8')
if 'data-novaflow-h3-low-vram' in s:
    assert 'data-novaflow-h3-profile' not in s
    print('H3 low-VRAM UI already applied')
    raise SystemExit(0)

def replace(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:100], s.count(old))
    s = s.replace(old, new)

replace('getSelectedProfile?.()||`classic`', 'getSelectedProfile?.()||`beta5_int8`')
replace('nfH3SubmitOptions?.profile||`classic`', 'nfH3SubmitOptions?.profile||`beta5_int8`')
replace('nfH3Acceleration=nfH3Profile===`classic`?`off`:`sage`', 'nfH3Acceleration=`sage`')
replace('acceleration:nfH3Profile===`classic`?`off`:nfH3Acceleration', 'acceleration:nfH3Acceleration')
start = s.index('nfChangeH3Profile=e=>{')
end = s.index(',nfH3AspectOptions=', start)
s = s[:start] + 'nfChangeH3Profile=e=>nfSetH3Profile(nfH3WorkflowApi().setSelectedProfile(e))' + s[end:]

label = '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`'
start = s.index(label + 'H3 版本`')
end = s.index(label + '画幅比例`', start)
s = s[:start] + s[end:]

start = s.index('(Number(nfPanelH3LoraSnapshot?.steps)===4&&')
end = s.index(',(0,X.jsxs)(`div`,{style:{display:`grid`,gap:6}', start)
s = s[:start] + s[end + 1:]

start = s.index('title:nfH3Profile!==`classic`?')
end = s.index(',"aria-label":`采样步数`', start)
s = s[:start] + 'title:`beta5 TURBO 已内置加速权重；不额外叠加 Turbo LoRA`' + s[end:]

start = s.index('"data-novaflow-h3-steps"')
anchor = 'style:{width:70,height:26,padding:`4px 8px`,textAlign:`right`}})]})'
end = s.index(anchor, start) + len(anchor)
switch = ',(0,X.jsxs)(`div`,{"data-novaflow-h3-low-vram-control":`1`,style:{display:`flex`,gap:8,alignItems:`center`},children:[(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.60)`,whiteSpace:`nowrap`},children:`低显存`}),(0,X.jsx)(`button`,{"data-novaflow-h3-low-vram":`1`,type:`button`,role:`switch`,"aria-label":`低显存`,"aria-checked":nfH3Profile===`beta5_fp8`,title:nfH3Profile===`beta5_fp8`?`低显存模式：W4A8`:`标准模式：INT8`,onClick:()=>nfChangeH3Profile(nfH3Profile===`beta5_fp8`?`beta5_int8`:`beta5_fp8`),style:{position:`relative`,display:`inline-flex`,alignItems:`center`,width:34,minWidth:34,height:18,padding:0,border:0,borderRadius:999,background:nfH3Profile===`beta5_fp8`?`#1ea672`:`#222222`,cursor:`pointer`},children:(0,X.jsx)(`span`,{style:{position:`absolute`,top:`50%`,left:nfH3Profile===`beta5_fp8`?20:4,width:10,height:10,borderRadius:999,background:nfH3Profile===`beta5_fp8`?`#e8e8e8`:`#8f98a3`,transform:`translateY(-50%)`}})})]})'
s = s[:end] + switch + s[end:]
assert 'data-novaflow-h3-profile' not in s
assert 'data-novaflow-h3-internal-turbo' not in s
p.write_text(s, encoding='utf-8', newline='')
print('H3 uses INT8 by default with a low-VRAM W4A8 switch after random seed')
