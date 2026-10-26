# NovaFlow 美工 Agent：画风泛化最后一轮实测（2026-10-26）

结论：完成八组、十六张严格匹配的真实对照，以及一张明确标注的人工 CG 执行诊断。候选 1.0.13 有局部改善，但没有稳定解决六组趋同，并出现红黑调色回退、明亮感减弱；单次分析也更慢。因此不以候选替换稳定技能 1.0.11。网站/安装包仍为此前发布的 2.0.117，本轮没有重新部署、安装或写入 Supabase。

对照页：http://127.0.0.1:4801/ 。这是只读的真实结果图册，不会启动推理或生图。每组可查看原始图片、参考、双方完整提示词和耗时。

## 1. 对照设计与边界

- 两侧使用相同原图、参考字节、同一条中性任务、同一 Qwen-Image-2.1 Turbo BF16、CFG 3、8 步、seed 54792256、Euler、专用 sigmas、负向和输出构图。图签名排除提示词、上传文件名及保存前缀后逐字一致。
- 每例一次实际视觉模型请求、一次生图，未使用自动审图、自动重试、二次修图或滤镜。八组的十六张 PNG 均保留原始输出与 Comfy history/prompt_id。
- 历史六张本人确认图来自不同局部反馈任务，另存为冻结历史基线；本轮严格 A/B 使用同任务新跑。三个完全相同的成功基线控制图复用原始回执，没有重复生成。
- 另有早期 1.0.12 三张试验候选，均明确隔离；没有挑掉失败图。两张新参考在最终规则冻结前选定，不用于规则调整；完成后未根据它们调参。
- 本人澄清：“湿润”不代表把机场人物或普通衣料画湿。验收高光形态、上色与材质区分及整体美感；强制湿布料控制在执行前取消。
- 本轮只验证同一内容图跨八种参考；不宣称已经覆盖所有内容题材。

## 2. 六组历史问题归因

| 组别 | 实际完整提示词和出图所支持的归因 |
|---|---|
| 明亮动漫 | 绘画语言基本对路，但后续长篇光照、材质清单占比过高。需要复测线条与色块，不能把层次统一解释为商业精修。 |
| 冷调动漫 | 最终历史任务是局部光色优化，锁定了既有面部画法；冷环境照明又被适配层通用句强化。历史偏蓝不能直接归因模型。 |
| CG 材质 | 把 CG 参考仍归入动漫精修，重点转为冷暖灯位清单，未清楚要求改变线条依赖、表面粗糙度及体积/材质响应。紫色环境反射也来自明确文字。 |
| 柔和插画 | 暖调与脸部绘画方向相对有效，但 polished/glossy 的通用目标易与其他风格趋同；作为回归保护项。 |
| 湿润高光 | 已经写到湿润布料和成组高光，不能认定完全未分析材质；但单一高光带与通用环境光掩盖了表面反射的形态差异。归因是指令欠具体与执行偏差混合待查。 |
| 红黑平面 | 历史最终请求明确锁定人物画法，只让背景后退；自然无法检验整幅主体图形化能力。参考本身有局部光泽细节，应转移大剪影、色域与边缘组织，而不机械去掉所有细节。 |

原始提示词逐字保存在 `work/style-generalization-20261026/historical-prompt-audit.json`；已核对实际图节点 5 与 Agent handoff 一致。

## 3. 实际尝试的位置与修改

1. **技能提示词**：在隔离的 1.0.13 候选中修改现有 systemPrompt 的观察、内容边界、执行简报和美术层次段落。单次观察内选取最重要的两三个视觉机制，区分形体明暗/投影/表面与笔触，允许重绘画法而不锁定旧渲染；禁止把参考的装饰轮廓当作新物件移植。没有六套风格模板、额外输出 schema 或新模型阶段。
2. **工具适配层试验**：消除正文 100–180 词与适配层 180–260 词的冲突，取消固定冷环境照明句，让光照支持实际画法；候选方法描述补充适用条件，避免把单图色光当全局规则。这三项只存在于隔离试验快照及配套 patch，因回归未通过而未合入默认画风路径。
3. **实际保留的源码修复**：`novaflow-web/worker/src/flash-art-agent.mjs` 的现有图号规范化增加精确 `&lt;imageN&gt;` → `<imageN>` 转换。其后仍执行原有双图编号、指纹、权限和参数校验；不解码普通 HTML、不猜测缺失图号。已增加正向与越界回归测试。
4. **经验与 GPU**：没有修改经验系统架构、GPU 调度、模型/采样、发布权限或正式库。正式 1.0.11 技能及其 Agent 系统提示词/工具定义均与发布基线一致，仅增加图号格式兼容。

