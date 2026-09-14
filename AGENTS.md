# NovaFlow 项目约定

- 修改运行源码后，用 `npm run sync:runtime` 同步并执行 `npm run check:runtime`；涉及运行入口或功能集成时执行 `npm run check:entry`。纯文档变更只检查内容和差异，不触发全量测试或打包。
- 界面、生成和保存问题沿实际调用链验证到用户可见结果。区分源码、桌面运行文件和安装包；确认相关文件同步，分别报告入口可用与实际功能验证结果。
- 完成并验证后，主动提交本次相关改动并报告提交号；保留其他未提交工作，排除临时日志和测试产物。推送远程按用户指示执行。
- 用户要求打包时，默认使用 `npm --prefix particle-editor-desktop run build:win:nobump`，核对包内文件并提供安装包路径及验证结果。
