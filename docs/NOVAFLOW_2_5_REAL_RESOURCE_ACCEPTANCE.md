# NovaFlow 2.5 Real Resource Acceptance

## 结论

本轮执行 NovaFlow 2.5 真实资源补验，范围限定为 4783 页面前端真实资源路径、带资源弹框入口、Storyboard 入口和动画切换验证。

- 结论：PASS，允许 NovaFlow 2.5 继续作为稳定基线。
- 阻塞问题：无。
- 本轮修改：仅新增本报告。
- 未执行事项：登录、授权、真实生图、后端生图输出、Runtime 拆分、性能优化。

## 当前 commit

- 执行时实际 HEAD：`74ecb669 docs: update agent development rules`
- 用户给定基线：`ef375abf docs: establish novaflow 2.5 release baseline`
- 说明：本次验收按执行时真实 HEAD 记录，`ef375abf` 作为 NovaFlow 2.5 release baseline 的前置基线说明。

## 测试环境

- 系统：Windows / PowerShell
- 页面：`http://127.0.0.1:4783/`
- 4783 状态：HTTP 200，可访问
- 浏览器验收：临时 Headless Chrome + CDP，1280x720 viewport
- 验收方式：真实本地 PNG 文件通过主页面 `File` / `DataTransfer` / `DragEvent` 路径导入
- 探测边界：不登录、不授权、不点击任何真实生成按钮

## 真实资源来源

本轮生成并使用 2 张临时 512x512 PNG，均位于系统临时目录，未提交到仓库：

- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\novaflow-acceptance-512.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\novaflow-acceptance-512-b.png`

## 验收明细

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| 初始 `git status --short` | PASS | 执行前工作区干净 |
| 4783 页面可访问 | PASS | `http://127.0.0.1:4783/` 返回 200 |
| 真实 PNG 资源准备 | PASS | 2 张临时 512x512 PNG |
| 导入 / 添加图片资源 | PASS | 主页面 drop 事件接收真实文件，`files=1` |
| 资源卡新增 | PASS | 出现资源卡 `novaflow-acceptance-512.png`，切换后出现第二张资源卡 |
| 资源卡选中 | PASS | 点击第一张资源卡后 active resource 切回 `novaflow-acceptance-512.png` |
| 资源卡删除 | PASS | 删除第一张资源卡后，仅保留第二张资源卡并自动选中 |
| 预览区图片显示 | PASS | 预览图可见，natural size 为 512x512 |
| 黑底背景 | PASS | 预览滚动区背景为深色，实测 `rgb(11, 11, 11)` / dark gradient |
| 切换资源后预览更新 | PASS | A/B 资源切换时 active resource 与 preview data URL 长度同步变化 |
| 高清放大弹框打开 / 关闭 | PASS | 带资源状态可打开；关闭后弹框正文消失；未点击生成 |
| 洗图弹框打开 / 关闭 | PASS | 带资源状态可打开；关闭后弹框正文消失；未点击生成 |
| 无限扩图弹框打开 / 关闭 | PASS | 带资源状态可打开；关闭后弹框正文消失；未点击生成 |
| 角度调整弹框打开 / 关闭 | PASS | 带资源状态可打开；关闭后弹框正文消失；未点击生成 |
| Storyboard 入口定位 | PASS | 定位到 `storyboard` 控制项 / `一键分镜` 入口 |
| Storyboard 弹框打开 / 关闭 | PASS | 弹框可打开关闭；未点击生成 |
| 动画切换：AI序列动画 -> 骨骼动画 -> AI序列动画 | PASS | active tab 与 body class 均按预期切换 |
| 首帧闪图 / 布局残留 / 按钮失控 | PASS | 截图与页面状态未观察到残留或失控；本轮未做高速逐帧探针 |
| 登录 / 授权 | N/A | 按本轮范围不验收 |
| 真实生图 | N/A | 按本轮范围不执行 |

## WARNING / 备注

| 项目 | 级别 | 说明 |
| --- | --- | --- |
| `npm run check:entry` 上游健康探测 | WARNING | 命令整体 `Overall: GO` 且 exit code 为 0，但 `/__runtime_health` 返回 502，直接探测 `127.0.0.1:8188` 超时。本轮不执行后端生图，因此不阻塞 4783 前端验收。 |
| 弹框关闭探测 | WARNING | 自动脚本的通用 fixed-layer 检测会把持久 workspace root 也计入 fixed surfaces；最终以弹框专属标题和正文消失作为关闭通过依据。 |
| 预览更新自动比对 | WARNING | PNG data URL 前缀一致导致 prefix-only 标记不能区分 A/B；实际依据为 active resource、data URL 长度和截图变化。 |

## 截图 / 日志说明

截图保存在系统临时目录，未提交到仓库：

- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\after-drop-a.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\after-drop-b.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\after-select-a.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\after-delete-a.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\dialog-imageUpscale.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\dialog-imageWash.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\dialog-imageOutpaint.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\dialog-imageAngleAdjust.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\dialog-storyboard.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\animation-initial.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\animation-bone.png`
- `C:\Users\jiang\AppData\Local\Temp\novaflow-real-resource-acceptance\animation-ai-return.png`

## 历史问题复查

| 复查项 | 结果 | 说明 |
| --- | --- | --- |
| 资源导入链路 | PASS | 真实本地 PNG 可进入资源 store 和预览区 |
| 资源卡交互 | PASS | 新增、选中、删除均可用 |
| 预览黑底与图片展示 | PASS | 黑底背景存在，图片可见且尺寸正确 |
| 多资源切换 | PASS | 切换后 active resource 与预览同步 |
| 美工工具弹框链路 | PASS | 四个工具弹框均可在带资源状态打开关闭 |
| Storyboard 入口 | PASS | 入口可定位，弹框可打开关闭 |
| 动画模式切换残留 | PASS | AI序列动画 / 骨骼动画往返后未发现布局残留或按钮失控 |

## 发现问题的优先级

- P0：无。
- P1：无。
- P2：`8188` 上游健康探测超时，仅影响后端健康可见性；本轮不做登录、授权或生图，不作为 2.5 前端稳定基线阻塞项。
- P3：自动化验收脚本存在检测口径噪声，可后续沉淀为专用只读验收脚本。

## 是否建议修复

本轮不建议立即修复。当前发现内容均不属于本轮真实资源前端验收的阻塞缺陷，且用户已明确禁止继续开发、重构和性能优化。

后续如要增强验收效率，可单独建立只读 CDP 验收脚本，把真实资源导入、弹框入口和动画切换纳入人工发布前检查；该工作应另行授权。

## 验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run phase0:check` | PASS | exit code 0，working tree clean |
| `npm run check:runtime` | PASS | exit code 0，Runtime 镜像一致 |
| `npm run check:entry` | PASS / WARNING | exit code 0，`Overall: GO`；上游 health probe 超时见 WARNING |
| `node --check particle-editor/novaflow-brand-runtime.js` | PASS | exit code 0 |
| `node --check particle-editor/spine-split-runtime.js` | PASS | exit code 0 |
| `node --check particle-editor/aifx-repaint-runtime.js` | PASS | exit code 0 |
| `node --check particle-editor-desktop/main.js` | PASS | exit code 0 |

