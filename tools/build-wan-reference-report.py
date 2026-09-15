"""Build the local review page only when all new image runs have succeeded."""
import hashlib
import html
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/image-wash-q5-reference'
cases = [
    ('q5-reference-0-0.65-512', '关闭参考'),
    ('q5-reference-0.6-0.65-512', '仅参考特征统计'),
    ('shared-kv/q5-reference-1-0.65-512', '共享原图注意力 · 512'),
    ('full-resolution/q5-reference-1-0.65-1mp', '共享原图注意力 · 1 MP'),
]
records = []
for stem, label in cases:
    record = json.loads((OUT / f'{stem}-run.json').read_text(encoding='utf-8'))
    assert record['status'] == 'success', stem
    assert record['seed'] == 9122026 and record['strength'] == .65
    assert record['steps'] == 20 and record['cfg'] == 4 and record['shift'] == 1
    assert record['lora'] is None and record['outputBlend'] is False
    assert record['model'].endswith('wan22RemixT2VI2V_t2vLowV20-Q5_K_M.gguf')
    image_path = OUT / f'{stem}.png'
    with Image.open(image_path) as image:
        image.verify()
    with Image.open(image_path) as image:
        dimensions = list(image.size)
    if record['referenceStrength']:
        assert record['telemetry']['maxStatisticsBlocks'] == 40
        assert record['telemetry']['styledAttentionCalls'] > 0
    records.append(record | {'label': label, 'file': stem + '.png', 'dimensions': dimensions,
                             'sha256': hashlib.sha256(image_path.read_bytes()).hexdigest()})
for record in records[1:]:
    assert record['positive'] == records[0]['positive'] and record['negative'] == records[0]['negative']
baseline_graph = json.loads((ROOT / 'docs/image-wash-q5-optimization/remix-auto-cfg4-no-lora-medium-workflow.json').read_text(encoding='utf-8'))
def source_pixels(path):
    with Image.open(path) as image:
        return image.size, hashlib.sha256(image.convert('RGB').tobytes()).hexdigest()
assert source_pixels(OUT / 'source.png') == source_pixels(OUT / 'shared-kv/source.png')
assert source_pixels(OUT / 'full-resolution/source.png') == source_pixels(ROOT / 'docs/image-wash-q5-optimization/source.png')
assert baseline_graph['9']['inputs']['text'] == records[-1]['positive']
assert baseline_graph['10']['inputs']['text'] == records[-1]['negative']
assert records[-1]['inputShape'][1:] == [1025, 1023, 3], records[-1]['inputShape']
verification = {'runsSucceeded': len(records), 'checks': 'PNG decode, identical Q5 / prompt / seed / strength / sampling, active reference telemetry',
                'qualityAccepted': False, 'productionChanged': False, 'unitTestsPassed': 7,
                'visualAssessment': {'sample': 'orange-shirt anime hiker, one seed',
                                     'improvement': 'Shared source attention reduces the glossy semi-realistic look and preserves the source composition better than Q5 without reference.',
                                     'remaining': 'Facial proportions, clothing highlights and background treatment still differ from the source. Matching original Wan and generalizing to other styles are not established.',
                                     'decision': 'Keep as an isolated experimental candidate; do not replace production.'}, 'records': records}
(OUT / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2), encoding='utf-8')


def card(label, image, note):
    return f'<figure><figcaption>{html.escape(label)}</figcaption><button class="image" data-image="{html.escape(image)}" aria-label="放大{html.escape(label)}"><img src="{html.escape(image)}" loading="lazy" alt="{html.escape(label)}"></button><p>{html.escape(note)}</p></figure>'


full = ''.join([
    card('原图', '../image-wash-q5-optimization/source.png', '目标：沿用原图的柔和动漫画风，让高强度控制重绘量。'),
    card('上一轮 Q5 · 无参考', '../image-wash-q5-optimization/remix-auto-cfg4-no-lora-medium.png', '复用已有 1 MP 输出。相同提示词、种子和采样参数。'),
    card('本轮 Q5 · 原图注意力参考', records[-1]['file'], '实际输出，重绘强度仍为 0.65。没有降低强度或混回原图。'),
])
small = card('512 原图', 'source.png', '本组各项均使用这一张 512 × 512 输入。') + ''.join(
    card(r['label'], r['file'], f"{r['seconds']:.1f} 秒；原图前向 {r['telemetry']['referencePasses']} 次；参考层调用 {r['telemetry']['styledAttentionCalls']} 次。")
    for r in records[:3])
