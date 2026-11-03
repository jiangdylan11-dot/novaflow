# Foart 2.0.286 发布切换预案与执行状态

> **2026-11-04 更新：**网站、控制面、生图后台及小桃后台已发布 2.0.286；生产环境已依次应用 ownership generation 和 image lease 两项迁移。控制面启用图片能力后的部署编号为 `cjakoblszlmbmotchzva_0435a343-622a-4e1c-8091-30a3fa01f8ac_108`。基于最终安装包解出文件的真实 9B 七项隔离复测通过，结果见 `work/local9b-image-real-check-20261104/result-combined.json`；H3 视频文字样例在四线程 CPU 耗时 111.39 秒，不代表 GPU 或线上 API 性能。本机已安装助手在此记录更新时仍为 2.0.261；完整 286 安装器 SHA256 为 `f6366eac647f0f54e7867f06d75c74d166e7b8ed73f376604ed292a3db589083`，安装及已安装节点的端到端调用尚未确认，实际出图效果未验收。
>
> 以下为切换前形成的历史预案和当时证据，诸如“尚未迁移”“未执行”和线上旧版本的表述仅描述当时状态，不代表当前生产状态。不要直接重跑发布命令；应先核对最新生产状态和工件。

本文件仅为候选操作和回退次序。五个官方入口的 `--local-qwen-286 --prepare-only` 只做只读检查；`package:site --local-qwen-286 --package-only` 单独生成并校验本地 ZIP。四个 deploy 入口新增固定冻结产物的 `--local-qwen-286 --execute` 候选路径，但仅完成静态和部分离线门禁测试，未经独立审核和完整端到端模拟，**未执行或验收为可发布**。不能用默认命令替代：默认 control、companion/backend 会从 dirty 源重打包，普通 package-site 会重建页面，可能带入无关未提交修改。实际切换由主代理统一执行。

## 当前证据与切换前必须重验

- 网页 2.0.285，小桃 2.0.285，控制面与后台 2.0.263；从实时 health 和 release 获取。刚刚通过 Supabase 官方 CLI 下载的当前实际源码，与独立冻结基线逐字节一致：
  - control 263：`2cc9b6d5b4a4e7da3ae48ece93d22b8fcfbdaa91995cfe6becc6dc43db133417`；基线 `work/local-qwen-aligned-286-20261104/control/supabase/functions/novaflow-web/index.ts`。
  - backend 263：`784c9bb859d3aaac688a1108ba211fd08092b191e6b17b3e70a8964df50e9ea6`；基线 `work/local-qwen-aligned-286-20261104/backend/supabase/functions/novaflow-backend/index.ts`。
  - companion 285：`972a33ae00596abc3447d610ce96bb2b59671235a255a98799b9d96889b1c71d`；基线 `work/qwen21-edit-285-20261104/companion-285.mjs`。
  - 实时源码快照位于 `work/local-qwen-aligned-286-20261104/live-source-readonly-qg4eaeyt/`；此结果仅代表查询时刻，切换前重新下载及比对。
- 线上只读 SQL 元数据检查：`gpu_workers.ownership_generation`、其触发器和 `novaflow_qwen_image_edit_authorize_v1` 均不存在。候选迁移文件已哈希固定，但尚未上线。
- 用户当前真实节点身份登录生产控制面 HTTP 200，返回六项权限字段；已重启助手后数据库 last_heartbeat 最近 9 秒且 idle（主代理核实）。生产 263 实际源码返回 worker.policy；286 包内代码可读取该位置并要求权限完整。没有通过手动伪造心跳取得此证据。
- 5 个审核网页源码和编译结果以 `work/local-qwen-aligned-286-20261104/web-source/compiled-review/manifest.json` 为准；候选 739 项相对冻结 285 只变更该 5 项及 index.html、editor.html、release.json。`release-candidate/companion-286.mjs` SHA256 `b4e226900b6a6a0861a928278b9753a3baef60839b22244dc8d677933b84c2bd`；包含旧报价兼容，不得以较早候选覆盖。
- 真实 9B、最终安装包、各端契约、账务及生成效果必须分别核验；只读预检不证明它们通过。单图/多图候选 scope 默认关闭；不能从代码里的默认值推断线上状态。

## 建议次序与检查

