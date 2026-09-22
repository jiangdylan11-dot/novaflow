# NovaFlow Web 架构

## 总体

```
                    浏览器 (NovaFlow Web)
                     │              │
        登录/积分     │              │  任务/调度/凭证
                     ▼              ▼
          novaflow-backend      novaflow-web            ← 两个 Edge Function
          （现有，未改动）        （新增）
                     │              │
                     └──────┬───────┘
                            ▼
                        Supabase
                  Auth · 用户 · 积分 · 任务队列 · Worker 注册表
                            │
                       任务分配（SQL 内完成）
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
        Worker-001      Worker-002      Worker-003
            │               │               │
      Gateway :8790   Gateway :8790   Gateway :8790   ← 外部唯一可达面
            │               │               │
      127.0.0.1:8188  127.0.0.1:8188  127.0.0.1:8188  ← ComfyUI，只绑回环
```

大文件**不经过 Supabase**：浏览器凭一次性凭证直连被分配到的 Worker 网关。

```
浏览器 ──(参考图 PUT)──> Worker Gateway ──> data/tasks/<id>/input/
浏览器 <──(结果 GET，支持 Range)── Worker Gateway <── data/tasks/<id>/output/
```

---

## 一份实现，两处部署

控制面的全部逻辑在 `packages/shared/src/control-plane.mjs`。它被两个地方引用：

| 部署 | 存储适配器 | 用途 |
| --- | --- | --- |
| `supabase/functions/novaflow-web/` | `SupabaseStore`（PostgREST `rpc()`） | 生产 |
| `control-local/src/server.mjs` | `PgStore`（PGlite 直连 SQL） | 开发与全部测试 |

两个适配器调用的是**同一批 SQL 函数**（迁移里定义的 `novaflow_web_*`）。
所以本地测试跑的是生产逻辑，不是仿制品。`npm run check:edge` 保证边缘函数目录里的
副本与源码逐字节一致，`protocol` 套件会断言这一点。

---

## 任务状态机

```
CREATED ──> QUEUED ──> ASSIGNED ──> UPLOADING ──> PROCESSING ──> COMPLETED
               │           │            │             │
               │           └────────────┴─────────────┘
               │                    （掉线重排）
               │                         ▼
               │                      QUEUED
               ▼
        CANCELLED / EXPIRED / FAILED
```

- 允许的迁移在两处定义：JS `TASK_TRANSITIONS` 与 SQL `novaflow_web_allows_transition()`。
  `protocol` 套件逐对（9×9＝81 对）比对两者，不一致就是测试失败。
- 每次迁移都写一行 `web_task_events`，带时间戳与执行者。
- 终态不可再迁移：重复取消会被拒（409），不是静默接受。
- 所有状态写入只有一个入口 `novaflow_web_update_task_status()`，非法迁移在数据库层被拒。

---

## 调度（V1）

`novaflow_web_claim_task()`，Worker 主动拉取：

1. Worker 必须 `idle`、心跳未超时、手上没有未完成任务。
2. 取 `status='queued'` 里**最早创建**的一条，且：
   - 该 Worker 的 `worker_models` 里对应 `model_id` 状态是 `ready`
   - `gpu_workers.vram_mb >= input_manifest.min_vram_mb`
3. `FOR UPDATE SKIP LOCKED` ＋ 单条语句内完成 `assigned` 更新。

两个 Worker 同时抢同一条时，输的一方看到的是「没有任务」，不是重复领取。
公平性来自「拉取」本身：空闲最久的 Worker 最先来问，自然就是 least-recently-served。
`gpu_workers.last_assigned_at` 已经记录，留给以后做更复杂的策略。

**没有做**（本次明确不做）：Kubernetes、Redis、自动扩容、复杂优先级。

---

## 算力池怎么变大

调度器不认识具体机器，只认「谁在心跳、显存够不够、模型 ready 没」。
所以加一台机器不需要改调度，也不需要任何人去改配置：

```
Owner 在 Web 顶栏点「算力节点」
   -> POST /api/web/workers/codes           发一个一次性码（库里只存 sha256）
新机器装 NovaFlowWorkerSetup.exe，填地址 + 码
   -> 自己生成 workerId / workerSecret       明文永不出这台机器
   -> POST /api/worker/register              码被消费，gpu_workers 落行
   -> 探 nvidia-smi / ComfyUI /system_stats   检测显卡与运行时
   -> POST /api/worker/models                worker_models 落行
   -> POST /api/worker/heartbeat 每 15s       状态 online
   -> POST /api/worker/claim 轮询             调度器开始派单
```

码是一次性的（`max_uses` 可调），过期时间可调，可吊销，
且抢不走一台已注册的机器——重新注册必须出示当前 secret，否则 409。
云 GPU、朋友的电脑和自己的电脑走的是同一条路径，没有哪一种要特殊对待。

---

## 掉线与恢复

