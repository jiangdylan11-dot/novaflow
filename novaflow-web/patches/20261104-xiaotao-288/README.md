# 小桃 2.0.288：冻结补丁与发布记录

2026-11-04：网站、控制面、生成后台和小桃后台已发布 2.0.288；控制面部署号末尾 _110，小桃后台 _114。本机当前仍运行 2.0.286 算力助手，其真实登录、自然心跳和分享权限已核验；288 安装器尚待安装。实际网页已识别本人 Qwen Image 2.1 节点，并以 512×512、25 步完成一张符合描述的文生图；一次下发网络失败经确认未创建任务后，手动复测成功。本地 9B 的文生图、单图图生图、音乐和视频提示词已实际写回，但图生图真实生成仍因完整安全图片绑定协议未接入而不可用。不得用这些局部补丁覆盖整个共享工作区；该工作区还有大量无关未提交内容。

## 网页和控制面

`web-runtime-287-to-288.patch` 从实际 287 可读源码 `work/xiaotao-assignment-retry-287/baseline/renderer/novaflow-web-runtime.js` 到实际 288 源码 `work/xiaotao-assignment-retry-287/renderer/novaflow-web-runtime.js`，包含任务状态 GET 的有界读取重试和 Qwen Image 2.1 标准/Turbo 指定节点能力检测。基线与目标均为 LF，SHA256 分别为 `177bf4b98df00936e2e3db0357c23ffcbaff97029655dfe50fa871a5a61bdea5` 和 `cca94ba4343b6df55a9897c5e5fed857ba8d02878ee73ac634cd50ff886fa7fc`。补丁已在隔离副本执行 git apply 检查与实套，并逐字节重建目标；不要直接套到有其他改动的共享源码。对应已压缩网页资源 SHA256 `34f6602146adf03caed97eb5381697798c1473ac329dc00e8899799254209aa3`，编辑器缓存键 `34f6602146`。

`control-bundle-287-to-288.patch` 是 287 实际冻结自包含入口到 288 入口的字节差异（虚拟路径 `control-bundle/index.ts`），包含受登录用户和指定节点约束的 Qwen Image 2.1 标准/Turbo 能力响应以及版本更新。基线 SHA256 `d3c785a2d4883dfa03a32231066eaac65a81e504e35f82291d617abf65b9e221`，目标 `d21cc06d4136f2e7de947ce182b6a331df4cdef842bc959746097604fa4c749c`；已隔离实套并逐字节重建。它不是拆分源码的直接补丁。

`web-entries-287-to-288.patch` 精确记录 index.html、editor.html 和 release.json 对 287 冻结树的增量；以原始字节生成并在隔离副本逐字节复建，不要重排或更改行尾。网页静态树相对于 287 限定变化上述三项和 `novaflow-web-runtime.js`，没有全量重建 dirty 工作区。

## 算力助手

`worker-empty-claim-backoff.patch` 基于 287 完整助手源码，只缩短确定空队列后的领取等待；故障、错误状态与忙碌保护仍沿用已有逻辑。原 287 worker-core SHA256 `40f4021a7fab3946aeb0078f3d76afbf982e42bc402b37398d674584b8669fcb`，候选 `04e5d37f36e84e1553626d9cdeccf0e9cd3ade04769a538b686d950a2530ef7d`，补丁 SHA256 `fb5e892ffbc0b1be69fad083face5550189e301487c9c8ba1ce79acb86fb5c0c`；已在独立副本检查和实套。项目源码和独立 288 构建副本的相关测试均为 7/7，包括标准两秒轮询实际计时、服务失败退避、暂停恢复及任务完成后的重置。

隔离构建的完整 computeOnly 288 安装器 SHA256 `eaa3e3955cd18d0d1dc5e0abee514bad735c7d809d4c218995064e22f755aae6`，未签名。实际从安装器提取 227 项后与同次构建逐项核对；相对 287 文件集合不变，仅可执行文件、包版本、worker-core 和共享版本四项变化。构建结果不代表已安装或完成真实节点验收。

## 封存和测试

`manifest-288.json` 的 SHA256 为 `1e6da9fc6fc202c084f8f746f978d78d1513666774bf11458ca6ca744fc2e844`。287 基线和 288 候选均为 739 项；288 静态树 SHA256 `5920351e6d0b0d2994290feced35d7e3b1d1af51451f88ea84f0b609743993c2`，ZIP SHA256 `3ccdae78c1ca93862274200adaf6443d66c85e12cd25cd1a83f7525104e2871c`。实际 ZIP 存于 `work/xiaotao-local-288-20261104/site-packages/5920351e6d0b0d2994290feced35d7e3b1d1af51451f88ea84f0b609743993c2/`，本目录不复制大包。

`release-288.mjs` 是审阅固定的发布 helper 副本，SHA256 `45ae8bd4212c682fc70f89bf88e3ca8c3b3cb06e98fd4082895dd5c75e0245e8`；`official-entry-288.patch` 记录五个正式入口的严格分支。helper 固定工作目录、工件及版本顺序，本副本不是可随意搬移的独立部署包。`release-288.test.mjs` 的 7 项纯函数检查通过。其余测试文件是实际项目或隔离候选测试的文本副本，保留原相对 import，只供追溯，不应直接在本目录作为完整项目运行。

本目录不包含账号、密钥、节点身份或登录/心跳 proof。打包、模型提示词、实际生成和线上各端验收必须分别判断。