候选正文为 5577 字符，原正文为 5942 字符；没有通过无止境堆长提示词处理问题。

## 4. 八组实际结果

| 组别 | 检查结果 | 判断 |
|---|---|
| 明亮动漫 | 内容和基本动漫画法保留；候选加重体积与暗部，明亮轻快感减弱。没有稳定优于基线。 | 不作为稳定替换 |
| 冷调动漫 | 候选发束、皮肤和明暗更细腻，但仍趋向精致体积插画，与参考的概括动漫造型并非同一件事。 | 局部改善，风格差异仍不足 |
| CG 材质 | 候选恢复连续曲面与柔和明暗，但最终指令仍写 polished anime，并把较多篇幅用于条带投影。人工明确 CG 指令对照可产生显著不同的三维体积与材质区分。 | 部分改善，未证明自动泛化达标 |
| 柔和插画 | 暖调、闭嘴、眨眼、痣和主要场景保留，候选的动漫面部与暖色完成度较好；无虎牙移植。仍需与其他风格区分。 | 较好的回归表现 |
| 湿润高光 | 按本人澄清，不要求湿衣料或淋湿状态。候选的头发、皮肤、杯子高光与细腻度有所变化，普通机场和正常衣料保持合理；仍有与柔和/CG 精修趋同的问题。 | 按高光画法与美感评估，非湿衣料指标 |
| 红黑平面 | 候选确实改变平面明暗和色块概括，且去掉了试验版复制的装饰环；但其 cooler saturated field 指令把参考红黑组织带偏为蓝灰。 | 未通过：调色回退 |
| 留出测试 · 木版画 | 两侧都形成明显的黑色轮廓、有限色块与纸面版画语言，没有把机场变成海浪场景。候选减少了一些装饰性卷纹，但旧框架原本就具备这类媒介迁移能力。 | 留出媒介迁移成立，非候选独有能力 |
| 留出测试 · 笔触油画 | 两侧都出现覆盖人物、衣料与环境的可见笔触；候选更强调分离色笔触与露底，且没有移植草帽、胡须或男士服装。 | 留出媒介迁移成立，候选笔触更明确 |

## 5. 完整提示词与原始图

### 明亮动漫

![参考 / 稳定框架 / 候选](/D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/comparisons-final/bright.jpg)

原始优化前：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\baseline\bright\output.png

原始候选：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\candidate\bright\output.png

优化前 227 词；候选 206 词。

优化前：
```text
Redraw <image1> entirely in the anime drawing language of <image2>, using <image1> as the content and <image2> as the artistic reference. Adopt the reference's clean confident line work, smooth cel-shaded tonal transitions, glossy specular highlights on hair and fabric, crisp edge definition, semi-idealized anime face proportions, and luminous atmospheric depth, with a coordinated bright palette and delicate midtone separation. Keep the woman's identity, long wavy reddish-brown hair, the winking one-eye smiling expression, the navy-and-white striped top, the clear plastic cup of iced milk tea with a straw, red-painted nails, and the seated pose and framing. Reconstruct the face, hair masses, hands, the cup's form and the striped fabric folds in the reference's form language, preserving their categories, functions and spatial relationships rather than photographic contours. Repaint the airport terminal setting — rows of gray seats, glass windows, illuminated signage — as a layered anime interior with coherent light direction, soft depth falloff and local reflected color, keeping the original spatial structures. Do not copy the reference's character, costume, sky, flowers, birds, lamp posts or landscape. The finished artwork depicts a young woman with long wavy reddish-brown hair, winking one eye and smiling, wearing a navy-and-white striped top and holding up a clear plastic cup of iced milk tea with a straw, seated among rows of gray seats in an airport terminal with glass windows and illuminated signage.
```