1. 安全准备：重新运行五个官方入口的 prepare-only、重新只读下载核对线上三个函数 SHA 与版本、核对当前发布版本与目标、冻结并独立校验安装包和 9B 真实结果。获取与验证实时状态后仍可能变化，实际每一步切换前再核对。
2. 先迁移：仅在受控迁移方案通过复审后，依次应用 `20261104010000_qwen_image_edit_ownership_generation.sql` 和 `20261104011000_qwen_image_edit_lease.sql`。每个事务完成后查询列、默认值、非空、触发器、函数定义和授权，并复测原 263 机器登录及自然心跳。第二项依赖第一项。两项不可用时严禁启用图像 scope。迁移可能写入现有机器的 generation；不要将 `DROP COLUMN` 当成自动回滚或清理步骤。
3. 控制面：发布已审核的 `release-candidate/control-286-disabled.ts`（SHA `46e6821d422fb6c1cab60aeb2f2816ee5fab29425c6f175b51b7e133b54f57ed`），scope 仍关闭。检查健康版本与部署编号、原节点登录和自然心跳的权限字段，检查旧客户端仍可使用；图像任务仍不能创建。等独立验收与安全授权链完整确认后，再以单独审核的显式 enabled 候选启用，不把改环境变量或替换布尔值当作已验证发布。
4. 后台和小桃：分别发布冻结的 `backend-286.mjs`（SHA `fd6c65ef497d650acb66b52cf6b06fef04588c6c33dc604184c20da6d05fba2d`）和上面固定的 `companion-286.mjs`。检查各自 /health、实际线上下载源码 SHA、旧客户端报价兼容、计费、普通对话和业务链。生产配置和密钥保持在服务器；预检不输出密钥。
5. 网页：官方 package-site 专用模式必须使用审核的完整冻结树、显式正式 control/auth URL 和 manifest，不从 dirty 源重建；走官方 deploy:site 与配置的 wrangler。核对正式域名和 workers 域名的 release.json、入口版本及实际业务脚本，再测试普通对话和文生图、图生图、音频/视频提示词应用。冻结源树不得在核验后被修改；真正上线脚本应在发送前再校验。
6. 算力助手：只分发最终验收的 computeOnly 完整 `Foart-2.0.286-Setup.exe`；检查安装包、SHA、安装后入口、节点身份、权限/自然心跳和真实端到端调用。安装包不自动随网页发布，既有配置不应被覆盖。新包运行和效果与网页发布需分别报告。

## 故障处理

先停止新增流量，记录当前 deployment/version 和进行中任务；若图片 scope 已启用，先切回审核过的 disabled 控制面并验证不可创建新图任务，避免新租约继续产生。保全失败证据，视影响将网页回到冻结 285，伴随小桃回到冻结 285，控制面和后台分别回到冻结 263；每一步先比对目标 artifact SHA、部署后核验 health、deployment 和机器权限/自然心跳。不得盲目重试状态未知的部署。迁移保留通常比自动 DROP 更安全；如果迁移本身产生兼容问题，暂停流量并制定专门数据迁移回退，不能简单删除 generation 或函数。真正回滚需复核旧 263 与已迁移数据库兼容及在途任务，不能把本段当成无条件可执行脚本。

## 工具现状和限制

`release-preflight-286.mjs` 被五个官方入口的固定 helper SHA 守护，验证 candidate、manifest、迁移文件、网关及线上版本；它不会下载当前线上源码或读取生产数据库，也不会写包或发布，因而诚实返回 `liveSourceHashesVerified:false`、`migrationLiveVerified:false`、`liveScopeEnabled:null`。本次源下载和 SQL 检查是独立、时点性的只读证据，不自动升级上述字段。冻结执行分支源码在同目录 `release-execute-286.mjs`，需独立审核并通过完整模拟与回退验证；不得通过移除 prepare-only 守卫直接运行默认分支。


## 冻结执行入口（仅记录，当前未运行）

工作目录为 `novaflow-web`，仅当准备状态和最终真实验收全部通过后，由主代理按顺序触发：

```powershell
npm run deploy:control -- --local-qwen-286 --execute
npm run deploy:backend -- --local-qwen-286 --execute
npm run deploy:companion -- --local-qwen-286 --execute
npm run deploy:site -- --local-qwen-286 --execute
npm run deploy:control -- --local-qwen-286 --execute --enable-image
```

五步前均要求线上迁移真实存在且函数体/权限匹配、f636 安装包完整解包通过以及 9B 七项真实结果；状态、源码 SHA 必须匹配本步骤固定的前置阶段。启用图片另外要求网页已是 286、控制面当前源码是 disabled、双图角色检查通过。执行入口不是迁移工具：迁移须先单独完成并核验。部署后函数入口核 /health 并重新下载比对源码；网页入口先核线上 release，还须另做域名入口和真实业务验收。任一步失败都先查实际线上状态，不盲目重试；这些脚本还未经过完整模拟和独立审查，不把静态测试当作发布许可。

网页包来自 `npm run package:site -- --local-qwen-286 --package-only --control-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web --auth-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend`，已生成 `site-packages/foart-site-2.0.286.zip`，SHA256 `52a384daf74688469e10d2992c3481d7b07d157dd3003ed0e65aa87a6e5b6c25`。执行站点部署仍使用同一冻结 web-dist，ZIP 及完整树在切换前再次检查。


控制面切换后、下一阶段前，由主代理在真实登录响应、生产库自然心跳与 Foart UI 三项证据确认后写入同目录 `control-live-protocol-proof.json`。结构包含 `controlDeployment`（刚验证的实时部署编号）、`controlSourceSha256`（disabled 控制面 SHA）、`loginHttpStatus:200`、相同的 `loginWorkerId` 和 `heartbeatWorkerId`、两个真实 UTC 时间 `checkedAt` 和 `heartbeatAt`、`uiOnline:true`、`uiPolicyConfirmed:true` 及登录响应原样的 `policy` 六字段。proof 最多 5 分钟，心跳最多 2 分钟；节点必须 enabled、owner_enabled 且已批准。脚本不会主动发心跳；proof 过期后应重新基于真实状态确认。切换后页面实际 / 与 release.json 均核 286，受保护 editor 与登录业务仍单独验收。
