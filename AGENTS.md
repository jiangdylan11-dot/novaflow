# NovaFlow Web 项目约定

- 本目录是唯一维护的独立 Git 仓库。日常开发、提交和构建都在 `D:/AI_APP/NovaFlow-Web` 内完成；旧 `NovaFlow` 项目已删除，不得再引用。
- 网页源码在 `novaflow-web/renderer`，算力助手在 `novaflow-web/worker`，后台管理唯一维护入口在 `novaflow-web/admin`。根目录 `particle-editor-desktop` 仍含助手依赖的公共代码，不等于外部旧项目。
- 唯一维护架构是「Foart 官网编辑器 + Foart 算力助手」。旧本地启动入口停止维护，不再作为制作、验收或发布路径；不得再交付旧 `FoartSetup` 本地工作台包。算力助手使用 `electron/compute-main.cjs`、`computeOnly: true` 和 `electron-builder-compute.json`，仅由官网进入编辑和提交任务。保留仍被算力助手引用的公共能力，不能把共享代码误当成旧入口删除。
- 修改运行源码后执行 `npm run sync:runtime`、`npm run check:runtime`；涉及入口或功能集成时执行 `npm run check:entry`。纯文档不触发全量测试或打包。
- 用户要求打包算力助手时使用 `npm run build:win`，执行前确认该命令走算力助手配置，产物为 `FoartComputeSetup`，包内入口为 `compute-main.cjs`；若仍指向旧启动助手，先完成架构合并，不能照旧打包。后台管理使用 `npm run admin:build`。网页发布使用 `novaflow-web/tools/package-site.mjs` 并显式指定正式控制面地址。不要使用旧桌面客户端的打包命令代替。
- 每次发布打包或部署前都要升级统一应用版本号，同步 `packages/shared/src/release.mjs`、Web/worker 的 package.json 与锁文件及 Edge 共享副本；同一次发布的打包和部署共用该版本。网站统一按 `novaflow-web/wrangler.toml` 使用 `wrangler deploy` 发布 Worker 和静态资源，部署后核对线上 `release.json` 和入口版本。
- 控制面使用 `npm --prefix novaflow-web run deploy:control` 发布自包含入口，核对真实 `/health` 版本与部署编号，并验证机器登录和心跳响应的权限字段。管理端源码已更新、CLI 返回成功都不能替代线上协议验收；不得用旧控制面覆盖算力助手所需的机器权限协议。
- 沿实际调用链验证到用户可见结果；分别说明源码、开发运行文件和已安装程序/线上站点是否更新。不能用构建成功代替功能验收。
- 保留无关的未提交工作。完成验证后仅提交本次相关文件并报告提交号；推送按用户指示执行。
- 后台的 `.secrets`、账号配置和环境密钥仅保存在本机，不进入 Git，不复制到公开网页或用户启动助手包。