候选：
```text
Redraw the content of <image1> using the actual anime painting language of <image2>. Use crisp, confident linework to define every form; build skin, the striped fabric and the plastic cup with cel-shaded value grouping combined with soft gradient modeling, so curved surfaces read as smoothly modeled volumes with clean fold shadows, not flat fills. Construct the long wavy hair as flowing glossy masses with sunlit highlight bands and fine flyaway strands. Apply luminous directional light entering from the large windows, with rim light, gentle bloom and atmospheric depth, keeping a cool-neutral palette of deep blues, crisp whites, warm skin, auburn hair and red nail accents. Repaint the rows of gray seats, slatted ceiling, glass windows and signage as the same anime environment, using graphic value grouping and atmospheric perspective for depth. Preserve the winking playful smile, cheek mole, striped top, held milk-tea cup and red nails. The finished artwork depicts a young woman with long wavy auburn hair, winking and smiling, a small mole on her cheek, wearing a navy-and-white horizontal striped off-shoulder top, holding up a clear plastic cup of milk tea with a straw and red-painted nails, seated in an airport terminal with rows of gray seats, a slatted ceiling and large glass windows.
```

### 冷调动漫

![参考 / 稳定框架 / 候选](/D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/comparisons-final/dark.jpg)

原始优化前：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\baseline\dark\output.png

原始候选：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\candidate\dark\output.png

优化前 229 词；候选 178 词。

优化前：
```text
Use <image1> as the content and <image2> as the artistic-language reference; repaint the source scene in <image2>'s polished anime rendering, not its character, props or night setting. Adopt the reference's clean crisp line edges, smooth gradient tonal transitions, hair built as broad flowing masses with defined strands and a soft sheen, skin with delicate midtone blush variation (not flat, not photographic), crisp fabric folds, and a cool-leaning palette with selective warm accents. Reconstruct the face, winking eye, smile, hair, striped top, hand and drink cup in this drawn form language while keeping her identity, the winking expression, the striped off-shoulder top, the red nails, the iced cup and the terminal seating/ceiling/windows/departure-sign structures. Light the interior with a coherent cool directional source, keep skin neutral (no orange/sepia cast), let warm accents come from the red nails and the drink, add layered background depth with softer focus on the far seats and signs, and a few local reflected highlights on the cup. Finish with full art completeness. The finished artwork depicts: A young woman with long reddish-brown wavy hair winks with one eye closed, a small mole under that eye, smiling slightly, wearing a navy-and-white striped off-shoulder top, raising a clear plastic cup of iced milk tea with a straw in red-nailed fingers, seated among rows of gray terminal seats beneath a slatted ceiling and glass windows with distant departure signs.
```

候选：
```text
Redraw <image1> using the actual painting language of <image2> as the style reference. Build skin, hair and fabric with smooth painterly gradient shading and soft blended transitions, cohesive hair masses carrying a satin sheen and fine strand highlights, clean thin linework, and strong dark value grouping that reads cloth and seats as modeled mass shapes with soft fold modeling. Use a cool atmospheric palette with one saturated accent, directional cool light with a soft rim, and atmospheric depth through a painterly background, bokeh light points and soft haze. Keep the woman's long wavy reddish-brown hair, winking expression, slight smile, beauty mark, navy-and-white striped off-shoulder top, clear plastic cup of iced drink with straw, red nails, and the terminal seating rows, glass windows and illuminated signage as the original scene. Do not copy the reference's umbrella, uniform, black hair, red eyes, moon, rain or props. The finished artwork depicts a young woman winking and smiling, holding a clear cup of iced drink with a straw, seated among rows of terminal seats in front of glass windows and glowing signage.
```

### CG 材质

![参考 / 稳定框架 / 候选](/D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/comparisons-final/cg.jpg)

原始优化前：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\baseline\cg\output.png

