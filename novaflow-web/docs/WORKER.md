# NovaFlow GPU Worker

一台提供算力的机器上跑的程序。它注册自己、上报硬件与模型、领任务、调本机 ComfyUI、
把结果交给浏览器。

## 安装包

```
novaflow-web/worker/dist/NovaFlowWorkerSetup.exe    （78 MB）
```

构建：

```bash
cd novaflow-web/worker && npm ci && npm run build:win
```

NSIS 安装器，非一键（可选安装目录），装到当前用户目录，中文界面，
建桌面与开始菜单快捷方式。卸载不删用户数据。

## 前提：这个安装包不含 AI 运行时，也不含模型

它只有 78 MB，里面是 Worker 程序 + NovaFlow 自己的图构建器 + 文件网关。
**ComfyUI、Python、CUDA、模型权重都不在里面。** 一台新机器还需要：

| 东西 | 体积 | 从哪来 |
| --- | --- | --- |
| ComfyUI + Python + CUDA | 约 7.5 GB | NovaFlow 桌面版的 AI 运行时（`C:\ProgramData\NovaFlow\AI-Runtime\engine`），或者对方自己已有的 ComfyUI |
| `Qwen-Rapid-AIO-NSFW-v20.safetensors` | 26.5 GB | 出图要用 |
| Minimax H3 四件套（模型 / 文本编码器 / 视频 VAE / 音频 VAE） | 39.5 GB | 出视频要用 |

只装 Worker 不装这些，机器照样能上线，只是模型状态会报 `missing`，
调度器就不会把对应的活派给它——**不会报错，只是一直闲着**。
所以可以先只备一个模型：只放 Qwen 就只接出图的活，两个都放才接视频。

权重**不会自动下载**。清单里 `download.mode` 是 `import_or_configured_url`，
因为这些权重是按用户授权的，本项目不适合代为分发。
做法是把 Worker 指向机器上已有的 ComfyUI models 目录。

## 朋友要做的事

0. 先让他那台机器有一个能跑的 ComfyUI 和模型（见上表）。
1. 双击 `NovaFlowWorkerSetup.exe`，下一步到底。
2. 打开「NovaFlow Worker」。
3. 到「设置」页，填两样：
   - **控制面地址**：`https://<你的项目>.supabase.co/functions/v1/novaflow-web`
   - **注册码**：你给他的 `NFW-XXXXXX-XXXXXX`

   如果他的 ComfyUI 不在默认的 `127.0.0.1:8188` / `8189`，在同一页改掉。
4. 保存 → 回「状态」页 → 点「启动」。

然后是自动的：检测 GPU → 检查 ComfyUI → 检测模型 → 注册 → 上线。
下次开机自动启动并重新上线，不用再点。

注册码是一次性的，用掉后程序会自己把它从配置里清掉，
这样重启不会拿一个已失效的码去反复失败。

Worker 这一侧**不需要**装 Python、`pip install`、配 CUDA、复制自定义节点、
改 JSON 路径、改环境变量——这些是 ComfyUI 那一侧的事，
而 ComfyUI 由 NovaFlow 桌面版的安装包负责，不归这个安装包管。

## 界面

```
NovaFlow Compute Node                    v0.1.0
┌─────────────────────────────────────────────┐
│ ● 在线 · 空闲                               │
│ GPU            NVIDIA GeForce RTX 5090      │
│ 显存           32 GB                        │
│ ComfyUI        图像 ✓   视频 ✓              │
│ 当前任务       空闲                          │
│ 已完成 / 失败   128 / 2                      │
│ 对外地址       http://1.2.3.4:8790          │
├─────────────────────────────────────────────┤
│ 模型                                        │
│ qwen-image-2511                  Ready      │
│ minimax-h3                       Ready      │
├─────────────────────────────────────────────┤
│        [ 启动 ]        [ 停止 ]             │
└─────────────────────────────────────────────┘
        状态  |  设置  |  日志
```

