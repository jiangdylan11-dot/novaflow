# NovaFlow UI 维护规则

## 禁止项

1. 新 UI 不允许通过覆盖旧 UI 实现。
2. 一个板块只能有一个入口组件。
3. 不允许旧组件作为 loading/fallback。
4. 不允许 useEffect 首帧后切换布局。
5. 不允许 display:none / opacity:0 保留旧布局。
6. 不允许无意义 wrapper div。
7. 不允许全局通用 class 污染业务板块。
8. 不允许用 !important 修补架构问题。
9. 不允许同时维护两个同功能页面。
10. 不允许改 A 页面却实际运行 B 页面。

## 修改 UI 必须检查

1. 冷启动。
2. 刷新。
3. 板块切换。
4. 快速切换 10 次。
5. 控制台错误。
6. build。
7. 入口检查。

## 4783 入口规则

唯一认可运行入口是 `http://127.0.0.1:4783/`。

真实运行链必须以 `tools/preview_runtime_server.py` 指向 `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html` 为准。

禁止将 `particle-editor` 的 Vite dev server、5173、4173 或 Electron dev 作为日常 UI 验证入口。

## 清理顺序

1. 先确认 active `index.html` 引用的真实 JS/CSS bundle。
2. 再确认 route/tab/switch/sidebar 是否仍 import 或触发旧入口。
3. 首帧必须直接进入最终布局；未 ready 时只能显示中性暗色 skeleton。
4. 删除 wrapper 前必须确认它没有 ref、事件、data 读取、ResizeObserver、canvas 尺寸、timeline 坐标、拖拽或 Electron drag region 依赖。
5. 删除文件前必须确认无 import、无 route、无 dynamic import、无字符串路径、无 preload/main/build/test 依赖，并且 `npm run build` 通过。
