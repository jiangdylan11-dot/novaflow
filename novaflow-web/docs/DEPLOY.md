# 部署

三块：数据库迁移、Edge Function、Web 静态站点。测试阶段都不需要域名、VPS 或 GPU 云。

> **重要**：本项目**没有**对生产数据库执行任何迁移，也**没有**部署任何 Edge Function。
> 构建机上没有 service-role key、没有数据库密码、没有登录过的 Supabase CLI。
> 下面是你要执行的步骤，每一步都在真 PostgreSQL 上验证过语法与效果
> （见 `npm run test:sql`），但**生产库的现状仍然是未改动的**。

---

## 1. 数据库迁移

项目：`cjakoblszlmbmotchzva`（NovaFlow）

### 1.1 先审计（可选但建议）

```sql
select table_name from information_schema.tables where table_schema = 'public' order by 1;
```

确认 `users`、`credits`、`system_settings`、`comfy_usage_settlements` 存在，
以及 `settle_comfy_usage` 函数存在。迁移开头的断言块也会替你检查一遍，不满足就直接报错回滚。

### 1.2 应用

只有一个文件要跑：

```
supabase/migrations/20260922010000_novaflow_web_worker_fabric.sql
```

方式 A — Supabase SQL Editor：整个文件粘进去执行（它自带 `begin; … commit;`）。

方式 B — CLI：

```bash
supabase db execute --file novaflow-web/supabase/migrations/20260922010000_novaflow_web_worker_fabric.sql
```

### 1.3 它做了什么

**新增 5 张表**，全部启用并强制 RLS，对 `anon`/`authenticated` 显式 deny-all：

| 表 | 用途 |
| --- | --- |
| `gpu_workers` | Worker 注册表：身份、硬件、状态、心跳、端点 |
| `worker_models` | 每台 Worker 的模型能力（ready/missing/invalid/updating） |
| `web_ai_tasks` | Web 线的任务队列与状态机 |
| `web_task_events` | 只增不改的状态迁移日志 |
| `web_worker_registration_codes` | 一次性注册码 |

**新增 10 个函数**，全部在 `novaflow_web_*` 命名空间，只授权给 `service_role`。

**没有动**：`users`、`credits`、`credit_logs`、`ai_providers`、`ai_models`、
`ai_tasks`、`system_settings`、`licenses`、`comfy_usage_settlements`
—— 结构、数据、函数体、索引、策略全部原样。这一点由 `npm run test:sql`
在真 PostgreSQL 上做前后快照对比证明。

### 1.4 回滚

```
supabase/migrations/rollback_novaflow_web_worker_fabric.sql
```

只删它自己建的东西，不碰 `settle_comfy_usage`，不碰任何既有表。
测试套件每次都会验证回滚后受保护的表逐字节不变。

### 1.5 那个可选的 ai_tasks 迁移

`20260922020000_novaflow_web_optional_ai_tasks_bridge.sql` **不要现在跑**。
它是给 `ai_tasks` 加列的方案，但我们无法确认那张表的现状和写入方，
所以按规则改用了 Web 专用表。文件顶部写了要先做哪些审计。

---

## 2. Edge Function

### 2.1 同步共享源码

```bash
cd novaflow-web && npm run sync:edge
```

Supabase 只打包函数自己的目录，所以 `packages/shared/src/*.mjs` 需要复制进去。
这是复制而不是第二份实现，`npm run check:edge` 会验证副本与源码一致。

### 2.2 设置密钥

```bash
supabase secrets set NOVAFLOW_WEB_CONTROL_SECRET="$(openssl rand -base64 48)"
```

`NOVAFLOW_SESSION_SECRET` **必须与现有 `novaflow-backend` 用的是同一个值**
——这正是 Desktop 账号能直接登录 Web 的原因。如果它已经作为项目级 secret 存在，
新函数会自动继承；否则显式设一遍同样的值。

`SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY` 由平台注入。

### 2.3 部署

```bash
supabase functions deploy novaflow-web --project-ref cjakoblszlmbmotchzva --no-verify-jwt
```

`--no-verify-jwt` 是必须的：这个函数用的是 NovaFlow 自己的 `nfs_`/`nfw_` 令牌体系，
和现有 `novaflow-backend` 一致（它的 `config.toml` 里也是 `verify_jwt = false`）。

### 2.4 验证

```bash
curl https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web/health
```

应返回 `{"ok":true,"service":"novaflow-web-control","protocol":1,...}`。

### 2.5 定时清理（可选）

给 sweeper 配一个 cron（Supabase Scheduled Functions 或任何外部定时器），
每 1–2 分钟打一次：

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/novaflow-web/api/maintenance/sweep \
  -H "Authorization: Bearer $NOVAFLOW_WEB_CONTROL_SECRET" \
  -H "content-type: application/json" -d '{}'
```

不配也能用，只是掉线的任务要等到有人调用才会被重排。

---

## 3. Web 站点

### 3.1 构建

```bash
cd novaflow-web/web && npm ci && npm run build
```

产物在 `novaflow-web/web/dist/`，纯静态：`index.html` ＋ 一个 JS ＋ 一个 CSS，
约 245 KB / gzip 77 KB。没有服务端运行时，不绑定任何一家托管商。

### 3.2 配置

构建时读环境变量（`.env.local` 或托管商的构建环境）：

```bash
VITE_NOVAFLOW_CONTROL_URL=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web
VITE_NOVAFLOW_AUTH_URL=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend
```

控制面地址不是 `127.0.0.1` 时，「本地验收登录」按钮自动消失。

### 3.3 部署到免费静态托管

产物是一堆静态文件，任何静态托管都行。SPA 需要把所有路径重写到 `index.html`。

**Cloudflare Pages**

```bash
npx wrangler pages deploy web/dist --project-name novaflow-web
```

**Netlify**

```bash
npx netlify deploy --dir=web/dist --prod
```

`web/dist/_redirects` 需要一行 `/*  /index.html  200`（构建后手动加，或用下面的 vercel.json 等价物）。

**Vercel**

在 `web/` 下放 `vercel.json`：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

然后 `npx vercel --prod`。

**GitHub Pages**：把 `web/dist` 推到 `gh-pages` 分支即可。`vite.config.ts` 里
`base: './'` 用的是相对路径，所以放在子路径下也能用。

**本地/局域网**：`npm run web:preview` 就是一个静态服务器。

> 注意：仓库根目录已有的 `vercel.json` 属于**稳定版 Desktop 线**（它指向
> `particle-editor/`），本次一个字没改。Web 线要自己的配置文件。

### 3.4 CORS

Edge Function 和 Worker 网关都返回 `Access-Control-Allow-Origin: *`，
且从不使用 `credentials: true`——授权来自 Bearer 令牌和一次性凭证，不来自 Cookie，
所以不存在跟着请求走的环境凭证。站点放在哪个域名下都能用。

---

## 4. 部署顺序

1. 跑迁移（Desktop 此时完全不受影响，新表只是多出来没人用）
2. 部署 `novaflow-web` 函数
3. 至少让一台 Worker 上线（见 [WORKER.md](WORKER.md)）
4. 部署 Web 站点
5. 打开站点，用 NovaFlow 账号登录，跑一次生成

任何一步出问题，回滚都是独立的：删函数不影响表，跑回滚脚本不影响 Desktop。
