"""Verify and display real SmoothMix T2V v4 outputs; never regenerate old baselines."""
import hashlib
import html
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/smoothmix-t2v-v4-image-wash-validation'
PREFIX = 'smooth-t2v-v4-beta-7-cfg1-shift8-'
ASSESSMENTS = {
    PREFIX + 'low': '基本保留姿势、服装配色和原图的柔和动漫表现；发丝、褶皱和路面有重绘，脸、短裤和背景仍有变化。低强度具备保真潜力，尚未经用户验收。',
    PREFIX + 'medium': '重绘幅度明显，构图仍可辨认；皮肤、衣服和背包趋向亮面、半 3D 材质，与原版 Wan 的二维色块和线条不同。未通过全面替换要求。',
    PREFIX + 'high': '姿态、背包位置、服装结构与背景发生大幅重绘；动漫面孔保留，但亮面材质和半 3D 倾向进一步突出。变化幅度通过，风格保真未通过。',
    'smooth-t2v-v4-simple-8-cfg1-shift8-medium': '添加作者动漫触发词后能画出动漫面孔，重绘明显；衣料和背包仍有偏 3D 的亮面反射。未通过二维风格保真要求。',
    'smooth-t2v-v4-simple-8-cfg2-shift8-medium-first-medium': '增强原图的二维画法描述并使负面词参与采样后，亮面材质仍在；饱和度升高，短袖还变成长袖。未通过。',
}


def read(name):
    return json.loads((OUT / name).read_text(encoding='utf-8'))


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def card(title, filename, note, evidence=None):
    link = f'<a class="evidence" href="{evidence}">运行记录</a>' if evidence else ''
    return f'<figure><figcaption>{html.escape(title)}</figcaption><a href="{filename}" target="_blank"><img src="{filename}" alt="{html.escape(title)}" loading="lazy"></a><p>{html.escape(note)}</p>{link}</figure>'


records = []
source_hash = digest(OUT / 'source.png')
assert source_hash == digest(ROOT / 'docs/smoothmix-image-wash-validation/source.png')
for name, assessment in ASSESSMENTS.items():
    record = read(name + '-run.json')
    workflow = read(name + '-workflow.json')
    history = read(name + '-history.json')
    assert record['status'] == 'success'
    assert history['status']['status_str'] == 'success'
    assert record['promptId'] == history['prompt'][1]
    assert workflow == history['prompt'][2], name
    assert workflow['3']['class_type'] == 'UNETLoader'
    assert workflow['3']['inputs']['unet_name'].replace('\\', '/') == 'Wan22/smoothMixWan2214BI2V_t2vLowV40.safetensors'
    assert workflow['11']['class_type'] == 'KSampler'
    assert '4' not in workflow
    assert record['sourceSha256'] == source_hash
    assert record['outputBlend'] is False and record['productionDefaultChanged'] is False
    image_file = OUT / (name + '.png')
    assert digest(image_file) == record['outputSha256']
    with Image.open(image_file) as image:
        record['dimensions'] = list(image.size)
        image.verify()
    record['assessment'] = assessment
    record['qualityAssessmentMethod'] = 'Manual inspection of actual generated images against source and recorded original Wan outputs.'
    records.append(record)

assert len({r['promptId'] for r in records}) == 5
for level in ('low', 'medium'):
    assert digest(OUT / f'wan-{level}.png') == digest(ROOT / f'docs/smoothmix-image-wash-validation/wan-{level}.png')

verification = {
    'candidate': read('model-inspection.json'),
    'executionAccepted': True, 'completedCandidateRuns': len(records),
    'qualityAcceptedForFullReplacement': False, 'productionDefaultChanged': False,
    'decision': 'Low strength is a promising fidelity candidate. Medium/high strengths redraw substantially but drift toward glossy semi-3D materials. Keep original Wan for now.',
    'scope': 'One recorded non-explicit anime source. Other media, additional seeds, and NSFW content have not been validated.',
    'baselineReused': True, 'sourceSha256': source_hash, 'records': records,
}
(OUT / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2), encoding='utf-8')

lookup = {r['case']: r for r in records}


