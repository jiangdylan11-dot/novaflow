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

源码维护入口是上面三个目录。`web-dist`、`worker-renderer` 和各 `dist` 为构建输出，不直接修改。
旧项目目录保留作归档；本仓库内部的 `particle-editor-desktop` 仍包含授权和 LoRA 公共模块，尚不能整目录删除。

迁移记录、依赖安装及发布说明见 [独立项目说明](novaflow-web/docs/INDEPENDENT_WORKSPACE.md)。
