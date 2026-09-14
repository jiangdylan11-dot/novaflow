# NovaFlow 项目约定

- 修改后做与任务相称的验证；运行文件变更后执行 `npm run sync:runtime`、`npm run check:runtime` 和 `npm run check:entry`。界面或生成问题应验证实际调用链，静态检查不能代替真实效果。
- 完成并验证后，主动提交本次相关改动并报告提交号；保留其他未提交工作，排除临时日志和测试产物。推送远程按用户指示执行。
- 用户要求打包时，默认使用 `npm --prefix particle-editor-desktop run build:win:nobump`，核对包内文件并提供安装包路径及验证结果。
