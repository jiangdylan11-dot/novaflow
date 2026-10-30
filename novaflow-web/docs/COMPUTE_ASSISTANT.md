# 对外算力助手

Foart 的用户入口固定为 https://foart.net/ 。对外包运行
`worker/electron/compute-main.cjs`，不提供本地编辑器页面、工程关联或机器授权导入。
接入码确定节点所属账号；首次接入后保存设备独立身份，每次启动自动连接平台。
助手仍提供暂停连接和退出，暂停会停止当前节点运行；关闭窗口会留在托盘。

## 本机开发

`npm run dev` 保留原本地开发助手；`npm --prefix novaflow-web run assistant:start`
保留源码本机测试入口，其既有登录和授权要求不变。
`npm --prefix novaflow-web/worker run dev:compute` 运行新的对外界面。
新助手使用独立的 `Foart Compute` 用户目录，不改旧助手身份、配置及仓库。

## 算力机器设置

后台“算力池 → 机器设置”提供设备归属账号、启用机器、本人使用、对外分享、
共享池或指定账号列表。本人任务按所属账号匹配；这不是网页自动扫描硬件。
普通账号可在官网“我的算力”选择已开通的本人机器，无需开放对外分享。
使用他人节点仍遵循现有账号套餐和节点等级限制；计费规则未变。

`enabled` 与心跳状态独立。停用、关闭分享或撤销账号权限后，不再领取相关新任务；
已经执行的任务继续完成。本人的排队任务优先于他人任务，不抢占已运行的任务。
新 `compute-only` 节点默认本人使用开启、对外分享关闭；升级既有节点保留原权限。

## 部署依赖

1. 先应用 `supabase/migrations/20261030020000_compute_machine_policy.sql`。
2. 同步并部署更新后的控制面（包含 index.ts 适配器和共享模块）。
3. 按项目正式发布流程更新官网，并发布新后台管理和算力助手。

数据库迁移和控制面必须一起完成才能使用新权限。后台缺少迁移字段时会显示
升级提示而不假报保存成功；助手连接不支持新权限的旧控制面时会拒绝接任务，避免
意外作为公共节点运行。未更新的线上控制面不应作为新助手的功能验收环境。

## 打包及边界

`npm run build:win` 现在输出 `worker/dist-compute/FoartComputeSetup-<version>.exe`。
构建只准备 `compute-renderer` 白名单，不打包完整 `web-dist` 或 `worker-renderer`，
也不含 Spine 编辑器、自动骨架、自动网格等独立模块、本地网页服务和机器授权代码。
后台仍使用 `npm run admin:build`。构建产物和已安装/线上版本分别管理。

本阶段保留节点必需的工作流执行、提示词服务和运行环境。两个历史构建器
`novaflow-brand-runtime.js`、`spine-split-runtime.js` 仍含混合业务闭包，尚未完成核心
提取或加密，不应宣称“完全无核心代码”。实际执行的任务图、参数、输入和结果
在节点上仍可被设备所有者观察。后续加密和核心逻辑迁移另做。

## 验证

`npm --prefix novaflow-web run test:compute` 验证节点启动、无本地编辑服务、包白名单、
绘图/视频工作流图、用户权限和数据库领取策略；它使用本地模拟模型和测试数据库，
不替代真实 GPU 输出验收。`test:compute-ui` 和后台 `test:compute-ui` 用隔离夹具验证
真实 Electron 界面，不接生产账号。原入口仍执行根目录 `check:entry`。
