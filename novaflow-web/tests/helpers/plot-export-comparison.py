"""Render the measured runtime comparison; no illustrative or invented values."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties

folder = Path(sys.argv[1])
rows = json.loads((folder / 'comparison.json').read_text(encoding='utf-8'))
font = FontProperties(fname='C:/Windows/Fonts/msyh.ttc')
plt.rcParams['axes.unicode_minus'] = False
bg, fg, muted = '#171a1e', '#ecf0f5', '#9ba8b7'
fig = plt.figure(figsize=(10, 11), dpi=150, facecolor=bg)
fig.text(.06, .956, 'NOVAFLOW · 导出关键帧对比', fontproperties=font, fontsize=23, color=fg)
fig.text(.06, .918, '实测 3.8 / 4.0 / 4.1 / 4.2 运行时 · 每例检查 1,201 个时刻', fontproperties=font, fontsize=12, color=muted)
names = ['飘带8骨骼', '橡胶球', '弹性放大', '匀速放大', '椭圆运动', '透明到实心', '用户双飘带工程']
labels = ['飘带计算（8 根骨骼）', '弹跳 · 橡胶球', '缩放 · 弹性放大', '缩放 · 匀速放大', '移动 · 椭圆运动', '透明度 · 透明到实心', '你的双飘带工程（移动＋缩放）']
for i, (name, label) in enumerate(zip(names, labels)):
    a = next(r for r in rows if r['version'] == '3.8' and r['name'] == name)
    b = next(r for r in rows if r['version'] == '4.0' and r['name'] == name)
    y = .805 - i * .087
    fig.text(.06, y+.025, label, fontproperties=font, fontsize=12, color=fg)
    ax = fig.add_axes([.37, y-.025, .48, .063], facecolor=bg)
    values = [a['before'], a['after'], b['after']]
    ax.barh([2,1,0], values, color=['#626e7d','#18b993','#58aafa'], height=.65)
    ax.set_xlim(0, a['before']*1.2)
    ax.set_ylim(-.6,2.6)
    for j, n in zip([2,1,0], values):
        ax.text(n + a['before']*.018, j, str(n), va='center', color=fg, fontsize=10)
    ax.axis('off')
    fig.text(.89, y-.002, f"−{(1-b['after']/b['before'])*100:.1f}%", fontsize=12, color='#58aafa')
for x, text, color in [( .06,'原始关键帧','#626e7d'),(.27,'3.8 优化后','#18b993'),(.49,'4.0 / 4.1 / 4.2 优化后','#58aafa')]:
    fig.text(x,.874,'■ '+text,fontproperties=font,fontsize=11,color=color)
groups = [[r for r in rows if r['version']==v] for v in ['3.8','4.0']]
totals = [(sum(r['before'] for r in g),sum(r['after'] for r in g)) for g in groups]
fig.text(.06,.139,'全部 33 例（含反向、极值、用户工程）',fontproperties=font,fontsize=13,color=fg)
for i,(version,(before,after)) in enumerate(zip(['3.8','4.x'],totals)):
    fig.text(.06+i*.48,.106,f'{version}：{before:,} → {after:,}  /  减少 {(1-after/before)*100:.1f}%',fontproperties=font,fontsize=14,color=['#18b993','#58aafa'][i])
geometry=max(r['geometry'] for r in rows)
alpha=max(r['alpha'] for r in rows)*100
fig.text(.06,.06,f'本批实测最大几何偏差 {geometry:.3f} 工程单位；透明度偏差 {alpha:.3f} 个百分点。',fontproperties=font,fontsize=10,color=muted)
fig.text(.06,.035,'统计所有输出轨道的关键帧（包含辅助骨骼）；非播放帧率。复杂冲击保留更多帧。',fontproperties=font,fontsize=10,color=muted)
fig.savefig(folder/'keyframe-comparison.png',facecolor=bg)
fig.savefig(folder/'keyframe-comparison.svg',facecolor=bg)
