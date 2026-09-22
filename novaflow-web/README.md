# NovaFlow Web

NovaFlow 的 Web 产品线：浏览器端 + Supabase 控制面 + 分布式 GPU Worker。

普通用户只需要浏览器；不安装 NovaFlow、不安装 ComfyUI、不装 Python、不下模型、不需要显卡。
算力由装了 `NovaFlowWorkerSetup.exe` 的机器提供。

**这条产品线与稳定版 NovaFlow Desktop 物理隔离。** 它活在独立的 git worktree
（`D:\AI_APP\NovaFlow-Web`，分支 `feature/novaflow-web`）里，有自己的
`node_modules`、构建产物、配置和安装包。删掉整个目录，Desktop 照常运行。

---

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/shared/` | 协议、令牌、定价、模型清单、**控制面全部逻辑**（一份实现，两处部署） |
| `supabase/migrations/` | 纯增量迁移 + 回滚脚本 |
| `supabase/functions/novaflow-web/` | Supabase Edge Function（`packages/shared` 的部署外壳） |
| `control-local/` | 本地控制面：PGlite（真 PostgreSQL）跑真迁移，供开发与测试 |
| `web/` | 浏览器端 React + Vite 应用 |
| `worker/` | GPU Worker：Electron 界面 + 网关 + ComfyUI 执行器 + 模型管理 |
| `tests/` | 端到端测试（真数据库、真 HTTP、真 ComfyUI） |
| `docs/` | 架构、部署、Worker 安装、安全边界 |

---

## 快速开始（本地验收）

```bash
cd D:\AI_APP\NovaFlow-Web\novaflow-web && npm install
```

一条命令起全部（控制面 + 一台 Worker + Web）：

```bash
npm start
```

它会打印出要打开的地址（默认 <http://127.0.0.1:4892>），
点「本地验收登录」即可。Ctrl+C 全部停止。

想分开跑就用 `npm run control:dev`、`npm run web:preview`、
`node worker/src/main-headless.mjs`（Worker 的环境变量见 `docs/WORKER.md`）。

---

## 测试

```bash
npm test
```

十个套件，全部跑真组件：

| 套件 | 验证什么 |
| --- | --- |
| `protocol` | JS 与 SQL 状态机逐对一致、工作流绑定可解析、定价不可被客户端左右、边缘函数副本与源码同步 |
| `workflow-redaction` | 剥离后的模块逐函数差分回归（191 个辅助函数 × 5348 次探针，结果逐字节相同） |
| `web-renderer-build` | 浏览器那份全部能解析、没有任何图拓扑泄漏、能录的都能重放、Web 专用文件不进算力节点 |
| `sql-contract` | 迁移是纯增量的（真 PostgreSQL 前后快照对比）、回滚只删自己建的东西 |
| `control-plane` | 鉴权边界、调度、积分、失败不扣分、非法状态迁移被拒 |
| `security` | 越权取文件、过期令牌、跨用户访问、ComfyUI 不可外联、路径穿越 |
| `multi-worker` | 不重复领取、任务分散、离线跳过、掉线重排、恢复后继续接单 |
| `worker-onboarding` | 发码 → 新机器只凭码自注册 → 检测 GPU/ComfyUI/模型 → 心跳 → Online → 自动派单；以及一次性、吊销、抢占防护 |
| `renderer-workflow` | 浏览器只发意图，图由算力节点用 NovaFlow 自己的构建器造出来并送进真 ComfyUI |
| `full-pipeline` | 浏览器 → 控制面 → Worker → **真 ComfyUI 出图** → 网关 Range 下载 → 积分结算 → TTL 清理 |

`renderer-workflow` 和 `full-pipeline` 需要本机 ComfyUI；没有时它会明说跳过生成部分，不会假装通过。

---

## 算力池在哪管

在**桌面后台管理器**里（`particle-editor-desktop/license-admin-gui` 的 **算力节点** 页），
和授权、积分、用户并列。发一次性注册码、看在线节点、停用/恢复、吊销码，都在那儿。

Web 站点里没有任何算力配置入口——用户只看得到顶栏的「AI 已连接 / 未连接」，
那个状态读的是公开的 `/api/web/capabilities`，不用登录也准。

---

## 与稳定版的关系

- **复用**：登录/积分用现有 `novaflow-backend`；扣费用现有 `settle_comfy_usage` RPC。两者一行未改。
- **新增**：一个新的 Edge Function `novaflow-web`，五张新表，`novaflow_web_*` 命名空间的函数。
- **未动**：`users`、`credits`、`credit_logs`、`ai_providers`、`ai_models`、`ai_tasks`、
  `system_settings`、`licenses`、`comfy_usage_settlements` 的结构、数据、函数体。

验证：

```bash
npm run verify:stable
```

```bash
npm run test:sql
```

---

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构、数据流、状态机、调度、文件传输
- [docs/DEPLOY.md](docs/DEPLOY.md) — Supabase 迁移、Edge Function、Web 静态托管
- [docs/WORKER.md](docs/WORKER.md) — Worker 构建、安装、注册、模型清单
- [docs/SECURITY.md](docs/SECURITY.md) — 信任模型、令牌、权限边界
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) — 28 项验收清单的逐条结果
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — 已知限制与没做的事
