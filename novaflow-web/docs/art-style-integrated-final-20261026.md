# 已接入默认规则后的八组全新生图验收

本轮没有全部达到稳定验收：湿润高光的衣料湿亮反光违反本人明确的普通环境要求；版画把浪花装饰加入头发，混入参考内容。两项在实际提示词中都有对应指令，首先属于分析与指令选择问题，不能直接归为 Qwen 没执行。当前只展示原始结果，不继续改规则或发布。

本轮按本人要求，重新运行实际默认分析与 Qwen 生图，不使用 CPU 回放充当效果验证。运行源码冻结于当前仓库快照，内置技能 1.0.13；使用空白任务记录、默认内置技能加载，不注入测试候选。原图、参考、生成模型、CFG 3、8 步、seed 54792256 及 sigmas 保持与上一轮一致。

所有图均为 Qwen 原始输出，没有后期处理、自动审图、默认自动重试、手工改写模型提示词或单图专用画风模板。七项一次新分析直出；版画首次缺少源图编号被拒，保留失败后手动重申编号格式补跑一次。总计九次新分析请求、八次真实生成。先按原样展示，是否保留仍由本人判断。

![本轮八组全新输出](D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/integrated-final/overview.jpg)

[完整原图、前后提示词及对照页](http://127.0.0.1:4803/)

## 本轮实际记录

| 画风 | 分析总计 | 其中模型请求 | 单张生成 | 与上轮同一中性任务的提示词相同 | 原图级观察 |
| --- | --- | --- | --- | --- | --- |
| 明亮动漫 | 141.6 秒 | 99.9 秒 | 67.0 秒 | 否 | 暖色轮廓光、清晰线条与概括块面更突出，人物和机场仍统一；较上轮明暗更直接、轮廓更硬，五官仍保留渐变体积，是否更好需本人取舍。 |
| 冷调动漫 | 123.2 秒 | 85.8 秒 | 70.7 秒 | 否 | 闭嘴、眨眼、痣、杯子和场景保留；整体更接近精致动漫，但鼻口仍有体积塑造，发顶集中带状高光比上轮反馈修正更明显。 |
| CG 材质 | 107.7 秒 | 64.3 秒 | 63.4 秒 | 否 | 皮肤、鼻口和发束的连续体积及反光更明显，机场光色较自然；仍偏精致半写实绘制，与参考的立体材质语言并非完全一致，不能只凭更亮的高光认定 CG 已充分迁移。 |
| 柔和插画 | 127.0 秒 | 98.3 秒 | 69.4 秒 | 否 | 暖色氛围、闭嘴微笑、眨眼和痣保留；腮红、皮肤高光点与头发带状反光明显增强，整体更亮滑，柔和程度与上轮不同。 |
| 湿润高光 | 120.9 秒 | 91.4 秒 | 69.1 秒 | 否 | 发丝、皮肤与杯子高光更明显，衣料也出现了成片湿亮反光；后者来自实际提示词的 wet-fabric 指令，与本人已明确的普通非湿环境要求冲突。本项不能作为稳定通过，属于分析指令选择问题。 |
| 红黑平面 | 117.2 秒 | 87.3 秒 | 68.5 秒 | 否 | 红黑大色块、深色剪影和机场图形结构成立；没有参考的冠状饰物。人物肤色更暗、更平面化，蓝白条纹仍突出，金色边光明显减少。 |
| 留出测试 · 木版画 | 114.1 秒 | 87.7 秒 | 71.4 秒 | 否 | 粗轮廓、平面色块和纸面纹理形成明确版画语言；头发额外出现白色浪花装饰，混入了参考内容，不符合只迁移画法的边界。本项不能作为稳定通过，首次编号失败与单次补跑均保留。 |
| 留出测试 · 笔触油画 | 108.1 秒 | 69.8 秒 | 73.5 秒 | 否 | 彩色方向性短笔触和画布纹理贯穿人物、服装、杯子与背景，暖赭与蓝紫并置；原人物、姿态和场景保留，没有移入参考人物的帽子或胡须。相较动漫组形成明确画法区别。 |

“正文版本相同”不等同于“重新分析的任务提示词和最终图像相同”；本表直接比较实际提示词。耗时包含每项独立加载、推理、释放，不能将生图时间单独称为全流程时间。

## 对照说明

冷调和红黑的页面中栏使用此前本人保留的局部反馈修正图，那两项包含具体反馈，任务文字与本轮中性请求不同，仅供美术视觉比较。其余六组中栏与本轮使用相同中性任务。机器参数核验统一对照此前八组中性任务工作流，不借更换采样掩盖结果差异。

## 明亮动漫

![参考、此前保留效果、本轮默认重跑](D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/integrated-final/comparisons/bright.jpg)

暖色轮廓光、清晰线条与概括块面更突出，人物和机场仍统一；较上轮明暗更直接、轮廓更硬，五官仍保留渐变体积，是否更好需本人取舍。

### 上轮实际完整提示词

```text
Redraw the content of <image1> using the actual anime painting language of <image2>. Use crisp, confident linework to define every form; build skin, the striped fabric and the plastic cup with cel-shaded value grouping combined with soft gradient modeling, so curved surfaces read as smoothly modeled volumes with clean fold shadows, not flat fills. Construct the long wavy hair as flowing glossy masses with sunlit highlight bands and fine flyaway strands. Apply luminous directional light entering from the large windows, with rim light, gentle bloom and atmospheric depth, keeping a cool-neutral palette of deep blues, crisp whites, warm skin, auburn hair and red nail accents. Repaint the rows of gray seats, slatted ceiling, glass windows and signage as the same anime environment, using graphic value grouping and atmospheric perspective for depth. Preserve the winking playful smile, cheek mole, striped top, held milk-tea cup and red nails. The finished artwork depicts a young woman with long wavy auburn hair, winking and smiling, a small mole on her cheek, wearing a navy-and-white horizontal striped off-shoulder top, holding up a clear plastic cup of milk tea with a straw and red-painted nails, seated in an airport terminal with rows of gray seats, a slatted ceiling and large glass windows.
```

### 本轮实际完整提示词

```text
Redraw the content of <image1> using the actual anime painting language of <image2>. Lead with crisp, confident line art of varied line weight that defines every form. Build skin as smooth, soft gradient washes over curved surfaces with a gentle blush, while cloth is grouped into hard-edged cast-shadow value masses: large flat color fields with sharp shadow edges under folds and bright sunlit highlights. Construct hair as smooth flowing masses edged by luminous rim-light, not individual strands. Apply strong directional sunlight with clear light/shadow separation, warm sunlit highlights and cool shadow tones, plus a luminous rim glow, keeping a neutral, cool local palette with no sepia cast. Render the rows of gray metal seats, the large glass windows, steel structure and illuminated signage with the same crisp-line, gradient-and-value-grouping finish and atmospheric depth, so subject and environment share one medium. The subject is a young woman with long wavy auburn hair winking and smiling, a small mole on her cheek, wearing a navy-and-white horizontal striped off-shoulder top, raising a clear plastic cup of milk tea with a straw in red-nailed fingers, seated among rows of gray metal seats in an airport terminal with large glass windows and illuminated signage.
```

## 冷调动漫

![参考、此前保留效果、本轮默认重跑](D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/integrated-final/comparisons/dark.jpg)

闭嘴、眨眼、痣、杯子和场景保留；整体更接近精致动漫，但鼻口仍有体积塑造，发顶集中带状高光比上轮反馈修正更明显。

### 上轮实际完整提示词

```text
Redraw <image1> using the actual painting language of <image2> as the style reference. Rebuild the face in anime form language: clean thin line contours, anime eye and eyelash shapes, a simplified nose rendered as a small soft shadow and short line rather than a photographic bridge and nostrils, an anime mouth keeping the closed-mouth smile, and smooth skin with soft blush gradient shading, not photoreal pore modeling. Keep cohesive hair masses with a satin sheen and varied fine strand highlights, not uniform bands. Use smooth painterly gradient shading, soft blended transitions, strong dark value grouping that reads seats and cloth as modeled mass shapes, a cool atmospheric palette with one saturated red accent, directional cool light with a soft rim, painterly background, bokeh light points and soft haze. Keep the woman's long wavy reddish-brown hair, winking expression, closed-mouth smile, cheek beauty mark, navy-and-white striped off-shoulder top, clear plastic cup of iced drink with straw, red nails, and the terminal seating rows, glass windows and illuminated signage as the original scene. The finished artwork depicts a young woman winking and smiling, holding a clear cup of iced drink with a straw, seated among rows of terminal seats in front of glass windows and glowing signage.
```

### 本轮实际完整提示词

```text
Render the content of <image1> using the polished anime illustration language of <image2>. Rebuild hair as large cohesive dark-auburn masses with crisp clean edge silhouettes and a single glossy sheen band across the crown, organized into smooth dark-to-light value grouping. Paint skin with soft, smooth gradient shading and a subtle localized pink blush, keeping the winking expression, single open eye, slight smile and small cheek beauty mark as clean drawn forms. Group the striped off-shoulder top's fabric into crisp cel-shaded folds with smooth value transitions, preserving the navy-and-white stripe construction. Model the held clear cup, straw and red-painted nails as smooth polished surfaces with soft specular highlights. Use a cool directional key light with a rim edge on the figure and a cool neutral palette, no warm cast. Build the airport terminal depth—rows of seats, glass wall, glowing departure signage—through atmospheric value grouping and soft painterly depth. The finished artwork depicts a young auburn-haired woman winking and smiling while raising a clear cup of iced milk tea in an airport waiting area.
```

## CG 材质

![参考、此前保留效果、本轮默认重跑](D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/integrated-final/comparisons/cg.jpg)

皮肤、鼻口和发束的连续体积及反光更明显，机场光色较自然；仍偏精致半写实绘制，与参考的立体材质语言并非完全一致，不能只凭更亮的高光认定 CG 已充分迁移。

### 上轮实际完整提示词

```text
Redraw <image1> using the painting language of <image2>. Render in polished anime illustration style with smooth painterly gradient shading on skin, not flat cel shading. Apply strong directional lighting that casts dappled striped shadow patterns across skin, clothing, and surfaces, using the airport's linear ceiling slats and window frame bars as the natural shadow-casting structures. Build hair as glossy voluminous masses with individual strand highlights catching directional light. Use clean crisp line art to define all forms. Skin should have warm luminous tones with soft gradient transitions and subtle surface texture. Maintain rich saturated palette with strong light-shadow contrast, preserving neutral local colors in shaded areas. The striped top's navy-and-white pattern must remain recognizable, rendered with smooth fabric shading. The winking eye, slight smile, beauty mark near the cheek, red nail polish, and clear plastic cup with iced drink and straw are all preserved as identity marks. Rows of gray airport seats, large glass windows, illuminated flight signs, and ceiling structure remain as the scene's spatial framework, repainted in the reference's smooth anime rendering with atmospheric depth. A young woman with long wavy auburn hair winks playfully while smiling and holding up a clear cup of iced milk tea with a straw, wearing a navy-and-white striped off-shoulder top, seated in an airport terminal with rows of gray seats and glass windows behind her.
```

### 本轮实际完整提示词

```text
Redraw <image1> in the painting language of <image2>. Use smooth volumetric skin shading with warm-to-cool gradient transitions on curved surfaces, glossy hair rendered as defined strand groups with bright specular highlights along the crown and tips, and sharp cast-shadow bands from strong directional light crossing skin, fabric and hands. Render the striped top with pattern-preserving fold modeling and subtle surface shading, not flat color fills. Model the plastic cup and drink as a translucent volume with internal liquid gradient and surface reflections. Build the airport lounge seats, window frames and ceiling structures with layered depth using graphic overlap and modeled volume, keeping recognizable spatial relationships. Preserve the winking expression, slight smile, auburn hair, navy-and-white striped top, red nails, clear cup with straw, and the rows of gray airport seats with large windows. A young woman with long wavy auburn hair winking with one eye closed and a slight smile, wearing a navy-and-white striped top, holding a clear plastic cup of milk tea with a straw, seated in an airport lounge with rows of gray seats and large windows.
```

## 柔和插画

![参考、此前保留效果、本轮默认重跑](D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/integrated-final/comparisons/soft.jpg)

暖色氛围、闭嘴微笑、眨眼和痣保留；腮红、皮肤高光点与头发带状反光明显增强，整体更亮滑，柔和程度与上轮不同。

### 上轮实际完整提示词

```text
Redraw the content of <image1> using the actual painting language of <image2> as the style reference. Render as a polished anime illustration: smooth volumetric skin built from soft tonal gradients with gentle blush and glossy specular sheen on cheeks, nose and shoulders; flowing glossy hair masses with cel-shaded highlight bands, fine flyaway strands and soft gradient transitions; luminous detailed eyes with sharp liner, glowing iris and defined lashes, preserving the winking expression, slight smile and small cheek beauty mark. Rebuild the navy-and-white striped top with soft fabric shading and crisp stripe rhythm, and the clear plastic cup, straw and red-nailed fingers with translucent glossy rendering. Use warm directional interior lighting with soft cast shadows and subtle atmospheric sparkle, a cozy warm palette balanced with neutral local colors. Background rows of gray terminal seats, glass panels and glowing signage are softly modeled with depth. The subject is a young woman with long wavy reddish-brown hair winking playfully with a slight smile, a small beauty mark on her cheek, wearing a navy-and-white striped top, holding up a clear plastic cup of milk tea with a straw in red-nailed fingers, seated among rows of gray airport terminal seats with glass panels and illuminated signage behind her.
```

### 本轮实际完整提示词

```text
Redraw <image1> in the painting language of <image2>. Render hair as smooth flowing masses with bright specular highlight bands running along the surface, creating a glossy reflective sheen. Model skin with soft volumetric gradients, warm blush tones on cheeks, and bright specular highlights on raised surfaces like shoulders and knuckles. Use clean refined anime linework with polished semi-painterly shading, not flat cel shading. Apply warm interior lighting that produces strong specular points and soft ambient glow, with material-specific surface rendering: the striped fabric shows soft fold shading, the plastic cup shows transparent reflections, the glass windows show cool ambient reflections. Preserve the winking expression, beauty mark, red nails, and navy-and-white striped top. A young woman with long wavy reddish-brown hair winks playfully while holding up a clear plastic cup of milk tea with a straw, wearing a navy-and-white striped top, in an airport terminal with rows of gray seats and large glass windows.
```

## 湿润高光

![参考、此前保留效果、本轮默认重跑](D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/integrated-final/comparisons/wet.jpg)

发丝、皮肤与杯子高光更明显，衣料也出现了成片湿亮反光；后者来自实际提示词的 wet-fabric 指令，与本人已明确的普通非湿环境要求冲突。本项不能作为稳定通过，属于分析指令选择问题。

### 上轮实际完整提示词

```text
Redraw the content of <image1> in the actual painting language of <image2>, a high-finish glossy anime illustration. Build hair as large smooth volumetric masses with smooth gradient shading, sharp bright specular highlight bands, clumped glossy tips and fine flyaway strands. Model skin with soft luminous gradients, cheek blush and subtle rim light; use crisp detailed lineart with large luminous gradient eyes, defined lashes and a glossy wet sheen. Render fabric with glossy sheen, smooth modeled folds and reflective highlights, treating surfaces with light-source-driven luminosity. Use the existing glowing flight signs, ceiling lights and glass windows as the bright sources that cast rim light along hair edges and create reflective highlights, keeping a clean cool-neutral palette with no warm sepia cast. Preserve the winking smile, cheek beauty mark, striped top design, cup, straw and red nails. The subject is a young woman with long wavy auburn hair winking and smiling with a small cheek beauty mark, wearing a navy-and-white horizontal-striped off-shoulder top, raising a clear plastic cup of milky drink with a straw and red-painted nails, seated in an airport terminal with rows of gray seats, a slatted ceiling, glowing yellow flight-information signs and large framed glass windows.
```

### 本轮实际完整提示词

```text
Redraw the content of <image1> entirely in the actual painting language of <image2> as the style reference. Build the hair as large, glossy, highly saturated flowing masses with smooth gradient volume, sharp specular streaks and fine flyaway strands. Apply the reference's wet-fabric mechanism to the striped top: mottled translucent sheen patches, glossy clinging value grouping, while preserving the navy-and-white horizontal stripe construction. Render skin with smooth painterly blending, soft cheek blush and a luminous iris, edges defined by crisp clean linework. Use strong directional rim light with high contrast between deep shadow and bright highlight, and rich local color and depth in the background. Keep the winking smile, beauty mark, red nails and the held cup. A young woman with long wavy auburn hair winks and smiles while holding up a clear plastic cup of milky drink with a straw, wearing a navy-and-white horizontal striped off-shoulder top, seated in an airport terminal waiting area with rows of gray seats, a slatted ceiling, a glass curtain wall and a yellow flight-information sign.
```

## 红黑平面

![参考、此前保留效果、本轮默认重跑](D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/integrated-final/comparisons/graphic.jpg)

红黑大色块、深色剪影和机场图形结构成立；没有参考的冠状饰物。人物肤色更暗、更平面化，蓝白条纹仍突出，金色边光明显减少。

### 上轮实际完整提示词

```text
Repaint the content of <image1> using the actual painting language of <image2>. Organize the whole scene into a single saturated red dominant field crossed by deep black graphic silhouette masses; the airport seats, window frames, dark ceiling bands and signage read as hard-edged black value shapes set against that red field, not as a cool blue-gray wash. Skin is a smooth pale plane sculpted by hard-edged cast-shadow shapes (nose, under-lip, cheek) with selective warm gold/white edge glints; the winking eye, closed-mouth smile and beauty mark are rebuilt as crisp drawn forms. Hair becomes a bold dark mass with a crisp silhouette, fine stray strands, a mesh texture overlay and warm edge-glint highlights. The navy-and-white striped top is rendered as flat graphic bands with hard shadow shapes; the held cup is a clean graphic form with a flat liquid shape and one sharp highlight; red nails read as flat saturated shapes. Scattered pigment speckle and splatter marks express the medium across the scene, not as new objects. Keep the auburn hair, navy/white stripes and red nails as identity cues, organized through the reference's red-black high-contrast flat palette. A young woman with long wavy auburn hair winks and smiles, holding up a clear plastic cup of iced coffee with a straw, wearing a navy-and-white striped top, seated in an airport terminal with rows of gray seats and large glass windows.
```

### 本轮实际完整提示词

```text
Redraw <image1> using the actual painting language of <image2>. Rebuild every form as flat graphic color masses bounded by sharp, hard-edged boundaries: the skin is a single matte muted tone with crisp cast-shadow shapes (jaw, neck, under hair) filled as flat planes, not soft gradients; the long wavy hair becomes a solid dark silhouette mass with thin ink-like strand lines and scattered tiny luminous gold-white sparkle dots across its surface; the striped top is rendered as flat navy and white graphic bands with clean edges; the raised drink cup and straw are flat graphic shapes with a few bright specular points; the red nail polish reads as a flat saturated accent. Use strong silhouette-driven contrast: deep dark figure masses against a bold, flat saturated terminal background field. Scatter thin ink-like contour lines for lashes, ear, and hair edges, and add sparse ink-dot and splatter motifs in the background field as the reference's decorative rhythm. The airport seating rows, glass window panels, slatted ceiling, and flight display board remain as recognizable flat graphic structures with sharp value grouping. Preserve the winking expression, slight smile, cheek beauty mark, striped garment design, and raised drink pose. The finished artwork depicts a young woman with long wavy auburn hair, winking and smiling, wearing a navy-and-white striped top, raising a clear cup of iced drink with a straw in an airport terminal seating area.
```

## 留出测试 · 木版画

![参考、此前保留效果、本轮默认重跑](D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/integrated-final/comparisons/holdout-print.jpg)

粗轮廓、平面色块和纸面纹理形成明确版画语言；头发额外出现白色浪花装饰，混入了参考内容，不符合只迁移画法的边界。本项不能作为稳定通过，首次编号失败与单次补跑均保留。

### 上轮实际完整提示词

```text
Render the content of <image1> in the woodblock-print painting language of <image2>: bold black ink outlines define every form, flat limited color blocks replace photographic shading, and depth is built by graphic overlap and planar value grouping on an aged beige paper ground, not smooth volumetric gradients. Rebuild the long hair as swirling rhythmic line masses with curling decorative contours, the striped top as flat navy-and-white bands, the cup, straw and liquid as outlined flat shapes with patterned foam-like motifs, the red nails as small flat accents, and the cheek beauty mark as a crisp ink dot. Translate the airport rows of seats, glass wall and signage into outlined flat overlapping shapes with restrained indigo, cream and white tones, keeping a cool neutral color organization. Preserve the wink, smile, pose and identity. The subject is: A young woman with long wavy reddish-brown hair winks and smiles while holding up a clear cup of iced milk tea with a straw, wearing a navy-and-white striped top, seated in an airport waiting area with rows of seats and a glass wall behind her.
```

### 本轮实际完整提示词

```text
Render the content of <image1> using the woodblock-print painting language of <image2>: every form defined by bold, confident outlines; volume built from discrete flat color blocks in limited tonal steps, not smooth gradients; the wavy hair mass becomes rhythmic flowing shapes with claw-like spiral foam motifs echoing wave crests; the striped top's bands become bold flat navy-and-white blocks with strong contour edges; the plastic cup, straw, and hand are crisp graphic shapes; the airport seating rows and glass curtain wall become overlapping graphic planes with strong outlines against a muted paper-toned sky wash. A beauty mark, red nails, winking eye, smile, reddish-brown hair, striped top, and iced milk tea cup remain as identity marks. The finished artwork depicts a young woman with long reddish-brown wavy hair winking and smiling while holding up a plastic cup of iced milk tea with a straw, wearing a navy-and-white striped top, seated in an airport terminal with rows of grey seats and a glass curtain wall behind her.
```

## 留出测试 · 笔触油画

![参考、此前保留效果、本轮默认重跑](D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/integrated-final/comparisons/holdout-oil.jpg)

彩色方向性短笔触和画布纹理贯穿人物、服装、杯子与背景，暖赭与蓝紫并置；原人物、姿态和场景保留，没有移入参考人物的帽子或胡须。相较动漫组形成明确画法区别。

### 上轮实际完整提示词

```text
Repaint <image1> using the actual painting language of <image2>: a post-impressionist impasto oil surface built entirely from short, discrete, directional strokes of pigment laid side by side, never smooth gradients. Model every form by stroke direction that follows its contours: the long wavy hair becomes dense parallel strokes of warm ochre-red, the skin is assembled from short broken strokes carrying pink, ochre and pale-green complementary notes, the navy-and-white striped top is rendered as parallel strokes following the drape of the body, the clear cup of iced coffee is built from broken strokes capturing translucent liquid, ice and the straw, and the red nails are small concentrated strokes. Edges dissolve into stroke clusters, no clean outlines. Use complementary color juxtaposition—warm ochre-red against cool blue-violet—rather than blending. The rows of terminal chairs, glass facade and illuminated signage become looser, thinner scattered strokes over an exposed pinkish-ocher canvas ground. Preserve the wink, smile, cheek beauty mark, striped garment, held cup and seating-row scene. The subject is: A young woman with long wavy reddish-brown hair winks and smiles while holding up a clear plastic cup of iced coffee with a straw, wearing a navy-and-white striped top, seated in a row of terminal chairs beside a glass facade.
```

### 本轮实际完整提示词

```text
Repaint the content of <image1> entirely in the actual painting language of <image2>: build every form from short, directional impasto brushstrokes laid in rhythmic parallel rows, so volume emerges from stroke direction and value grouping rather than smooth gradients. Use complementary color juxtaposition—warm ochre, yellow and pinkish-ochre for skin and hair set against cool blue, violet and teal strokes for the striped top and shadowed areas—letting adjacent hues vibrate side by side. Define edges by stroke rhythm and broken contours, not outlines, and keep the woven canvas texture visible across the whole surface. Model the face, hair mass, striped fabric, hand, cup and straw as fields of layered strokes; the winking eye, smiling mouth, beauty mark and red nails stay recognizable as painted forms. Render the airport chairs, glass wall and ceiling as a field of short radiating strokes in muted mauve-grey, with cool blue-violet cast shadows, depth carried by graphic stroke overlap. The finished artwork depicts a young woman winking and smiling, with long wavy auburn hair, a navy-and-white striped top, a beauty mark on her cheek, red-painted nails, holding up a clear plastic cup of iced coffee with a straw, seated in rows of airport gate chairs beside a glass wall and overhead departure signage.
```

## 证据与边界

本次直接运行冻结源码的本地 Strata `artAgentChat` 与内置技能加载分支，使用空白任务记录，知识版本为 `bundled-only`；未启动或更新已安装助手 UI，也未连接线上共享技能缓存。正式运行中的已发布云端技能优先级保持原样，不能将本轮本地测试描述为线上所有账户的实际结果。

版画表中的分析时间为成功补跑时间；此前失败另耗时 132.2 秒，失败响应仍保留。七项保持原中性任务文字；版画补跑只追加明确双图编号的格式要求，画风规则未改，模型实际生成的英文提示词未由人工重写。

全新分析请求 9 次，全新生成任务 8 次；8 个唯一实际 Qwen prompt_id，输入、输出摘要、工作流参数及分析资源释放均通过核验。

源码快照、原始响应、实际下发 graph、history、输出 PNG、生命周期记录和验证文件全部保留在 `D:/AI_APP/NovaFlow-Web/work/style-generalization-20261026/integrated-final/`。每批分析和生图顺序执行，专用服务结束后释放，未停止其他服务。

本轮仅测试和展示，没有再次修改规则或发布 Supabase 经验，也没有打包或更新线上。现有八组不能证明所有未来素材都可靠，具体图的缺陷不会直接改写成全局规则。
