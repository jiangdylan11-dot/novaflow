# 小桃 2.0.286 候选：隔离集成记录

## 2026-11-04 实际发布和验收状态

网站、控制面、生图后台和小桃后台已发布至 2.0.286；控制面已显式启用图片能力，最终部署编号为 `cjakoblszlmbmotchzva_0435a343-622a-4e1c-8091-30a3fa01f8ac_108`。生产数据库已依次应用 ownership generation 和 image lease 两项迁移。已使用真实 9B 模型从最终安装包解出的代码完成七项隔离复测，结果记录于 `work/local9b-image-real-check-20261104/result-combined.json`；四线程 CPU 下 H3 视频文字样例耗时 111.39 秒，不能代表 GPU 或线上 API 的性能。

线上 2.0.286 已实际验证普通对话，以及美工、视频、背景音乐和音效提示词直接更新到对应输入框；最终控制面 _108 上原 261 节点真实登录和自然心跳正常，权限字段完整。

本机安装的 Foart 算力助手目前仍为 2.0.261；2.0.286 完整安装器已构建且未签名，SHA256 为 `f6366eac647f0f54e7867f06d75c74d166e7b8ed73f376604ed292a3db589083`。此记录更新时，尚未确认 286 安装及已安装节点端到端业务验收，也不能据此认定实际出图效果已验收。

本目录保存文本补丁和迁移副本，供审阅与后续集成；补丁本身不代表所有端到端验收已完成。当前共享工作区存在其他未提交改动，不得直接全量覆盖。请先以对应基线执行 `git apply --check`，再根据实际文件状态局部合入；不要将自包含 bundle 补丁误当成仓库中拆分源码的补丁。

## 网页

`web-285-readable-to-286.patch` 是五个可读源码的完整文本增量，目标路径为 `novaflow-web/renderer/`。基线分别为 brand 的 `work/qa-art-web-unified-267-20261103/renderer`，art-agent 的 `work/qwen21-edit-284-20261104/source`，smart-ai、web-runtime、foart-tools 的 `work/qwen21-edit-283-20261104/source`。五个基线经过项目原有保护脱敏与 Terser 流程后均逐字节重现 `work/qwen21-edit-285-20261104/web-dist` 的 285 对应产物。实际在基线副本应用补丁后，五份源码均与隔离 `web-source` 目标换行归一化后完全一致；其中 brand 和 art-agent 原始字节也一致，另外三份只存在 CRLF/LF 差异。基线、目标的原始 SHA256 见 `provenance.json`；由目标源码重建并审核的五个产物哈希见 `work/local-qwen-aligned-286-20261104/web-source/compiled-review/manifest.json`。不要混入工作区其他未提交修改。

## 算力助手

`compute-261-to-286-f636.patch` 是完整安装版 261 的受影响文件到 f636 候选源码的精确增量，覆盖入口、worker、gateway、Python 和必要共享文件。已在 261 基线副本实际应用，13 个目标文件均与隔离构建 stage 字节完全一致；包含新 `qwen21_image_edit.py`。补丁实套后的 12 个运行文件与 f636 实际解包文件逐字节一致；构建器会从包内 package.json 移除 scripts 和 devDependencies，其余字段与补丁目标一致。该补丁并不包含整个安装包，也不单独覆盖构建用的 worker lock；统一版本及 lock 应结合实际工作区状态另行核验。

构建的未签名安装器 SHA256 为 `f6366eac647f0f54e7867f06d75c74d166e7b8ed73f376604ed292a3db589083`。以真实安装器双层解包得到的全载荷 227 文件中，156 位于 resources；完整清单和校验工具位于 `work/compute-286-scope-audit-20261104/installer-payload-f6366eac-sha256.json`、`verify-f636-payload.py`，不是发布包。禁止把旧 `0703b1ef…` 中间包作为最终候选。

## 控制面与在线小桃

`control-263-to-286-disabled.patch` 是 263 冻结自包含控制面入口到 286 已联调 disabled 候选的完整 bundle 差异，虚拟路径 `control-bundle/index.ts`。它默认关闭本地图生图能力；普通 Qwen plan 原有配置保留。`companion-285-to-286.patch` 是 285 冻结自包含在线小桃到 286 候选的 bundle 差异，虚拟路径 `companion-bundle/index.mjs`，含引号、参考图及兼容性校验修正。两者均在各自基线副本实际应用并与候选内容换行归一化后完全一致；控制面目标原始字节也一致。它们用于审阅和重建已验证的 bundle，并非拆分源码的直接提交补丁。

`20261104010000_qwen_image_edit_ownership_generation.sql` 和 `20261104011000_qwen_image_edit_lease.sql` 是对应迁移的文本副本，顺序分别为 ownership generation、lease。此前已在隔离 PGlite 中测试，现已应用于生产并核验相关列、触发器及函数授权。

## 验证与真实模型状态

隔离版 9B Python 合同回归 5 项、Node worker/gateway/入口及图片、H3、音频生命周期回归 23 项通过；对最终包实际解出模块，独立 gateway/verifier + 263 控制候选 + PGlite 及生命周期回归 6 项通过。Node 模拟模型桥使用 JSON 输出，真实 9B 纯文本原文另外由 Python 合同测试覆盖。

首次实际 9B 的中、英单图及双图三例输出为合理纯文本，但 JSON 门禁全部误拒；f636 候选已加入单段纯文本兼容并保留语言、题字及引用等校验。用户再次配合退出 Foart 后，基于最终包解出文件完成七项隔离 CPU 模型复测：中英单图、双图、文生图、H3 文字、音乐及音效均获得有效提示词；测试后 2.0.261 节点已重启并恢复在线。H3 样例耗时 111.39 秒，使用四线程 CPU、四次模型调用；这不能代表线上 API 的耗时。该测试不是已安装节点的完整网页链路，也没有验收实际出图或视频效果。

`run_isolated.py` 是合成素材复测脚本副本；发布预检、执行草案及其测试也在此留存供审阅。它们依赖 `work` 下固定路径和哈希，复制到此处不代表可直接运行。发布前的计划和限制见 `release-transition-plan-286.md`，实际进展以本节上方的状态为准。
