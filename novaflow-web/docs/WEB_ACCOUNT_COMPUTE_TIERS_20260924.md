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

## 改动位置

- `packages/shared/src/protocol.mjs`：`SHARED_COMPUTE_PLANS`、`canUseSharedCompute()`、错误码 `plan_required`。
- `packages/shared/src/control-plane.mjs`：`handleCreateTask` 拦截、`handleMe` 返回账户类型。
- `control-local/src/db.mjs`、`server.mjs`：本地开发登录 `/dev/login` 接受 `plan`，默认 `pro`。
- `renderer/novaflow-web-runtime.js`、`renderer/novaflow-web-account.js`：账户弹框显示账户类型。
- `admin/license-admin-gui/index.html`、`renderer.js`：新建账号的账户类型选择、用户列表的账户类型列。
- `supabase/functions/novaflow-web/*`、`novaflow-web-bundle/index.ts`：由 `sync:edge`、`bundle:edge` 重新生成。

## 验证

- `node tests/run-tests.mjs control-plane security protocol web-account web-compute-mode web-renderer-build`。
- `control-plane` 新增「account tiers」段：trial 账户 403、任务列表仍可读、改成 pro 后同一令牌立即可建任务、team 视为高级。
- `npm run sync:runtime`、`npm run check:runtime`、`npm run check:entry`、`npm run admin:test`、`npm run verify:edge`。

## 上线

- 控制面：需要把 `supabase/functions/novaflow-web-bundle/index.ts` 重新部署到 Supabase Edge Function `novaflow-web`；部署前线上不会拦截。
- 网页：重新打包站点 zip 并上传 Cloudflare；本地助手重新 `npm run build:win`。
- 现有账户 `plan` 默认 `trial`，即上线后所有未升级账户都只能用本机算力；需要用共享池的账户在后台改成「高级」。
