# 普通云服务器网站验证包

此包用于验证现有 NovaFlow 网页迁至 Linux 服务器的可行性，不表示已完成线上迁移。复用已验证的 2.0.146 网页文件，不重建前端，不修改现有 Cloudflare 站点、DNS、账号、扣费、数据库或算力节点。当前域名为 `foart.net` 和 `www.foart.net`。

## 内容与验证范围

- `web-dist/`：正式网页文件，控制面和认证仍使用既有 Supabase 地址。
- `deploy/_worker.js`：复用现有登录网关的会话验签和公开文件白名单；不复制可能嵌入密钥的构建副本。
- `deploy/standalone/server.mjs`：无第三方依赖的 Node HTTP 适配，缺少会话密钥即拒绝启动；仅通过鉴权网关提供文件，支持流式响应、HEAD 和单段 Range。
- `Caddyfile`：`foart.net`、`www.foart.net` 的 HTTPS 入口，全路径反向代理到本机 3000 端口。
- `novaflow-site.service`：以独立普通用户运行，只监听 127.0.0.1，不将网页目录交给另一套静态服务器直接开放。
- `manifest.json`：源文件与复制文件的 SHA256 清单。包中没有实际密钥或账号配置。

本机测试使用真实网关和测试签名，验证登录页、匿名/伪造/过期凭证、有效凭证、路径穿越、外部文件链接、媒体范围与 HEAD。尚未验证 Linux 系统服务、Caddy 配置实际加载、公开 HTTPS 证书、真实用户登录或模型调用。

## 服务器准备

选普通 Linux 服务器即可，网站不在此机器执行 GPU 生成。需公网 IP 和能提供 HTTPS 的网络条件；套餐地域、带宽、流量包、续费价以及适用的域名接入要求，在购买前确认。建议先用短周期做实际访问验证。

服务器应安装 Node.js 22 或更新的受支持版本、Caddy，以及支持 systemd 的 Linux 系统。示例服务文件假定 Node 位于 `/usr/bin/node`，实际路径不同需先调整 `ExecStart`。解压包到 `/opt/novaflow-site`，使此目录直属 `package.json`、`web-dist` 和 `deploy`，创建普通服务用户 `novaflow` 并授予这些文件只读权限。

## 密钥和启动

由管理员在服务器本机安全创建 `/etc/novaflow-site.env`，设置：

```text
NOVAFLOW_SESSION_SECRET=<既有正式认证服务使用的同一会话签名密钥>
```

不得换成新随机值，否则现有认证服务发出的会话无法通过验签；不得从网页文件读取或嵌入密钥，也不要将密钥发到聊天或加入 Git。环境文件只允许管理员读取，由 systemd 注入服务。上线前必须先确认能够安全取得既有密钥。

复制 `deploy/standalone/novaflow-site.service` 到 `/etc/systemd/system/`，检查用户、路径、密钥与目录权限后加载并启动服务。此时先从服务器本机核对登录页可访问、未登录请求业务脚本必须 403，再配置 HTTPS。

## 域名与 HTTPS

阿里云 DNS 保持原提供商，添加 `@` 与 `www` 的 A 记录到新服务器的真实公网 IP；无需为此将域名接入 Cloudflare。具体记录在服务器公网 IP 确定后填写，验证阶段不修改 DNS。

将 `deploy/standalone/Caddyfile` 配置到 Caddy，先运行配置校验再启用。公开 80/443 端口，3000 端口不对公网开放。Caddy 负责申请和续期 HTTPS 证书；证书成功取决于 DNS、端口与证书服务验证，不能以本机 HTTP 测试代替。

上线后分别验证 `foart.net` 与 `www.foart.net` 的 release、登录、未登录代码 403、已登录编辑器与现有 API。域名改变后浏览器存储属于新 origin，需要重新登录；原站点的本机目录授权和浏览器内工程不会自动迁到新域名，应在切换前确认保存和重新打开流程。

## 回退

首次验证期间保留原 Cloudflare 站点和原包；只有新域名通过实际登录与编辑器验收后才更改默认入口。服务器网站迁移不会自动替换算力助手当前的 cloudflared 外网通道；它属于独立链路。
