# NovaFlow 当前源码构建

网页源码统一维护在 `novaflow-web/renderer`，不再使用旧桌面客户端的 renderer/dist 镜像作为正式入口。

1. `npm run sync:runtime` 生成浏览器 `web-dist` 和算力端 `worker-renderer`。
2. `npm run check:runtime` 检查当前仓库、内部依赖和文件同步。
3. `npm run check:entry` 检查助手、本机服务和浏览器路由。
4. `npm run build:win` 打包启动助手；`npm run admin:build` 打包后台。

网页发布包需要显式填写正式控制面地址，详见 [部署说明](novaflow-web/docs/DEPLOY.md)。生成包不会自动安装或发布。
