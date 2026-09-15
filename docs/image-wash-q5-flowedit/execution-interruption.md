# 2026-09-12 执行中断排查

发现并修复了一个明确的 Windows 中断触发点。不能据此断言所有历史中断都有同一原因。

## 证据链

1. 多次工具中断发生在 `test_qwen3_nf4_cache.py` 启动时。其缓存锁测试先用当前测试进程 PID 检查存活状态。
2. `prompt_assistant/qwen3_vl_adapter.py` 的 `_pid_alive` 原先无平台区分地调用 `os.kill(pid, 0)`。
3. [CPython 的 Windows 实现](https://github.com/python/cpython/blob/3.13/Modules/posixmodule.c) 把信号 0 当作 `CTRL_C_EVENT` 传入 `GenerateConsoleCtrlEvent`，不能当作 POSIX 的无副作用存活探测。没有控制台路径时还可能进入进程终止 API。
4. 本任务对应的 Codex 桌面日志在 `2026-09-12T15:22:03.523Z` 记录 `transport_closed`、`closeCode=3221225786`（`0xC000013A`），随后自动重连，任务状态为 `interrupted`。此前有工具输出缺失错误。该退出码与控制台中断吻合；未故意重现旧代码的中断行为。

日志文件：`C:/Users/jiang/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/Codex/Logs/2026/09/12/codex-desktop-4d18ac2c-cc14-4671-81d1-c2351a0bb992-16996-t0-i1-151501-0.log`。

## 修复与验证

- Windows 使用 `OpenProcess(SYNCHRONIZE)`、`WaitForSingleObject(handle, 0)` 和 `CloseHandle` 只查询状态，不发送信号、不结束进程。
- 只在确认 PID 不存在或进程已经退出时报告死亡；访问被拒绝和查询失败保留锁，避免误抢正在构建的缓存。
- 使用等待结果识别退出，避免把已退出进程的退出码 259 当作仍在运行。
- Windows 测试拦截所有 `os.kill` 调用：未来若回归，测试报错而不会再次中断控制台。
- 缓存测试 9 项通过，包括真实子进程查询及自然退出、活动锁保护、失效锁恢复、访问拒绝与句柄关闭。
- 洗图分析 5 项、预览分析 2 项、JavaScript 洗图和运行时检查 16 项通过，共 32 项。
- 修复已同步到工作区 `dist/win-unpacked/resources/app` 副本，`check:runtime` 通过；未重新打包安装器。
- `check:entry` 仍为 NO-GO：4783 未响应，8188 直接探测成功，另列出 AI 特效接管集成未完成。入口检查日志为工作区 `.tmp-wan-source-entry-check.log`。

## 独立存在的限制

另两次自动审批明确拒绝了候选节点安装/Runtime 重启，以及剩余 GPU 验证启动；仅返回 `blocked by policy`，没有具体原因。这与上述进程查询错误是两类记录，不能混为一谈，也未通过另一条执行路径绕过拒绝。

Q5 画质仍待低、中强度及摄影、三维完整回归，软件默认仍为原版 Wan。修复执行中断不等于完成模型替换。
