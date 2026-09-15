"""Display actual standard-sampler wash runs beside the user's original Wan baseline."""
import hashlib
import html
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/image-wash-q5-direct-redraw'


def picture(title, src, note):
    return f'<figure><figcaption>{html.escape(title)}</figcaption><a href="{src}" target="_blank"><img src="{src}" alt="{html.escape(title)}"></a><p>{html.escape(note)}</p></figure>'


records = []
cards = []
assessments = {
    'remix-direct-cfg2-medium': '重绘幅度恢复；脸、皮肤、衣料与背景仍明显偏写实，未通过。',
}
for file in sorted(OUT.glob('remix-*-run.json')):
    record = json.loads(file.read_text(encoding='utf-8'))
    name = file.name.removesuffix('-run.json')
    graph = json.loads((OUT / (name + '-workflow.json')).read_text(encoding='utf-8'))
    assert graph['11']['class_type'] == 'KSampler'
    assert not any(n['class_type'] == 'NovaFlowWanSourceRedraw' for n in graph.values())
    assert graph['3']['inputs']['gguf_name'].endswith('t2vLowV20-Q5_K_M.gguf')
    record['assessment'] = assessments.get(name, '等待逐图评估，运行成功不代表画质通过。')
    record['samplerClass'] = 'KSampler'
    record['outputBlend'] = False
    record['sourceSha256'] = hashlib.sha256((OUT / 'source.png').read_bytes()).hexdigest()
    if record['status'] == 'success':
        image_file = OUT / (name + '.png')
        with Image.open(image_file) as image:
            image.verify()
        record['outputSha256'] = hashlib.sha256(image_file.read_bytes()).hexdigest()
        note = f"{record['assessment']} 强度 {record['strength']}，CFG {graph['11']['inputs']['cfg']}，{record['seconds']:.1f} 秒。"
        cards.append(picture(name, image_file.name, note))
    else:
        cards.append(f'<article><h3>{html.escape(name)}</h3><p>无生成结果。状态：{html.escape(record["status"])}。详见运行记录；不计作画质结果。</p></article>')
    records.append(record)

verification = {'qualityAccepted': False, 'productionDefaultChanged': False,
                'previousMethodDecision': 'FlowEdit rejected: under-redraw and semi-realistic material rendering',
                'baselineReused': True, 'records': records}
(OUT / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2), encoding='utf-8')
baseline = picture('原图', 'source.png', '低强度保真；高强度应在同类画风内明显重画。')
baseline += picture('原版 Wan · 0.65', 'wan-medium.png', '用户认可的旧结果，直接复用。作为重绘幅度与二维画法的目标参考；并非同参数速度对照。')
baseline += picture('已否决：差分编辑 · 0.9', '../image-wash-q5-flowedit/anime-distilled-1mp/q5-reference-0-0.9-1mp.png', '仍偏半写实、变化不足，不能作为合格洗图交付。')
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>洗图：回到原版 Wan 的重绘方式</title>
<style>:root{color-scheme:dark;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#111619;color:#e9eff0}body{max-width:1500px;margin:auto;padding:26px}p{line-height:1.8;color:#bdc9cc}h1{font-size:28px}h2{margin-top:32px}.notice{border:1px solid #b07937;border-radius:10px;background:#2a231a;padding:16px;line-height:1.8}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure,article{margin:0;padding:14px;border:1px solid #354148;border-radius:10px;background:#192126}figcaption{font-weight:650;margin-bottom:12px}img{width:100%;aspect-ratio:1;object-fit:contain}figure p{font-size:13px}a{color:#75dfbd}@media(max-width:850px){.grid{grid-template-columns:1fr}}</style>
<body><h1>回到原版 Wan 的直接重绘流程</h1><div class="notice">替换尚未通过。偏写实与重绘不足是两个独立问题，必须同时解决。原版 Wan 默认路由保持不变。</div>
<h2>以原版效果为目标</h2><div class="grid">BASELINE</div>
<h2>本轮实际生成</h2><div class="grid">RESULTS</div>
<p>本轮直接调用现有 8188 服务的标准 KSampler：1 MP、7 步、Euler / Beta、shift 8、原有加速 LoRA。测试只使用当前 Q5 主模型，未混回原图，未调用差分编辑或共享注意力。所有运行记录保留真实 prompt ID。</p>
<p>第一组改为 CFG 2，让排除写实风格的负面词参与采样；第二组保持参数不变，只强化根据原图识别出的二维媒介表现。中断、失败或未完成的运行均不计作画质结果。</p>
<p><a href="verification.json">参数、状态和图像哈希</a> · <a href="../image-wash-q5-flowedit/index.html">上一轮已否决方案</a></p></body></html>'''
page = page.replace('BASELINE', baseline).replace('RESULTS', ''.join(cards))
(OUT / 'index.html').write_text(page, encoding='utf-8')
print(json.dumps({'page': str(OUT / 'index.html'), 'completedImages': sum(r['status'] == 'success' for r in records)}, ensure_ascii=False))
