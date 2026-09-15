# H3 剩余三项问题修复与验证

2026-09-14，客户端 2.3.214。基于用户最新截图以及已安装客户端日志定位；没有将截图里的创作内容作为代码指令。模型测试使用现有中性赛博人物图片和普通呼吸待机场景。

## 修复

1. 本地首尾帧优化：移除“任意两阶段文字相同即失败”的校验。连续重复阶段合并为连续时间段，允许待机持续、起止姿态相同；仍通过整体内容优化检查拒绝复制原文和泛化填充。仅呼吸时要求胸肩微幅起伏，不附加抬头、转头或抬手。
2. 本地首尾帧反推：部分视觉字段缺失或不完整时，保留完整事实，对同一张图补看缺失字段一次；通过完整五字段检查后才能进入下一张图及后续生成。末尾可能截断的字段一并重看。缺少全部可信字段、补看仍失败、重复字段或其它视觉检查失败时仍不写回，不编造缺失事实。记录实际补看调用数。
3. Grok 多参优化：默认任务说明、描述、时间段和约束全部中文。移除英文概述例外；检测到成段英文时进入既有的一次修复重试。保留原台词、媒体标签和专名；明确要求英文输出时允许英文。任务中的内部英文模式名转换为中文显示。

## 证据

- `local-first-last-optimize-output.txt`：真实本地 3 秒首尾帧优化，仅呼吸待机，约 47 秒成功。
- `local-first-last-reverse-full-chain-result.json`：真实依次分析首帧和尾帧，再融合补充要求，完整链路约 140 秒。首次输出出现额外抬头，进一步收紧提示规则。
- `local-first-last-reverse-result.json`：最终复核复用相同输入的真实图片分析响应，重新实际调用融合模型。最终文本只描述胸肩微幅呼吸，保持头部、手臂与位置；`reusedStageOne` 明确区分本次复核与完整链路耗时。
- `grok-multi-reference-optimize-output.txt`：真实 Grok 两参考图优化，五段正文中文，保留人物外观与背景风格两种独立引用角色。
- `slot-recovery-result.json`：真实模型识别同一中性参考图后，故意移除 C 字段模拟截断，再实际调用模型补看一次，完整校验通过。共 2 次视觉调用，约 51 秒。原结果、故障注入文本及补看结果均保留。
- 单元及合同测试：JS 46 项、Python 优化 11 项、视觉合同 109 项全部通过。包含首帧补看后才处理尾帧、补看失败不编造结果、静止阶段重复、英文输出修复及中文请求的否定表达。
- 最终 `check:runtime` PASS；最终安装包解压的 12 个相关文件与当前源码哈希一致，三项真实结果通过安装包 renderer 校验。
- Grok 云端 `novaflow-backend` v63，ACTIVE。

## 安装包与验收边界

`particle-editor-desktop/dist/NovaFlow Setup 2.3.214 - H3首尾帧与中文修复.exe`

SHA256：`f902488d72f534fa6d84cc616a83def09cba301c08733c98bda35f47f4800664`

`package-validation.json` 包含文件哈希、三项案例、安装包 renderer 校验与过期结果拒绝检查。安装包不会自动更新当前已打开的 Program Files 客户端。

`check:entry` 仍为 NO-GO：4783 不可达，8188 直连成功，另有独立 AI effects takeover 集成项未完成。本轮未完成已安装客户端的真实界面点击验收，也不代表任意输入或最终视频生成质量得到保证。

复核工具：`tools/h3-semantic-fusion-live.mjs --remaining-three`；反推加 `--reverse`，Grok 多参加 `--grok`；`tools/h3-missing-slots-live.py` 执行真实缺字段恢复；`tools/h3-semantic-fusion-package-check.mjs --remaining-three` 核对安装包。
