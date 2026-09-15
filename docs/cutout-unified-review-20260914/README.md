# 视频抠图统一版（2026-09-14）

入口改为一个纯文字“视频抠图”按钮，占满一行；处理后同一按钮显示“保存并关闭”。采用 AI 主体识别与色键透明度恢复，保留光效透明、投影、擦除、修复及羽化。

薄纱修正：去掉外部光色匹配置信度跨阈值时的硬切换，连续估计透明材质颜色；提高局部运动匹配的位置约束，减少静态褶皱被光点带动。

验证：39 项抠图测试通过；蓝幕、MiniMax、Scatter、Gloweyes、DivinePower 共 457 帧，经当前按钮与实际 PNG 导出完成。AI 遮罩为先前真实推理保存的原尺寸结果，按当前捕获 RGB 匹配回放，未重跑模型。预览由这些 PNG 直接合成，无额外后处理。

生命周期：四次关闭/重开、首尾帧、原比例和透明画面通过；独立按钮集成测试实际点击“保存并关闭”，成功编码、读取并提交 960×960 透明 WebM。按钮无图标，318px 按钮宽度与行宽一致。完整应用外壳的 4783 检查仍 NO-GO：本地入口不可达，另有 AI 特效集成检查未完成；本包供功能验收，不代表完整应用验收通过。

安装包：particle-editor-desktop/dist/NovaFlow Setup 2.3.214 - 视频抠图统一版-20260914.exe

安装包解压后的渲染代码、抠图核心、品牌界面代码及 main.js 与测试版本一致。版本号保持 2.3.214。

证据：logs/cutout-unified-20260914/package-verification.json、single-button-acceptance/report.json、close-reopen/report.json；docs/cutout-unified-review-20260914/index.html、acceptance.json。
