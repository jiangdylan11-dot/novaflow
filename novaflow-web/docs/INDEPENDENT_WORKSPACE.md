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

## 剩余迁移审计

- 旧分支比 Web 分叉点多出的 9 个提交逐项核对：6 个后台功能提交的最终文件已与 `novaflow-web/admin` 对照一致；3 个文档提交的最终记录补入 `docs/qwen-completion-fp8-restore-20260922.md`。
- 旧工作区未提交的有效运行修复合入 Web：SeeThrough 整头替换只移除独立 `face`，保留眉毛、睫毛、虹膜等图层参与后续合成。Web 入口更新缓存版本，新增 3 项执行行为测试。旧桌面版本号、旧测试缓存标记及完整原始补丁保存在本机迁移档案，避免覆盖 Web 自身实现。
- AI 环境打包脚本和 PM2 辅助脚本改为按脚本所在仓库定位，不再写入旧项目；历史 stable 检查默认检查独立仓库，只有显式指定 `NOVAFLOW_STABLE_DIR` 时才比较外部历史仓库。未启动自动提交监视器。
- 桌面“NovaFlow 后台管理”快捷方式指向本项目 `novaflow-web/admin/dist-admin/win-unpacked`；原快捷方式保存在本机迁移档案。Windows Run、计划任务和系统服务未发现旧源目录引用。

本机迁移档案位于 `.legacy-migration/20260923/`，不进入 Git 或公开安装包。`manifest.jsonl` 记录每个旧文件的原路径、SHA-256 和处理结果；相同文件复用本项目已有副本，其他文件复制并再次校验。`legacy-working-tree.patch` 保留旧目录未提交差异，`excluded-directories.jsonl` 记录未复制的依赖和缓存目录。旧 Git 历史已经迁入独立 `.git`，不重复复制；`node_modules`、Electron 下载缓存和 Python 字节码可重新生成。

用户账号、授权、Worker 身份和模型仍使用原本的机器配置与独立 AI 环境，不重建或清空。迁移不等于部署外网站点，也不自动覆盖系统已安装的启动器。

本次核对 389,489 个非缓存文件，复制逐文件 SHA-256 验证无错误。AI 环境和素材导出恢复在本项目 `_exports/`，其余独有历史文件在迁移档案 `files/` 中；最终 manifest 的 `stored_path` 均相对当前仓库根目录。原旧目录暂留，未删除。

本次验证：新增拆层行为测试 3 项、原入口断言 120 项、独立运行文件检查、后台契约及只读在线查询均通过。启动助手 `NovaFlowSetup-0.4.4.exe` 已重新构建，安装包内浏览器/Worker 拆层文件与构建输出哈希一致。正式配置的网页包在 `.artifacts/novaflow-web-latest.zip`，未发布。

**尚待服务切换**：旧后台 Node 进程 PID 44428 仍监听 `127.0.0.1:4761`。停止并替换该进程的自动操作被审批拦截；用户关闭应用窗口后检查仍存活，已请求明确确认仅切换这个后台进程。新服务的配置与旧 `/health` 脱敏配置一致，新代码的临时端口 `/health` 与在线只读查询已通过。确认后从本项目执行 `npm run admin:server`，复核 4761 的进程路径和配置；在这一步完成前，不将旧目录标记为可删除。
