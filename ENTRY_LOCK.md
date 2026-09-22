# NovaFlow 当前运行入口

- 唯一开发仓库：`D:/AI_APP/NovaFlow-Web`。旧 `D:/AI_APP/NovaFlow` 已删除。
- 网页源码：`novaflow-web/renderer`；助手：`novaflow-web/worker`；后台：`novaflow-web/admin`。
- 从启动助手打开本地浏览器工作台，默认 `http://127.0.0.1:4784/`，授权和本机连接由助手处理。
- 后台 GUI：`npm run admin:start`；后台 HTTP：`npm run admin:server`，默认 `127.0.0.1:4761`。
- 修改网页后执行 `npm run sync:runtime`、`npm run check:runtime`，入口集成执行 `npm run check:entry`。
- `web-dist`、`worker-renderer` 和各 `dist` 是生成产物，不直接修改。
- 源码、安装包、已安装程序和线上网页分别验证，构建成功不代表已安装或已发布。

详见 [独立项目说明](novaflow-web/docs/INDEPENDENT_WORKSPACE.md)。
