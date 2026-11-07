# 小桃：已记用量却没关闭的操作（2026-11-07）

现象：线上 2.0.341 验证中，规划响应在浏览器丢失，网页关闭请求比规划记账早 4 秒，没有结算，之后无人再关。
操作 6a469892 停在 open/recorded，预留 1.406797 一直占着。原清扫只处理 dispatched，管不到 recorded。

- 网页（55a670fa）：关不上时后台再试几次，覆盖服务端 80 秒模型上限。
- 数据库：`supabase/migrations/20261107120000_xiaotao_sweep_open_recorded_v3.sql` 扩展 `sweep_xiaotao_stale_dispatched_v3`：
  该用户下次报价时，已闲置 30 分钟、没有在途阶段的 open/recorded 操作按网页取消结算（已记用量照收，未记用量退回）。
  只替换清扫函数，不动任何被 readiness 固定哈希的函数。回滚：同目录 `rollback_20261107120000_...sql`。
- 只读查看当前卡住的操作：`list_open_recorded_readonly.sql`（2026-11-07 10:41 有 9 个操作的预留，含 6a469892）。

执行（仓库根目录，一次）：

    npx --no-install supabase db query --linked --project-ref cjakoblszlmbmotchzva --file supabase/migrations/20261107120000_xiaotao_sweep_open_recorded_v3.sql

执行后：每个账号下次在线报价时自动清掉自己的这类操作；不用重新部署后端。
