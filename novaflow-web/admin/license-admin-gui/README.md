# NovaFlow 后台管理

这是 NovaFlow 的独立后台管理端。积分流水在 `credit_ledger`，算力任务在 `web_ai_tasks`。后台不保存完整 Workflow 与生成产物。

## 当前模块

- 仪表盘（RunningHub 国内站余额、最近积分扣费与算力任务）
- 用户管理（账户类型：普通 / 中级 / 高级；同时在线与有效期）
- 授权管理
- 会员管理（单一积分余额：充值、扣减、设为；原因写入 `credit_ledger`）
- AI 服务（RunningHub、功能单价、积分流水）
- 算力节点与注册码（节点分普通 / 高级；可删除离线节点、清理失效注册码和旧使用记录）
- 专业经验（主内容区审核，不使用弹层）

内部目录、IPC 和脚本名保持兼容，`license-admin-gui` 不重命名。

## 启动

在 `novaflow-web/admin` 目录执行：

```bash
npm start
```

Windows 也可以继续使用仓库中已有的 VBS 双击入口启动。后台服务骨架可单独启动：

```bash
npm run server
```

该服务默认监听 `127.0.0.1:4761`，管理员 HTTP 接口需要 `NOVAFLOW_ADMIN_API_TOKEN`。

## 当前范围

- 授权管理沿用现有功能，可查询、创建/更新、启用、停用、删除授权，并可签发和校验 `license.nfl`。
- 后台管理数据层已接入 Supabase 查询；未配置环境变量时列表为空并提示未配置，不展示假数据。
- 用户管理支持管理员手动创建登录账号、设置初始密码、修改密码和维护用户状态；NovaFlow 主程序登录走后台服务账号+密码链路，不直连 Supabase Service Role。
- 会员管理通过 `admin_adjust_feature_credits` 在同一事务里更新 `credits.balance` 并写入 `credit_ledger`。
- AI 服务页只配置 RunningHub API Key，并做免费的 accountStatus 检测。在线图像和语言模型只走 RunningHub。本地 Comfy 不在此配置。
- 客户端后续可用 `GET /api/client/bootstrap` 一次读取 session 用户、当前积分、客户端安全 AI 配置和 Gateway Lite 合同，减少免费后端请求量。
- `/api/ai/tasks` 当前只做 Gateway Lite 前置检查：验证 session、用户状态和积分余额，后台计算 `credit_cost`；不调用 AI、不扣积分、不写任务记录、不保存 workflow。

## Supabase 配置

后台管理端读取：

- `NOVAFLOW_SUPABASE_URL`
- `NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY`
- `NOVAFLOW_SUPABASE_PUBLISHABLE_KEY` 或 `NOVAFLOW_SUPABASE_ANON_KEY`

未配置时，用户、积分、AI 服务和算力页面是空态，右上角显示 `● 未配置`，写入会被拒绝。配置正确时显示 `● Supabase Connected`；连接或查询失败时显示 `● Supabase Error`。

`service role key` 只允许后台管理端或后续后台服务使用，不要写入 renderer，不要打包进公开客户端，也不要用于 NovaFlow 主程序客户端直连。Renderer 只能通过 IPC 调用 `admin-data.js`，不能直接 import Supabase。

Windows 下后台工具和后台服务都会先读取进程环境变量；如果进程环境缺失，会再读取当前用户环境变量注册表，便于免安装包直接启动后连接后台。

## 用户管理

用户管理页提供后台管理员手动开户能力：

- 创建 Supabase Auth 登录身份，并写入 `users` 档案。用户可见账号不要求邮箱格式，后台会映射为内部 Auth 邮箱。
- 账号规则为 2-64 位小写字母、数字、点、下划线或短横线，例如 `artist01`、`ops_team`。
- 同步创建该用户的 `credits` 当前余额，默认建议为 0，再由管理员手动分配。
- 用户列表支持搜索，并可更新启用状态。
- 用户列表支持修改密码。主程序没有找回密码入口，忘记密码时由管理员修改。
- 用户列表支持删除无效/测试用户。删除前需要输入账号确认；后台会删除 `credits`、`public.users`，并在能匹配到 Supabase Auth 身份时一并删除登录身份。

主程序不开放用户自注册。`POST /api/auth/register` 当前返回 `410 Gone`，正式用户由后台管理软件创建账号和初始密码后再发给用户。

