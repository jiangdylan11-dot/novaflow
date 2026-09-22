# NovaFlow Web

本目录是独立开发仓库。新的网页编辑器、启动助手和后台管理统一在这里维护。

| 工作 | 路径或命令 |
| --- | --- |
| 网页源码 | `novaflow-web/renderer/` |
| 启动助手 | `novaflow-web/worker/` |
| 后台管理 | `novaflow-web/admin/` |
| 启动助手开发版 | `npm run dev` |
| 启动后台 | `npm run admin:start` 或双击根目录“授权管理工具（双击打开）.vbs” |
| 构建及检查网页 | `npm run sync:runtime`、`npm run check:runtime`、`npm run check:entry` |
| 打包启动助手 | `npm run build:win` |
| 打包后台管理 | `npm run admin:build` |
| AI 环境打包工具 | `tools/ai-runtime/` |

源码维护入口是上面三个目录。`web-dist`、`worker-renderer` 和各 `dist` 为构建输出，不直接修改。
旧 `D:/AI_APP/NovaFlow` 项目已删除；本仓库内部的 `particle-editor-desktop` 仍包含授权和 LoRA 公共模块，不能整目录删除。

迁移记录、依赖安装及发布说明见 [独立项目说明](novaflow-web/docs/INDEPENDENT_WORKSPACE.md)。

历史迁移副本、测试记录、临时日志和旧安装包已清理；历史源码仍可通过 Git 查看。本机只保留最新发布产物：

- 启动助手：`novaflow-web/worker/dist/NovaFlowSetup-0.4.4.exe`
- 后台管理：`novaflow-web/admin/dist-admin/NovaFlow 后台管理 Setup 3.0.5.exe`
- 网页发布包：`.artifacts/novaflow-web-latest.zip`
- 现存最新环境安装包：`_exports/NovaFlow-AI-Runtime-Installer-0.2.5/NovaFlow-AI-Runtime-0.2.5.zip`，解压后运行 `setup.exe`。
