# Web 账户入口与弹框调整（2026-09-22）

## 范围

- 仅调整 `novaflow-web/renderer` 中的 Web 专用适配层。
- Web 动画「模式选择」和绘图「模式」中的共享账户卡隐藏，保留右上角账户入口。
- 未修改共享桌面账户组件、桌面布局或 `D:\AI_APP\NovaFlow` 本地项目。
- 本发布包同时包含前一提交的登录 LOGO 修复。

## 行为

- 账户使用原生模态 dialog，顶部栏和左侧一级导航均处于遮罩下面，弹框打开时背景不可交互。
- 显示账户名称、可用积分和提示词服务的剩余次数 / 总次数。
- 每次打开通过现有账户服务 `/api/client/bootstrap` 读取余额和 `providerQuotas.grok`，不从算力接口推断提示词配额。
- 读取失败显示未读取状态及「重新读取」，不伪装为零次；保留右上角叉号、Escape、点击空白关闭与焦点恢复。

## 验证

- `node novaflow-web/tests/run-tests.mjs web-renderer-build web-generation-routes web-account`：129 项通过（78 + 38 + 13）。
- 账户专项覆盖服务路由、认证头、小数余额、非零配额、503 错误不清除会话及未登录不发请求。
- 在完整 Web 构建的本地浏览器预览中，分别展开动画和绘图模式，确认两处重复账户卡均不可见。
- 实际打开账户弹框，确认积分与提示词次数可见，顶部栏和左侧导航被遮罩覆盖；Escape 和叉号关闭后恢复焦点。
- 浏览器预览使用本地测试账户（5,000.125 积分、12 / 30 次），这些数值只用于界面验收，不是线上账户余额；测试服务器和测试会话未打入发布包。
- `sync:runtime`、`check:runtime`、`check:entry` 已执行；这个 Web 工作区仍缺少桌面 `@jsquash/webp` 依赖及 renderer/dist 文件，桌面检查未通过。同步引起的两处纯换行变化已还原，未将 Web 调整写入桌面布局。

## 发布包

- `novaflow-web/.artifacts/novaflow-web-account-ui.zip`：13,472,891 字节。
- ZIP SHA-256：`e91d56a0af95098196d81d3cd1b85655524ee23939c0c90e21b84ded4c43da2f`。
- 账户脚本 SHA-256：`37b4623028d40a57ed9d443fcfd405a563854f1e9011a709892e8ffc7959f0fe`。
- Runtime 脚本 SHA-256：`5cb93838e37f4137bd3d31aa10791d07fed260016794d87db32e2aebbca3169f`。
- 已核对 ZIP 内两个脚本与源码逐字节相同，包含 LOGO，入口指向生产 Supabase 控制面和账户服务。
- 当前等待手动选择 ZIP 后发布；尚未宣称本次账户 UI 已在线上生效。
