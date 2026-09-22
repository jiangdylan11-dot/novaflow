# Web 生成链路修复验收（2026-09-22）

## 问题和修复

- 智能补图提示 `workflow not available on the web`：增加受限的补图、智能抠图和绘图入口白名单，在 Worker 保留完整位置参数并执行原有构图代码。
- Instant 绘图提示 `Runtime 未连接: 200`：补齐原界面读取的 `data` 返回字段；连接状态按公共算力池查询，不再依赖当前账号名下的 Worker。
- 文生视频下发 503：接通直接 fetch 使用的提交、历史、队列、下载路径，统一构图模块名称。
- 实际界面验收发现的后续故障：保留输出文件前缀；临时缓存读取图片字节并返回可显示的 Blob URL；任务只携带自身参数引用的上传文件，避免补图预上传污染文生视频；补齐 H3 当前页面内的临时结果登记和读取接口（刷新后不保留，不是云端长期仓库）。
- 工作流仍在 Worker 构建。浏览器不接收节点图；Worker 的节点查询限定为本机配置的运行服务。

## 自动检查

- protocol：104 项通过；web-renderer-build：77 项通过。
- control-plane：52 项通过；security：51 项通过。
- 新增 web-generation-routes：36 项通过，覆盖真实构建产物的返回字段、视频直接请求及临时结果播放、资源身份去重、绘图入口、参数隐私、参考图筛选与去重、Worker 抠图构图、缓存字节及释放。
- `sync:edge`、`check:edge`、`bundle:edge`、`verify:edge` 通过；Deno 实际启动后各路由形式正常，未认证 grant 返回 401。
- 尝试桌面约定的 `sync:runtime`、`check:runtime`、`check:entry`，本 Web 工作区缺少桌面依赖 `@jsquash/webp` 和桌面 renderer/dist，未通过。此次未修改原本地端目录，也未把这些失败描述为桌面验收通过。

## 真实算力验收

独立本地控制服务、测试 Worker、零余额测试账号，调用本机 8188/8189；不使用付费图像提供商。工具为 `tools/verify-generation-routes.mjs`，可指定 `cutout inpaint art video`。

| 场景 | 结果 | 用时 | 输出 |
| --- | --- | --- | --- |
| 智能抠图 | 成功 | 4.793 秒 | 256×256 RGBA PNG，Alpha 范围 0–255 |
| 智能补图 | 成功 | 63.384 秒 | 1024×1024 PNG，473756 字节 |
| Instant 绘图 | 成功 | 11.208 秒 | 512×512 PNG，357106 字节 |
| 文生视频 | 成功 | 87.005 秒 | MP4，924964 字节 |

结果记录位于 `.artifacts/generation-routes/results-cutout-inpaint-art.json` 和 `results-video.json`。这些是生成、签名下载和文件验证，不代表所有模式的画质验收。

浏览器在隔离预览 4894 中验证：Instant 显示 100%，图片进入画布和资源列表；涂抹选区后执行智能补图，产生 `source_layer_inpaint` 新图层；文生视频显示“已生成并加入临时仓库”，画布显示实际生成的视频画面。最终任务 `8bad4d58-ac52-4b62-b6f8-a0421b0c65cb` 对应一条资源卡，点击播放后按钮变为暂停，帧数从 1 前进至 4（共 49 帧）。视频百分比仍显示 0%，与完成文案不一致，实时百分比未在此次接入。

额外观察：长时间运行的隔离测试 Worker 曾在 Comfy 两端健康时报告池容量为 0，重启测试 Worker 后恢复。该容量波动未定位根因，此次完成验收不代表长时间可用性验收。

## 配套发布文件

- 网页：`.artifacts/novaflow-web-generation-fix.zip`，配置生产控制服务地址。
- 云端函数：`supabase/functions/novaflow-web-bundle/index.ts`（部署目标仍为 `novaflow-web`）。
- Worker：`worker/dist/NovaFlowWorkerSetup.exe`，版本 0.4.1。已从安装包解压，核对 Worker 核心、构图宿主、Comfy 客户端、共享白名单及两份运行构图文件的 SHA-256 与本次产物一致。

尚未发布至线上、替换线上 Worker 或推送远程。上线需配套更新函数白名单、Worker 0.4.1 和网页；只刷新现有线上网页不会获得本次修复。原 `D:\AI_APP\NovaFlow` 本地端未改动。
