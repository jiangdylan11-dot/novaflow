# 绘图参考流程

范围为美工的“绘图”页，UI 设计流程保留自己的入口。旧的分析框架已删除，历史记录在 Git 里。

## 普通“生成”

`runArtGenerate → NovaFlowArtPrepare.prepare → buildArtGenerateRunWorkflow`

- `renderer/art-prepare.workflow.js` 只做准备：按提示词和页面用途判断每张参考图的角色，把 `@参考图N` 编译成 `<imageN>`，核对图片格式和数量。这里不调用任何模型。
- 生成后不再做模型复审或自动纠正。

## 风格重绘

Qwen-Image-2.1 Turbo 不会从风格图片里读画风，但会照着具体文字描述画（A/B 记录在 `work/art-style-ab-20261105`）。所以风格词由小桃的在线模型写：

1. 用户在小桃里确认一张主体和一张或多张风格图。
2. `optimizeForAgent` 把图片按主体在前发给 `novaflow-companion`，`packages/shared/src/qwen21-native-rewrite.mjs` 的风格模式让在线模型只写 `style_description`、`mood_description` 和 `content_description` 三段短文，程序把它们套进固定模板，只取参考图的打光设计、颜色保持原样，再接上 `STYLE_POLISH`，策略为 `qwen21-style-redraw-v1`。
3. 负向提示词由程序决定：用户自己的内容在前，后接 `STYLE_NEGATIVE`。
4. 确认草稿后，本地 Qwen 2.1 生成：CFG 3，主体图 0.25 MP，风格图 1 MP，空白 latent 固定约 1.77 MP（4:3 时 1536×1152），最后缩到用户设的 W/H。页面上的提示词保留原槽位编号。

## 采样规则

只有一条规则，定义在 `renderer/art-generate-model.resource.js` 的 `isStyleRedraw`：绘图任务的 `referenceRoles` 是一张主体在前、其余全是风格，就算风格重绘。

- CFG 3，普通版和 Turbo 相同，用户手填的值优先。
- 内容图走工作尺寸；宽高比和主体一致时用编码器的 latent，否则新建 latent。
- 每张风格图不超过 1 MP，全部额外参考合计不超过 1.5 MP。

其他情况沿用默认值：Turbo CFG 1，普通版有负向 2.5、无负向 1。

## 本地大脑

本地模型只对话和优化提示词。选中本地大脑且参考图里有风格图时，小桃用普通回复说明风格转换需要在线模型，不报错、不扣费。