原始候选：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\candidate\cg\output.png

优化前 217 词；候选 223 词。

优化前：
```text
Redraw the content of <image1> using the actual painting language of <image2> as the style reference. Reconstruct the face, hair, hands, clothing and drink in a polished anime illustration form: defined eye and brow construction, crisp confident linework, smooth tonal transitions on skin with selective glossy highlights, layered hair masses with strand sheen, and clear edge definition. Keep the woman's identity, her winking expression with one eye closed and a slight smile, the small beauty mark on her cheek, the navy-and-white striped top, the clear plastic cup of iced milk tea with a straw held up, and the red-painted nails. Preserve the airport/terminal setting: rows of waiting seats, large glass windows, slatted ceiling, and the illuminated yellow departure sign board. Design coherent indoor illumination — cool ambient light from the glass and seating, with a warm accent from the sign and soft directional light on the face and drink — keeping neutral local colors and delicate midtone separation, not a uniform warm cast. Balance broad shapes with fine detail, let the reference's shading and palette guide form, and maintain full artistic finish. The finished artwork depicts: a young woman with long wavy reddish-brown hair winking and smiling while holding up a clear cup of iced milk tea, seated among rows of seats in a glass-walled airport terminal.
```

候选：
```text
Redraw <image1> using the painting language of <image2>. Render in polished anime illustration style with smooth painterly gradient shading on skin, not flat cel shading. Apply strong directional lighting that casts dappled striped shadow patterns across skin, clothing, and surfaces, using the airport's linear ceiling slats and window frame bars as the natural shadow-casting structures. Build hair as glossy voluminous masses with individual strand highlights catching directional light. Use clean crisp line art to define all forms. Skin should have warm luminous tones with soft gradient transitions and subtle surface texture. Maintain rich saturated palette with strong light-shadow contrast, preserving neutral local colors in shaded areas. The striped top's navy-and-white pattern must remain recognizable, rendered with smooth fabric shading. The winking eye, slight smile, beauty mark near the cheek, red nail polish, and clear plastic cup with iced drink and straw are all preserved as identity marks. Rows of gray airport seats, large glass windows, illuminated flight signs, and ceiling structure remain as the scene's spatial framework, repainted in the reference's smooth anime rendering with atmospheric depth. A young woman with long wavy auburn hair winks playfully while smiling and holding up a clear cup of iced milk tea with a straw, wearing a navy-and-white striped off-shoulder top, seated in an airport terminal with rows of gray seats and glass windows behind her.
```

### 柔和插画

![参考 / 稳定框架 / 候选](/D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/comparisons-final/soft.jpg)

原始优化前：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\baseline\soft\output.png

原始候选：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\candidate\soft\output.png

优化前 233 词；候选 203 词。

优化前：
```text
Redraw the content of <image1> using <image2> as the artistic-language reference. Adopt the reference's polished semi-realistic anime rendering: smooth skin built from soft warm gradient shading with gentle cheek blush, glossy hair masses carrying sheen highlight bands and fine strand lines, expressive eye design, rich midtone tonal transitions rather than flat cel shading, and warm directional illumination with soft shadows. Keep the woman's identity, her winking expression (one eye closed, one open), faint smile, small cheek mole, long wavy auburn hair, navy-and-white striped top, and the clear plastic cup with straw held up in her red-nailed hand, preserving the original composition and the airport/terminal waiting-area setting with rows of gray seats, glass windows, slatted ceiling and illuminated signage. Reconstruct face, hair, hands, the cup's form and fabric folds in the reference's form language, keeping categories and spatial relationships, not photographic contours. Design coherent warm light within the original interior, with selective focus supporting the focal subject and a layered, atmospheric background depth. Do not copy the reference's character, cat ears, board, sweater, props, location or text. The finished artwork depicts: A young woman with long wavy auburn hair winks and smiles faintly, a small mole on her cheek, wearing a navy-and-white striped top, holding up a clear plastic cup of milk tea with a straw in her red-nailed hand, in an airport terminal waiting area with rows of gray seats and glass windows.
```

