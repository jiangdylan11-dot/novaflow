# 验收清单逐条结果

测试命令：`npm test`（十个套件，481 项断言，0 失败）。
结果文件：`novaflow-web/.artifacts/test-results.json`。

| 套件 | 断言 | 耗时 |
| --- | --- | --- |
| protocol | 74 | 1.8s |
| workflow-redaction | 94 | 0.6s |
| web-renderer-build | 40 | 12.3s |
| sql-contract | 37 | 1.6s |
| control-plane | 48 | 1.8s |
| security | 42 | 1.7s |
| multi-worker | 28 | 13.8s |
| worker-onboarding | 48 | 2.7s |
| renderer-workflow | 28 | 6.5s |
| full-pipeline | 42 | 25.5s |
| **合计** | **481 passed / 0 failed** | |

---

## 二十六、测试要求（28 项）

| # | 项目 | 结果 | 在哪验证的 |
| --- | --- | --- | --- |
| 1 | Web 正常启动 | ✅ | 生产构建 245 KB / gzip 77 KB；浏览器实测打开、登录、生成 |
| 2 | Supabase 登录 | ⚠️ 部分 | 会话令牌验证与现有 `novaflow-backend` 逐字节兼容；本地用同格式令牌全链路验证。**未用真实生产账号登录过**（构建机无凭据） |
| 3 | credits 读取 | ✅ | `control-plane`、`full-pipeline`；浏览器显示 1000 → 999.4 |
| 4 | 创建 ai_task | ✅ | `control-plane`、`full-pipeline`（用 `web_ai_tasks`，见下方说明） |
| 5 | Worker 注册 | ✅ | `control-plane`、`multi-worker`、`full-pipeline`；整条接入闭环在 `worker-onboarding` 48 项 |
| 6 | Worker heartbeat | ✅ | 同上；超时判定在 `multi-worker` 里实测 |
| 7 | GPU 检测 | ✅ | `full-pipeline` 真调 `nvidia-smi`，识别出 RTX 4090 Laptop / 16376 MB |
| 8 | Model capability 上报 | ✅ | 真问本机 ComfyUI `/object_info`，两个模型都报 ready |
| 9 | Task 自动分配 | ✅ | `full-pipeline`、`multi-worker` |
| 10 | Browser → Worker 文件上传 | ✅ | 网关 PUT + 凭证校验（`security`、`full-pipeline`）；浏览器端 XHR 带进度 |
| 11 | Worker → ComfyUI 执行 | ✅ | `full-pipeline` 真跑本机 ComfyUI 0.24.1 |
| 12 | ComfyUI 结果获取 | ✅ | 同上，取回真实 PNG |
| 13 | Worker 进度上报 | ✅ | `full-pipeline` 断言运行中确实收到过 >0 的进度 |
| 14 | 实时更新 Web | ⚠️ 用轮询 | 1 秒轮询控制面，不是 Supabase Realtime。理由见下 |
| 15 | Web 图片预览 | ✅ | 浏览器实测显示生成图 |
| 16 | Web 视频 Range 播放 | ✅ | Range 语义对**真文件**验证：206 / `Content-Range` / 后缀区间 / 416 越界。视频元素按 Range 播放已接线，**未用真实 H3 视频跑通** |
| 17 | 结果下载 | ✅ | `full-pipeline` 取回 285,919 字节 PNG；UI 有下载按钮 |
| 18 | TTL 清理 | ✅ | `full-pipeline`：删文件 → 标记 `result_expired` → 再申请凭证得 410 |
| 19 | Worker 掉线 | ✅ | `multi-worker`：心跳失效 → offline → 拒绝派单 |
| 20 | Worker 恢复 | ✅ | `multi-worker`：恢复心跳 → 重新接单 |
| 21 | Task 失败 | ✅ | `control-plane`：失败路径、Worker 释放 |
| 22 | Credits 失败不误扣 | ✅ | `control-plane` 余额前后相等；`multi-worker` 掉线重试后只结算一次 |
| 23 | 两 Worker 调度 | ✅ | `multi-worker` 28 项；另有真实双节点实测（见下） |
| 24 | Unauthorized 文件访问拒绝 | ✅ | `security`：无凭证 401、伪造 403、他人 Worker 凭证 403 |
| 25 | 过期 Token 拒绝 | ✅ | `security`：过期凭证 401、过期 Worker 令牌 401 |
| 26 | 其他用户 Task 访问拒绝 | ✅ | `security`：读/换凭证/取消/列表全部 404 |
| 27 | ComfyUI 公网不可访问 | ✅ | `security`：非回环地址拒绝启动；网关 7 条 ComfyUI 路由全 404 |
| 28 | Stable NovaFlow 没有任何变化 | ✅ | `npm run verify:stable` 8/8；`npm run test:sql` 37/37 |

---

## 真实双节点实测

两个独立 Worker 进程同时在线，其中 **worker B 跑的是安装包解包后的目录**
（`dist/win-unpacked/resources/app`），不是源码目录：

```
local-4090       idle   RTX 4090 Laptop 16GB   http://127.0.0.1:8790
packaged-node    idle   RTX 4090 Laptop 16GB   http://127.0.0.1:8791
```

提交两个任务：

```
task f0a75167 | completed | worker 369d20d6 | charged 0.6 | out_0001.png
task 0089b0f0 | completed | worker 99be6302 | charged 0.6 | out_0001.png

distinct workers used: 2
```

