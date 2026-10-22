# H3 上传卡片修复 2.0.84

已修复 2.0.83 多参上传区的原生文件控件外露、文字竖排及溢出。入口仍为：动画 → AI 序列动画 → 模型方式 → 本地 beta5 / 本地 beta6 → 多参视频。

## 原因与变更

旧运行时 applyAiAnimationSourceOwnedReferenceMetrics 会把参考列的直接子元素设成固定高度、横向不换行的 flex 行，覆盖新 H3 面板的网格布局。2.0.83 的上传 input 也没有隐藏。这不是模型或素材数量问题。

H3 面板现在由 React 挂载到设置/进度之后、提示词之前的独立整行。H3 多参模式跳过旧参考列布局，退出该模式时恢复原有布局属性。新增的 H3 专属 CSS 明确载入并随安装包发布。

上传按钮采用项目绘图面板已有的 87×59 虚线圆角加号卡片参数、颜色及统一加号图形。原生 input 隐藏，卡片点击触发文件选择；图片有缩略图、序号与删除，视频/独立音频有可辨识卡片、文件名、实测时长与删除。分组显示计数，小容器自动换行，满载时素材列表可滚动；说明文字独占整行，正负提示词保持在上传区之后。

没有改变 9 图 / 3 视频 / 3 独立音频上限、IndexedDB 数据结构、sourceId、引用编号、持久化或最终节点绑定。旧素材可直接恢复。

## 真实渲染验收

无需账号的独立 Electron fixture 只渲染 H3 组件及提示词邻接区域，加载真实 index.html 内样式与资源，不进入账户应用、不绕过登录、不连接 GPU。

源资源和新安装包内 web-dist 分别通过以下四种布局（合计 8 个场景），各保存 5 张截图：

- 1200px 宽：空状态、9/3/3 满状态。
- 480px 宽：空状态、9/3/3 满状态；另保存满状态滚动到底的截图。
- 检查 CSS 实际加载、原生 file input 不可见、卡片尺寸 87×59、无横向溢出、上传区不覆盖提示词、说明文字宽度及素材卡片换行。
- 通过 DataTransfer 实际导入 9 张 PNG、3 段 MP4、3 份 WAV；六段媒体均显示 2.0s。卡片触发隐藏 input、插入引用、删除后重新编号、IndexedDB 重新打开和退出 H3 布局恢复检查通过。

包内截图和度量：[宽屏空状态](../worker/dist/h3-beta6-2.0.84/visual-check/empty-wide.png)、[宽屏满状态](../worker/dist/h3-beta6-2.0.84/visual-check/full-wide.png)、[窄屏空状态](../worker/dist/h3-beta6-2.0.84/visual-check/empty-narrow.png)、[窄屏满状态](../worker/dist/h3-beta6-2.0.84/visual-check/full-narrow.png)、[窄屏满状态底部](../worker/dist/h3-beta6-2.0.84/visual-check/full-narrow-bottom.png)、[检查结果](../worker/dist/h3-beta6-2.0.84/visual-check/results.json)。这些是独立组件 fixture 截图，不是登录后完整应用验收。

回归：H3 三文件合并 Node 执行 8 个测试通过；包含两 profile × 五种构图场景、真实 worker 各 15 素材序列化/重映射/绑定、保存恢复及明确引用遗漏检查。包内 worker-renderer 的 beta5/beta6 15 素材传输另行重跑通过。自定义尺寸回归通过。npm run sync:runtime、check:runtime、check:entry 通过；entry 的 4 文件通过，内部检查数 48、63、138、32。

## 本地补丁安装包

worker/dist/h3-beta6-2.0.84/NovaFlowSetup-2.0.84.exe

大小：124,517,351 字节。
SHA256：c19956613d01bff8c2e90fb7537c0dd29c0bef4cd519325dc412a1157674add3。

包内 CSS 与源 CSS 的 SHA256 均为 aef801ce3b35562ccc4198a1f48b855192b099358b51a6c18483fff5cc4f9bc0。旧 2.0.83 包保留，未自动安装、重启或部署；用户安装补丁并重新打开客户端后生效。没有改其他工作流或回退其他窗口工作。

仍未完成：登录后完整应用操作及真实 GPU 出图，9+3+3 在 16GB 显存下的运行边界仍未验证。本次修复的视觉和素材绑定验收不依赖账号，已完成；GPU 验收继续等待主会话取得显示隔离登录窗口的许可。