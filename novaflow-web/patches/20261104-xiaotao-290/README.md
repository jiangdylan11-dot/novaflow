# 小桃 2.0.290 补丁与发布记录

本目录记录基于已发布 2.0.289 源码的三份前端源码增量。**当前推送分支的完整运行源码仍为旧基线，并非完整的 2.0.290 源码；仅凭本目录不能重建或声称源码已与线上完整对齐。** 补丁只适用于下列 SHA-256 指定的 289 基线，不能直接假定可应用于此分支的旧源码。

| 源文件 | 289 基线 SHA-256 | 290 候选 SHA-256 | 补丁 SHA-256 |
| --- | --- | --- | --- |
| `novaflow-brand-runtime.js` | `6a623170ad64617a167eae5d0b1da5b73660fa7287796b2f49f2fbf2ea4370c5` | `1f31ba2aa562b55cf93b7ceeb771753ecb6efd7b2c079a2488a4c7907b6a29d7` | `941b227bd0fccbde37727af5894c838808cf1b49f266961b937abe16db672546` |
| `xiaotao-foart-tools.js` | `155582f9387cb0c2f87eaf1eafb5b0f444be6cd19f35dc663b70695fcde778ce` | `e081f1035ccdd81940afb2a50a9413608b1464adbfaf9a07f78673b234aae520` | `d0f8ea5323c108f7604d76c9d5bad00e973703d1429cf4b7e87570c3925cd78f` |
| `xiaotao-art-agent.js` | `2ea773f7308fc60e22b243886252169702d3592eca70f15cb4ddc6bac9103b4f` | `6469341ff1ebe1a0fc8bee7f9629689bcd2facca039a868059cd3a2953a49ce3` | `706f486227926b61f3dcecfb803a75a4e8e8340e8662f3a276ea681da58b80cb` |

`xiaotao-art-agent.js` 候选源文件为 CRLF，补丁按 LF 生成以避免整文件换行差异；候选源转为 LF 后的 SHA-256 为 `3cc338c430e50d4a5f95e7ce509951c3f6bf5a2354900b5971b1d86ec4c61cc4`。

`novaflow-brand-runtime.js` 与 `xiaotao-foart-tools.js` 共同修复纯提示词优化后的手动生成路径，保留执行提示词、反向词、参考图角色和张数；用户修改相关内容后不使用过期准备稿，显式代理生成仍保留原有保护。`xiaotao-art-agent.js` 含本地图片优化能力的有限刷新，并移除“反推图片”“分析画风”按钮。

2026-11-04 发布：网站 2.0.290、控制面 2.0.290（部署 `_112`）、生图后台 2.0.290（响应头无部署编号）、小桃后台 2.0.290（部署 `_116`）已部署；发布工具内置版本及源码核对通过。网站包 SHA-256 为 `b725d40a4a9b762b65b8ecc19f84dcddcac65f7ff2e05d5b68be8b2be74c469a`，封存 manifest SHA-256 为 `0008831cea26d91cb78865be544ba7fdcf3ccd461f3484f9ef1b5ef0258a1904`。

`Foart-2.0.290-Setup.exe` 已构建，尚未安装或发布下载；本机当时仍在运行并分享 2.0.289。应用户要求，未进行线上优化后生成的功能实测，最终 `xiaotao-art-agent.js` 候选修改后也未再测试。此前纯优化及相关路径的隔离测试通过 39 项；这些结果不代表线上端到端或真实 GPU 验收。
