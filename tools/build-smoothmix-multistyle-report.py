"""Build a browsable matrix from verified local SmoothMix executions and visual notes."""
import hashlib
import html
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/smoothmix-t2v-v4-multistyle-validation'
fixtures = json.loads((OUT / 'fixtures.json').read_text(encoding='utf-8'))
notes = json.loads((OUT / 'assessments.json').read_text(encoding='utf-8'))
levels = [('low', 0.2), ('medium', 0.65), ('high', 0.9)]


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def card(title, image_path, note, record=None):
    link = f'<a class="record" href="{record}">参数与运行记录</a>' if record else ''
    return f'<figure><figcaption>{html.escape(title)}</figcaption><a class="image" href="{image_path}" target="_blank"><img src="{image_path}" alt="{html.escape(title)}" loading="lazy"></a><p>{html.escape(note)}</p>{link}</figure>'


records, sections, rows = [], [], []
for fixture in fixtures:
    fid, title = fixture['id'], fixture['title']
    folder = OUT / fid
    source = folder / 'source.png'
    assert sha(source) == sha(ROOT / fixture['source']), fid
    with Image.open(source) as image:
        source_size = image.size
    cards = card('原图', f'{fid}/source.png', f'原始尺寸 {source_size[0]} × {source_size[1]}。点击图片查看原尺寸。')
    local_records = []
    for level, strength in levels:
        name = f'smooth-t2v-v4-{fid}-beta-7-cfg1-shift8-{level}'
        record = read(folder / (name + '-run.json'))
        graph = read(folder / (name + '-workflow.json'))
        history = read(folder / (name + '-history.json'))
        assert record['status'] == history['status']['status_str'] == 'success', name
        assert history['prompt'][1] == record['promptId']
        assert history['prompt'][2] == graph
        assert record['sourceSha256'] == sha(source)
        assert graph['3']['inputs']['unet_name'].replace('\\', '/') == 'Wan22/smoothMixWan2214BI2V_t2vLowV40.safetensors'
        assert graph['3']['class_type'] == 'UNETLoader' and graph['11']['class_type'] == 'KSampler'
        assert graph['11']['inputs']['denoise'] == record['strength'] == strength
        assert graph['11']['inputs']['seed'] == 9122026
        assert graph['11']['inputs']['steps'] == 7 and graph['11']['inputs']['cfg'] == 1
        assert graph['11']['inputs']['scheduler'] == 'beta' and graph['5']['inputs']['shift'] == 8
        assert '4' not in graph and not record['outputBlend'] and not record['productionDefaultChanged']
        output = folder / (name + '.png')
        assert sha(output) == record['outputSha256']
        with Image.open(output) as image:
            record['dimensions'] = list(image.size)
            image.verify()
        record['visualAssessment'] = notes[fid][level]
        record['assessmentMethod'] = 'Manual inspection of the actual source and all three raw generated outputs.'
        local_records.append(record)
        cards += card(f'强度 {strength}', f'{fid}/{name}.png', notes[fid][level] + f' · {record["seconds"]:.1f} 秒', f'{fid}/{name}-run.json')
    prompts = [read(folder / (r['case'] + '-workflow.json'))['9']['inputs']['text'] for r in local_records]
    assert len(set(prompts)) == 1, 'Prompt must stay identical across strengths.'
    records.extend(local_records)
    sections.append(f'<section id="{fid}" data-fixture="{fid}"><h2>{html.escape(title)}</h2><p class="section-note">{html.escape(notes[fid]["summary"])}</p><div class="grid">{cards}</div><details><summary>这张图的描述与风格处理</summary><p>风格触发词：{html.escape(fixture["styleTrigger"] or "未添加动漫或 SmoothMix 写实触发词；直接描述原图的摄影或三维表现。")}</p><pre>{html.escape(prompts[0])}</pre><p>来源：人工查看原图后写入描述，本轮未运行自动 Prompt Assistant。</p></details></section>')
    rows.append(f'<tr><th><a href="#{fid}">{html.escape(title)}</a></th><td>{html.escape(notes[fid]["summary"])}</td></tr>')

assert len(records) == 12 and len({r['promptId'] for r in records}) == 12
verification = {
    'model': 'Wan22/smoothMixWan2214BI2V_t2vLowV40.safetensors',
    'executionPassed': True, 'completedRuns': 12, 'distinctSources': 4,
    'productionDefaultChanged': False, 'oldExperimentsRerun': False,
    'singleSeed': 9122026, 'megapixels': 1,
    'inputCaptionMethod': 'Manual descriptions from sources visually inspected this turn; no automated style-recognition acceptance claim.',
    'coverage': ['anime character illustration', 'photorealistic cinematic portrait', 'stylized 3D robot', 'photographic still life'],
    'notEvaluated': ['multiple seeds', 'pixel art', 'line art', 'transparent background preservation', 'NSFW content', 'formal UI integration and automated Prompt Assistant'],
    'findings': notes, 'records': records,
}
(OUT / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2), encoding='utf-8')