`novaflow_web_sweep()`，可由 cron 或运维调用：

| 情况 | 处理 |
| --- | --- |
| 心跳超过 75 秒 | Worker → `offline`，不再分配任务 |
| 任务 `assigned` 超过 120 秒没动静 | 重新排队 |
| `processing` 超过 30 分钟无进度 | 重新排队 |
| 重试次数达到 3 次 | 标记 `failed` |

任务永远不会卡在 `processing`：要么被某个 Worker 推进，要么被 sweeper 收走。

**失败不扣分是结构性的**：扣费代码只存在于 `handleWorkerComplete` 一条路径上。
失败路径里没有任何调用扣费的代码，所以不是「记得不要扣」，而是「扣不了」。

---

## 积分

```
创建任务 ──> 服务端按参数定价 ──> 余额不足直接拒绝（402）
                                      │
                                      ▼
                              任务跑完（且只有跑完）
                                      │
                                      ▼
                    settle_comfy_usage(usage_key='comfyui:<prompt_id>')
                              现有生产函数，原样复用
                              幂等 + 原子（用户积分与供应商预算同步）
```

- 定价在 `packages/shared/src/pricing.mjs`，按 task_type × 分辨率 × 步数 × 数量（或时长）算。
- 浏览器发什么价格都无效：`priceTask()` 只读经过校验的业务参数。
  `protocol` 套件专门断言了这一点（塞 `creditCost:0`、`chargeAmount:0`、`free:true` 都没用）。
- Worker 只上报 `success/failed` 和执行元数据，碰不到金额。
- 重放完成请求不会二次扣费：`usage_key` 唯一。

---

## 文件传输与凭证

浏览器要碰 Worker，必须先向控制面换一张 `nfg_` 凭证：

```
POST /api/web/tasks/<id>/grant  {"op":"upload"|"download"}
 ↓
{ token, endpoint, expiresAt }
```

凭证里绑死 `{user, task, worker, op}`，并用**该 Worker 专属的派生密钥**签名
（`HMAC(control_secret, "…:" + worker_id)`）。所以：

- 换成另一个 task id → Worker 拒（403）
- 拿到别的 Worker 那里 → 签名对不上（403）
- 用下载凭证去上传 → op 不符（403）
- 过期 → 401

上传窗口 15 分钟，下载窗口 1 小时。

---

## Workflow 隔离

浏览器**永远拿不到 ComfyUI 图**。它只发业务参数：

```json
{ "task_type": "qwen_t2i",
  "parameters": { "prompt": "...", "width": 1024, "steps": 20, "count": 1 } }
```

Worker 自己按 `task_type` 选 `worker/workflows/<file>.json`，把参数注入**显式声明的绑定槽**：

```json
"bindings": { "prompt": { "node": "2", "input": "text" } }
```

绑定是声明式的（不是字符串占位符），好处有两个：模板本身是合法的 ComfyUI API 图，
可以直接粘进 ComfyUI 调试；未知参数不可能误入某个节点。
`protocol` 套件会检查每个绑定都指向真实存在的节点。

---

## Worker 网关

对外只开 `/gw/*`，且每个请求都要凭证：

| 路由 | 说明 |
| --- | --- |
| `GET /gw/health` | 存活探测，无需凭证 |
| `PUT /gw/tasks/<id>/input/<name>` | 上传参考图（upload 凭证） |
| `GET /gw/tasks/<id>/output/<name>` | 取结果（download 凭证），**支持 Range** |
| `GET /gw/tasks/<id>/preview/<name>` | 取中间预览（download 凭证） |

视频靠 Range 边下边播：请求 `bytes=0-99` 返回 206 + 正确的 `Content-Range`，
越界返回 416，后缀区间 `bytes=-50` 也正确。这几条在 `full-pipeline` 里对**真文件**验证过。

网关不代理任何 ComfyUI 端点。`/prompt`、`/queue`、`/view`、`/object_info` 等一律 404
（`security` 套件逐个断言）。

---

## 网络抽象

`gpu_workers.transport` 有 `direct` 与 `tunnel` 两种取值，`endpoint_url` 是普通字符串。
任务系统、文件系统、Worker 身份都不依赖固定公网 IP：换成隧道 URL 只是换一个
`endpoint_url`，没有任何业务逻辑需要改。

本次实际实现的是 `direct`。`tunnel` 是数据模型已经预留、但没有落地实现的那一半，
见 [LIMITATIONS.md](LIMITATIONS.md)。

---

## TTL 清理

Worker 每 15 分钟扫一次 `data/tasks/`：

| 类型 | 默认保留 |
| --- | --- |
| 输入 | 24 小时 |
| 图片结果 | 72 小时 |
| 视频结果 | 48 小时 |

过期就删文件，然后把受影响的 task id 报给控制面标记 `result_expired = true`。
任务记录保留，字节没了。之后再申请下载凭证会得到 410。