候选：
```text
Redraw the content of <image1> using the actual painting language of <image2> as the style reference. Render as a polished anime illustration: smooth volumetric skin built from soft tonal gradients with gentle blush and glossy specular sheen on cheeks, nose and shoulders; flowing glossy hair masses with cel-shaded highlight bands, fine flyaway strands and soft gradient transitions; luminous detailed eyes with sharp liner, glowing iris and defined lashes, preserving the winking expression, slight smile and small cheek beauty mark. Rebuild the navy-and-white striped top with soft fabric shading and crisp stripe rhythm, and the clear plastic cup, straw and red-nailed fingers with translucent glossy rendering. Use warm directional interior lighting with soft cast shadows and subtle atmospheric sparkle, a cozy warm palette balanced with neutral local colors. Background rows of gray terminal seats, glass panels and glowing signage are softly modeled with depth. The subject is a young woman with long wavy reddish-brown hair winking playfully with a slight smile, a small beauty mark on her cheek, wearing a navy-and-white striped top, holding up a clear plastic cup of milk tea with a straw in red-nailed fingers, seated among rows of gray airport terminal seats with glass panels and illuminated signage behind her.
```

### 湿润高光

![参考 / 稳定框架 / 候选](/D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/comparisons-final/wet.jpg)

原始优化前：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\baseline\wet\output.png

原始候选：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\candidate\wet\output.png

优化前 233 词；候选 197 词。

优化前：
```text
Use <image1> as the content source and <image2> as the artistic-language reference. Redraw the scene in the reference's polished anime style: crisp clean line art, glossy luminous hair built as smooth flowing masses with strong specular highlight bands and saturated color, layered cel-shaded eyes with detailed iris construction, soft skin shading with delicate blush and subtle midtone transitions, a rich saturated palette, and fabric with clean folds and a light sheen. Apply this drawing language to the source's own local colors — keep the auburn hair, navy-and-white striped top, red nails and the creamy drink color neutral and true, not a warm orange cast. Reconstruct the winking eye, smile, face proportions, hair masses, hand and the transparent plastic cup with straw in the reference's form language, preserving the beauty mark under the eye. Render the airport seating rows, glass windows and slatted ceiling with layered depth, soft atmospheric falloff and selective cool interior light, keeping the main spatial structures. Maintain high art finish and coherent shading across face, hair, clothing and environment. The finished artwork depicts: A young woman with long wavy auburn hair winks with one eye closed and smiles, wearing a navy-and-white striped off-shoulder top, raising a clear plastic cup of iced milk tea with a straw in her red-nailed hand, with a beauty mark under her eye, seated among rows of gray terminal seats in front of large glass windows.
```

候选：
```text
Redraw the content of <image1> in the actual painting language of <image2>, a high-finish glossy anime illustration. Build hair as large smooth volumetric masses with smooth gradient shading, sharp bright specular highlight bands, clumped glossy tips and fine flyaway strands. Model skin with soft luminous gradients, cheek blush and subtle rim light; use crisp detailed lineart with large luminous gradient eyes, defined lashes and a glossy wet sheen. Render fabric with glossy sheen, smooth modeled folds and reflective highlights, treating surfaces with light-source-driven luminosity. Use the existing glowing flight signs, ceiling lights and glass windows as the bright sources that cast rim light along hair edges and create reflective highlights, keeping a clean cool-neutral palette with no warm sepia cast. Preserve the winking smile, cheek beauty mark, striped top design, cup, straw and red nails. The subject is a young woman with long wavy auburn hair winking and smiling with a small cheek beauty mark, wearing a navy-and-white horizontal-striped off-shoulder top, raising a clear plastic cup of milky drink with a straw and red-painted nails, seated in an airport terminal with rows of gray seats, a slatted ceiling, glowing yellow flight-information signs and large framed glass windows.
```

### 红黑平面

![参考 / 稳定框架 / 候选](/D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/comparisons-final/graphic.jpg)

原始优化前：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\baseline\graphic\output.png

原始候选：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\candidate\graphic\output.png

优化前 235 词；候选 206 词。

