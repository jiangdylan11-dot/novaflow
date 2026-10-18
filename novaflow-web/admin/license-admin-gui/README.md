# NovaFlow 后台管理

这是 NovaFlow 的独立后台管理端。当前按轻量后台执行：只保留授权、用户、积分和 AI Provider 必要配置，不保存任务记录、消费流水或完整 Workflow。

## 当前模块

- 仪表盘（含算力节点上的最近生成记录）
- 用户管理（账户类型：普通 / 中级 / 高级 / 团队）
- 授权管理
- 会员管理（积分与提示词次数同一张表；提示词次数可增加 / 扣减 / 设置）
- AI 服务
- 算力节点与注册码（节点分普通 / 高级；可删除离线节点、清理失效注册码和旧使用记录）

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
- 后台管理数据层已接入 Supabase 查询；未配置环境变量时自动回退 mock 数据。
- 用户管理支持管理员手动创建登录账号、设置初始密码、修改密码和维护用户状态；NovaFlow 主程序登录走后台服务账号+密码链路，不直连 Supabase Service Role。
- 积分管理支持管理员手动增加积分、扣减积分或设置余额；轻量版只更新 `credits.balance`，不写 `credit_logs`。
- 积分管理支持管理员手动分配提示词服务次数；轻量版只在 `system_settings` 中记录 `allocated_count` 和 `used_count`。
- AI 服务页只保留 Provider 配置、ComfyUI 只读连接检测和 ComfyUI 手动总余额。
- 客户端后续可用 `GET /api/client/bootstrap` 一次读取 session 用户、当前积分、客户端安全 AI 配置和 Gateway Lite 合同，减少免费后端请求量。
- `/api/ai/tasks` 当前只做 Gateway Lite 前置检查：验证 session、用户状态和积分余额，后台计算 `credit_cost`；不调用 AI、不扣积分、不写任务记录、不保存 workflow。

## Supabase 配置

后台管理端读取：

- `NOVAFLOW_SUPABASE_URL`
- `NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY`
- `NOVAFLOW_SUPABASE_PUBLISHABLE_KEY` 或 `NOVAFLOW_SUPABASE_ANON_KEY`

未配置时，用户、积分、AI 服务和基础设置页面使用 mock 数据。配置正确时，右上角显示 `● Supabase Connected`；缺少配置时显示 `● Mock`；连接或查询失败时显示 `● Supabase Error`。

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
- mock 数据只读，不允许假写入。
- 用户必须已存在于 `users` 表。
- 每个用户在 `credits` 表只应有一条余额记录，schema 草案通过 `credits_user_id_unique_idx` 约束这一点。
- 轻量版不保存 `credit_logs`。这会降低免费数据库写入量，但也意味着后台不提供消费审计。

NovaFlow 客户端不能直接判断或修改积分。真正 AI 调用前，未来后台服务必须检查 `credits.balance`，余额不足时拒绝任务。

## 提示词服务次数分配

提示词服务次数按用户手动分配，当前底层 Provider 为 Grok，用于提示词优化和反推：

- 每个用户的次数存为 `system_settings.provider_quota_grok_<user_id>`。
- 只记录 `allocated_count`、`used_count` 和 `remaining_count`。
- 后台服务提示词服务调用成功后只把对应用户的 `used_count + 1`。
- 不保存 prompt、messages、任务记录、消费记录或 workflow。
- `NOVAFLOW_GROK_API_KEY` 只允许配置在后台服务/后台管理运行环境中，不写入 renderer，不提交仓库。
- 后续新增 Provider 时同样只允许把 API Key 配置在后台服务/后台管理运行环境中，不能写入 NovaFlow 客户端。
- ComfyUI 不做次数限制，真实生成成功后按用户积分扣费；AI 服务页的 ComfyUI 手动总余额会同步扣减，用于人工维护平台剩余总积分。

## ComfyUI Provider 检测

后台管理端可读取以下本机环境变量，用于 AI 服务页 ComfyUI Provider 连接检测：

- `NOVAFLOW_COMFYUI_BASE_URL`，未配置时默认 `https://cloud.comfy.org`
- `NOVAFLOW_COMFYUI_API_KEY`
- `NOVAFLOW_COMFYUI_API_KEY_SECRET_REF`，仅用于显示/记录服务端密钥引用，当前没有 secret resolver 时不能替代真实环境变量

检测只在 Electron 后台管理侧执行，通过 IPC 返回状态给 renderer；后台服务也提供只读 HTTP 检测路由：

```text
GET /api/admin/providers/comfyui/status
```

Renderer 不直接持有 Key，也不直接请求 ComfyUI。当前只调用官方只读用户接口：

```text
GET https://cloud.comfy.org/api/user
Header: X-API-Key
```

余额字段只从官方返回体中的 `credits`、`credit_balance`、`balance` 等字段读取；如果官方接口未返回余额字段，则显示 `官方余额 API 未开放`。后台管理页另提供 `ComfyUI 手动总余额` 输入框，把平台页面看到的余额人工录入到 `system_settings.provider_budget_comfyui`；后续用户 ComfyUI 生成成功后，后台会同步扣减用户 `credits.balance` 和该手动总余额。

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

AI 服务页新增 RunningHub 国内站配置与只读账户检测。保存到本机后台环境变量，API Key 不回显；Key 留空保留原值，清空必须显式勾选。普通刷新只读取配置或上次检测结果，保存成功或点击“检测账户”才调用 `POST /uc/openapi/accountStatus`，不提交生成或 LLM 请求。余额与运行任务数为上次检测快照。

配置变量：`NOVAFLOW_RUNNINGHUB_BASE_URL`（默认 `https://www.runninghub.cn`）、`NOVAFLOW_RUNNINGHUB_API_KEY`、`NOVAFLOW_RUNNINGHUB_LLM_BASE_URL`（默认 `https://llm.runninghub.cn/v1`）、`NOVAFLOW_RUNNINGHUB_LLM_MODEL`、`NOVAFLOW_RUNNINGHUB_GPT_IMAGE_ENDPOINT`、`NOVAFLOW_RUNNINGHUB_GOOGLE_IMAGE_ENDPOINT`。后三项可留空；图片模型路径从国内站模型文档复制，以 `/openapi/v2/` 开头。

本阶段仅新增服务商配置，尚未迁移 GPT / Google 的 ComfyUI 生成链路与 Grok 提示词服务，也未启用 RunningHub 积分计费。模型 API / LLM 需企业级－共享 Key，账户检测成功不能证明某个模型已获授权或调用成功。配置不自动同步到线上后端，线上使用时需在对应后端单独配置密钥。

官方账户接口：https://www.runninghub.cn/runninghub-api-doc-cn/api-425748943

验证：`npm run admin:test`；`npm --prefix novaflow-web/admin run test:runninghub-ui` 使用真实页面和 preload、隔离的模拟 IPC，不读写实际 Key、不发外部请求。
