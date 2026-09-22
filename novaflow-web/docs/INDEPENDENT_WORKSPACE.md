# NovaFlow 独立项目

## 当前状态

唯一维护目录为 `D:/AI_APP/NovaFlow-Web`。Git 对象、分支和历史均在本目录 `.git`，没有外部对象库或 linked worktree 依赖。旧 `D:/AI_APP/NovaFlow` 已删除。

网页、启动助手和后台最新有效改动已经合入；旧后台 HTTP 服务已切换到本项目 `novaflow-web/admin/admin-server/server.js`，继续监听 `127.0.0.1:4761`。桌面后台快捷方式及根目录“授权管理工具（双击打开）.vbs”均使用新目录。

旧迁移副本、临时日志、测试截图/执行记录、重复解压目录和过期安装包已清理，不再保留整份历史文件镜像。Git 历史保留，用于追溯源码。当前使用文档和教程资源保留。

## 维护和构建

| 内容 | 位置或命令 |
| --- | --- |
| 网页源码 | `novaflow-web/renderer` |
| 启动助手 | `novaflow-web/worker`；`npm run dev` |
| 后台 GUI | `novaflow-web/admin`；`npm run admin:start` |
| 后台 HTTP | `npm run admin:server` |
| 网页同步 | `npm run sync:runtime` |
| 运行文件、入口检查 | `npm run check:runtime`、`npm run check:entry` |
| 后台检查 | `npm run admin:test` |
| 助手、后台打包 | `npm run build:win`、`npm run admin:build` |
| AI 环境打包源码 | `tools/ai-runtime`、`tools/ai-runtime-h3` |

本仓库内部 `particle-editor-desktop` 仍包含助手使用的授权、LoRA 公共模块及相关测试，不等于已经删除的外部旧项目，不要整目录删除。`web-dist`、`worker-renderer` 和各 `dist` 为构建输出。

首次拉取后分别在 `novaflow-web/admin` 和 `novaflow-web/worker` 执行 `npm ci --workspaces=false`；Web 测试依赖见项目 README。环境打包工具的默认输出相对于当前项目定位。

## 本机配置与保留产物

- 后台配置继续使用 `%APPDATA%/novaflow-license-manager` 和 Windows 用户环境变量。
- 授权签名私钥保存在 `novaflow-web/admin/.secrets`，已校验与原公钥匹配；不进入 Git、公开网页或用户启动助手包。
- 用户授权、Worker 身份、模型和安装好的 AI 环境保留原位置。图像环境为 `C:/ProgramData/NovaFlow/AI-Runtime`，视频环境为 `C:/ProgramData/NovaFlow/AI-Runtime-H3`。
- 后台当前运行日志写入 `novaflow-web/admin/.runtime-logs`，不进入 Git。
- 当前启动器仍占用的 `.tmp-launcher-design-start.log` 和 `.err` 属于正在写入的运行输出，保留且不进入 Git；其他历史临时日志已清除。

仅保留以下最新发布产物及当前助手/后台的运行解包目录：

| 产物 | 路径 |
| --- | --- |
| 启动助手 0.4.4 | `novaflow-web/worker/dist/NovaFlowSetup-0.4.4.exe` |
| 后台管理 3.0.5 | `novaflow-web/admin/dist-admin/NovaFlow 后台管理 Setup 3.0.5.exe` |
| 网页正式配置发布包 | `.artifacts/novaflow-web-latest.zip` |
| 现存最新环境安装包 0.2.5 | `_exports/NovaFlow-AI-Runtime-Installer-0.2.5/NovaFlow-AI-Runtime-0.2.5.zip` |

环境 ZIP 解压后运行 `setup.exe`，保留同目录 `Runtime` 文件夹。该包是保留的现有环境包，不是本次重新制作的完整图像/视频整合包。

## 验证边界

独立 Git 连通性、后台 `/health`、原授权密钥匹配及用户/积分/节点/使用记录只读查询通过。最新环境 ZIP 全部条目 CRC 校验通过。拆层修复的执行行为测试、助手/本机服务/浏览器入口检查及后台契约检查通过，安装包关键文件已与构建输出核对。

本次迁移没有进行线上数据库写入、重新签发授权或真实 GPU 生成。产物没有自动安装到系统，也没有自动发布外网站点。