优化前：
```text
Use <image1> as the content and <image2> as the artistic-language reference. Redraw the scene in <image2>'s high-contrast graphic anime style: bold flat color fields, deep saturated silhouette masses, sharp clean edge definition, and selective luminous highlights that glow against dark forms. Build the face with crisp anime feature construction, keeping the winking eye, the open eye, and the slight smile as drawn forms, with a small beauty mark preserved. Render the long wavy hair as a rich dark-red mass with sharp graphic strands, glossy specular accents, and a few bright rim-light edges, echoing the reference's deep black hair treatment. Give the striped top bold flat navy-and-white blocks with strong edge contrast. Keep the clear plastic cup, straw, and red nails as recognizable props, lit with crisp highlights. Apply the reference's dramatic rim lighting and selective glowing sparkle accents to the face and drink, with a vivid saturated background field that carries the airport windows, gray seat rows, and illuminated signage as simplified high-contrast graphic shapes. Maintain strong value separation, flat bold color blocks, ink-splatter energy, and a luminous warm glow against deep shadow, without a uniform yellow-orange cast. The finished artwork depicts a young woman with long reddish-brown wavy hair winking and smiling while holding up a clear plastic cup of iced milk tea with a straw, wearing a navy-and-white striped top, seated among rows of gray terminal seats in front of large airport windows.
```

候选：
```text
Repaint the content of <image1> using the actual painting language of <image2>. Skin is a smooth, low-detail pale plane sculpted by hard-edged cast-shadow shapes (nose, under-lip, cheek) instead of soft airbrush gradients; the winking eye, smile and beauty mark are rebuilt as crisp drawn forms. Hair becomes a bold dark-auburn mass with a crisp silhouette, fine stray strands, a lace/mesh texture overlay and warm edge-glint highlights. The navy-and-white striped top is rendered as flat graphic bands with hard shadow shapes; the held cup is a clean graphic form with a flat liquid shape and one sharp highlight; red nails read as flat saturated shapes. The terminal seats, glass windows and signage recede as flat graphic value planes with high contrast, deep dark masses set against a cooler saturated field. Scattered pigment speckle and splatter marks express the medium across the scene, not as new objects. Keep the auburn hair, navy/white stripes and red nails as identity cues, organized through the reference's high-contrast flat palette. A young woman with long wavy auburn hair winks and smiles, holding up a clear plastic cup of iced coffee with a straw, wearing a navy-and-white striped top, seated in an airport terminal with rows of gray seats and large glass windows.
```

### 留出测试 · 木版画（未参与规则调整）

![参考 / 稳定框架 / 候选](/D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/comparisons-final/holdout-print.jpg)

原始优化前：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\baseline\holdout-print\output.png

原始候选：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\candidate\holdout-print\output.png

优化前 235 词；候选 180 词。

优化前：
```text
Redraw <image1> entirely in the woodblock-print visual language of <image2>. Adopt the reference's flat, graphic rendering: bold confident outlines, limited coordinated palette (indigo/prussian blue, muted teal, cream and warm beige paper tones, restrained ochre accents), broad flat color planes with minimal gradient, and decorative rhythmic line patterns. Translate the long wavy hair into stylized flowing masses with swirling, claw-like curl motifs echoing the reference's foam line-work; render the striped top as crisp flat navy-and-cream bands with graphic edge definition. Keep the face as a clean drawn form with subtle midtone shading, preserving the playful wink, slight smile, beauty mark and red nails as recognizable identity marks. Render the clear cup, straw and iced drink as flat layered shapes with a thin outline. Build the interior as a graphic patterned space: rows of seats as repeating flat silhouettes, the slatted ceiling as rhythmic linear bands, the glass facade as flat panes with restrained reflections, on a warm paper-toned ground with faint woodblock grain. Maintain a cohesive drawing language across face, hair, hands, clothing and environment; no photographic texture, no smooth 3D shading, no warm yellow color cast. The finished artwork depicts a young woman with long wavy auburn hair winking playfully while raising a clear plastic cup of iced milk tea with a straw, wearing a navy-and-white striped top, seated among rows of terminal seats in an airport interior with a slatted ceiling and glass facade.
```

