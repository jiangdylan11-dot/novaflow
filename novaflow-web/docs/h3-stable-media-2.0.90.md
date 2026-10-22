# H3 多参持续显示修正 2.0.90

入口：动画视频生成 → 本地 beta5 / 本地 beta6 → 多参视频。此轮只改多参内容显示、时长探测和对应测试；图片原始缩略图、横向排列、容量、@ 与实际输入绑定保持，图生和首尾模式未改。

## 根因与修复

已在 2.0.88 源码上执行正式运行时的独立晚到调用，复现黑底一闪消失。`stabilizeAiAnimationSourceOwnedUploadDropzoneVisuals` 每次刷新遍历所有 div/span，将名称条重写为 `position: static`、`background: transparent` 和 13px。上版只在布局阶段补回名称条，因此随后独立归一化仍会清除它。

修复后旧归一化明确跳过多参卡片拥有的内部内容，包含名称条和媒体行；标题恢复函数及非 source-owned 占位回退也作同样的多参隔离。没有新增监视器或定时器与旧写入抢最后一次执行。相同的晚到调用后黑底仍为 rgba(0,0,0,0.65)、absolute、bottom 0、12px。

视频/音频改成一个普通 flex 行：14px 小图标在秒数前，间隔 6px，整行在预览区域居中。取消两者的角落绝对定位；删除按钮保持右上。图片仍用原 img 分支。

之前 Panel 的时长探测随 tick/卸载取消并重新建立。本版按 sourceId 与实际 dataUrl 复用完成结果和进行中的独立元数据探测，模式/板块切换不再重启探测。冷载入读取前仍可短暂显示 --；成功后显示实际秒数；解码失败或十秒超时显示“时长不可用”并在提示中说明原因。没有将用户截图中的初始 -- 冒认为已确认永久读取故障。

## 验证与证据

源码和最终包内资源分别通过：

- 34 个既有实际生成区场景，两模型覆盖空/部分/每类满/9+3+3/连续添加/删除恢复/批量拖入/窄窗/横向滚动/持久化及 @ 交互。
- 新增 11 个时序场景：正式函数在 DOM MutationObserver 及 140 / 500ms 定时触发；命名混排在 2s / 4s 再触发，5.2s 采样仍稳定。断言黑底、字号、位置、图标秒数同行及整行居中；晚到写入后没有调用内容修复函数掩盖结果。
- 两模型各重复两次整个生成区卸载返回和两次多参模式卸载返回，原四份命名素材保持；额外媒体探测创建次数均为 0。两模型切换、IndexedDB 冷重开、添加删除、23.8s / 2.5s 显示继续通过。
- 损坏音频实际触发明确 error 状态，显示“时长不可用”，不永久保持 --；两模型均通过。
- 两模型真实 @ 候选、鼠标/键盘插入、sourceId 编译、删除重编号与失效引用检查保留通过。包内 worker-renderer 各 15 素材的队列保存、文件重映射、MiniMaxH3ReferenceToVideo 全部节点输入及存档重开检查通过。
- Node 合并 8/8、sync:runtime、check:runtime、check:entry 通过；entry 四个文件内部 48 / 63 / 138 / 32 项。测试使用模拟队列和测试端口，没有向现有 ComfyUI 提交 GPU 任务。

受控测试加载实际完整生成区、原卡片组件、index 样式、正式 ensureStyle 注入 CSS、上传/标题/占位/字体/图标/分辨率等晚到函数。MutationObserver 与时间触发由测试提供；空闲任务、独立可用宽度、关闭历史弹窗和 Window 函数 receiver 是适配。不是已登录完整应用或用户当前窗口的验收。

证据均位于 `worker/dist/h3-beta6-2.0.90/visual-check/`：

- `regression-2088-before.json`、`regression-fixed-after.json`：同一正式函数独立执行的修复前后差异。
- `beta6_int8-named-files-stable.png`：图标和秒数居中同行、三类统一黑底名称条。
- `beta5_int8-named-files-temporal.json`、`beta6_int8-named-files-temporal.json`：初始和 5.2 秒稳定后坐标/样式。
- `*-section-return-*-temporal.json`、`*-mode-return-*-temporal.json`、`persisted-reopen-temporal.json`：反复返回与冷恢复。
- `*-warm-cache.json`、`*-metadata-failure.json`、`*-mention-results.json`：探测复用、解码错误及引用绑定。
- `results.json`：34 基础场景与 exceptions=[]。

## 本地交付

另一窗口已提交姿势编辑器 2.0.89，本任务未回退或覆盖，故使用下一版 2.0.90。基于该提交之后的当前工作树打包，仅提交本轮相关文件。

`worker/dist/h3-beta6-2.0.90/NovaFlowSetup-2.0.90.exe`

142,332,451 字节，SHA256：`31723ec7cf9e02d85963e2bed694f1bd01ea6f3a3e20536e272d7d2798b518e6`。

包内 H3 media JS/CSS、resource 和 mention tool 与源码逐一哈希一致，正式 runtime 的包内函数直接参与上述测试。旧包均保留。没有自动安装、重启、显示登录窗口、接管前台、执行 GPU、网站或 Supabase 部署。用户自行安装并重开客户端后生效。

完整已登录应用、用户原素材及真实 GPU 生成仍未验收。显示隔离登录测试窗口的许可仍待回复，未执行；未绕过鉴权或复用/导出 token、浏览器 profile。16GB 显存下 9+3+3 的运行边界没有冒充通过。
