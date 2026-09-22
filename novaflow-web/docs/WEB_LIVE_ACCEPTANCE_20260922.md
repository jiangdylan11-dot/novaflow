# 2026-09-22 线上生成故障核验

## 现场结论

- 线上静态网页已经包含生成路由修复；报错来自旧版云端函数，不能通过重复安装 Worker 或刷新页面解决。
- Supabase `novaflow-web` 部署版本 5 缺少 `novaflow-brand-runtime.buildArtGenerateRunWorkflow` 和 `spine-split-runtime.defaultQwenInpaintWorkflow/defaultRmbgWorkflow` 白名单。补丁已在函数编辑器核对，尚待用户确认最终发布；未声称线上绘图、补图已恢复。
- 视频任务 `b385e2b6-7287-47e9-b2f4-368a5dc0fc89` 的本机日志为 `fetch failed`。现场探测 8188、8189 均拒绝连接，原因是本地算力服务已停止。
- 使用原配置的图像、H3 启动脚本在后台恢复服务，两端 `/system_stats` 均返回 200。

## 线上视频实测

在独立验收标签页访问正式站点 `https://novaflow.jiangdylan11.workers.dev/`，不改动用户原工作标签页。通过界面提交文生视频：352 × 608、2 秒、24 FPS、4 步。

- 云端任务：`fd5aa764-ac0a-4c10-8da6-351323abe886`。
- 本机 ComfyUI prompt：`a420ed05-56e2-43bb-9738-cbaca273e0b6`。
- Worker 执行完成，耗时 38.6 秒，返回 1 个视频。
- 网页资源列表出现 `MiniMax_H3_t2v_00014_-fd5aa764-1.mp4`，状态显示“已加载到画板”，画板实际显示并播放生成视频。
- 页面成功状态旁仍显示 0%，本次不把该进度数字作为成功依据。

## Worker 0.4.3

- 模型可用性按实际任务使用的图像或视频服务分别判断，图像服务看到 H3 权重不再使已停止的视频服务被报为可用。
- 服务连接状态改变时立即重新上报完整模型状态；磁盘有模型但服务未启动时不报 Ready。
- 领取任务后再次检查目标服务，断开时返回明确的中文错误并撤销相应可用状态。
- 不自动启动任意用户配置的算力服务。本机本次已用现有脚本恢复服务；重启电脑后仍需要启动相应算力服务。

## 验证范围

- `worker-onboarding` 51 项、`worker-start-retry` 16 项、`worker-runtime-health` 11 项，共 78 项通过。
- 新测试通过 HTTP 服务模拟图像与视频服务分别停止、恢复，验证上报结果跟随实际端点，且连接未变化时不重复上报模型。
- 安装包已构建，解压核对 Worker 核心 SHA256 与源码一致。
- 用户确认 Windows 提权后，0.4.3 已安装到原目录，安装退出码为 0，安装后的核心文件哈希与源码一致；保留既有节点身份与配置。重新启动后云端登录返回版本 0.4.3、状态 idle，两个模型均上报 Ready；8188、8189 健康探测再次返回 200。
- 按约定执行 `sync:runtime`、`check:runtime`、`check:entry`，因 Web 工作区缺少桌面 `@jsquash/webp` 依赖及桌面 renderer/dist，三个桌面检查未通过；原本地端目录未修改，同步产生的无关换行变化已恢复。

安装包：`novaflow-web/worker/dist/NovaFlowWorkerSetup.exe`。
