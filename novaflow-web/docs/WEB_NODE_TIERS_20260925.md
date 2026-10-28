# 账户三级与算力节点分级（2026-09-25）

在 [WEB_ACCOUNT_COMPUTE_TIERS_20260924.md](WEB_ACCOUNT_COMPUTE_TIERS_20260924.md) 的两级账户之上，账户分成三级，算力节点分成两级。

## 规则

| 账户类型 | `users.plan` | 本机算力 | 普通算力节点 | 高级算力节点 |
| --- | --- | --- | --- | --- |
| 普通账户 | `trial`（默认） | 可用 | 不可用 | 不可用 |
| 中级账户 | `standard` | 可用 | 可用 | 不可用 |
| 高级账户 | `pro`（历史 `team` 读作 `pro`） | 可用 | 可用 | 可用 |

| 节点等级 | `gpu_workers.tier` | 谁能用 |
| --- | --- | --- |
| 普通节点 | `standard`（默认） | 中级、高级账户 |
| 高级节点 | `premium` | 仅高级账户 |

- 节点等级由接入它的注册码决定（`web_worker_registration_codes.tier`），后台「算力节点」页可随时改；重新注册不会改变等级。
- 控制面 `POST /api/web/tasks`：普通账户仍收 403 `plan_required`；中级账户固定到高级节点收 403 `node_tier_required`。
  未固定的任务写入 `input_manifest.allow_premium_nodes`，`novaflow_web_claim_task` 让高级节点跳过中级账户的任务；
  `capableWorkers` 对中级账户只数普通节点。
- `GET /api/web/nodes` 每个节点带 `tier`，`compute` 带 `shared`（可用共享池）和 `premium`（可用高级节点）；`GET /api/web/me` 同样带 `compute.premium`。
- `POST /api/web/workers/codes` 接受 `tier`，返回值和 `GET /api/web/workers/codes` 都带 `tier`。
- 网页「选择 AI 算力源」弹框把节点分成「普通算力节点（中级及以上账户可用）」和「高级算力节点（仅高级账户可用）」两组，
  中级账户的高级节点灰显，点击提示升级；「自动分配」对中级账户写明只落到普通节点。账户弹框显示三级文案。
- 后台管理：用户管理的账户类型多了「中级」；算力节点表可改节点等级、可删除离线或已停用的节点；
  注册码表显示等级、已失效的可删除、可一键清理；使用记录可按天数清理已完成的旧记录；
  生成注册码时可选普通 / 高级；仪表盘「最近活动」显示算力节点上的生成记录；「积分管理」改名「会员管理」，积分和提示词次数合成一张表，提示词次数支持增加 / 扣减 / 设置。

## 改动位置

- `packages/shared/src/protocol.mjs`：`PLAN_TIERS`、`normalizePlan()`、`canUsePremiumNodes()`、`NODE_TIERS`、`normalizeNodeTier()`、`planAllowsNode()`、错误码 `node_tier_required`。
- `packages/shared/src/control-plane.mjs`：注册时按注册码写节点等级、建任务时的等级拦截与 `allow_premium_nodes`、节点列表与 `/me` 的 `compute.premium`、注册码的 `tier`。
- `control-local/src/pg-store.mjs`、`supabase/functions/novaflow-web/index.ts`：`setWorkerTier()`、`countCapableWorkers(..., allowPremium)`、注册码读写带 `tier`。
- `supabase/migrations/20260925010000_novaflow_web_node_tiers.sql`：两张表加 `tier` 列并重建 `novaflow_web_claim_task`。
- `renderer/novaflow-web-compute-node.js`、`renderer/novaflow-web-account.js`：弹框分组与三级文案。
- `admin/license-admin-gui/*`：后台改动。

## 验证

- `node tests/e2e/control-plane.test.mjs`：新增「node tiers」一段：注册码带等级、节点按码入池、中级账户固定高级节点被拒、
  自动分配只落普通节点、高级节点跳过中级任务、重新注册不降级。
- `node tests/e2e/sql-contract.test.mjs`、`web-compute-node.test.mjs`、`web-account.test.mjs`、`web-compute-mode.test.mjs`、`protocol.test.mjs`。
- `npm run admin:test`。

## 上线

1. Supabase SQL 编辑器执行 `supabase/migrations/20260925010000_novaflow_web_node_tiers.sql`（不执行时控制面写 `tier` 会失败：先跑迁移再部署函数）。
2. 重新部署 `supabase/functions/novaflow-web-bundle/index.ts` 到 Edge Function `novaflow-web`。
3. 重新打包站点 zip 上传 Cloudflare；本地助手 `npm run build:win`；后台管理 `npm run admin:build`。
4. 现有节点等级全部为普通；需要标记为高级的节点在后台「算力节点」页改。现有账户等级不变。
