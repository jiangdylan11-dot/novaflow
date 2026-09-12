# H3 beta5 本地双模型配置

用户提供的两个基模文件均保留在原路径；此次没有重新下载、转换、改写或删除模型，也没有提交视频生成任务。

## 使用入口

`http://127.0.0.1:4783/` → 动画 → AI序列动画 → 模式选择 → MiniMax_h3 → 底部「H3 版本」。

| 选项 | 实际文件 | 文件大小 | 文件头核对结果 |
| --- | --- | --- | --- |
| H3 原版 | 原有 Minimax_H3 目录下 FL2VA / Ref2VA 文件 | 原有文件 | 原配置保留 |
| H3 beta5 · INT8（3185154） | `E:\NovaFlow\models\diffusion_models\h3ErosMax_beta5_3185154.safetensors` | 20,970,414,464 字节 | 200 个 int8_tensorwise 量化层；另有 BF16/F32 张量，并非未量化版 |
| H3 beta5 · 混合量化（fp8） | `E:\NovaFlow\models\diffusion_models\h3ErosMax_beta5_fp8.safetensors` | 13,997,668,774 字节 | 180 个 asym_w4a8_int8 层及 20 个 int8_tensorwise 层，含 FP8 缩放张量，并非纯 FP8 |

两个新配置默认 4 步，保留可编辑步数。首次载入此次更新时，会将上次保存的 beta5 默认 20 步迁移为 4 步，其他自定义值及原版设置保留；此后手动设置 20 步仍会正常保存。没有自动附加 Turbo LoRA，原版的 4 步 Turbo 行为保持原样。

画幅、分辨率、时长、FPS 和步数按配置独立保存，生成时固定所选配置，避免切换界面后改变正在准备的任务。两个新版仅接入文生、图生及首尾帧流程；尚无已确认的 beta5 Ref2VA 权重，多参考模式应切回原版。切换新版时若此前处于多参考模式，会切到图生视频。

## 部署与验证范围

- 现有 H3 侧车位于 `C:\ProgramData\NovaFlow\AI-Runtime-H3`，端口 8189。其 ComfyUI 已有 INT8/W4A8 加载代码，无须添加节点或更新引擎。
- 已读取两份 safetensors 文件头并核对张量数据末端与文件大小一致；未做全文件哈希来源认证或模型推理。
- 8189 的 `object_info/UNETLoader` 已列出两份精确文件名。
- 17 项所选工作流/界面契约检查通过，包含原版回归、双模型路由、交叉模型拒绝及参数隔离。表面测试中两项与本次无关的既有 Art Generate 哈希、品牌缓存预期失败未纳入本次通过统计。
- 首次部署时在 4783 浏览器实际切换两个模型，确认 Turbo 标识关闭、多参考按钮禁用及参数跨配置恢复。默认步数现已按用户要求由 20 改为 4；默认值与旧设置迁移经过纯配置测试，没有点击「开始生成」。
- 源静态镜像、renderer 和 win-unpacked 同步；runtime 一致性检查 PASS、4783 入口检查 GO。LoRA 修复后的复查中，共享 8188 上游可达；它与 H3 的 8189 独立。
- Windows 安装包使用 `build:win:nobump` 更新为 2.3.214；此次无版本号递增。

**待用户验收：模型实际加载、出片质量、显存峰值和生成速度均未通过本次推理实测，不作已跑通或加速承诺。**

此前 LightX 试验配置已撤回；其历史文档已标为撤回，不是本次 beta5 模型部署的依据。

## LoRA 目录修复

原目录只接受 `lora_unet_*.lora_down/up.weight` 命名，以及 `ss_network_module=networks.lora_minimax_h3` 和特定基模字段。用户的另外五份文件采用 ComfyUI `diffusion_model.*.lora_A/B.weight` 命名或省略这些作者字段，因此被误过滤。

现支持上述两种命名，包括 token_refiner 权重。缺少作者元数据时，必须由完整配对的四类 H3 主模块投影及其张量尺寸识别，并继续检查层号、秩、数据范围、Runtime 登记、文件指纹和加速器排除规则。明确标记 FL2VA / Ref2VA 的文件仍按模式筛选，不能仅凭文件名认定兼容。

本地 `E:\NovaFlow\models\loras\minimax_h3` 已识别并校验 6 个普通 LoRA；内置 Turbo 和之前的四份 LightX 加速器不计入普通列表。未改写任何 LoRA 文件。

此次 29 项目录、前端资源、工作流、IPC 测试及 13 项所选界面测试通过。经真实 4783 目录接口读取，再交给已部署的前端筛选和工作流构造器，6 个 LoRA 均能在两个 beta5 配置中通过结构校验（12 个组合）；没有提交这些工作流进行推理。

此次更新时用户正在生成，未刷新其页面或重启引擎。安装包在独立 `particle-editor-desktop/dist/h3-lora-update` 目录构建，不清理活动 win-unpacked 目录；正在运行的桌面进程应等生成结束后重启，才能加载主进程目录规则更新。

实际运行程序位于 `C:\Program Files\NovaFlowPortable`。尝试同步四个修复文件时，第一个文件即被 Windows 拒绝写入（PermissionError 13），没有更改安装目录。4783 和工作区版本已同步；正式安装版须等当前生成结束后，用更新的 `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe` 覆盖安装并重新打开才能生效。此次没有触发安装或 UAC，避免影响进行中的生成。
