# 小桃：在线模型失败后卡住的预留（2026-11-06）

现象：小桃多风格"各自生成一次"，豆包这一步在线模型没有返回（超时/失败），网页显示"工具操作未全部完成 / 在线请求中断，账单状态待核对"。
原因：服务器只在模型成功返回时才结算；模型失败时阶段停在 dispatched，预留既不收也不退，网页只能提示待核对。

代码修复（本次提交）：
- 服务器（xiaotao-operation-v3-art-adapter / ports / companion-art-business）：模型调用失败、超时或用量无法记录时，当场用
  `reject_xiaotao_operation_stage_v3` 释放该阶段预留，再用 `finalize_xiaotao_operation_v3_refund` 把整个操作按 0 结算，
  返回 `provider-failed`，网页显示"在线模型这次没有返回结果，本次未扣费，可以再试一次"。模型调用加 120 秒上限。
- 网页：所有小桃提示里的"账单状态待核对 / 请核对账单"字样去掉；多风格各自生成时，一张失败其余照常生成，最后列出未完成的。

数据库（线上，Dylan 在 SQL Editor 执行，不改函数，不影响 readiness 哈希）：
1. `list_stuck_holds_readonly.sql` 看有哪些卡住的预留。
2. `refund_stuck_holds.sql` 释放并退款（超过 10 分钟仍是 dispatched 的）。可重复执行。
