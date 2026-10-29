# Cloudflare 部署异常诊断摘要

用于准备官方排查资料，尚未发送或提交工单。发布工具 Wrangler 4.154.0，目标 Worker `novaflow`，网页版本 2.0.146。

## 观察到的两个问题

1. 用户通过浏览器访问 Cloudflare 控制台，反复看到 `Rate Limit Exceeded / This IP address has been rate limited`，并反馈等待数小时仍存在。尚未确认触发该限制的具体请求来源、规则或解除条件。
2. Wrangler 发布停在 `POST /accounts/<account>/workers/scripts/novaflow/assets-upload-session`，返回 HTTP 500、代码 10013 和固定未知错误提示。在该阶段未上传资产或创建新站点版本。尝试时间包含 2026-10-29 07:43、07:44、07:45、07:48、08:04 UTC（北京时间分别加8小时，用户本地 Asia/Bangkok 加7小时）。没有将持续失败归因于免费套餐，也没有证据证明账号被封。

两者是否同因仍需 Cloudflare 后端关联日志确认。用户提供的 LAX CNI 2.0、Workflows 和 D1 状态页公告具有各自影响范围，不能仅凭同时发生就认定是本次上传失败的根因。

## 已核对的本机产物

- 146 网站 ZIP：703 个文件，没有增删；与已发布的 145 ZIP 相比，仅 core/UI、index 和 release 四个文件内容变化。
- ZIP、关键压缩文件和安装包载荷校验通过；失败发生在上传会话接口，不是本机编译或 ZIP 生成阶段。
- Cloudflare 登录令牌到期后已由 Wrangler 正常刷新，域名读取 API 随后成功；`foart.net` 尚未添加。命令授权没有创建域名的编辑权限，未擅自扩展授权。
- 为避免持续请求，没有部署重试循环或定时任务；不通过切换 IP、修改鉴权或更换上传入口来规避限制。

原始、已脱敏的本机 Wrangler 输出保存在 `work/release-2.0.146/wrangler-deploy*.log`，其中最后一次重试为 `wrangler-deploy-later-retry.log`。如需 Cloudflare 私下关联，应提供相关请求时间、账户和 Worker 标识；公开报告使用上述脱敏路径。密钥、令牌和账号配置不应作为公开附件。