只有这些。NovaFlow 的编辑器界面一点都没有搬过来——算力节点没有理由带一套设计工具。

## 无界面运行

服务器或 CI 上：

```bash
NOVAFLOW_WEB_CONTROL_URL=https://<ref>.supabase.co/functions/v1/novaflow-web \
NOVAFLOW_WORKER_NAME=studio-5090 \
NOVAFLOW_WORKER_REGISTRATION_CODE=NFW-XXXXXX-XXXXXX \
NOVAFLOW_GATEWAY_PORT=8790 \
NOVAFLOW_PUBLIC_ENDPOINT=http://1.2.3.4:8790 \
node worker/src/main-headless.mjs
```

| 变量 | 说明 |
| --- | --- |
| `NOVAFLOW_WEB_CONTROL_URL` | 必填。控制面地址 |
| `NOVAFLOW_WORKER_NAME` | 节点名（人看的标签，可重复） |
| `NOVAFLOW_WORKER_REGISTRATION_CODE` | 首次接入用 |
| `NOVAFLOW_OWNER_SESSION_TOKEN` | 或者用自己的 `nfs_` 会话令牌注册自己的机器 |
| `NOVAFLOW_GATEWAY_PORT` | 网关端口，默认 8790 |
| `NOVAFLOW_PUBLIC_ENDPOINT` | 浏览器能访问到的地址；留空则用本机地址 |
| `NOVAFLOW_COMFY_IMAGE_URL` | 默认 `http://127.0.0.1:8188` |
| `NOVAFLOW_COMFY_VIDEO_URL` | 默认 `http://127.0.0.1:8189` |
| `NOVAFLOW_MODELS_ROOT` | 可选，用于离线按文件检测模型 |
| `NOVAFLOW_WORKER_DATA_DIR` | 任务文件与身份文件的位置 |

## 注册码从哪来

**后台管理器**，不是给用户的 App。打开 `授权管理工具（双击打开）.vbs`
（或 `cd particle-editor-desktop && npm run license:gui`），左栏选 **算力节点**。

那一页三块：**在线节点**（显卡、显存、ComfyUI 版本、完成/失败、最后心跳，可停用/恢复）、
**接入一台新机器**（选归属用户 → 填备注 → 可用次数/有效天数 → 生成注册码）、
**已发出的注册码**（备注、已用/上限、有效期，可吊销）。

运营算力池是运维的事，不是用户的事。普通用户在 NovaFlow Web 里
只看得到顶栏那句「AI 已连接 / 未连接」，没有任何发码或配置入口。

明文码**只在这一次返回**。数据库里存的是
`sha256("novaflow-web-registration-code:v1:" + 明文码)`，
所以读到数据库也拿不到能用的码，面板自己的列表接口也不会再吐出明文。

默认一次性、7 天过期。要给一批云 GPU 用就把「可用次数」调大。

后台管理器走的是 service_role 直连 Supabase，和用户管理/积分管理同一套路子。
也可以用 Web 控制面的 API 做同样的事（两边算出来的哈希逐字节相同）：

```bash
# 面板点按钮走的就是这个接口
curl -X POST $CONTROL/api/web/workers/codes \
  -H "authorization: Bearer $SESSION" -H 'content-type: application/json' \
  -d '{"label":"云 GPU","max_uses":3,"valid_days":1}'

# 还剩几次
curl $CONTROL/api/web/workers/codes -H "authorization: Bearer $SESSION"

# 吊销没用完的
curl -X POST $CONTROL/api/web/workers/codes/revoke \
  -H "authorization: Bearer $SESSION" -d '{"label":"云 GPU"}'
```

吊销是把 `expires_at` 推到现在，不是删行——用过的码仍留在历史里。

本地控制面另有 `/dev/registration-code`，那只是测试用的捷径；
生产的 Edge Function 里没有它，也不需要它。

**整条接入链路不需要改数据库、配 IP、编辑 .env 或改源码。**
云 GPU、朋友的电脑、自己的电脑走的是同一个流程。
`worker-onboarding` 套件就是照着这条链路一步步测的（48 条断言）。

