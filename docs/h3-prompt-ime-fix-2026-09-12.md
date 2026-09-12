# 多参考提示词中文输入修复

多参考提示词通过 `resource-mention.tool.js` 的 contenteditable 编辑器代理原 textarea。旧逻辑在中文组合输入期间仍将拼音写回 textarea；挂载刷新、资源刷新和 backing change 又可调用 `renderController`，清空重建编辑 DOM 或重设选区，打断输入法维护的组合文本。

本次修复在组合输入期间同时暂停 backing 同步和 DOM/选区刷新。`compositionend` 延迟到下一任务再提交，覆盖 Chromium 在 compositionend 之后派发最终 input 的顺序。新组合开始时取消旧提交计时器，卸载时清理计时器。组合输入、`isComposing`、键码 229 和 composition 类型的 beforeinput 不触发引用菜单或引用原子删除逻辑。

改动位于共用引用编辑器，适用于 H3 多参考及其他使用该组件的提示词。没有改动模型、生成参数或原始提示词内容。HTML 缓存版本更新为 `20260912-resource-mentions-ime-1`。

验证：4 项新增组合输入事件回归和 8 项既有引用路由检查通过；语法及 runtime 一致性检查通过。测试模拟组合事件顺序，不代表已经完成 Windows 原生输入法交互验收。未运行视频生成。

安装包在 `particle-editor-desktop/dist/h3-prompt-ime-update` 构建，交付 `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe`，包内输入脚本和 HTML 与源文件哈希一致。正式客户端需覆盖安装并重开；Program Files 安装目录没有直接修改。4783 仍不可达，入口检查 NO-GO，未进行浏览器点击验收；8188 直接探测可达。
