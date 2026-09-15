# H3 校验与历史列表 15 条修正

日期：2026-09-14；客户端版本：2.3.214。

## 本轮改动

- 本地首尾帧反推：保留分类分流前的人物证据来统计人物槽位，不再只扫描分流后的姓名、外观。已有可见程度分类而范围未明确时记录 `uncertain`，避免同时生成“存在该分类”和“程度为 none”的矛盾字段；不猜测范围、不降低内容分类，最终仍通过原有完整视觉校验。语义失败日志增加固定原因分类，不记录图片或原始提示词。
- Grok 多参优化：一次修复重试现在收到具体的应用校验失败项，包括语言、字段、时间段、引用、台词及实质优化；此前重试只有笼统错误码。最终失败向界面返回固定的具体原因和真实重试次数，未知服务文本不泄漏。任务时长 `3s` 与 `3秒` 等价，数值不匹配仍拒绝。本地 Python、桌面服务、Edge 和 renderer 保持一致。
- 历史记录：视频、美工共用的两套提示词列表总显示上限为 15 条，已保存项也占列表预算；保留原排序和保存优先级。仅切分显示数组，不删除已存记录，原生点击回填完整提示词。包括过多旧保存槽位的情况。
- 保留此前视频抠图实现；该文件 SHA256 仍为 `805e64e7b4dce684cd78fbc6e4ca6ac290b9a0ebf35d9f67c924d6f1c53ccf70`。

## 复核

- Grok 多参优化真实调用一次，6.4 秒，通过最终 renderer 校验，五段正文中文，两种参考角色和仅呼吸补充要求保留。见 `grok-multi-reference-optimize-result.json`、`grok-multi-reference-optimize-output.txt`。
- 本地首尾帧反推完整调用两张图片分析，再调用优化模型融合补充要求，总计 148.635 秒，未复用旧分析结果；通过最终 renderer 校验。见 `local-first-last-reverse-result.json`、`local-first-last-reverse-output.txt`。
- JS 专项 49 项通过；Grok reverse 和 prompt backend 两个合同套件分别通过。Python 视觉 109 项、优化 11 项、字段一致性 3 项通过。较旧的合同测试中，更新了中文策略文案断言和完整长输入保留断言，并补齐独立 VM 的共享依赖。
- 实际 bundle 组件测试覆盖 0/1/5/20 个保存槽位及 0/4/30 条历史的组合，最多 15 行，选择项始终回填超过 500 字的完整文本，存储数组不变。该测试在源码和安装包提取的 bundle 各执行一次。
- `check:runtime` 最终 PASS。云端 `novaflow-backend` v64 ACTIVE，见 `cloud-deployment.json`。
- `package-validation.json`：安装包中 15 个关键文件与源码逐个哈希一致；两个真实模型结果通过包内 renderer 校验，输入过期结果仍拒绝写入。

## 安装包与边界

`particle-editor-desktop/dist/NovaFlow Setup 2.3.214 - H3校验与历史15条修复.exe`

大小：250139346 字节。

SHA256：`81de596135da135d50e1064f700a8e17f22f57b707755dd935ff89154dd28ead`。

测试使用中性人物图片和呼吸待机提示词，未完整复测用户截图中的同组素材。安装包不会自动更新已打开的 Program Files 客户端。

`check:entry` 仍为 NO-GO：锁定的 4783 入口不可达，8188 直连可达，独立 AI effects takeover 项未完成。未完成已安装客户端真实界面点击验收，也未将此次模型调用通过表述为任意输入保证成功。

复核命令：`node tools/h3-semantic-fusion-package-check.mjs --history-15`；`node --test particle-editor-desktop/tests/prompt-history-display-limit.test.mjs`。实际模型工具沿用 `tools/h3-semantic-fusion-live.mjs --remaining-three --out=docs/h3-history-15-validation`，本地反推加 `--reverse`，Grok 多参加 `--grok`。
