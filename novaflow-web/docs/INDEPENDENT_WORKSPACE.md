# 独立项目迁移（2026-09-23）

## 当前结构

`D:/AI_APP/NovaFlow-Web` 已从旧项目的 linked worktree 转为独立 Git 仓库。当前分支仍为 `feature/novaflow-web`；迁移前 HEAD `ce014f2`、两个分支及所有已有 refs 保持不变。对象通过 `--mirror --no-hardlinks` 复制，无 `objects/info/alternates`，`.git` 和 common-dir 均位于本目录。迁移前工作区无已跟踪未提交修改；未跟踪文件与本机环境文件未覆盖。

旧目录 `D:/AI_APP/NovaFlow` 保留，未删除或改名；其中其他未提交修改未动。仅将其不再使用的 Web worktree 注册信息移到迁移备份目录，旧仓库不再将此目录视作工作树。

本机回退资料在 `D:/AI_APP/.NovaFlow-Web-migration-20260923`：原 Git 指针、index、worktree 元数据、迁移前 refs/status、后台来源文件摘要。它是运维备份，不是本项目运行依赖。原仓库没有远程，本次也未设置远程或推送。

## 后台迁移

后台最新源版本来自旧仓库 `be77d3c`，迁入 `novaflow-web/admin/`，包含授权、用户、积分、AI 服务、算力节点、注册码及 Web 使用记录。GUI、IPC、在线授权、签名模块、管理服务和提示词策略一并复制，沿用原行为；只调整目录、独立 npm 配置和 userData 定位。

后台维护入口现在是 `novaflow-web/admin`，根目录历史 `particle-editor-desktop/license-admin-gui` 仅为旧源码存档，不再作为本项目后台构建输入。`particle-editor-desktop` 内仍有启动助手使用的公钥、授权校验和 LoRA 共用模块，这些是本仓库自身文件，与旁边旧目录无关。

- `appId`、产品名及 `%APPDATA%/novaflow-license-manager` 不变，继续使用已保存的管理端配置和 Windows 用户环境变量。
- 原授权签名私钥已复制到本机 `novaflow-web/admin/.secrets`，已被 Git 排除，签名/公钥匹配校验通过；没有重新生成密钥或签发测试用户授权。
- 私钥只属于管理员安装包，不进入公开网页和用户启动助手包。此文件不会随 Git clone 自动取得，换开发机时需要从管理员备份恢复。
- 模型、AI 环境、用户机器授权、Worker 身份和线上数据库没有迁移或清空。

## 常用命令（仓库根目录）

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动助手开发入口 |
| `npm run admin:start` | 启动新版后台 |
| `npm run admin:server` | 启动管理 HTTP 服务 |
| `npm run sync:runtime` | 构建 Web 与 Worker renderer |
| `npm run check:runtime` | 检查独立 Git、内部依赖和浏览器运行文件同步 |
| `npm run check:entry` | 助手、浏览器路由和本地服务入口测试 |
| `npm run admin:test` | 后台原有功能契约检查 |
| `npm run build:win` | 打包新版 NovaFlow 启动助手 |
| `npm run admin:build` | 打包后台管理，不自动升级版本号 |

首次拉取源码后，在根目录执行 `npm --prefix novaflow-web/admin ci --workspaces=false` 和 `npm --prefix novaflow-web/worker ci --workspaces=false` 安装各自依赖。完整 Web 测试依赖按 `novaflow-web/README.md` 安装。双击根目录“授权管理工具（双击打开）.vbs”也会进入新的 admin 目录。

网页发布仍使用 `novaflow-web/tools/package-site.mjs` 显式指定正式 control-url，普通 renderer 构建会写入开发配置，不能将其直接当正式站包发布。

## 验证

- Git refs、HEAD、index 和工作区状态在切换前比较一致；新仓库对象连通性检查通过，无外部对象库依赖。
- `sync:runtime`、`check:runtime`、`check:entry` 通过。120 项入口断言使用隔离服务/身份，未替代真实 GPU 生成验收。
- 后台契约检查通过；独立 Electron 实际加载 admin 页面、preload 无报错，读取原 userData 和已保存在线配置成功。
- 新后台对现有 Supabase 的用户、积分、算力节点、使用记录只读查询均返回 connected；管理服务临时端口 `/health` 返回 200。未执行线上增删改或扣费。
- 新后台与启动助手均从本仓库独立打包；最终包内入口/模块文件与源码逐项哈希核对。

安装包是本机产物，尚未覆盖系统已安装版本；外网站点没有发布变更。旧源目录目前作为回退档案保留。
