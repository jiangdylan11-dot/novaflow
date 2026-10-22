# H3 beta5 / beta6 本地多素材候选版本 2.0.83

状态：本地候选包已构建，CPU 验证通过；未安装，实际登录界面操作与 GPU 验收待完成。此记录不代表出图质量或 16GB 显存满载可运行的保证。

## 用户入口

动画 → AI 序列动画 → 模型方式 → 本地 beta5 / 本地 beta6 → 多参视频。
两条线路各支持上传最多 9 张图片、3 个视频、3 份独立音频。上传列表显示编号，可插入素材引用；删除会重新编号，已删除但仍在提示词中的引用明确报错。素材与提示词按画板持久保存，提交时冻结快照。编译后显示使用和未使用素材；明确引用的素材不得静默丢弃。

视频作为画面/动作参考，独立音频作为声音条件。视频内原音轨不自动作为声音参考。仅选择一份独立音频时可复用其原音轨；多份音频不自动混音，也不保证精确口型。保留既有每段 2–15 秒、同种媒体总计不超过 15 秒和每文件 64 MiB 上传限制。

## 模型与接法

- beta5：Minimax_H3/10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors，20,970,414,464 字节。保留既有成功参数及默认 4 步。
- beta6：Minimax_H3/10Eros_Max_h3_8stepTURBO_beta6_int8.safetensors，21,709,633,539 字节。SHA256：e2c5493e5997726ab12f17caecd6fe88c7e64b135bd3435c0f158c8f1b632a5f，与 TenStrip/10Eros-Max 仓库 revision 84c820586c62701c2a29a6eafb94416d490564ed 的 LFS 数据匹配。
- 未下载新模型，未覆盖 beta5；复用已有 Qwen3-VL 编码器、视频/音频 VAE。
- beta6 默认 8 步，显式 video shift 10 / audio shift 3；使用原生 MiniMaxH3ReferenceToVideo，不使用作者警告的 FL 专用接法。单图与首尾帧模式经原生 MiniMaxH3AddGuide 约束首/尾位置，CPU 已验证连线，效果仍待 GPU 验证。不叠加 Eros_beta6mix LoRA，不使用 SLA。
- 当前 ComfyUI 原生参考节点声明图片 9 / 视频 3 / 独立音频 3 个输入。声明容量不代表同时满载的效果或显存保证。每一份实际使用的素材有 sourceId、文件名、模型 token 与最终输入端口记录。

作者依据：https://huggingface.co/TenStrip/10Eros-Max/discussions/61 、https://huggingface.co/TenStrip/10Eros-Max/discussions/63 、https://huggingface.co/TenStrip/10Eros-Max/raw/main/README.md 。

## 已完成验证

- h3-multireference-profiles.test.mjs：两种 profile × 文生 / 单图 / 首尾帧 / 1+1+1 / 9+3+3 共 10 个构图场景，真实参考节点与输入索引、beta6 shift、素材身份、保存/恢复/删除重新编号以及清空后不复活素材。
- h3-multireference-transport.test.mjs：实际 createLocalTasks、withReferences、createWorkflowHost 和任务输入完整性检查；两种 profile 各 15 份素材通过队列序列化、上传重映射、私有 worker 构图；队列重新载入保留身份；明确引用遗漏会失败。另针对候选安装包内 worker-renderer 重跑通过。
- h3-generate-compile.test.mjs：6 个既有测试通过。以上三个文件的合并 Node 执行报告为 8 个测试通过。
- h3-custom-resolution.test.cjs：既有四模式自定义尺寸、对齐、持久化检查通过。
- npm run sync:runtime、npm run check:runtime 通过；npm run check:entry 的 4 个测试文件全部通过（内部检查数为 48、63、138、32）。本地 renderer 构建与语法检查通过。
- 未提交任何 GPU 任务。隔离本地验收窗口运行在 127.0.0.1:4786，runtimePolicy=existing-only，停在正常账户登录页。等待用户允许显示窗口并自行登录；没有绕过登录、复制浏览器 profile 或导出认证令牌。

## 候选安装包及运行版本

路径：worker/dist/h3-beta6-2.0.83/NovaFlowSetup-2.0.83.exe
大小：120,098,094 字节
SHA256：95e032710e22b39c5c23b593ff3b2c470aaf0542881d6748e5c1c0b4bde3550e
候选 EXE 元信息 2.0.83.0、内置 app package 2.0.83、web release 2.0.83 已核对。

已安装程序仍是 C:/Program1/NovaFlow/NovaFlow.exe：EXE 元信息 2.0.81.0，已安装资源与既有 4784 服务报告 2.0.82。未改已安装程序，未停止/重启当前服务或 GPU 队列。正式本地入口需要用户自行安装候选包并重新启动客户端；GPU 验收未完成前应视为待验收候选。旧安装包保留。

此包基于当前工作树，包含其他窗口原有未提交工作；仅 H3 相关源文件列入本任务提交，其余工作未修改/回退。未部署网站、未修改 UI 设计链或 Grok、未增加付费调用。一次向 Supabase 镜像目录同步共享文件的操作被自动审批拒绝，未执行；之后仅构建本地候选，Edge 仍为 2.0.82。

## 待验收

用户登录隔离窗口后：实际界面多素材上传与保存恢复；队列空闲时普通素材短片出图；记录 beta5 / beta6 的任务 ID、进入采样的素材数量、耗时、显存与输出。9+3+3 在 16GB 显存下尚未验证，失败必须报告实际限制，不静默删减材料。当前阻塞为等待显示隔离窗口及用户登录许可；未拒绝本地 GPU 测试，也未尝试绕过登录。