当前主程序不使用邮箱验证码邮件。Supabase 邮件品牌只在后续重新启用邮件确认、找回密码或通知邮件时需要配置。

## 积分分配

积分管理页提供后台管理员手动操作：

- 增加积分
- 扣减积分
- 设置余额

写入要求：

- 必须配置 `NOVAFLOW_SUPABASE_URL` 和 `NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY`。
- 未配置 Supabase 时拒绝写入，并说明原因。
- 用户必须已存在于 `users` 表。
- 每个用户在 `credits` 表只应有一条余额记录，schema 草案通过 `credits_user_id_unique_idx` 约束这一点。
- 调整必须填写原因。成功后可在 AI 服务的积分流水里按用户查看。`credit_logs` 不再作为运营入口。

NovaFlow 客户端不能直接判断或修改积分。真正 AI 调用前，未来后台服务必须检查 `credits.balance`，余额不足时拒绝任务。

## 单一积分

在线文本、视觉和出图只走 RunningHub，使用 `NOVAFLOW_RUNNINGHUB_API_KEY`。默认 LLM 地址是 `https://llm.runninghub.ai/v1`，默认模型是 `xai/grok-4.7`。计量走 `credit_ledger`。失败或审核不扣积分。本地功能单价为 0。

- 不要把 Key 写入页面、renderer 或仓库。
- 不保存完整 Workflow 与生成产物。
- 旧配额迁移只留在 AI 服务的维护区，会员页不再分配。

## 已退出的在线供应商

在线供应商只有 RunningHub。`NOVAFLOW_COMFYUI_*` 与 `NOVAFLOW_GROK_*` 不能通过后台写入。本地 Comfy 仍由算力节点自己上报版本。

## Supabase 初始化顺序

1. 在 Supabase SQL Editor 手动执行 `supabase-admin-schema.sql`。
2. 先建 `users`。
3. 再建 `credits`。
4. 再建 `ai_providers`。
5. 最后建 `system_settings`。

现有 `licenses` 授权逻辑保持原有配置和原有代码路径。

## 授权记录删除

授权列表和授权详情区都提供删除入口：

- 列表内删除按当前记录 `id + license_key` 删除单条授权记录。
- 详情区删除按 `license_key` 删除匹配记录；如果历史数据存在重复 `license_key`，会一起删除。
- 删除前需要输入授权码二次确认。
- 删除只影响 `licenses` 授权记录，不删除用户、积分或签名密钥。

## 当前保留表

- `users`
- `licenses`（现有授权系统）
- `credits`
- `ai_providers`
- `system_settings`

当前不创建或使用：

- `credit_logs`
- `ai_tasks`
- `ai_models`

## 安全要求

- 不要把 API Key 写死到前端。
- 云端 AI 调用后续应通过后台服务转发。
- 后台服务只负责登录、Session、授权验证、积分检查、Provider Key、HTTP 转发和必要扣积分。
- NovaFlow 主程序负责 Workflow、Prompt、图片、参数、模型选择等 AI 创作逻辑。
- 私钥不要发送给用户，不要提交到仓库。
- 更换签名密钥会导致旧授权文件失效。
## RunningHub 国内站服务商

AI 服务页只把 RunningHub API Key 写入本机后台环境变量 `NOVAFLOW_RUNNINGHUB_API_KEY`。页面用密码框，保存后清空输入，响应和日志都不回显 Key。留空表示不修改，清空必须显式勾选。地址、LLM 和 GPT 路径只读：图像默认国内站，语言模型默认国际站 `https://llm.runninghub.ai/v1`。普通刷新只读取配置或上次检测结果；保存成功、点击「检测账户」或「刷新国内站余额」才调用 `POST /uc/openapi/accountStatus`，不出图、不调用语言模型。

真实 Key 只留在后台进程。不要写入仓库，不要写入公开网页，不要回显。示例文件里的该变量保持为空。

账户检测成功只说明 Key 能读到账户状态。

官方账户接口：https://www.runninghub.cn/runninghub-api-doc-cn/api-425748943

验证：`npm run admin:test`；`npm --prefix novaflow-web/admin run test:runninghub-ui` 使用真实页面和 preload、隔离的模拟 IPC，不读写实际 Key、不发外部请求。
