# H3 中文编辑与英文执行复验

本次实现中文输入/编辑、英文模型执行，但金币视频替换效果仍未通过验收。不能把提示词校验成功或 Runtime 的 success 状态解释为效果成功。

## 已完成的链路修改

- 新客户端请求声明 `H3 response format: bilingual-v1`。Grok 返回相互对应的英文 modelPrompt 与中文 displayPrompt，各自保留完整六字段。旧客户端继续得到单份六字段，避免云端部署破坏旧版本。
- 编辑器只显示中文说明、中文字段标题及 UI 素材标签。实际采样使用英文模型正文。双语结果校验媒体来源、主体编号、任务和保留关系；阻止中文正文误作英文执行内容。
- 同一输入和素材可复用已校验翻译。中文编辑或素材变更会使旧翻译失效；重新打开后没有会话缓存时，会重新翻译，不能沿用旧英文。
- 本地接受等价的素材标签拼写及明确槽位名，仍拒绝不存在的素材。用户这句“把参考视频中的金币换成参考图1”走严格限定的本地编译路径，直接生成两种语言的明确替换关系，无模型推理。其他复杂要求继续走本地模型，不能把本例直接编译成功称为复杂请求的模型推理验收。
- 移除自动灰色运动轮廓处理：它抹掉了正反面/币边/光照线索，不能保证转向。补上被动英文及中文替换语句的图片准备识别，修正中文排版破坏 `[Shot 1]` 标记的问题。

## 实际素材与视频效果

参考是用户桌面的 `kling_20260903_VIDEO_Video1视频中的_4542_0.mp4`。桌面文件和本次 Runtime 输入副本 SHA256 相同：`3958a2efcf09d24d1e899601cddfebf49dc1fb0a877da54644511beadfa51110`。图片为用户失败任务实际使用的 `27_1789394327015_ac9a64.png`（透明背景猫金币），不是之前的小美元金币。

对照均使用相同时间点解码，见 `tools/h3-compare-reference-motion.py`。平面轮廓的宽度是无符号指标，不能独立证明旋转方向或角速度，也不据此推定转了 360 度。

| 条件 | 实际结果 |
| --- | --- |
| 上轮灰色轮廓 + 美元图片 | 图案保留，但未保证原视频转向和相位；旧成功结论撤回。见 `motion-comparison.jpg`。 |
| 取消灰色轮廓，中文正文，图片按源视频构图准备 | 猫图案仅开头出现，随后回到面具。任务 `a149b85f-fd8e-4dad-bb64-33ba8c5e2583`，见 `native-result/comparison.jpg`。 |
| 较大参考图，仅清理透明背景，中文正文（隔离试验，未采用） | 猫图案保留，但画面占比、转到侧面的时间明显偏离源视频。任务 `49a6fb71-0312-482a-b51a-1ccf6576e0a1`，见 `alpha-result/comparison.jpg`。 |
| 中文编辑内容 + 英文模型正文，原视频帧与原图片准备链路 | 仍然从猫图案回到面具，效果不合格。任务 `5254bc58-db36-43e5-986c-811b597fb9b6`，见 `english-result/comparison.jpg`。 |

最后一项实际模型输入见 `bilingual-local/model.txt`，中文显示见 `bilingual-local/display.txt`；图、视频、采样器连接见 `bilingual-local/coin-workflow.json`。输出是 `C:/ProgramData/NovaFlow/AI-Runtime-H3/generated/output/video/NovaFlow_H3_coin_reference_fixed_00005_.mp4`，beta5 INT8、4 步、640×640、24 FPS、73 帧、种子 1696013393。

Grok 的真实双语返回也已通过后端、编辑回填和再次生成的模块验证，见 `bilingual-grok/model.txt` 与 `bilingual-grok/display.txt`。这不是已安装 Electron 窗口点击验收。

## 验证与交付边界

45 项相关测试通过，覆盖双语绑定、旧客户端兼容、修改后重编译、标签归一化和原始视频帧连接。`sync:runtime`、`check:runtime` 通过。安装包按无版本递增流程构建；具体哈希及包内文件核对见 `package-verification.json`。

本轮最终 4783 入口检查失败，因为服务已停止；直接 8188 检查可用。自动审批拒绝重新启动 4783 的命令，工具只返回 blocked by policy。未把前一次 GO 状态用于本次最终验收，也未声称已更新 Program Files 中的安装程序。

官方多参规范要求模型正文使用英文，参见 [H3 Reference Prompt Guide](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)。这说明中英文需要分层，不说明某次采样必然实现精准替换。当前仍待解决的是同时保留目标图案、源视频方向/速度/相位的实际效果。