buttons = '<button type="button" data-filter="all" aria-pressed="true">全部四种</button>' + ''.join(f'<button type="button" data-filter="{f["id"]}" aria-pressed="false">{html.escape(f["title"])}</button>' for f in fixtures)
page = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmoothMix v4 · 多图洗图测试</title>
<style>:root{color-scheme:dark;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#e9f2ed;background:#101714}*{box-sizing:border-box}body{max-width:1780px;margin:auto;padding:28px}h1{font-size:30px;margin:10px 0}h2{font-size:23px;margin:0 0 8px}p{line-height:1.8;color:#b8c9bf}.eyebrow{font-size:12px;letter-spacing:.12em;color:#83dbad}.summary{background:#192c23;border:1px solid #3a6952;border-radius:12px;padding:17px 20px;margin-top:20px}.summary p{margin:0}.chips{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.chips span{font-size:13px;padding:7px 11px;border:1px solid #3b5043;border-radius:7px}nav{display:flex;flex-wrap:wrap;gap:9px;position:sticky;top:0;background:#101714f5;padding:15px 0;z-index:2}button{font:inherit;font-size:14px;color:#c6d5cc;background:#203129;border:1px solid #425d4c;border-radius:7px;padding:9px 15px;cursor:pointer}button[aria-pressed=true]{color:#062e1b;background:#86dfb0;border-color:#86dfb0}section{padding-top:28px;scroll-margin-top:80px}section[hidden]{display:none}.section-note{margin:0 0 15px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}figure{margin:0;background:#19251e;border:1px solid #344b3c;border-radius:11px;padding:11px}figcaption{font-weight:650;margin:0 0 10px}.image{display:block;background:#0d1410;border-radius:5px}img{display:block;width:100%;height:clamp(300px,36vw,610px);object-fit:contain}figure p{font-size:13px;line-height:1.65;margin:11px 0 0}a{color:#90e2b8}.record{display:inline-block;margin-top:9px;font-size:12px}details{padding:14px 17px;border:1px solid #354c3e;border-radius:9px;margin:15px 0}summary{cursor:pointer;font-size:14px}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#c4d7ca;line-height:1.6;font-size:12px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #354c3e;padding:12px;line-height:1.7}th{width:180px}footer{font-size:13px;border-top:1px solid #354c3e;margin-top:32px;padding:17px 0}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}img{height:480px}}@media(max-width:600px){body{padding:16px}h1{font-size:25px}.grid{grid-template-columns:1fr}img{height:auto;max-height:80vh}nav{position:static}th{width:110px}}</style></head><body>
<div class="eyebrow">NOVAFLOW / SMOOTHMIX T2V LOW V4</div><h1>不同原图，同一套洗图参数</h1><p>沿用你认可的上一轮方案，扩展到古风动漫、写实人物、三维角色和静物摄影。每张图只改变强度，原图与三个结果并排展示。</p>
<div class="summary"><p>__OVERALL__</p></div><div class="chips"><span>4 张不同原图</span><span>12 次生成成功</span><span>强度 0.2 / 0.65 / 0.9</span><span>7 步 · Euler / Beta · CFG 1</span><span>生成结果未混回原图</span></div>
<nav aria-label="筛选原图">__BUTTONS__</nav>__SECTIONS__
<section><h2>逐图观察</h2><table><tbody>__ROWS__</tbody></table></section>
<details><summary>测试范围和完整证据</summary><p>使用你提供的 SmoothMix T2V Low v4 FP8 混合精度文件；标准 KSampler、1 MP 工作尺寸、shift 8、固定种子 9122026。没有额外加速 LoRA。古风动漫使用 smoothmixanime；摄影与三维素材根据原图描述，不统一套动漫风格。原图较小时，1 MP 工作流会先放大再重绘。</p><p>本轮使用人工观察后的描述测试模型效果，尚未验证自动识图、正式界面和透明背景。只用了一个种子，不把四张图的表现推断为所有画风均通过。0.65 与 0.9 的变化不是线性关系，具体重构幅度应看各自的实际结果。</p><p>运行记录、工作流、返回历史、原图和输出哈希均已交叉核对；旧实验没有重跑，正式默认模型尚未更改。<a href="verification.json">完整验证记录</a> · <a href="fixtures.json">测试原图与描述</a> · <a href="../smoothmix-t2v-v4-image-wash-validation/index.html">上一轮单图对照</a></p></details>
<footer>图片均为本轮生成的原始输出，点击可查看原尺寸。摄影素材 coffee 来自本地 scikit-image 示例（Rachel Michetti，CC0）；其他素材来自已有本地任务图片。</footer>
<script>document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{const filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-fixture]').forEach(s=>s.hidden=filter!=='all'&&s.dataset.fixture!==filter);}));</script></body></html>'''
for key, value in {'__OVERALL__': html.escape(notes['overall']), '__BUTTONS__': buttons, '__SECTIONS__': ''.join(sections), '__ROWS__': ''.join(rows)}.items():
    page = page.replace(key, value)
(OUT / 'index.html').write_text(page, encoding='utf-8')
print(json.dumps({'page': str(OUT / 'index.html'), 'verifiedRuns': len(records), 'sources': len(fixtures)}, ensure_ascii=False))