候选：
```text
Render the content of <image1> in the woodblock-print painting language of <image2>: bold black ink outlines define every form, flat limited color blocks replace photographic shading, and depth is built by graphic overlap and planar value grouping on an aged beige paper ground, not smooth volumetric gradients. Rebuild the long hair as swirling rhythmic line masses with curling decorative contours, the striped top as flat navy-and-white bands, the cup, straw and liquid as outlined flat shapes with patterned foam-like motifs, the red nails as small flat accents, and the cheek beauty mark as a crisp ink dot. Translate the airport rows of seats, glass wall and signage into outlined flat overlapping shapes with restrained indigo, cream and white tones, keeping a cool neutral color organization. Preserve the wink, smile, pose and identity. The subject is: A young woman with long wavy reddish-brown hair winks and smiles while holding up a clear cup of iced milk tea with a straw, wearing a navy-and-white striped top, seated in an airport waiting area with rows of seats and a glass wall behind her.
```

### 留出测试 · 笔触油画（未参与规则调整）

![参考 / 稳定框架 / 候选](/D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/comparisons-final/holdout-oil.jpg)

原始优化前：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\baseline\holdout-oil\output.png

原始候选：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\paired-final\generation\candidate\holdout-oil\output.png

优化前 213 词；候选 203 词。

优化前：
```text
Redraw <image1> using the actual painting language of <image2> as the artistic reference. Build every form — face, hair, hands, striped top, cup, seats, glass wall — with visible directional loaded brushstrokes and impasto, constructing volume stroke by stroke rather than smooth photographic gradients. Use broken complementary color: warm ochre-auburn hair masses set against cool violet-blue shadows, pink-grey midtones in the skin, navy stripes rendered with blue-violet and pale-yellow accents, the iced coffee lit with warm cream against cool reflections. Model the winking eye, smile and red nails with coordinated stroke shapes, keeping the actual expression and hand pose. Preserve the canvas-like granular texture, edge definition built from stroke direction, and the reference's broad-shape/detail balance. Maintain the original composition and scene structures — rows of terminal seats, slatted ceiling, illuminated departure signs, glass curtain wall — as a coherent painted environment with a single coherent light direction. Do not copy the reference's hat, beard, face, clothing, props or literal palette as objects. The finished artwork depicts: A young woman with long wavy auburn hair winks and smiles while raising a clear plastic cup of iced coffee with red-painted nails, wearing a navy-and-white striped top, seated among rows of terminal seats beneath a slatted ceiling with illuminated departure signs and a glass curtain wall.
```

候选：
```text
Repaint <image1> using the actual painting language of <image2>: a post-impressionist impasto oil surface built entirely from short, discrete, directional strokes of pigment laid side by side, never smooth gradients. Model every form by stroke direction that follows its contours: the long wavy hair becomes dense parallel strokes of warm ochre-red, the skin is assembled from short broken strokes carrying pink, ochre and pale-green complementary notes, the navy-and-white striped top is rendered as parallel strokes following the drape of the body, the clear cup of iced coffee is built from broken strokes capturing translucent liquid, ice and the straw, and the red nails are small concentrated strokes. Edges dissolve into stroke clusters, no clean outlines. Use complementary color juxtaposition—warm ochre-red against cool blue-violet—rather than blending. The rows of terminal chairs, glass facade and illuminated signage become looser, thinner scattered strokes over an exposed pinkish-ocher canvas ground. Preserve the wink, smile, cheek beauty mark, striped garment, held cup and seating-row scene. The subject is: A young woman with long wavy reddish-brown hair winks and smiles while holding up a clear plastic cup of iced coffee with a straw, wearing a navy-and-white striped top, seated in a row of terminal chairs beside a glass facade.
```

## 6. 内容保留与物理状态