两个任务落在两台不同的 Worker 上，各自完成，各扣 0.6。

---

## 接入一台新算力机（实测，2026-09-22）

这条链路是分开做的两件事：**在浏览器里发码**，和**在一台机器上只凭这个码上线**。
中间没有任何一步碰过数据库、IP、`.env` 或源码。

1. `http://127.0.0.1:4892` 顶栏点 **算力节点** → 面板显示「还没有算力节点」
2. 备注填 `laowang-4090` → 点 **生成注册码** → 拿到 `NFW-VZ8MUT-2K2SW2`，
   下面写着「只显示这一次，请立刻复制。一次性使用，2026/9/29 12:43:01 过期。」
3. 另一台机器上只给两样东西——控制面地址和这个码：

   ```
   NOVAFLOW_WEB_CONTROL_URL=http://127.0.0.1:4890
   NOVAFLOW_WORKER_REGISTRATION_CODE=NFW-VZ8MUT-2K2SW2
   ```

4. 它自己完成了剩下的全部：

   ```
   [worker] gateway listening  {"port":8791,"endpoint":"http://127.0.0.1:8791"}
   [worker] registered         {"gpu":"NVIDIA GeForce RTX 4090 Laptop GPU","vramMb":16376}
   [worker] models reported    {"ready":["qwen-image-2511","minimax-h3"]}
   NovaFlow Compute Node online
   ```

5. 面板（8 秒一刷）随即长出一行：
   `laowang-4090 · NVIDIA GeForce RTX 4090 Laptop GPU · 16GB · ComfyUI 0.24.1 · 完成 0 / 失败 0 · 空闲`，
   顶栏同时从「AI 未连接」变成 **「AI 已连接」**
6. 从页面下单一张 512×512：调度器自己把它派给这台新机器，
   `[worker] task completed {"outputs":1,"ms":18578}`
7. 浏览器凭 `nfg_` 短期凭证从**这台 Worker 的网关**取回 317,267 字节 PNG
   （无凭证同一 URL 返回 401），积分 100000 → **99999.4**，正好 0.6
8. 面板那一行变成 `完成 1 / 失败 0`

一次性、吊销、过期、以及「别人拿码抢不走已注册的机器」这些边界，
由 `worker-onboarding` 套件的 48 条断言覆盖。

### 第二台：直接用安装包的产物

同一块面板再发一个码 `NFW-3EA8M2-FTVXTJ`，交给**安装包解包出来的目录**
（`worker/dist/win-unpacked/resources/app`，不是源码目录）：

```
[worker] registered      {"gpu":"NVIDIA GeForce RTX 4090 Laptop GPU","vramMb":16376}
[worker] models reported {"ready":["qwen-image-2511","minimax-h3"]}
NovaFlow Compute Node online   gateway http://127.0.0.1:8792
```

面板随即是两行：

```
laowang-4090             RTX 4090 Laptop 16GB  ComfyUI 0.24.1  完成 1 / 失败 0  空闲
packaged-installer-node  RTX 4090 Laptop 16GB  ComfyUI 0.24.1  完成 0 / 失败 0  空闲
```

安装包 `NovaFlowWorkerSetup.exe` 78 MB，随包带 97 个 NovaFlow 构建器模块；
浏览器那三个 Web 专用文件（runtime / capabilities / 算力节点面板）不在里面——
`web-renderer-build` 套件专门盯着这一条，因为其中的 runtime 会覆盖
`runtimeRequestJson`，而算力节点恰恰要用它去读本机 ComfyUI 的节点目录。

---

## 需要说明的三项

### #2 生产账号登录

Web 的登录直接打现有 `novaflow-backend` 的 `POST /api/auth/login`，一行没改。
会话令牌 `nfs_<base64url(payload)>.<hmac>` 的构造与校验与该后端**逐字节一致**
（`control-local` 里签的令牌就是用同一套代码，控制面用同一套代码验）。

但构建机上没有任何真实用户的账号密码，所以**没有用生产账号实际登录过一次**。
这一步需要你自己验：部署后用你的 NovaFlow 账号登录，如果 `NOVAFLOW_SESSION_SECRET`
在两个函数间一致，就能通。

### #14 用轮询而不是 Realtime

Supabase Realtime 要求浏览器持有 anon key，并且订阅的表对浏览器可读。
本项目的数据面是 **service-role-only**（沿用 Desktop 的 `final_service_role_only`
加固方案），给浏览器开表读权限会把那道加固撕开一个口子。

所以改成 1 秒轮询控制面。代价是每个运行中的任务每秒一个小请求；
换来的是数据面边界完好。`WebRuntime.watchTask()` 的接口就是一个 Realtime
实现该满足的形状，将来要换只动这一个方法。

### #4 用 web_ai_tasks 而不是扩展 ai_tasks

规格要求给 `ai_tasks` 加列。**没有这么做**，原因是无法确认那张表：
构建机没有 service-role 访问权，线上 `novaflow-backend` 自报
`writesTaskRecords: false` 且从不查询 `ai_tasks`，仓库里也没有任何迁移创建它。

既定规则是「无法确认对 Desktop 是否安全，就改用 Web 专用表」，所以 Web 线用
`public.web_ai_tasks`。加列的方案完整写在
`20260922020000_novaflow_web_optional_ai_tasks_bridge.sql` 里，默认不执行，
文件顶部列出了要先做的四步审计。
