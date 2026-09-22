# 安全边界

## 三类身份

| 令牌 | 前缀 | 谁签发 | 有效期 | 能做什么 |
| --- | --- | --- | --- | --- |
| 用户会话 | `nfs_` | **现有的 `novaflow-backend`** | 24 小时 | 自己的任务、自己的 Worker 列表、给自己的任务换凭证 |
| Worker 身份 | `nfw_` | `novaflow-web` 控制面 | 24 小时 | 心跳、上报自身硬件与模型、领任务、推进**分给自己的**任务 |
| 文件凭证 | `nfg_` | `novaflow-web` 控制面 | 上传 15 分钟 / 下载 1 小时 | 对**一个** task 的**一种**操作 |

三个前缀互不为前缀，一类令牌不可能被当成另一类使用（`protocol` 套件断言）。

**Web 线从不签发 `nfs_`**，只验证。这意味着即使整个 Web 控制面被攻破，
攻击者也无法凭空制造一个用户身份——用户体系仍然只由现有后端掌握。

## Worker 绝对没有什么

按规格要求逐条确认：

| 不该有 | 实际情况 |
| --- | --- |
| Supabase `service_role` key | 没有。Worker 只跟控制面的 HTTP 接口说话 |
| Grok API Key | 没有。Worker 代码里不存在任何 Grok 调用 |
| 后台管理员 Token | 没有 |
| 全用户读取权限 | 没有。`/api/web/*` 全部拒绝 `nfw_` 令牌 |
| 修改积分的权限 | 没有。扣费在控制面完成，Worker 只报成功/失败 |
| 改 `system_settings` 的权限 | 没有 |
| NovaFlow Web 完整源码 | 没有。安装包里只有 Worker 自己的代码和共享协议 |
| Admin 源码 | 没有 |

Worker 能做的，就是上面表里 `nfw_` 那一行。它不能管理别的 Worker、不能查用户、
不能碰不属于自己的任务（`security` 套件里都有对应的拒绝用例）。

## Worker 凭证怎么存

```
worker_secret_hash = sha256("novaflow-worker-secret:v1:" + worker_id + ":" + secret)
```

明文只在 Worker 自己机器上的 `identity.json` 里。数据库被读走也拿不到可用凭证。

一个 `worker_id` 注册过之后，必须出示当前 secret 才能再次注册（轮换）。
拿注册码是抢不走已有 Worker 的——`security` 套件有专门的劫持用例，期望 409。

## 文件凭证为什么安全

凭证用**该 Worker 专属的派生密钥**签名：

```
grant_key(worker) = HMAC(control_secret, "novaflow-web-grant-key:v1:" + worker_id)
```

Worker 在注册/领任务时拿到的只是自己那一把。所以：

- 它能验证发给自己的凭证（不用每个字节都回控制面问一次）
- 它**无法**为别的 Worker 伪造凭证（算不出别人的 key）
- 换个 task id 用 → `task` 字段不符，403
- 换台 Worker 用 → 签名验不过，403
- 下载凭证拿去上传 → `op` 不符，403
- 过期 → 401

这四条加上「无凭证 401」「伪造凭证 403」，`security` 套件逐条验证过。

## ComfyUI 隔离

```
公网 ──> Worker Gateway ──> 凭证校验 ──> 任务作用域 ──> data/tasks/<id>/...
                                                        （只读文件，不碰 ComfyUI）
                              Worker 内部 ──> 127.0.0.1:8188
```

- Worker 启动时校验 ComfyUI 地址必须是回环，`0.0.0.0` / 内网 IP / 公网域名一律**拒绝启动**。
- 网关只有 `/gw/*` 四条路由。`/prompt`、`/queue`、`/history`、`/view`、`/object_info`、
  `/system_stats`、`/upload/image` 全部 404（逐条测过）。
- 网关不是代理。它只从 `data/tasks/<id>/` 读写文件。

## 路径处理

文件名必须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` 且不含 `..`；
之后再用 `resolve()` 二次确认结果路径仍在该任务目录下。
两道都过不去的一律 400/404。测过的攻击串包括 `..%2F..%2F`、`....//`、
`%2e%2e%2f`、以及 `%00` 截断。

## 跨用户

别人的任务一律返回 **404**，不是 403——「不存在」和「无权访问」对外表现一致，
遍历 id 拿不到任何信息。读、换凭证、取消、列表全部如此。

## 积分不可篡改

- 定价只由服务端按**经过校验的业务参数**计算（`packages/shared/src/pricing.mjs`）。
- 浏览器发 `creditCost` / `chargeAmount` / `price` / `free` 都会被完全忽略
  （`protocol` 套件专门塞了这些字段验证）。
- 参数越界向**贵**的方向钳制，不会向便宜或免费的方向掉。
- Worker 只上报 `success` / `failed` 和执行元数据，不参与定价。
- 扣费走现有 `settle_comfy_usage`，`usage_key = comfyui:<prompt_id>` 唯一，
  重放完成请求不会二次扣费。
- 失败路径里**没有任何扣费代码**，所以失败不可能扣分。

## 数据库权限

五张新表全部：

- `ENABLE ROW LEVEL SECURITY` ＋ `FORCE ROW LEVEL SECURITY`
- `REVOKE ALL ... FROM anon, authenticated`
- 显式 deny-all 策略（`using (false) with check (false)`）——
  这样即使将来有人误 GRANT，拿到的也是零行而不是数据泄漏

十个新函数全部 `REVOKE ALL FROM public, anon, authenticated` ＋
`GRANT EXECUTE TO service_role`。

这与现有 Desktop 数据面的做法一致（`20260721020000_final_service_role_only.sql`）。
`sql-contract` 套件对每张表逐条验证。

## CORS

Edge Function 与 Worker 网关都返回 `Access-Control-Allow-Origin: *`，
但**从不**使用 `credentials: true`。授权完全来自 Bearer 令牌和一次性凭证，
不存在跟着请求自动发送的 Cookie 或环境凭证，所以通配 origin 不构成 CSRF 面。

## 没有做的安全工作

见 [LIMITATIONS.md](LIMITATIONS.md)：速率限制、Worker 端 TLS、结果内容审核、
Worker 代码签名。
