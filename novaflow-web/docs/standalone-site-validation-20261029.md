# 独立服务器备用验证包验收记录

用户因 Cloudflare 控制台持续提示 IP 限速、Wrangler 发布持续失败而评估其他发布方式。此项仅准备可审查的本机备用包；用户尚未购买服务器，后续也表达了费用可能不值得。没有购买资源、执行外部部署、更改 DNS、迁移 Supabase 数据或改变现有发布入口。

## 验证包

- 文件：`.artifacts/NovaFlow-Server-2.0.146-validation-ready.tar.gz`。
- SHA256：`1b01d7577306269c3483c990153ff4ff495c064ff8ea91c26a40aed787288213`。
- 网页基线：已验证的 2.0.146 网站 ZIP；700 个网页文件与该 ZIP 对应文件逐字节相同。只排除 Cloudflare 专用 `_worker.js`、`.assetsignore` 与 vendor 的 `.gitattributes`，网关使用不含内嵌密钥的维护源码，单独放在公开网页目录之外。
- 运行适配：Node.js 22+，复用原 `_worker.js` 会话验证，Caddy HTTPS 反向代理，systemd 普通用户服务配置。没有外部运行依赖包。
- 包含 705 个清单文件，实际遍历 tar 验证内容 SHA256；没有符号链接、密钥文件或账号配置。

## 本机通过

- 新增 HTTP 网关回归共 9 项（含 1 个父项），验证无密钥拒绝启动、公开登录页、错误/过期/伪造凭证、正确凭证、目录穿越、编码路径、公开根外链接、Range、HEAD、空文件、无效方法与 404。
- 既有登录网关 32 项通过，`npm run check:entry` 4 项通过。
- 从实际打包目录导入运行，监听本机临时端口，另做 6 项实际字节检查：公开 release=2.0.146、匿名业务代码403、测试签名下载正确业务文件、Range、HEAD及网关源码拒绝下载，全部通过。临时 HTTP 服务已关闭。
- 未启动生成模型或付费请求，不影响用户已有本机 NovaFlow 会话。

## 尚未验证

Linux 系统服务、Caddy 二进制配置校验、公开 DNS/HTTPS、正式认证密钥配置、真实用户登录、浏览器存储迁移以及完整编辑器交互均未验收；备用验证包不能称为已部署或已经可以替代线上站点。正式认证服务的签名密钥须先确认可在服务器上安全配置，不能用新随机值替代。

用户当前尚未确定购买服务器；没有实施迁移。现有 Cloudflare 发布仍需单独解决错误，Supabase 继续原有服务。

本机证据在 `work/standalone-site-test.log`、`work/standalone-entry-check.log`、`work/standalone-package-ready.log`、`work/standalone-archive-verification.json`、`work/standalone-runtime-verification.json`。
