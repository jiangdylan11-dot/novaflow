# Spine 序列工程导出

序列帧页开启「导出 SPINE 序列工程」后，默认输出 `名称.json` 和 `images/名称_0000.png` 等原尺寸图片，不生成 atlas。勾选「打包图集」后显示「打包设置…」，输出 `名称.json`、`名称.atlas`、`名称.png`（多页为 `名称_2.png` 等），供匹配版本的 Spine 运行时播放。

当前接入粒子序列和 AI 特效序列；普通 PNG、视频和骨骼工程原有导出入口保持原通道。控制面、数据库和生成任务协议不涉及此功能。

## 共用模块

- `novaflow-web/renderer/spine-sequence-atlas.js`：PNG 编码、透明裁边、无旋转 MaxRects、图集页和 Spine JSON、文件写入结果检查。
- `spine-sequence-atlas-ui.js` / `.css`：共用勾选和设置窗口；设置以 `novaflow.sequenceAtlas.settings.v1` 保存在本地浏览器。
- 当前页面的 bundle 负责调用现有渲染器逐帧输出，再交给模块；测试从页面入口提取实际导出函数，避免只测独立样例。

其他模块接入时，应使用自己的逐帧渲染器，再调用 `createWriter({ baseName, version, packed, settings, write })` 的 `addCanvas` / `addRgba` / `addPng`。若已有多画板或特殊动画时间轴，使用 `finish(existingJson)` 保留动画定义。`createFileWriter({api,dir,handle})` 对原生 API 或浏览器目录句柄写入；原生写入的 `spineSequenceNamed` 标记避免二次命名和背景处理。异常时应调用 `dispose()`。

默认最大页 2048×2048、间距 2、裁边阈值 0、边缘复制和透明颜色填充；PMA 默认关闭。保留裁边原尺寸和偏移，保留全透明帧。PNG / RGBA8888 / Linear / ClampToEdge；不旋转，超过容量自动增加页。单帧超出页尺寸时明确报错，不自动缩放。Spine 3.8 atlas 不写新版本 `pma` 字段；选择 PMA 时，使用方需要配置相同混合方式。

## 验证

`node --test novaflow-web/tests/e2e/spine-sequence-atlas.test.mjs novaflow-web/tests/e2e/particle-spine-export.test.mjs`

覆盖默认无 atlas、名称一致、矩形尺寸、裁边像素还原、空白帧、间距与多页不重叠、PMA 字节、写入失败、实际粒子和 AI alpha 导出调用、视频原始逐帧通道、面板开关和 Hook 顺序、官方 Spine 3.8/4.0 读取。

4.1/4.2 官方运行时附加验收使用官方 npm 包 `@esotericsoftware/spine-core@4.1.24` / `@4.2.19`，分别解包到 `.artifacts/spine-runtimes/4.1/package` / `4.2/package`，将 `dist/index.js` 用 esbuild 打为该版本目录的 `runtime.cjs`。上述测试会执行原生 Sequence 的逐帧播放和裁边偏移检查；未安装这些测试夹具时明确跳过这两项。测试运行时不进入网页或助手包。

运行源码更改后执行 `npm run sync:runtime`、`npm run check:runtime`、`npm run check:entry`。安装包和网页包须分别构建并核对内嵌静态资源。构建及运行时数据验证不代替浏览器操作、Spine 编辑器导入或线上验收。