def result_card(level):
    name = PREFIX + level
    r = lookup[name]
    label = {'low': '低强度', 'medium': '中强度', 'high': '高强度'}[level]
    return card(f'SmoothMix · {label} {r["strength"]}', name + '.png', ASSESSMENTS[name] + f' 本轮耗时 {r["seconds"]:.1f} 秒。', name + '-run.json')


medium = card('原图', 'source.png', '同一张源图、同一随机种子 9122026。点击任意图片查看原尺寸。')
medium += card('原版 Wan · 0.65', 'wan-medium.png', '直接复用之前的真实结果，没有重跑。较明确的二维线条、色块与绘画材质。')
medium += result_card('medium')
low = card('原图', 'source.png', '低强度目标：保留原有画风、结构与角色特征，并适度重绘纹理和细节。')
low += card('原版 Wan · 0.2', 'wan-low.png', '复用旧结果。保真与二维表现的参照。')
low += result_card('low')
range_cards = ''.join(result_card(level) for level in ('low', 'medium', 'high'))
experiments = ''
for name in ('smooth-t2v-v4-simple-8-cfg1-shift8-medium', 'smooth-t2v-v4-simple-8-cfg2-shift8-medium-first-medium'):
    r = lookup[name]
    title = 'Euler / Simple · 8 步 · CFG ' + str(r['sampling']['cfg'])
    experiments += card(title, name + '.png', ASSESSMENTS[name] + f' 本轮耗时 {r["seconds"]:.1f} 秒。', name + '-run.json')

page = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SmoothMix T2V v4 · 洗图实测</title>
<style>
:root{color-scheme:dark;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#eaf0ed;background:#101615}*{box-sizing:border-box}body{max-width:1550px;margin:auto;padding:28px}h1{font-size:29px;margin:10px 0}h2{font-size:21px;margin:34px 0 14px}p{color:#b9c8c1;line-height:1.75}.eyebrow{color:#78d6b0;font-size:13px;letter-spacing:.08em}.notice{border:1px solid #8c693a;background:#29241b;border-radius:12px;padding:18px;margin:20px 0;line-height:1.8}.notice strong{color:#ffcf83}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.two{grid-template-columns:repeat(2,minmax(0,1fr))}figure{margin:0;padding:13px;border:1px solid #30453c;background:#19231f;border-radius:12px}figcaption{font-weight:650;margin:0 0 12px}figure p{font-size:13px;margin:12px 0 0}img{display:block;width:100%;aspect-ratio:1;object-fit:contain;border-radius:5px;background:#0e1311}a{color:#7ae4b5}.evidence{display:inline-block;font-size:12px;margin-top:9px}.meta{font-size:13px}details{margin-top:25px;border:1px solid #30453c;border-radius:12px;padding:18px}summary{cursor:pointer;font-weight:600}code{overflow-wrap:anywhere;color:#c7dfd2}nav{display:flex;flex-wrap:wrap;gap:20px;margin-top:22px}nav a{font-size:14px}.facts{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}.facts span{border:1px solid #354a40;border-radius:7px;padding:7px 10px;font-size:13px}footer{margin-top:30px;border-top:1px solid #30453c;padding-top:15px;font-size:13px}@media(max-width:900px){body{padding:16px}.grid,.two{grid-template-columns:1fr}h1{font-size:25px}img{max-height:75vh}}
</style></head><body>
<div class="eyebrow">NOVAFLOW / 模型候选实测</div><h1>SmoothMix T2V v4：能洗图，但还不能全面替换原版 Wan</h1>
<p>测试的是你提供的 <code>smoothMixWan2214BI2V_t2vLowV40.safetensors</code>：T2V Low、FP8 混合精度。文件名里的 I2V 不代表它是之前试过的 I2V Low 模型。</p>
<div class="notice"><strong>本轮判断：低强度有保真潜力，中高强度仍有画风漂移。</strong><br>重绘幅度会随强度增加，解决了“没什么变化”；但衣料、背包和皮肤逐渐变成亮面、半 3D 表现。按“保持原图画风”的目标，暂不切换软件默认模型。</div>
<div class="facts"><span>5 次实际生成成功</span><span>原版结果直接复用</span><span>原图未混回结果</span><span>正式默认模型未更改</span></div>
<nav><a href="#medium">中强度对照</a><a href="#low">低强度对照</a><a href="#range">强度变化</a><a href="#sampling">其他采样测试</a></nav>
<h2 id="medium">0.65：原版 Wan 与 SmoothMix</h2><div class="grid">MEDIUM_CARDS</div>
<h2 id="low">0.2：保真表现更接近</h2><div class="grid">LOW_CARDS</div>
<h2 id="range">同一套 SmoothMix 参数，只改变强度</h2><p class="meta">7 步、CFG 1、Euler / Beta、shift 8；动漫触发词与主体描述一致。0.9 没有对应的旧 Wan 历史图，此处仅比较候选模型内部的强度变化。</p><div class="grid">RANGE_CARDS</div>
<details id="sampling"><summary>另外两组 0.65 测试：采样设置与更明确的二维提示</summary><p>第一组为 8 步 Euler / Simple、CFG 1。第二组改为 CFG 2，并强化来自原图的二维画法描述、加入排除照片与 3D 材质的负面词。两组仍出现亮面材质。</p><div class="grid two">EXPERIMENT_CARDS</div></details>
<details><summary>证据、测试边界与模型说明</summary><p>作者 v4 指南说明，不加风格触发词时默认偏写实。本轮根据源图的动漫媒介加入 <code>smoothmixanime, anime style</code>，没有使用写实触发词。作者的动漫风格仍不等于每一种原图画法。</p>
<p>候选通过 UNETLoader 加载你提供的文件，使用现有 Wan VAE / UMT5 和标准 KSampler。移除了原版额外叠加的加速 LoRA，未使用差分编辑或 I2V 首帧条件。主对照的采样设置沿用旧 Wan，但触发词和 LoRA 有差异，因此不是只换权重的严格单变量实验。</p>
<p>8 步 Euler / Simple 参考作者 T2V v3 示例作为本轮起点；v4 指南未给出新的完整采样参数。所有实际参数、模型路径、prompt ID、运行历史、图像哈希都保存在下方记录中。耗时仅表示本轮观测，缓存与参数不同，不能据此断言比旧 Wan 更快。</p>
<p>本轮覆盖一张普通动漫原图和一个种子；其他画风、其他种子及 NSFW 内容尚未验证。低强度的潜力也不代表已经证明全面兼容。</p>
<p><a href="verification.json">完整验证记录</a> · <a href="model-inspection.json">本地模型检查</a> · <a href="https://civitai.com/articles/32754/smoothmix-wan-22-t2v-v4-guide">作者 v4 指南</a></p></details>
<footer>全部候选图均为本轮生成的原始输出。旧实验未重跑，模型文件未改写，软件默认洗图仍保留原版 Wan。</footer>
</body></html>'''
for key, value in {'MEDIUM_CARDS': medium, 'LOW_CARDS': low, 'RANGE_CARDS': range_cards, 'EXPERIMENT_CARDS': experiments}.items():
    page = page.replace(key, value)
(OUT / 'index.html').write_text(page, encoding='utf-8')
(OUT / 'README.md').write_text('''# SmoothMix T2V Low v4 image-wash validation

The user-provided safetensors file ran successfully in five standard ComfyUI KSampler jobs.
This was an isolated model experiment; no production routing or model files were changed.

Manual inspection: low strength is promising for fidelity. Medium/high strength produces substantial redraw, but the source style drifts toward glossy semi-3D materials. Full replacement is not accepted.

See `index.html` for source, reused original Wan baselines, strength comparisons, and alternate parameter results. `verification.json` records exact model/seed/settings, prompt IDs, source/output hashes, manual assessments, and scope limits. All saved workflows were checked against returned execution history.

The author v4 guide confirms the anime style trigger and a photorealistic default without style triggers. Candidate tests remove the original external acceleration LoRA; they are not strict weight-only comparisons. Only one non-explicit anime source and one seed were evaluated. No old experiments were rerun.

Run a new unrecorded case with `tools/smoothmix-t2v-image-wash-smoke.cjs`; it refuses to overwrite existing case records and never changes the application's default. Rebuild this report with `tools/build-smoothmix-t2v-wash-report.py`.
''', encoding='utf-8')
print(json.dumps({'page': str(OUT / 'index.html'), 'verifiedRuns': len(records), 'fullReplacementAccepted': False}, ensure_ascii=False))