## 身份

首次运行生成一次，存在 `identity.json`：

```json
{ "workerId": "<uuid>", "workerSecret": "<32+ 字符随机串>" }
```

数据库里只存 `sha256("novaflow-worker-secret:v1:" + workerId + ":" + secret)`，
明文永远不进数据库。换句话说，读到数据库也拿不到可用的 Worker 凭证。

一个 workerId 已经注册过之后，别人拿注册码也抢不走它——必须出示当前的 secret。
`security` 套件专门测了这条。

## 网络

浏览器要能访问 Worker 的网关端口（默认 8790）。三种做法：

- **同一局域网**：填内网 IP 即可。
- **公网 IP**：端口转发 8790，`NOVAFLOW_PUBLIC_ENDPOINT` 填公网地址。
- **没有公网 IP**：目前需要自己套隧道（cloudflared / frp / tailscale funnel），
  把隧道给出的 URL 填进 `NOVAFLOW_PUBLIC_ENDPOINT`。
  数据模型已经支持（`transport` 字段有 `tunnel` 取值），但内建隧道本次没做，
  见 [LIMITATIONS.md](LIMITATIONS.md)。

ComfyUI **必须**留在 `127.0.0.1`。Worker 启动时会检查，配成 `0.0.0.0` 或任何非回环地址
会直接拒绝启动，不是警告。

## 模型清单

`packages/shared/src/model-manifest.mjs`。当前两个：

| model_id | 显示名 | 最低显存 | 工作流 |
| --- | --- | --- | --- |
| `qwen-image-2511` | Qwen Image (Rapid AIO) | 16000 MB | `qwen_t2i.json`、`qwen2511_edit.json` |
| `minimax-h3` | MiniMax H3（图生视频） | 15000 MB | `h3_i2v.json` |

每个模型列出 `required_files`（路径、最小字节数、可选 sha256）、
`min_vram_mb`、兼容的工作流。

检测顺序：
1. **问 ComfyUI**：拉 `/object_info` 看它实际能加载哪些权重。这是最诚实的信号，
   因为它反映的是「真能跑」而不是「文件在不在」。
2. **回退到文件系统**：配了 `NOVAFLOW_MODELS_ROOT` 时按路径找，容忍常见的子目录差异。

没有 pin sha256 的文件，报告里会明确写 `size_only_no_hash_pinned`，
不会假装校验过哈希。

调度器只把任务发给报告 `ready` 的 Worker。

## 支持的任务与工作流

| task_type | 模型 | 工作流 | 状态 |
| --- | --- | --- | --- |
| `qwen_t2i` | qwen-image-2511 | `qwen_t2i.json` | 在真 ComfyUI 上端到端验证过 |
| `qwen2511_edit` | qwen-image-2511 | `qwen2511_edit.json` | 图已按 API 格式校验；未跑过真实生成 |
| `h3_i2v` | minimax-h3 | `h3_i2v.json` | 图按 8189 运行时的 `/object_info` 构造；未跑过真实生成 |

诚实说明见 [LIMITATIONS.md](LIMITATIONS.md)。

加新任务类型要改四处：`protocol.mjs` 的 `TASK_TYPE` / `TASK_TYPE_WORKFLOW` /
`TASK_TYPE_REQUIREMENTS`、`pricing.mjs` 的费率、`model-manifest.mjs`（如果是新模型）、
以及 `worker/workflows/` 下的图。`protocol` 套件会检查这四处是否齐全。

## 任务文件布局

```
<dataDir>/tasks/<task_id>/
    input/     浏览器上传的参考图
    preview/   中间预览
    output/    结果
```

TTL 到期自动删（输入 24h / 图片 72h / 视频 48h），然后把任务标记为
`result_expired`，元数据留着。磁盘不会无限涨。

## 日志

界面「日志」页，或 `<userData>/data/worker.log`。点「打开日志文件夹」直达。
