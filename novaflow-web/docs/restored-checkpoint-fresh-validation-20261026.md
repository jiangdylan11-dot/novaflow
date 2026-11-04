# 基点恢复后五项全新分析与真实出图复核

五项均完成一次新分析及一次真实生图，过程没有继续改规则，也没有使用旧提示词。结果未通过与认可基线的画质一致性复核：CG 的体积和投影关系恢复，但明亮大面积偏蓝且更平，冷调灰白肤色/红唇与立体塑造明显变化，湿润仍偏硬并出现绿眼，柔和高光与肤色也明显改变。代码和原始绘图指令已恢复，不代表新分析稳定复现了原有效果；本轮不发布、不替换认可图片。

恢复源码提交：`c2d75e29`。配置来源：`5b6ee8c9` 保存的 1.0.13 技能和绘图适配，已与认可批次的实际系统正文/工具定义匹配。114 项相关测试、runtime 同步检查及入口检查先完成，再冻结源码运行本次五项。

[四列对照：参考 / 上轮认可 / 4806 回退图 / 恢复后新图](http://127.0.0.1:4809/)

## 本轮约束

五项均从完整原图与画风参考重新分析一次，生成新的英文提示词并原样交给真实 Qwen 生图；没有提供旧英文提示词、旧生成图、历史对话或候选经验。知识记录为空白，使用源码默认技能加载，未注入 1.0.13 或 1.0.14 候选。说明为中文。

与 4806 使用完全相同的任务清单、完整图片、负向、模型、CFG 3、8 步、seed 54792256、尺寸、sigmas 和工作流几何。两者区别是恢复后的默认绘图规则及原始执行层。整个五项运行期间不改规则、任务或提示词，没有自动审图、自动重试、第二遍增强或翻译调用。红黑、木版画和油画不测。

上轮认可冷调图经过局部反馈；本轮冷调为无旧稿的新分析任务。因此不能把“系统规则相同”当成“所有任务上下文完全相同”或画质必然相同。

## 实际结果

| 风格 | 分析总计 | 模型请求 | 单张生图 | 观察 |
| --- | --- | --- | --- | --- |
| 明亮动漫 | 114.7 秒 | 78.8 秒 | 59.5 秒 | 背景、座椅和环境大面积偏蓝，色块与边缘更平更硬，认可图的局部光源与体积层次未复现；不能判为同等质量。 |
| 冷调动漫 | 93.1 秒 | 65.5 秒 | 59.4 秒 | 冷灰肤色、深红唇和立体鼻口塑造明显增强，色调与认可版不同，依然偏写实；不能确认恢复了认可效果。 |
| CG 材质 | 101.7 秒 | 70.3 秒 | 56.3 秒 | 方向光、条纹投影、皮肤体积和发丝/杯体反射比 4806 明显，脸颊痣保留，未见新增雀斑；比上轮认可图更偏光滑立体塑造，不能视为完全相同画法。 |
| 柔和插画 | 100.1 秒 | 71.9 秒 | 61.0 秒 | 暖光、头发与杯体反射存在，但高光更油亮、肤色偏橙，虹膜金色与五官塑造也有变化，和认可图并不一致。 |
| 湿润高光 | 102.5 秒 | 76.0 秒 | 58.2 秒 | 皮肤渐变、发束与杯体反射存在，衣服和场景保持干燥；整体仍较硬，柔和光泽与氛围未达到上轮认可图，虹膜明显偏绿，不能判为同等质量。 |

分析总计包含加载与释放，单张生图不包含服务启动，不能把后者说成整个冷启动耗时。观察来自助手查看原始 PNG，不是产品自动审图，也不代表用户已认可。

## 明亮动漫

![参考、已认可、回退图、恢复后新图](D:/AI_APP/NovaFlow-Web/work/restored-checkpoint-fresh-20261026/run/comparisons/bright.jpg)

背景、座椅和环境大面积偏蓝，色块与边缘更平更硬，认可图的局部光源与体积层次未复现；不能判为同等质量。

### 本轮新分析返回的完整英文正文

```text
Repaint <image1> using <image2>'s anime painting language. Build every form with crisp variable-weight line contours enclosing flat cel color masses whose shadow shapes carry sharp cast-shadow edges, while skin keeps smooth soft gradient volume rather than a flat fill. Construct hair as flowing smooth masses with glossy banded highlight ribbons and soft tapering strands. Render cloth through strong value grouping: crisp fold shadows and bright rim highlights on the striped top, preserving its navy-and-white horizontal stripe construction. Use a luminous cool-dominant palette of saturated blues and clean neutral tones, warm accents only on skin, and soft painterly dappled masses for the background to create graphic atmospheric depth. Keep the winking smile, cheek beauty mark, red nails, the clear cup with straw, the airport seating rows, the glowing departure board and the glass facade as recognizable structures. The finished artwork depicts: A young woman with long reddish-brown wavy hair winks and smiles, wearing a navy-and-white horizontal striped top and holding a clear plastic cup of iced milk tea with a straw, seated in an airport waiting area with rows of seats, a glowing departure board and a glass window facade.
```

## 冷调动漫

![参考、已认可、回退图、恢复后新图](D:/AI_APP/NovaFlow-Web/work/restored-checkpoint-fresh-20261026/run/comparisons/dark.jpg)

冷灰肤色、深红唇和立体鼻口塑造明显增强，色调与认可版不同，依然偏写实；不能确认恢复了认可效果。

### 本轮新分析返回的完整英文正文

```text
Render <image1> in the actual painting language of <image2>, using <image2> only as the style reference. Rebuild the forms with smooth volumetric skin shading: soft pink blush gradients on cheeks, nose and lips, gentle value transitions across curved surfaces, not flat cel paint. Construct the long wavy hair as cohesive dark-reddish masses with smooth tapered strands, a few soft sheen highlights and crisp outer edges. Model the striped top's fabric folds through clean crisp line work and smooth value grouping, keeping the navy-and-white stripe construction. Apply strong cool directional light with deep modeled shadows in clothing folds, a cool blue color organization accented by the warm red of the lips, nails and hair, and atmospheric depth with soft bokeh from the scene lights. Repaint the airport seating rows, glass wall and glowing departure sign in the same painterly anime medium with graphic depth. Do not copy the reference's person, umbrella, uniform, moon, rain or props. Keep the winking expression, closed eye, beauty mark, red lips, red nails, held cup with straw and the seated pose. The finished artwork depicts a young woman with long reddish-brown wavy hair winking playfully, a small beauty mark on her cheek, red lips and red nails, holding up a clear plastic cup of iced milk tea with a straw, wearing a navy-and-white striped top, seated in rows of gray airport seats beside a glass wall with a glowing departure sign.
```

## CG 材质

![参考、已认可、回退图、恢复后新图](D:/AI_APP/NovaFlow-Web/work/restored-checkpoint-fresh-20261026/run/comparisons/cg.jpg)

方向光、条纹投影、皮肤体积和发丝/杯体反射比 4806 明显，脸颊痣保留，未见新增雀斑；比上轮认可图更偏光滑立体塑造，不能视为完全相同画法。

### 本轮新分析返回的完整英文正文

```text
Render <image1>'s content in the painting language of <image2>: smooth volumetric skin modeling with warm luminous highlights and crisp cast-shadow bands, a glossy hair mass with strong specular sheen, fine ornamental linework drawn over fabric surfaces, vivid detailed eyes with bright catchlights, and a soft painterly background with depth and edge vignetting. Rebuild the winking face, beauty mark, smile and red nails as drawn forms; shape the long wavy hair into a glossy gradient mass; treat the navy-and-white stripes as crisp value grouping with fine edge linework; model the plastic cup, straw and drink with smooth translucent volume. Use the airport ceiling slats and window mullions to cast dappled striped shadow bands across the figure, keeping a neutral interior palette. Keep the rows of gray seating, glass windows and departure signage as recognizable scene structures. A young woman with long wavy auburn hair winks and smiles while holding up a clear cup of milk tea with a straw, wearing a navy-and-white striped boat-neck top, in an airport terminal seating area.
```

## 柔和插画

![参考、已认可、回退图、恢复后新图](D:/AI_APP/NovaFlow-Web/work/restored-checkpoint-fresh-20261026/run/comparisons/soft.jpg)

暖光、头发与杯体反射存在，但高光更油亮、肤色偏橙，虹膜金色与五官塑造也有变化，和认可图并不一致。

### 本轮新分析返回的完整英文正文

```text
Repaint <image1> using the actual painting language of <image2>. Build every form with crisp clean contour linework laid over smooth airbrushed gradient volume shading: skin modeled with soft warm blush, subtle subsurface warmth and glossy specular highlight streaks on the shoulder, arm and hand curves; hair as flowing smooth masses with thin stray strands and bright glossy specular sheen bands running along the bangs; the open eye as a luminous, sharply lined iris with defined lashes, the winking eye kept closed. Render the striped top's fabric with detailed line texture and soft fold shading, the plastic cup as a translucent reflective surface, the red nails as polished glossy forms. Use warm directional interior light with strong cast-shadow edges and soft glowing accents, depth built through graphic value grouping. Keep the original composition, seating rows, glass windows and illuminated signage. A young woman with long wavy reddish-brown hair winks with one eye closed and smiles softly, a small mole on her cheek, wearing a navy-and-white striped top, holding up a clear plastic cup of iced milk tea with a straw and red-painted nails, seated among rows of terminal seats beside large glass windows with illuminated signage.
```

## 湿润高光

![参考、已认可、回退图、恢复后新图](D:/AI_APP/NovaFlow-Web/work/restored-checkpoint-fresh-20261026/run/comparisons/wet.jpg)

皮肤渐变、发束与杯体反射存在，衣服和场景保持干燥；整体仍较硬，柔和光泽与氛围未达到上轮认可图，虹膜明显偏绿，不能判为同等质量。

### 本轮新分析返回的完整英文正文

```text
Redraw the content of <image1> using the polished anime painting language of <image2>. Adopt its crisp, tapered linework that defines every form, its smooth gradient shading on skin with soft cheek blush and richly layered, glossy iris rendering, and its treatment of hair as large cohesive masses with strong color separation, glossy specular highlights and crisp edge strands. Rebuild the striped top as dry fabric with smooth value grouping, crisp fold lines and a saturated navy-and-white local palette; keep the plastic cup, straw and drink as clean, dry forms. Render the terminal seats and glass windows as a painted, high-contrast environment with glowing interior light sources and atmospheric depth, all sharing one saturated anime finish. Do not add rain, wet reflections, water droplets, puddles or wet-cloth sheen; the scene is dry. The subject is a young woman with long reddish-brown wavy hair winking and smiling faintly, wearing a navy-and-white striped top, holding up a clear plastic cup of milk tea with a straw, red-painted nails and a small mole on her cheek, seated in an airport terminal waiting area with rows of gray seats and large glass windows.
```

## 验证边界

五个唯一 provider 请求、五个唯一 Qwen prompt_id；逐项核对原图/参考 SHA、默认技能 1.0.13、系统摘要、采样、工作流差异与最终执行提示词。实际模型请求中 prompt 字段为空、图片只有主体和参考两张，没有旧稿或旧结果。实际 Qwen 正文等于新分析正文，未人工改写。

图片生成成功只记录为隔离任务 succeeded/unrated，不当作满意反馈，不发布共享经验。前端写入与编译检查运行真实源码模块的 CPU 隔离路径，不是已安装软件 UI 自动化；本轮没有更新已安装助手、线上网站或 Supabase。

证据目录：`D:/AI_APP/NovaFlow-Web/work/restored-checkpoint-fresh-20261026/run/`。源码和规则恢复已完成，画质是否采用以对照与用户反馈为准；本报告不以技术通过代替效果验收。
