# 英文提示词恢复后的五项全新分析与真实生图验证

五项均完成全新视觉分析和真实 Qwen 生图，但不能判定重新分析后全部达到上轮认可质量：明亮、冷调、柔和的完成度接近，调子/画法仍有差别；湿润更冷、更硬；CG 明暗组织与材质主导判断减弱并引入雀斑。本轮没有替换已选图或发布经验，质量采用仍由用户看对照决定。

[参考、上轮认可图、本轮新图及实际提示词逐项对照](http://127.0.0.1:4806/)

![五项重新分析后的真实输出](D:/AI_APP/NovaFlow-Web/work/english-style-fresh-final-20261026/run/overview.jpg)

## 本轮实际验证的内容

小桃重新读取完整主体图与完整画风参考，独立分析一次，返回新的英文执行提示词，经实际前端模块写入与编译后，真实调用 Qwen-Image-2.1 Turbo 生成一张。原有提示词字段清空；没有向分析模型提供旧生成图、旧提示词或历史对话。上轮认可图仅用于结果对照。对话说明保持中文。

只测明亮动漫、冷调动漫、CG 材质、柔和插画、湿润高光；红黑、木版画、油画依用户要求不再测试。没有改变美术规则、采样、GPU 调度、经验系统或发布状态。

原图、参考、Qwen 模型、CFG 3、8 步、seed 54792256、sigmas、尺寸及工作流几何与封存结果一致，原有负向保留。当前默认规则 1.0.11，上轮认可图来自 1.0.13（冷调曾经过局部反馈）；本轮是重新分析的当前完整流程验收，不能据此将差异全部归因于语言。

## 真实结果与耗时

| 风格 | 分析总计 | 模型请求 | 单张生图 | 原图级观察 |
| --- | --- | --- | --- | --- |
| 明亮动漫 | 113.5 秒 | 78.2 秒 | 59.2 秒 | 亮度、动漫块面、构图和完成度接近上轮，人物特征保留；本轮背景更蓝，面部过渡更柔，线条与唇部仍带统一精致动漫倾向，风格效果并非完全一致。 |
| 冷调动漫 | 81.6 秒 | 54.7 秒 | 60.3 秒 | 冷背景与暖肤色分开，主体、机场层次和精细度接近上轮；本轮人物更暖、线条与发丝更明确，冷调动漫的造型概括仍偏弱。 |
| CG 材质 | 100.1 秒 | 65.1 秒 | 58.7 秒 | 主体细节和暖侧光成立，但没有达到上轮较鲜明的明暗组织，依然偏精致动漫而非更强的 CG 材质；额外增加了参考图式雀斑。本项不能判为相同质量。 |
| 柔和插画 | 101.6 秒 | 76.2 秒 | 60.9 秒 | 暖色氛围、背景虚实与完成度接近上轮，脸颊痣、眨眼、服装与道具保留；本轮腮红更重、暖色更强，不能视为完全相同。 |
| 湿润高光 | 81.4 秒 | 54.4 秒 | 59.8 秒 | 动漫造型、发丝亮带与杯体反射成立，衣服保持干燥；本轮更冷、更饱和、边缘更硬，上轮较柔和的光泽与氛围未完全复现，不能直接视为同一效果。 |

分析总计包括独立加载及释放；单张生图是已启动本轮 Comfy 服务后的任务耗时，不等于完整冷启动耗时。助手逐张查看原始输出作上述观察，不是产品默认自动审图，也不是用户满意反馈。

## 前置失败与修正范围

前置验证共发生 5 次真实分析、0 次生图：柔和首次及一次明确诊断后的补测返回错误任务校验标识；冷调、CG、湿润的最终提示词缺少双图编号。应用均正确拦截，没有手工修补模型响应后冒充原生成功。

前置验证指令改写时遗漏了原有验收请求中的“最终提示词必须明确写出双图职责”要求。本轮恢复原有中性任务措辞，清空旧提示词并保留原有负向；湿润补入已明确的普通非湿环境约束，然后全新分析五项。未修改系统美术提示词或工具校验。前置失败与最终成功均单独保留。普通自然对话下的交接可靠性仍需关注，本轮未把明确措辞下的成功扩张为任意话术都稳定。

## 明亮动漫

![参考、上轮认可、本轮新图](D:/AI_APP/NovaFlow-Web/work/english-style-fresh-final-20261026/run/comparisons/bright.jpg)

亮度、动漫块面、构图和完成度接近上轮，人物特征保留；本轮背景更蓝，面部过渡更柔，线条与唇部仍带统一精致动漫倾向，风格效果并非完全一致。

### 上轮执行提示词

```text
Redraw the content of <image1> using the actual anime painting language of <image2>. Use crisp, confident linework to define every form; build skin, the striped fabric and the plastic cup with cel-shaded value grouping combined with soft gradient modeling, so curved surfaces read as smoothly modeled volumes with clean fold shadows, not flat fills. Construct the long wavy hair as flowing glossy masses with sunlit highlight bands and fine flyaway strands. Apply luminous directional light entering from the large windows, with rim light, gentle bloom and atmospheric depth, keeping a cool-neutral palette of deep blues, crisp whites, warm skin, auburn hair and red nail accents. Repaint the rows of gray seats, slatted ceiling, glass windows and signage as the same anime environment, using graphic value grouping and atmospheric perspective for depth. Preserve the winking playful smile, cheek mole, striped top, held milk-tea cup and red nails. The finished artwork depicts a young woman with long wavy auburn hair, winking and smiling, a small mole on her cheek, wearing a navy-and-white horizontal striped off-shoulder top, holding up a clear plastic cup of milk tea with a straw and red-painted nails, seated in an airport terminal with rows of gray seats, a slatted ceiling and large glass windows.
```

### 本轮重新分析产生的执行提示词

```text
Redraw <image1> in the polished anime painting language of <image2>. Use <image1> as the content and <image2> as the artistic reference for line, form, shading, color and rendering only — do not copy the reference's character, sky, flowers, lamp, mountains or props. Adopt the reference's clean confident linework, smooth cel-shading with soft gradient tonal transitions, a polished semi-real anime face, glossy hair highlights, crisp broad-shape/detail balance, and a rich saturated cool palette of deep navy, crisp white and clear blue, with the auburn hair as the warm accent. Reconstruct the face, hair mass, hand and the clear cup in this drawn form language while keeping the winking expression, slight smile, cheek beauty mark, red nails, striped top and the held iced drink. Render the airport terminal with atmospheric depth: rows of gray seats, large glass windows, ceiling slats and the departure sign, using selective focus and coherent cool interior light with soft local reflections, keeping neutral skin tones and clear material separation, no warm yellow cast. The finished artwork depicts a young woman with long wavy auburn hair winking and smiling, wearing a navy-and-white striped off-shoulder top, holding up a clear cup of iced milk tea with a straw and red nails, seated in an airport terminal with rows of gray seats, large glass windows and a departure sign.
```

## 冷调动漫

![参考、上轮认可、本轮新图](D:/AI_APP/NovaFlow-Web/work/english-style-fresh-final-20261026/run/comparisons/dark.jpg)

冷背景与暖肤色分开，主体、机场层次和精细度接近上轮；本轮人物更暖、线条与发丝更明确，冷调动漫的造型概括仍偏弱。

### 上轮执行提示词

```text
Redraw <image1> using the actual painting language of <image2> as the style reference. Rebuild the face in anime form language: clean thin line contours, anime eye and eyelash shapes, a simplified nose rendered as a small soft shadow and short line rather than a photographic bridge and nostrils, an anime mouth keeping the closed-mouth smile, and smooth skin with soft blush gradient shading, not photoreal pore modeling. Keep cohesive hair masses with a satin sheen and varied fine strand highlights, not uniform bands. Use smooth painterly gradient shading, soft blended transitions, strong dark value grouping that reads seats and cloth as modeled mass shapes, a cool atmospheric palette with one saturated red accent, directional cool light with a soft rim, painterly background, bokeh light points and soft haze. Keep the woman's long wavy reddish-brown hair, winking expression, closed-mouth smile, cheek beauty mark, navy-and-white striped off-shoulder top, clear plastic cup of iced drink with straw, red nails, and the terminal seating rows, glass windows and illuminated signage as the original scene. The finished artwork depicts a young woman winking and smiling, holding a clear cup of iced drink with a straw, seated among rows of terminal seats in front of glass windows and glowing signage.
```

### 本轮重新分析产生的执行提示词

```text
Redraw <image1> in the polished anime rendering language of <image2>. The woman winks with one eye closed, smiling softly, a small beauty mark beneath her right eye; she wears a navy-and-white striped off-shoulder top, holds a clear plastic cup of milk tea with a straw in her red-manicured hand, seated in an airport terminal with rows of gray seats, glass curtain walls, and overhead strip lighting. Apply the reference's smooth clean line work, flowing hair masses with soft specular highlights, gentle skin shading with subtle blush, rich tonal gradients, and deep saturated palette. Render the striped fabric with clear flat color blocks and soft fold shading. Give the background atmospheric depth with cool ambient light from the glass panels, warm accent glow from ceiling fixtures, and soft bokeh on distant departure signs. Maintain the selfie framing, the cup as focal prop, and the terminal's spatial structure. A young woman with long wavy auburn hair winks and smiles while holding a milk tea cup in an airport terminal, wearing a navy-and-white striped off-shoulder top.
```

## CG 材质

![参考、上轮认可、本轮新图](D:/AI_APP/NovaFlow-Web/work/english-style-fresh-final-20261026/run/comparisons/cg.jpg)

主体细节和暖侧光成立，但没有达到上轮较鲜明的明暗组织，依然偏精致动漫而非更强的 CG 材质；额外增加了参考图式雀斑。本项不能判为相同质量。

### 上轮执行提示词

```text
Redraw <image1> using the painting language of <image2>. Render in polished anime illustration style with smooth painterly gradient shading on skin, not flat cel shading. Apply strong directional lighting that casts dappled striped shadow patterns across skin, clothing, and surfaces, using the airport's linear ceiling slats and window frame bars as the natural shadow-casting structures. Build hair as glossy voluminous masses with individual strand highlights catching directional light. Use clean crisp line art to define all forms. Skin should have warm luminous tones with soft gradient transitions and subtle surface texture. Maintain rich saturated palette with strong light-shadow contrast, preserving neutral local colors in shaded areas. The striped top's navy-and-white pattern must remain recognizable, rendered with smooth fabric shading. The winking eye, slight smile, beauty mark near the cheek, red nail polish, and clear plastic cup with iced drink and straw are all preserved as identity marks. Rows of gray airport seats, large glass windows, illuminated flight signs, and ceiling structure remain as the scene's spatial framework, repainted in the reference's smooth anime rendering with atmospheric depth. A young woman with long wavy auburn hair winks playfully while smiling and holding up a clear cup of iced milk tea with a straw, wearing a navy-and-white striped off-shoulder top, seated in an airport terminal with rows of gray seats and glass windows behind her.
```

### 本轮重新分析产生的执行提示词

```text
Redraw the content of <image1> entirely in the actual painting language of <image2>, using <image1> as the content source and <image2> as the artistic reference. Adopt the reference's polished anime form language: a refined face with large expressive eyes, clean defined line edges, glossy skin highlights, delicate freckle-like skin texture, rich tonal transitions between lit and shadowed areas, and detailed hair strands with warm rim light and soft sheen. Apply a coherent directional light that creates strong illuminated-versus-shadowed separation across the face, hair, hand and clothing, matching the reference's dramatic light-shadow structure, while keeping neutral local colors (navy stripes, gray seats, cool window reflections) so the image does not become a uniform warm cast. Reconstruct the face, hair mass, hand and the held cup in the reference's volume and shading, preserving the winking expression, faint smile, cheek beauty mark, long wavy reddish-brown hair, navy-and-white striped top, red-painted nails, and the clear plastic cup with straw and milky tea. Keep the close-up selfie composition and the terminal setting: rows of gray seats, glass windows, slatted ceiling and yellow departure signage, repainted with depth, soft atmospheric falloff and selective focus behind the subject. The finished artwork depicts: A young woman with long wavy reddish-brown hair winks with one eye closed and smiles faintly, wearing a navy-and-white striped top and raising a clear plastic cup with a straw and a milky tea drink, seated in rows of gray terminal seats beneath a slatted ceiling with glass windows and yellow departure signage.
```

## 柔和插画

![参考、上轮认可、本轮新图](D:/AI_APP/NovaFlow-Web/work/english-style-fresh-final-20261026/run/comparisons/soft.jpg)

暖色氛围、背景虚实与完成度接近上轮，脸颊痣、眨眼、服装与道具保留；本轮腮红更重、暖色更强，不能视为完全相同。

### 上轮执行提示词

```text
Redraw the content of <image1> using the actual painting language of <image2> as the style reference. Render as a polished anime illustration: smooth volumetric skin built from soft tonal gradients with gentle blush and glossy specular sheen on cheeks, nose and shoulders; flowing glossy hair masses with cel-shaded highlight bands, fine flyaway strands and soft gradient transitions; luminous detailed eyes with sharp liner, glowing iris and defined lashes, preserving the winking expression, slight smile and small cheek beauty mark. Rebuild the navy-and-white striped top with soft fabric shading and crisp stripe rhythm, and the clear plastic cup, straw and red-nailed fingers with translucent glossy rendering. Use warm directional interior lighting with soft cast shadows and subtle atmospheric sparkle, a cozy warm palette balanced with neutral local colors. Background rows of gray terminal seats, glass panels and glowing signage are softly modeled with depth. The subject is a young woman with long wavy reddish-brown hair winking playfully with a slight smile, a small beauty mark on her cheek, wearing a navy-and-white striped top, holding up a clear plastic cup of milk tea with a straw in red-nailed fingers, seated among rows of gray airport terminal seats with glass panels and illuminated signage behind her.
```

### 本轮重新分析产生的执行提示词

```text
Redraw <image1> entirely in the polished anime painting language of <image2>, treating <image2> only as the artistic reference and never copying its character, cat ears, sign, sweater, lamp or bedroom. Adopt the reference's rich glossy anime rendering: clean confident line work on facial features, soft layered skin shading with luminous highlights, delicate pink blush across cheeks and nose, glossy sheen bands running through the hair, finely drawn individual strands, and a warm directional key light creating clear illuminated areas against softer shadowed zones. Establish a coherent warm light direction inside the airport terminal, with gentle reflected color on the skin and the plastic cup, while keeping the gray seats, navy stripes and glass neutral in their local colors. Render the eyes, the winking closed eye, the mouth and the beauty mark as redesigned drawn forms that preserve the original playful expression. Give the striped top and the held cup crisp fabric and liquid form design with readable folds and translucency. Add atmospheric depth to the rows of seats, ceiling structure and windows through a soft focus hierarchy that supports the focal subject. Maintain high art finish, a coordinated palette and smooth tonal transitions. The finished artwork depicts: a young woman with long wavy auburn hair, winking with one eye closed and a playful smile, a small beauty mark on her cheek, red-painted nails, wearing a navy-and-white striped off-shoulder top, holding up a clear plastic cup with a straw of milky iced coffee, seated among rows of gray terminal seats beside large glass windows and a structured ceiling.
```

## 湿润高光

![参考、上轮认可、本轮新图](D:/AI_APP/NovaFlow-Web/work/english-style-fresh-final-20261026/run/comparisons/wet.jpg)

动漫造型、发丝亮带与杯体反射成立，衣服保持干燥；本轮更冷、更饱和、边缘更硬，上轮较柔和的光泽与氛围未完全复现，不能直接视为同一效果。

### 上轮执行提示词

```text
Redraw the content of <image1> in the actual painting language of <image2>, a high-finish glossy anime illustration. Build hair as large smooth volumetric masses with smooth gradient shading, sharp bright specular highlight bands, clumped glossy tips and fine flyaway strands. Model skin with soft luminous gradients, cheek blush and subtle rim light; use crisp detailed lineart with large luminous gradient eyes, defined lashes and a glossy wet sheen. Render fabric with glossy sheen, smooth modeled folds and reflective highlights, treating surfaces with light-source-driven luminosity. Use the existing glowing flight signs, ceiling lights and glass windows as the bright sources that cast rim light along hair edges and create reflective highlights, keeping a clean cool-neutral palette with no warm sepia cast. Preserve the winking smile, cheek beauty mark, striped top design, cup, straw and red nails. The subject is a young woman with long wavy auburn hair winking and smiling with a small cheek beauty mark, wearing a navy-and-white horizontal-striped off-shoulder top, raising a clear plastic cup of milky drink with a straw and red-painted nails, seated in an airport terminal with rows of gray seats, a slatted ceiling, glowing yellow flight-information signs and large framed glass windows.
```

### 本轮重新分析产生的执行提示词

```text
Use <image1> as the content and <image2> as the artistic-language reference. Redraw the source scene in <image2>'s polished anime rendering: crisp clean linework, luminous glossy hair built from smooth tonal masses with bright highlight bands and fine strand edges, large expressive detailed eyes with layered iris shading, soft skin shading with delicate cheek blush and gentle midtone transitions, and richly shaded fabric folds. Adopt <image2>'s saturated, cool-leaning palette, strong edge definition, and layered depth, while keeping the source's dry, normal clothing and interior atmosphere—do NOT add wet fabric, rain, water droplets, glossy wet sheen on the shirt, or a wet environment; the striped top stays a dry matte cotton fabric. Preserve the woman's identity, the winking eye and slight smile, the cheek beauty mark, the long wavy auburn hair, the navy-and-white striped top, the raised clear cup of iced milk tea with straw and red nails, and the airport-terminal seating rows and glass facade with yellow signage as the main scene structure. Reconstruct face, hair masses, hand and cup form in the reference's anime form language, keeping proportions, expression and object categories recognizable, not photographic contours. The finished artwork depicts: A young woman with long wavy auburn hair winks one eye with a soft smile, a small beauty mark on her cheek, wearing a navy-and-white striped top, raising a clear plastic cup of iced milk tea with a straw and red-painted nails, seated among rows of terminal seats in front of a glass facade with yellow signage.
```

## 证据与边界

最终轮 5 次真实新分析、5 次真实生图；连同前置失败共 10 次真实分析请求，没有翻译调用、自动审图、生图重试或第二遍增强。新提示词与最终 Qwen 正文逐字一致，五个任务的唯一 provider request_id、prompt_id、输入/输出 SHA 及工作流差异均有记录。

所有生成结果只记入隔离任务日志为 succeeded/unrated，不代表画质验收或经验发布。源图、旧图、参考未覆盖。前端检查运行冻结源码的实际模块，属于 CPU 隔离代码路径检查；真实模型与生图调用不等于已安装软件 UI 自动化验收。

原始证据：`D:/AI_APP/NovaFlow-Web/work/english-style-fresh-final-20261026/run/`；前置失败：`D:/AI_APP/NovaFlow-Web/work/english-style-fresh-20261026/run/`。本轮没有更新安装包、已安装程序、线上站点或 Supabase。