逐图检查中，眨眼、脸颊辨识点、条纹上衣、举杯/吸管和机场座椅玻璃等主要结构仍可识别；木版画/油画参考中的海浪、草帽、胡须未成为新场景物件。人物比例、线条和阴影允许按媒介重绘，因此这些观察不等于像素轮廓锁定或严格的人脸识别承诺。
早期试验曾移植红黑参考中的环形装饰，属于明确失败；最终候选去掉了该环，但调色回退仍使其不能全量替换。普通衣料不需要因为“湿润高光”标签而改变干湿状态。

## 7. 分析速度

| 阶段 | 稳定框架 | 候选 |
|---|---:|---:|
| 每任务启动/重载封装 | 23.6 秒（n=8） | 24.7 秒（n=7） |
| 实际单次请求 | 70.3 秒（n=8） | 80.4 秒（n=8） |
| 释放封装 | 2.8 秒（n=8） | 3.1 秒（n=7） |
| 完整单次分析 | 96.8 秒（n=8） | 108.3 秒（n=8） |

候选总分析均值增加 11.5 秒，约 11.9%；平均最终提示词由 227.8 词降至 199.5 词，较短并没有自动带来更快的单次推理。双方仍均为一次请求。
生图单张实测范围：基线 61.2–70.0 秒，候选 59.2–70.0 秒。采样/调度完全相同，不把这点运行波动称作速度优化。
这些是本轮同机单次样本，加载项包含每任务启动/重载，不代表首次安装冷启动。湿润候选的原始调用因图号转义被旧校验拒绝；保留真实总耗时与 trace 请求耗时，加载/释放分段缺失，未伪造补齐，因此候选这两项 n=7。CPU 回放没有新增模型请求。

## 8. 生成模型执行能力与限制

人工 CG 控制明确写出连续三维体积、分离的漫反射/镜面响应、较粗糙布料与透明塑料差异。相同 Qwen 模型和采样产生了明显不同于常规动漫线稿的 CG 体积图，说明这一个案例中生成端具备执行更清楚材质指令的能力。它是人工诊断，不是 Agent 自动改进后的结果，也不是正式风格模板。
![人工 CG 执行诊断，不计入 Agent 自动结果](/D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/controls/cg/output.png)
红黑的蓝灰场、早期装饰环以及硬边投影导致平面化，都能追到具体提示词；不能把这些归入模型拒不执行。木版画与油画又证明该固定生成配置并非只能输出同一种动漫图。
仍未完全满足的是：类似动漫参考之间，细粒度五官/材质/绘画程度的自动判断和执行稳定性。单张单种子不支持宣称整条 Qwen-Image-2.1 路线有不可跨越的能力上限，也未验证标准版或其他采样。湿衣料能力未测试，且按本人意图不是本轮目标。

## 9. 经验候选与冻结决定

成功或失败的方法摘要均只保存在本机 QA 候选中，来源、模型和适用条件可追溯；没有把任何图的 RGB、暖冷或固定光位发布成全局规则，也没有伪造“满意/采用”反馈。需要实际验证和本人确认后才可进入正式共享库。
继续冻结稳定技能 1.0.11（系统 SHA-256 `9ee27938e8cba9864728f84540e22deb5ad7c1727677cb92396ef3a00e846c28`），保留候选 1.0.13（`c74b48b7ec8b15d26e2a4eaf0148c153ffa8a743b84ea1fb4df00146750ff21e`）和隔离运行快照以便回看。未把不稳定候选接入正式缓存指针；原有明确回退机制保留。

## 10. 证据与来源

机器核验：D:\AI_APP\NovaFlow-Web\work\style-generalization-20261026\verification.json，8 组 / 16 张，实际图节点、输入/输出摘要、唯一 prompt_id、单次请求和完整图签名比对通过。
正式代码的 runtime 同步、runtime/entry 检查及 58 项相关回归通过，记录在 `work/style-generalization-20261026/validation-summary.json`。所有本轮占用的分析/生成服务已释放，专用端口已关闭，未停止其他用户服务。
新参考来自 The Metropolitan Museum of Art 的公开领域图像元数据：
- 木版画：[Under the Wave off Kanagawa](https://www.metmuseum.org/art/collection/search/45434)。
- 笔触油画：[Self-Portrait with a Straw Hat](https://www.metmuseum.org/art/collection/search/436532)。
