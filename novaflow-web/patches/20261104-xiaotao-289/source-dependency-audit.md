# 289 小桃绘图测试的源码依赖审计

`qwen21-native-rewrite.test.mjs` 引用的 art-business 模块在基线提交中缺失；仅把当时未跟踪的 art-business、pricing 和 decimal 模块复制进旧分支，会继续使用旧的 DeepSeek 费率。以同一合成输入为例，旧分支估算 9 分，而经 SHA256 核验的 289 自包含 companion 候选估算 1 分，因此不能用这种混合状态作为源码基线。

本次只补齐 art-business、companion-pricing、xiaotao-decimal-usage、xiaotao-operation-pricing-v3、xiaotao-model-rates 五个缺失模块，以及这条闭包所需的 feature-credits、runninghub-llm 变更。保留分支已有的 289 冻结文本/视觉系统提示词；pricing 默认 revision 保持线上 289 的 `2.0.265`，不带入主工作区后续未冻结的 idle-draft 和音频音乐能力。价格、额度和使用量必须继续由服务端策略决定。

离线对照以 `work/xiaotao-local-289-20261104/companion-289.mjs` 为基准，其 SHA256 为 `518c338ee986cd0717ea6d69b9d79cc78c9c5a13929cbd812584f15a1a8995b4`。基线文本/视觉系统提示词逐字一致；内嵌 Qwen native 模块与已提交源码去除 export 后逐字一致。解析并规范化打包器局部变量及模块限定名后，`createTrustedArtPhases` 完整函数与候选一致。

合成输入对照覆盖定价/结算 28 例、价格策略能力开关 26 例、RunningHub 请求与响应 15 例，以及一次结构化绘图 quote→infer→settle，候选结果与 289 bundle 一致。分支中 Qwen native、图生图、冻结定价合同、feature-credits PGlite、RunningHub 适配以及 decimal 运算合计 52 项检查通过。这些样例不是整个生产 bundle 的逐字节重建证明，也不是实际供应商调用或图生图安全绑定验收；生产发布依然必须使用经审核和验证的冻结工件。
