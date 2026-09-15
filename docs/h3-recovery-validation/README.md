# H3 优化与反推修复验证（2026-09-14）

本次用户未提供失败时的原提示词。以下使用同一张现有赛博角色图片分别绑定首、尾帧，验证双槽位传递与闭环动作；不等同于用户原素材验收。

## 已确认的问题与修复

- 正式客户端日志显示 FL2VA 优化连续两次以“详细提示词缺少镜头行为”失败，总耗时 284271 ms。移除 Python、桌面 JS、Edge 与浏览器校验器中的字面关键词硬门槛；保留五段结构、时长、引用和实质优化校验。
- 截图中的 EPIPE 堆栈来自绿幕测试脚本的 console.log。正式主进程和该脚本均增加仅针对 EPIPE 的输出管道保护；其他错误继续暴露。正在运行的旧进程须退出后重新启动才会载入修复。
- 本地主进程对子进程 stdin 的错误增加拒绝待处理请求与清理逻辑；write 的同步抛错和异步失败均清理请求计时器，避免等待整个推理超时。
- 反推请求明确携带 h3Mode、durationSeconds，并经本地主进程转发，减少从生成说明文本中解析状态的依赖。Grok 优化同步携带当前 contentPolicy；未将其缺失认定为已证实的失败根因。
- 本地模型入口移除“快速处理”的速度承诺。

## 真实模型结果

| 路径 | 耗时 | 结果 |
| --- | ---: | --- |
| 本地首尾帧优化 | 105490 ms | 真实 Python 服务 JSON 行请求，首次返回；通过 renderer validateAndRestore |
| Grok 首尾帧优化 | 9710 ms | 真实 Grok Responses 请求，首次返回；通过共享五段与内容校验 |
| 本地双图反推 | 69142 ms | 真实 Python 服务、两次视觉分析；通过 renderer validateAndRestore |
| Grok 双图反推 | 37392 ms | 真实 Grok 两次视觉分析、正式编译器；通过 renderer validateAndRestore |

输入、模型输出、服务日志和校验结果保存在本目录。优化输出采用用户要求的五段格式；反推保留既有 H3 视觉事实编译协议。

Grok 测试直接调用已配置的提供商，不包含用户账号登录、计费或正式客户端 IPC 网络转发。没有取得用户原场景的正式 UI 全链路通过证据。

## 回归与交付

- JavaScript 41 项通过；Python 5 项通过。包括真实 stdout 读取端断开后进程仍存活的回归。
- sync:runtime、check:runtime 通过。
- check:entry 为 NO-GO：锁定入口 4783 不可达；8188 直探可达。上一轮启动入口的操作被自动审批拒绝，未绕过该限制。
- Supabase novaflow-backend 已部署为 v60，状态 ACTIVE。
- 安装包 `particle-editor-desktop/dist/NovaFlow Setup 2.3.214 - H3优化反推修复.exe`，250129408 bytes。
- SHA-256：`4d8f5d928463dc2c7f9338e0c7c11c667e41130c788271e96efd82670a34d83c`。
- 从最终安装包解压的 8 个关键文件与源文件逐一哈希相同，见 package-files.json。
- 未覆盖 Program Files 中已安装的应用；需用户运行新安装包并重新启动客户端。
