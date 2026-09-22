# Web LoRA 与粒子模板修复（2026-09-22）

## 范围与原因

- 只修改 NovaFlow Web 与其 Compute Node；没有修改 `D:\AI_APP\NovaFlow` 的本地端布局或源码。
- Web LoRA 接口原为返回空列表的占位实现。绘图 `catalogFromInfo` 又被工作流裁剪器误替换为调用描述对象，导致渲染时报 `record.names.filter is not a function`，一直显示读取中。
- Web 没有实现桌面版 `loadUserData('templates')` 的默认模板加载链路。

## 实现

- Worker 0.4.4 复用桌面的 Qwen/H3 safetensors 兼容性检查，汇报名称、类型和指纹等目录元数据；不上传模型文件。每两分钟刷新，并在任务入队前重新检查选中的 LoRA。
- 登录后的 Web 通过控制面的 LoRA API 读取可调度节点的共同兼容列表，按 H3 模式过滤；旧节点、扫描错误和过期数据返回明确错误。
- Web 打包保留 Qwen 列表解析的同步数组返回约定。实际工作流仍在 Worker 构建。
- `particle-templates/` 保存从当前本地安装资源复制的 19 个模板，逐文件 SHA256 一致。Web 构建生成 `templates/particle-bundled.json`。
- 默认模板首次写入浏览器 IndexedDB；已有自定义模板合并保留。后续修改和删除在浏览器本地保存，不传 Supabase；显式重置才恢复默认模板。防止初始空状态自动保存覆盖异步加载结果。

## 验证

- 初轮相关八组测试 268 项通过；发现并修正打包问题后，重跑构建、LoRA、模板三组 106 项通过（包括新增的 3 项裁剪回归检查）。
- Edge bundle 启动、路径和登录拦截检查通过；生产 `/api/web/loras/qwen` 未登录返回 401。
- 本机真实模型：Qwen 14 个；H3 普通模式 10 个、参考视频模式 9 个。
- 完整 Web 预览：Qwen 下拉列表可选，选中后显示强度和移除按钮；H3 同样可选。19 个粒子模板显示缩略图，点击火焰喷射模板后实际应用到画布。
- 使用真实模型目录构建 Qwen/H3 工作流，确认选中 LoRA 及 0.6 强度进入图，并通过节点端重新校验。没有执行 GPU 生成，因此不宣称图像/视频输出效果已验收。
- Worker 安装包两份兼容检查模块与桌面源文件 SHA256 一致，已安装版本 0.4.4。
- 已执行根目录 `sync:runtime`、`check:runtime`、`check:entry`，未通过：Web 工作树缺少桌面 `@jsquash/webp` 依赖和 renderer/dist 入口，另有既存 aifx 集成门禁。Web 构建与上述专项检查通过；不将桌面入口门禁写成通过。

## 发布记录

- 已使用 Supabase CLI 发布 `cjakoblszlmbmotchzva` 的 `novaflow-web`，未修改 `novaflow-backend`。
- 已将本机 Worker 的 models 目录设为 `E:\NovaFlow\models`，恢复 H3 8189 服务。
- Worker 安装包：`worker/dist/NovaFlowWorkerSetup.exe`，SHA256 `5dd87ee9b23142be2400c2a01aa1018573c4321d9391ae2f946f7c656684c35e`。
- Web 包：`.artifacts/novaflow-web-lora-templates.zip`，SHA256 `a740882be641d9a72e7605eb76e9f86a8fc9786124a6a2ebeb31cd571454eea0`。
- 待用户在 Cloudflare 选择 ZIP 后发布并验证线上；Worker 启动命令被自动审批拒绝（仅返回 blocked by policy），已请用户打开并启动节点。
