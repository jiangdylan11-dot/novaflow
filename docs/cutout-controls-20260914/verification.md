# 抠图参数与颜色校正界面

## 桌面原生上传入口补充修复

- 新测试包：`NovaFlow Setup 2.3.214-color-fix.exe`，250,163,556 bytes，SHA256 `b55907a9354844c66ffe0486a5674adf030b72622e7e4a5c902c9d29235b9bd1`。`package-color-fix-validation.json` 核对 bundle、brand runtime、原生上传桥和 index 四文件与源文件完全一致。
- 从该安装包提取完整 renderer 后，完整桌面页面测试与控件/原生上传测试均 PASS；打包后 runtime 检查 PASS、入口 Overall GO。包内完整页面记录：`logs/cutout-controls-20260914/packaged-full-desktop/result.json`。
- 用户安装目录的 bundle、runtime、index 和上传桥接文件与上一包一致，排除装错包；漏改的是 `file:` + `electronAPI` 下自动启用的 `novaflow-source-upload-island-bridge.js`。它原先始终把旧上传卡插到工具列表顶部。
- 原生上传卡现在跟随 React 校正面板挂载在分隔线下方，折叠/取消时移出页面，已选择的参照保留。标题改为“上传色彩校正参照”。
- 空画板初始三个入口均可点击，执行校正/抠图时检查资源并给出提示；进入互斥模式时才禁用另外两个。
- 校正状态切换发出事件，在 React 提交后的 microtask 直接同步工具禁用状态与原生上传卡。避免依赖隐藏 Electron 页面的 RAF 导致取消后按钮仍灰。
- 新增 `color-correction-desktop-page.test.cjs`，加载完整生产 `file://.../index.html`，仅提供桌面检测对象，使用独立 Electron 原生鼠标事件检查页面：初始无上传卡、三个入口可用；展开仅一个原生上传卡，另外两个按钮 0.55 透明度并禁用；取消后上传卡消失，三个入口恢复。记录在 `logs/color-correction-desktop-page-20260914/`。
- `cutout-controls-ui.test.cjs` 同时补入桌面原生上传桥、空资源进入/执行限制的验证。

## 修改

- React 首次挂载参数行时直接提供固定布局与 range/value 标记，避免关闭光效透明保留后先出现短粗原生滑条，再由 DOM 刷新改变尺寸。
- 参数行样式同步不再清除再补回相同的标记，减少 MutationObserver 重复处理。
- 连续 range 输入立即更新数值；暂停帧的昂贵预览在输入停顿 80 ms 后合并刷新。帧切换、笔刷与导出继续使用现有参数和流程。
- 锁定帧率滑条的 JS 样式与 CSS 轨道均为 2 px。
- 颜色校正默认仅显示按钮。首次点击展开分隔线下方的参照上传区，按钮变为红底“执行校正”，再次点击走原有执行回调。
- 上传区域名称“上传色彩校正参照”；下方说明“上传参照图片，校正视频整体色调，减轻帧间色彩偏差。”进入抠图时收起颜色校正面板。
- 更新补丁入口 `scripts/patch-ai-seq-cutout-edit.mjs`，新增独立且幂等的 `patch-cutout-controls.mjs`。
- 三个工具采用统一互斥规则：颜色校正展开即进入激活状态，另外两个入口使用原有 0.55 透明度和禁止点击样式；鼠标/键盘产生的点击均由入口守卫阻止切换。
- 增加“取消校正”，退出并恢复其他入口；校正 busy 从 true 变为 false 时自动退出，处理中不能取消。

## 验证

- `node particle-editor-desktop/tests/run-electron-check.cjs particle-editor-desktop/tests/cutout-controls-ui.test.cjs` PASS。
  - 生产 Dock 与生产样式在独立 Electron 中挂载；连续开关三轮，九行参数初始布局与样式同步后的布局完全相同。
  - 参数轨道 2 px；重复样式同步 10 次，参数标记变更数为 0。
  - 40 次连续输入合并为 1 次暂停预览调用，最终值 49 正确保留。该项检验调度，不代表真实视频的渲染耗时。
  - 首次展开不执行，上传与二次执行各调用一次原有回调；注释容器不会被误识别为第二个上传框。
  - 锁定 FPS 轨道 2 px。
- 4783 完整页面人工工具验证：默认上传框隐藏；展开按钮背景 rgb(111,31,42)；上传区在视频抠图按钮下方分隔线之后，说明在上传框下方；无额外外框。
- 4783 抠图编辑锁定状态：帧率滑条 disabled=true，轨道 100% 2px，宽 144 px。
- 补丁幂等检查 PASS；bundle 与 runtime JS 语法检查 PASS。
- 三工具互斥矩阵 9 项 PASS；取消解锁、处理结束解锁 PASS。4783 完整页面验证：颜色校正 active=1、红底，另外两个 aria-disabled=true、pointer-events=none、opacity=0.55；取消后三者均恢复 aria-disabled=false、pointer-events=auto、opacity=1。
- `npm run sync:runtime` 完成，`npm run check:runtime` PASS，`npm run check:entry` Overall GO。

## 验证边界

- 独立 UI 测试提供视频可用状态与回调替身，没有执行原视频的完整抠图算法。4783 浏览器尝试实际抠图返回“AI 分割仅桌面版支持”，因此原视频在桌面端的最终拖动手感尚未实测。
- 整包 HEAD replay 未通过：首个差异为其他界面标题“处理工具”与“视频处理”，位于此次 Dock 修改之外；未覆盖其他任务的已有改动。
- 已使用 `build:win:nobump` 构建 `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe`（250,163,114 bytes）。
- 从最终安装包提取 bundle、runtime、index.html，三者与源文件 SHA256 完全一致；使用包内文件重跑 Electron 控件、三工具互斥、取消恢复、busy 结束恢复测试均 PASS。打包后 runtime 检查 PASS，4783 入口 GO。
- 安装包 SHA256：`6c26e24b364710853b6c7436edab51b383086276daa0ea33c9d4d01b7282833a`。核对结果在 `package-validation.json`，测试记录在 `logs/cutout-controls-20260914/`。
