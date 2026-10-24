# 用户本地八参考对比页发布（仅 work）

`publish-user-reference-suite.py` 是离线发布脚本。它不启动 GPU/服务，不读取任意 URL，不编辑图片，不改产品源码。当前没有执行发布。

页面复用现有 `manifest.json` / `data.js`：每组新增一个“参考＋真实成图”比较卡；原生完整提示词和 graph/历史/原始 SSE/视觉审核证据可查看。每张均为“待用户验收”。原有 accepted/top、反馈、排序字段和值不改，不继承旧暗色 r10 的认可。

计时分开：每卡为本次真实 request 秒、`enqueueToSuccessfulHistorySeconds` 和 `individualJobFullSeconds`。前者标明“入队→成功历史”，含提交/排队/模型执行/历史轮询，不能称纯采样；后者另含入队前准备/上传、下载校验与 free 释放等待，已包含前者，不能相加。`uploadSeconds` 实际是 run_job 开始到入队前，包含其他服务 idle 检查，不冒称纯网络上传。共享模型生命周期在一个独立区列示。中断后的原批次和续批按实际两次 load/unload 各计一次；总数不摊给每卡。两个 batch wall 时长之和不包含中间人工复核间隔，不能称整轮用户等待时间。原失败记录留存；离线验证视图必须绑定原 request/raw/events 的字节 SHA，不能把重新编写的 prompt 当原生结果。

## 输入

- `--suite`：原冻结 `suite-manifest.json`，八组真实参考，原有协议文件不改。
- `--generation-map`：独立 JSON，`suiteId` 与原 suite 相同。`analysisBatches` 列真实原 session / continuation session 的 `resultPath`（不能使用合并汇总文件冒称一次 load）；`cases` 八项，每项 `name` 为原 case id、`analysisDir` 指独立 `native-validated/<原case>/flash-analysis`，`generationDir` 指实际 native-batch harness 的 `jobs/<formal-case-id>` 目录。可选 `analysisValidationPath`，默认 `analysisDir/native-validation.json`。
- `--visual-review`：根代理实际看完八张后写的 `visual-review.json`。必须包含 `suiteId`、`reviewedBy`、`allGpuJobsCompleted:true`、`allGenerationTasksTerminal:true`、`analysisResourcesReleased:true`；`cases` 八项各含原 `name`、真实 `outputSHA256`、`visualReviewed:true`、具体 `notes`。这是根代理的结束/看图声明；脚本不声称查询了实时 GPU。`qualityAccepted` 不作为发布条件，并且发布输出始终不继承或自动给出用户认可。

示例结构：

```json
{
  "suiteId": "user-eight-v10n-20261025",
  "analysisBatches": [
    {"label": "session-1-original", "resultPath": "suites/user-eight-v10n-20261025/batch/result.json"},
    {"label": "session-2-continuation", "resultPath": "ROOT_SET_ACTUAL_CONTINUATION_RESULT_PATH"}
  ],
  "cases": [
    {
      "name": "usr8-bright-v10n-20261025",
      "analysisDir": "suites/user-eight-v10n-20261025/native-validated/usr8-bright-v10n-20261025/flash-analysis",
      "generationDir": "ROOT_SET_ACTUAL_COMPLETED_GENERATION_DIR"
    }
  ]
}
```

实际需完整八项，不能直接运行上面仅示意一项的 JSON。路径相对于 generation-map 文件目录，绝对路径也可以。

## 操作

先离线验证；不带 `--write` 不写任何 gallery 文件：

```powershell
python work/qwen-reference-adapter-research/cross-style-generalization-20261025/publish-user-reference-suite.py --suite <原suite-manifest.json> --generation-map <真实八项map.json> --visual-review <visual-review.json>
```

根代理确认验证结果后，在同一命令末尾加 `--write`。新证据不可变，现有 id/资产不同则拒覆盖；gallery 在验证期间变化会停止。`data.js` 与 `manifest.json` 按现有 work 发布器的顺序分别原子替换，两文件整体不是事务；若写文件阶段受系统错误中断，需要先核两文件再处理，不能盲目重复运行。

直接读取 `native-batch-harness-20261025/run-native-batch.py:run_job` 的真实凭证格式：`result.promptId`、单个 `output`、`originalAnalysisRecord`、`nativePromptPath/SHA256`，以及原生 `references.json` 的 `graphName/upload`、`graph-diff-proof.json`、`queued.json`、`history.json`、每任务 `release.json`。不要求也不补造旧式 `provenance.json`、生成目录 `prompt.txt`、`result.id/outputs/totalSeconds`。gallery 中新增的 proof 是这些真实原凭证的绑定索引，不冒称原运行器产物。

本 harness 的完整原生提示词必须逐字节等于实际 graph 正向，不做编号转换或补写。实际图必须为原始 1280×960 PNG，Qwen-Image-2.1-Turbo-BF16 GGUF、真实 SamplerCustom CFG3、专用8步 sigmas、seed54792256、空负向、源图对齐 node5 latent；历史完成状态、参考上传名和 SHA 均核对。冻结正式图与实际图只可更改两图上传名和保存前缀。

聚焦 CPU 契约测试：

```powershell
python work/qwen-reference-adapter-research/cross-style-generalization-20261025/test-publish-user-reference-suite.py
```

这些测试覆盖计时/释放、原失败保留、原生全文/SSE、未结束/未看图拒发布等局部契约。未来完整八输出的 dry-run 和实际浏览器展示仍须由根代理在真实凭证齐全后完成，不把 CPU 测试当视觉验收。
