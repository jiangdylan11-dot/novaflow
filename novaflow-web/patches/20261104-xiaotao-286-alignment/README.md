# 小桃 2.0.286 候选：隔离集成记录

本目录只保存文本补丁和迁移副本，供审阅与后续集成；不代表候选已部署或验收完成。当前共享工作区存在其他未提交改动，不得直接全量覆盖。请先以对应基线执行 `git apply --check`，再根据实际文件状态局部合入；不要将自包含 bundle 补丁误当成仓库中拆分源码的补丁。

## 网页

`web-285-readable-to-286.patch` 是五个可读源码的完整文本增量，目标路径为 `novaflow-web/renderer/`。基线分别为 brand 的 `work/qa-art-web-unified-267-20261103/renderer`，art-agent 的 `work/qwen21-edit-284-20261104/source`，smart-ai、web-runtime、foart-tools 的 `work/qwen21-edit-283-20261104/source`。五个基线经过项目原有保护脱敏与 Terser 流程后均逐字节重现 `work/qwen21-edit-285-20261104/web-dist` 的 285 对应产物。实际在基线副本应用补丁后，五份源码均与隔离 `web-source` 目标换行归一化后完全一致；其中 brand 和 art-agent 原始字节也一致，另外三份只存在 CRLF/LF 差异。基线、目标的原始 SHA256 见 `provenance.json`；由目标源码重建并审核的五个产物哈希见 `work/local-qwen-aligned-286-20261104/web-source/compiled-review/manifest.json`。不要混入工作区其他未提交修改。

## 算力助手

`compute-261-to-286-f636.patch` 是完整安装版 261 的受影响文件到 f636 候选源码的精确增量，覆盖入口、worker、gateway、Python 和必要共享文件。已在 261 基线副本实际应用，13 个目标文件均与隔离构建 stage 字节完全一致；包含新 `qwen21_image_edit.py`。补丁实套后的 12 个运行文件与 f636 实际解包文件逐字节一致；构建器会从包内 package.json 移除 scripts 和 devDependencies，其余字段与补丁目标一致。该补丁并不包含整个安装包，也不单独覆盖构建用的 worker lock；统一版本及 lock 应结合实际工作区状态另行核验。

构建的未签名安装器 SHA256 为 `f6366eac647f0f54e7867f06d75c74d166e7b8ed73f376604ed292a3db589083`。以真实安装器双层解包得到的全载荷 227 文件中，156 位于 resources；完整清单和校验工具位于 `work/compute-286-scope-audit-20261104/installer-payload-f6366eac-sha256.json`、`verify-f636-payload.py`，不是发布包。禁止把旧 `0703b1ef…` 中间包作为最终候选。

## 控制面与在线小桃

`control-263-to-286-disabled.patch` 是 263 冻结自包含控制面入口到 286 已联调 disabled 候选的完整 bundle 差异，虚拟路径 `control-bundle/index.ts`。它默认关闭本地图生图能力；普通 Qwen plan 原有配置保留。`companion-285-to-286.patch` 是 285 冻结自包含在线小桃到 286 候选的 bundle 差异，虚拟路径 `companion-bundle/index.mjs`，含引号、参考图及兼容性校验修正。两者均在各自基线副本实际应用并与候选内容换行归一化后完全一致；控制面目标原始字节也一致。它们用于审阅和重建已验证的 bundle，并非拆分源码的直接提交补丁。

`20261104010000_qwen_image_edit_ownership_generation.sql` 和 `20261104011000_qwen_image_edit_lease.sql` 是对应现有候选迁移的文本副本，顺序分别为 ownership generation、lease。仅在隔离 PGlite 中测试；本记录不代表生产已迁移或已启用该能力。

## 验证与真实模型状态

隔离版 9B Python 合同回归 5 项、Node worker/gateway/入口及图片、H3、音频生命周期回归 23 项通过；对最终包实际解出模块，独立 gateway/verifier + 263 控制候选 + PGlite 及生命周期回归 6 项通过。Node 模拟模型桥使用 JSON 输出，真实 9B 纯文本原文另外由 Python 合同测试覆盖。

首次实际 9B 的中、英单图及双图三例输出为合理纯文本，但 JSON 门禁全部误拒；当前 f636 候选已加入单段纯文本兼容并保留语言、题字及引用等校验。首次测试前用户已配合退出本机运行的 Foart 2.0.261 算力助手，测试后节点已重启。当前修复版完整七项真实复测仍需用户再次在系统托盘右键 Foart → 退出 Foart，之后才能进行；不得把模拟回归视为真实模型或出图效果验收。

`run_isolated.py` 是待执行的合成素材复测脚本副本；发布预检、执行草案及其测试也在此留存供审阅。它们依赖 `work` 下固定路径和哈希，复制到此处不代表可直接运行，更不代表已执行迁移或部署。完整顺序和限制见 `release-transition-plan-286.md`。
