# 生图：姿势参考

入口：美工 → 绘图 → 生图 → 姿势参考。此工具在浏览器中摆放成人比例的灰色人偶，不需要 ComfyUI 或生成模型。

- 姿势库提供 136 个上游预设及预览图，支持名称搜索和分类筛选；点击应用骨骼和预设镜头方向，再继续调节关节。普通姿势按成年人体型自动适配全身，特写预设保留原有构图。
- 支持 IK 手脚拖动、FK 关节角度、三种手势、镜头旋转/平移/缩放和撤销重做。
- 导出 PNG 使用当前视角和输出尺寸，隐藏操作手柄、关节和网格。保存/导入姿势文件保留关节、根骨位置、镜头及输出设置；最近姿势也保存在浏览器本地。
- 「用作姿势参考」填入当前模型允许范围内的第一个空参考位，然后切换到图生图。参考位已满或生成正在运行时提示用户，不覆盖已导入图片。
- 不更改生成模型、2511 路由、采样参数或用户提示词。模型最终对姿势的跟随程度仍需要实际出图验证。

## 上游与更新

3D 核心直接来自 [AHEKOT/ComfyUI_VNCCS_Utils](https://github.com/AHEKOT/ComfyUI_VNCCS_Utils)，MIT；Three.js r160 为 MIT。MakeHuman 图形资产为 CC0。核心、依赖、许可和原始文件 SHA256 保存在 `renderer/vendor/vnccs/`。

为避免下载整个 38 MB morph 包，使用上游算法离线生成约 1.4 MB 的中性成人静态人偶。上游年龄不是 0..1 参数；其完整成年形态对应 1..90 范围的中点 45.5。更新脚本固定该形态，避免混入婴幼儿/儿童 morph。

姿势库是所给仓库引用的 81 个社区预设加 55 个随包预设。原始 JSON 和预览图原样保留在 `renderer/vendor/vnccs/pose_library/`；`index.json` 记录每项来源、提交及 SHA256。预览保留上游画面；应用时只读取姿势和镜头，不改变人偶体型，也不导入上游提示词。第三方姿势库各自保留原作者条款，不能统一视为核心的 MIT 许可，详见 `NOTICE.txt`。

更新本地副本：

```powershell
node novaflow-web/tools/vendor-pose-studio.mjs
node novaflow-web/tools/vendor-pose-library.mjs
node --test novaflow-web/tests/e2e/pose-reference.test.mjs
npm run sync:runtime
npm run check:runtime
npm run check:entry
```

更新脚本仅下载静态开源资源，不安装 ComfyUI 节点或生成模型。正式发布、打包和部署仍遵循仓库版本流程。
