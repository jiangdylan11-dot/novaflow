"""Compare each model's normal recipe using the same source/caption/seed/sampling."""
import hashlib
import html
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/wan-vs-smoothmix-wash-validation'
SMOOTH = ROOT / 'docs/smoothmix-t2v-v4-multistyle-validation'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def verify(folder, name):
    record = read(folder / (name + '-run.json'))
    workflow = read(folder / (name + '-workflow.json'))
    history = read(folder / (name + '-history.json'))
    assert record['status'] == history['status']['status_str'] == 'success'
    assert record['promptId'] == history['prompt'][1]
    assert workflow == history['prompt'][2]
    assert sha(folder / (name + '.png')) == record['outputSha256']
    assert sha(folder / 'source.png') == record['sourceSha256']
    assert not record['outputBlend'] and not record['productionDefaultChanged']
    with Image.open(folder / (name + '.png')) as image:
        record['dimensions'] = list(image.size)
        image.verify()
    return record, workflow


def picture(title, src, note, evidence=None):
    link = f'<a class="record" href="{evidence}">运行记录</a>' if evidence else ''
    return f'<figure><figcaption>{html.escape(title)}</figcaption><a href="{src}" target="_blank"><img src="{src}" alt="{html.escape(title)}" loading="lazy"></a><p>{html.escape(note)}</p>{link}</figure>'


fixtures = read(OUT / 'fixtures.json')
notes = read(OUT / 'assessments.json')
pairs, sections, table_rows = [], [], []
for fixture in fixtures:
    fid, title = fixture['id'], fixture['title']
    original_dir, smooth_dir = OUT / fid, SMOOTH / fid
    assert sha(original_dir / 'source.png') == sha(smooth_dir / 'source.png') == sha(ROOT / fixture['source'])
    for level, strength in [('low', 0.2), ('medium', 0.65), ('high', 0.9)]:
        suffix = f'{fid}-beta-7-cfg1-shift8-{level}'
        original_name, smooth_name = 'original-wan-' + suffix, 'smooth-t2v-v4-' + suffix
        original, wg = verify(original_dir, original_name)
        smooth, sg = verify(smooth_dir, smooth_name)
        assert original['sourceSha256'] == smooth['sourceSha256']
        for node in ['2', '6', '7', '8', '10', '11', '12']:
            assert wg[node] == sg[node], (fid, level, node)
        assert wg['11']['inputs']['denoise'] == strength
        assert wg['3']['inputs']['gguf_name'].replace('\\', '/') == 'Wan22/Wan2.2-T2V-A14B-LowNoise-Q4_K_S.gguf'
        assert sg['3']['inputs']['unet_name'].replace('\\', '/') == 'Wan22/smoothMixWan2214BI2V_t2vLowV40.safetensors'
        assert wg['4']['inputs']['strength_model'] == 1 and '4' not in sg
        assert wg['5']['inputs']['shift'] == sg['5']['inputs']['shift'] == 8
        assert wg['9']['inputs']['text'] == fixture['prompt']
        prefix = (fixture['styleTrigger'] + '. ') if fixture['styleTrigger'] else ''
        assert sg['9']['inputs']['text'] == prefix + wg['9']['inputs']['text']
        assessment = notes[fid][level]
        pairs.append({'fixture': fid, 'strength': strength, 'sourceSha256': original['sourceSha256'], 'original': original, 'smoothmix': smooth, 'assessment': assessment})
        cards = picture('原图', f'{fid}/source.png', '两边输入完全相同；点击图片查看原尺寸。')
        cards += picture(f'原版 Wan · {strength}', f'{fid}/{original_name}.png', assessment['original'] + f' · 本轮 {original["seconds"]:.1f} 秒', f'{fid}/{original_name}-run.json')
        smooth_path = f'../smoothmix-t2v-v4-multistyle-validation/{fid}/{smooth_name}'
        cards += picture(f'SmoothMix v4 · {strength}', smooth_path + '.png', assessment['smoothmix'] + f' · 上轮 {smooth["seconds"]:.1f} 秒', smooth_path + '-run.json')
        hidden = '' if level == 'medium' else ' hidden'
        sections.append(f'<section data-fixture="{fid}" data-strength="{level}"{hidden}><h2>{html.escape(title)} · 强度 {strength}</h2><p class="observation">{html.escape(assessment["comparison"])}</p><div class="grid">{cards}</div></section>')
    table_rows.append(f'<tr><th>{html.escape(title)}</th><td>{html.escape(notes[fid]["summary"])}</td></tr>')

assert len(pairs) == 12
assert len({pair['original']['promptId'] for pair in pairs}) == 12
verification = {'comparison': 'Two normal workflow recipes, not a pure weight-only ablation.', 'newOriginalWanRuns': 12, 'reusedSmoothMixRuns': 12, 'sources': 4, 'shared': ['source pixels', 'base caption', 'seed 9122026', '1 MP scaling', 'Wan VAE', 'UMT5', '7 Euler/Beta steps', 'CFG 1', 'shift 8', 'denoise 0.2/0.65/0.9', 'negative prompt'], 'different': ['model loader/weights/precision', 'original Wan external acceleration LoRA at strength 1; SmoothMix none', 'anime source only: SmoothMix author trigger prepended; original Wan uses base caption'], 'postprocessing': None, 'productionDefaultChanged': False, 'qualityAcceptedForFullReplacement': False, 'assessments': notes, 'pairs': pairs}
(OUT / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2), encoding='utf-8')
fixture_buttons = '<button data-fixture-filter="all" aria-pressed="true">全部素材</button>' + ''.join(f'<button data-fixture-filter="{f["id"]}" aria-pressed="false">{html.escape(f["title"])}</button>' for f in fixtures)
template = (Path(__file__).parent / 'wan-vs-smoothmix-report-template.html').read_text(encoding='utf-8')
for key, value in {'__OVERALL__': html.escape(notes['overall']), '__FIXTURE_BUTTONS__': fixture_buttons, '__SECTIONS__': ''.join(sections), '__TABLE_ROWS__': ''.join(table_rows)}.items():
    template = template.replace(key, value)
(OUT / 'index.html').write_text(template, encoding='utf-8')
print(json.dumps({'page': str(OUT / 'index.html'), 'verifiedPairs': len(pairs)}, ensure_ascii=False))
