# 小桃 2.0.289：冻结补丁与发布记录

2026-11-04：网页、控制面、生图后台、小桃后台及本机算力助手已对齐至 2.0.289。实际本地对话验证余额不变、不显示旧线上扣费；切换到在线模型时可见上次在线记录，再切回本地时隐藏。真实节点对话任务的排队时间实测为 2.66 秒；网页结合已安装 289 助手实际生成一张 512×512、25 步的红色陶瓷杯图片，页面显示约 39 秒且画面符合描述。

**尚未完成：图生图生成的安全绑定。** 上述对话与账务验证不代表该生成链路或实际图像效果已通过验收。共享工作区仍有大量无关未提交内容，不得全量覆盖或清理。

## 业务源码和网页

`xiaotao-billing-288-to-289.patch` 是实际候选的可读源码增量：本地免费操作不显示已结算的旧线上扣费，仍保留待核对事项；在线模型继续展示最近一条相关记录。基线 `work/xiaotao-billing-288-check/baseline/renderer/xiaotao-art-agent.js` SHA256 `d037545fac851a38e88cae51ba6eadb6444d188fac468edec252db7eb085f442`，目标 `work/xiaotao-billing-288-check/candidate/renderer/xiaotao-art-agent.js` SHA256 `2ea773f7308fc60e22b243886252169702d3592eca70f15cb4ddc6bac9103b4f`。补丁已在隔离基线上实套并逐字节重建目标；不能直接套用到已有其他更改的共享文件。`xiaotao-billing-display.test.mjs` 为相关项目测试文本副本，保留其原项目相对引用。

`web-entries-288-to-289.patch` 精确记录首页、编辑器和 release.json 对 288 冻结站点的字节差异，已隔离实套并逐字节验证。压缩后的 `xiaotao-art-agent.js` 是另一项变化：288 资产 SHA256 `fc1c6758e60a3077e56e1f3c72a4aed8e08f2e007e79d087851916792309ce2e`，289 资产 `575c616866efaa7a2589d18523bc9811277c54d10635b0f2a9ed67f649918ffd`。`xiaotao-art-agent-asset-delta.json` 和 `apply-web-asset-delta.py` 是小体积字节增量及校验工具；工具验证基线和目标 SHA，使用独占创建输出，已实际重建并与 289 资源逐字节对比。运行方式为 `python apply-web-asset-delta.py BASELINE_JS OUTPUT_JS`。

## 发布工件

`manifest-289.json` SHA256 `2b93a6c7dd916fba95d70f4128c0fe8d25f7a57ba00e9aa818ea5069ff8b3189`；288 和 289 站点各为 739 项。289 静态树 SHA256 `2ea23dfae044f9f14ae05d9e9ed4ab4e9008cb4e7bc8828f6d1ee1d859d4f5f9`，ZIP SHA256 `2a098381feb0576a453e755023371f403b8f0d5d30078b920a42051a5109586e`。大包保留于 `work/xiaotao-local-289-20261104/site-packages/2ea23dfae044f9f14ae05d9e9ed4ab4e9008cb4e7bc8828f6d1ee1d859d4f5f9/`，未复制到本目录。

`release-289.mjs` 为本次封存发布 helper 的文本副本，SHA256 `69efd7af3b432495feae7441ffc0190d0155bb9980356b9b5cc0517bcf1816dd`；`official-entry-289.patch` 为五个正式打包/部署入口的严格分支差异。helper 固定原工作目录和工件，不是可直接搬移的完整部署包；测试文件保留原相对路径，只供对照。

完整 computeOnly 289 安装器 SHA256 `e3a501a6097dc8da36218525d40301d4174fe1c10282d70e509ee2edff58583b`，包内入口为 `electron/compute-main.cjs`，载荷共 227 项。相对 288，助手源码仅同步版本，安装载荷变化为可执行文件、包版本和共享版本；安装结果与业务验收分别判断。

本目录不保存账号、密钥、节点身份或登录/心跳 proof。保留原始冻结包和无关未提交工作。
