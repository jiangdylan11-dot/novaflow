# 账户分级与算力权限（2026-09-24）

## 规则

| 账户类型 | `users.plan` | 本机算力（本地助手“启动NovaFlow”） | 其他算力节点（正式站共享池） |
| --- | --- | --- | --- |
| 普通账户 | `trial`（默认） | 可用 | 不可用 |
| 高级账户 | `pro`、`team` | 可用 | 可用 |

- 账户类型只由后台管理「用户管理」设置：新建账号时选择，用户列表里可随时切换后「保存」。
- 本机算力不经过控制面：本地助手打开的页面把任务发给本机服务，因此普通账户不受影响。
- 共享池的唯一入口是控制面 `POST /api/web/tasks`。控制面按 `users` 表当前的 `plan` 判断，
  不看登录令牌里的旧值，后台改完立即生效，不需要用户重新登录。
- 普通账户在正式站提交任务时收到 403，`code` 为 `plan_required`，提示文字：
  「普通账户只能使用本机算力：请在本地助手点击“启动NovaFlow”后生成。使用其他算力节点需要高级账户。」
- `GET /api/web/me` 增加 `user.plan` 和 `compute.shared`；网页账户弹框在用户名下方显示账户类型和可用算力。
- 读取任务列表、LoRA 目录、结果取回不受账户类型限制。贡献算力节点（注册 Worker）也不受限制。

## 顶栏「AI 算力源」选择

- 顶栏原来的「AI 已连接 / 未连接」文字变成按钮（`renderer/novaflow-web-compute-node.js`）。
  点击弹出「选择 AI 算力源」，列出算力池里每台电脑：名称、显卡、显存，以及「空闲 / 忙碌 / 离线」。
- 第一行是默认来源：本地助手打开的页面为「本机」，正式站为「自动分配（任意空闲节点）」。
- 高级账户点某台电脑即固定到它：顶栏显示「已链接 AI-<节点名>」，该节点掉线时显示「AI-<节点名> 未连接」。
  之后每个任务都带 `target_worker_id`，能力探测带 `?worker=<id>`，只对这台电脑说话；选择记在本浏览器里，刷新后仍在。
- 普通账户也能看列表，但每一行都不可选，弹框底部提示：
  「普通账户只能使用本机算力。需要使用其他算力节点，请联系管理员开通高级账户。」
- 本地助手打开的页面选了别人的节点后，任务改走控制面（需要已登录的高级账户）；改回「本机」即恢复本机算力。
- 控制面：`GET /api/web/nodes`（需登录）返回 `nodes[]` 与 `compute.shared`，不含地址、密钥和归属。
  `POST /api/web/tasks` 接受 `target_worker_id`，不存在的节点返回 404；`GET /api/web/capabilities?worker=<id>` 只统计该节点。
- 调度：新迁移 `supabase/migrations/20260924010000_novaflow_web_task_target_worker.sql` 重建 `novaflow_web_claim_task`，
  固定到某节点的任务只有该节点能领取，其他节点跳过；未固定的任务行为不变。

## 改动位置

- `packages/shared/src/protocol.mjs`：`SHARED_COMPUTE_PLANS`、`canUseSharedCompute()`、错误码 `plan_required`。
- `packages/shared/src/control-plane.mjs`：`handleCreateTask` 拦截与 `target_worker_id`、`handleMe` 返回账户类型、
  `handleListNodes`、`handleCapabilities(query)`。
- `control-local/src/pg-store.mjs`、`supabase/functions/novaflow-web/index.ts`：`countCapableWorkers` 可按节点过滤、`listPoolWorkers()`。
- `control-local/src/db.mjs`、`server.mjs`：本地开发登录 `/dev/login` 接受 `plan`，默认 `pro`。
- `renderer/novaflow-web-runtime.js`：`computeNode` / `setComputeNode()` / `listComputeNodes()`，任务与能力探测带节点。
- `renderer/novaflow-web-compute-node.js`（新）：顶栏按钮与选择弹框；`renderer/novaflow-web-account.js`：账户弹框显示账户类型。
- `admin/license-admin-gui/index.html`、`renderer.js`：新建账号的账户类型选择、用户列表的账户类型列。
- `supabase/functions/novaflow-web/*`、`novaflow-web-bundle/index.ts`：由 `sync:edge`、`bundle:edge` 重新生成。

## 验证

- `node tests/run-tests.mjs control-plane security protocol sql-contract web-account web-compute-mode web-compute-node web-renderer-build`。
- `control-plane` 新增「account tiers」「算力源 picker」两段：trial 账户 403；节点列表不含地址与归属；
  固定到 B 节点的任务 A 节点领不到、B 节点能领到；不存在的节点 404；`capabilities?worker=` 只数一台。
- `web-compute-mode`：固定节点后任务体带 `target_worker_id`、能力探测带 `worker=`、刷新后仍在；本地页面固定远程节点后任务改走控制面。
- `web-compute-node`：顶栏文字三种状态、行数据、普通账户全部锁定并提示联系管理员。
- 浏览器实测（本地控制面 + 假节点池）：普通账户弹框全部灰显并提示联系管理员，点击不生效；
  高级账户选中 studio-5090 后顶栏显示「已链接 AI-studio-5090」，能力探测请求带 `?worker=<id>`。
- `npm run sync:runtime`、`npm run check:runtime`、`npm run check:entry`、`npm run admin:test`、`npm run verify:edge`。

## 上线

- 控制面：把 `supabase/functions/novaflow-web-bundle/index.ts` 重新部署到 Supabase Edge Function `novaflow-web`。
- 数据库：在 Supabase SQL 编辑器执行 `supabase/migrations/20260924010000_novaflow_web_task_target_worker.sql`；
  不执行时固定节点的任务仍会被任意空闲节点领走（只是不再按选择分配），其余功能正常。
- 网页：重新打包站点 zip 并上传 Cloudflare；本地助手重新 `npm run build:win`。
- 现有账户 `plan` 默认 `trial`，即上线后所有未升级账户都只能用本机算力；需要用共享池的账户在后台改成「高级」。
