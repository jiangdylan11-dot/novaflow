# NovaFlow Web 项目约定

- 本目录是唯一维护的独立 Git 仓库。日常开发、提交和构建都在 `D:/AI_APP/NovaFlow-Web` 内完成；旧 `NovaFlow` 项目已删除，不得再引用。
- 网页源码在 `novaflow-web/renderer`，启动助手在 `novaflow-web/worker`，后台管理唯一维护入口在 `novaflow-web/admin`。根目录 `particle-editor-desktop` 仍含助手依赖的授权和 LoRA 公共代码，不等于外部旧项目。
- 修改运行源码后执行 `npm run sync:runtime`、`npm run check:runtime`；涉及入口或功能集成时执行 `npm run check:entry`。纯文档不触发全量测试或打包。
- 用户要求打包启动助手时使用 `npm run build:win`；后台管理使用 `npm run admin:build`。网页发布使用 `novaflow-web/tools/package-site.mjs` 并显式指定正式控制面地址。不要使用旧桌面客户端的打包命令代替。
- 沿实际调用链验证到用户可见结果；分别说明源码、开发运行文件和已安装程序/线上站点是否更新。不能用构建成功代替功能验收。
- 保留无关的未提交工作。完成验证后仅提交本次相关文件并报告提交号；推送按用户指示执行。
- 后台的 `.secrets`、账号配置和环境密钥仅保存在本机，不进入 Git，不复制到公开网页或用户启动助手包。