rows = ''.join(f'<tr><td>{html.escape(r["label"])}</td><td>{r["dimensions"][0]} × {r["dimensions"][1]}</td><td>{r["seconds"]:.1f} 秒</td><td>{r["telemetry"]["styledAttentionCalls"]}</td></tr>' for r in records)
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Q5 洗图 · 原图参考验证</title>
<style>
:root{color-scheme:dark;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#101416;color:#e8eeee}body{max-width:1640px;margin:auto;padding:32px}h1{font-size:30px;margin:8px 0 16px}h2{font-size:21px;margin:32px 0 14px}p{line-height:1.7;color:#b9c6c8}a{color:#65dcb6}.tag{color:#65dcb6;font-size:13px;letter-spacing:1px}.notice{border:1px solid #6a562b;background:#2a261c;border-radius:12px;padding:16px 20px;color:#e9d5a9}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.small{grid-template-columns:repeat(4,minmax(0,1fr))}figure{margin:0;background:#1a2124;border:1px solid #2c373c;border-radius:12px;overflow:hidden}figcaption{padding:14px;font-weight:650}.image{display:block;border:0;padding:0;background:none;width:100%;cursor:zoom-in}.image img{display:block;width:100%;aspect-ratio:1;object-fit:contain}figure p{font-size:13px;margin:12px 14px 16px;min-height:44px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #303c40}th{color:#8fa9aa}details{margin:24px 0;background:#171d20;padding:16px;border-radius:12px}summary{cursor:pointer;color:#bdcece}.old{max-width:540px;margin-top:18px}dialog{padding:12px;background:#11191c;border:1px solid #57716a;border-radius:12px;max-width:96vw;max-height:96vh}dialog::backdrop{background:#000c}dialog img{display:block;max-width:90vw;max-height:85vh}dialog button{float:right;margin-bottom:8px;background:#263e35;color:white;border:0;padding:8px 18px;border-radius:6px}@media(max-width:900px){body{padding:16px}.grid,.small{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:540px){.grid,.small{grid-template-columns:1fr}}
</style><body><div class="tag">NOVAFLOW · 本地实测 · Q5 权重保持不变</div><h1>原图参考能否纠正高强度洗图的画风？</h1>
<div class="notice">结论：共享原图注意力有改善，1 MP 输出明显减轻了偏写实、偏光滑的感觉；脸型、衣服高光和背景处理仍与原图有差异。尚未证明达到原版 Wan 的效果，保留为实验候选，未替换安装版。</div>
<p>固定重绘强度 0.65、seed 9122026、20 步、CFG 4、Euler / Beta、shift 1，无 LoRA。改变的是采样时能否读取原图特征。点击图片可放大。</p>
<h2>正式分辨率对照</h2><div class="grid">FULL</div>
<h2>512 尺寸：从特征统计到注意力参考</h2><div class="grid small">SMALL</div>
<p>仅匹配特征统计时，画风改善很小。共享原图注意力后，512 输出的眼睛、脸型和构图更接近原图，但材质仍有偏亮、偏立体的现象。这个观察不能直接外推到其他图片和画风。</p>
<table><thead><tr><th>测试</th><th>输出尺寸</th><th>本次耗时</th><th>实际参考层调用</th></tr></thead><tbody>ROWS</tbody></table>
<p>耗时是这台电脑各次运行的实测值，包含当次模型调度，不是严格的性能基准。参考需要额外原图前向计算，成本明显增加。</p>
<details><summary>原版 Wan 的既有结果（目标参考，不是同参数对照）</summary><p>这张使用原版 Wan 与旧采样配置，保留了动漫画风，但也改变了动作和服装。本轮未重跑。</p><div class="old">WAN</div></details>
<p><a href="verification.json">运行与文件校验记录</a> · <a href="README.md">方法、复现与限制</a></p>
<dialog id="zoom"><button id="close">关闭</button><img alt="放大查看输出"></dialog><script>const dialog=document.querySelector('#zoom');for(const button of document.querySelectorAll('[data-image]'))button.onclick=()=>{dialog.querySelector('img').src=button.dataset.image;dialog.showModal()};document.querySelector('#close').onclick=()=>dialog.close();dialog.onclick=e=>{if(e.target===dialog)dialog.close()};</script></body></html>'''
page = page.replace('FULL', full).replace('SMALL', small).replace('ROWS', rows).replace('WAN', card('原版 Wan · 0.65', '../smoothmix-image-wash-validation/wan-medium.png', '既有基准，旧参数，不用于证明本轮性能差异。'))
(OUT / 'index.html').write_text(page, encoding='utf-8')
print(json.dumps({'runs': len(records), 'page': str(OUT / 'index.html')}, ensure_ascii=False))
