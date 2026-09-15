# 绿幕光效透明抠图：实现与验收

2026-09-13，测试素材：`D:\some\2026_08金鏟鏟\MiniMax_H3_fl2v_00161_.mp4`。736×1280，24 fps，共 73 帧，原始 H.264 视频没有 Alpha，背景是近似均匀绿幕。

## 原因与修复

此前的分割、阈值和去溢色会把剑光的背景混色保留为暗色；对整张图去黑又会改变角色的不透明区域。此外，两条透明 WebM 导出路径对已经为直通 RGB 的 PNG 再次执行 `premultiply=inplace=1`，造成第二次变暗。实际编码回读测试中 `[30,160,240,64]` 变成 `[6,39,58,64]`；改用直通 RGB 后为 `[29,159,240,64]`。

新模块 `particle-editor/ai-sequence-green-screen-matting.js` 从图像边缘估计均匀绿幕颜色，联合求取软 Alpha 和去背景污染后的 RGB。发光区域保留连续透明度；绿色不占优势的主体像素保留原始 RGBA。接近幕色的小幅压缩噪声采用平滑抑制，避免反预乘后出现透明彩色杂点。均匀度不足或素材本来带透明度时，自动回退到原处理路径。

真实 React 抠图组件的共用最终合成器接入该模块，预览和导出共用结果；AI 和绿色色键模式均可使用。新增“绿幕光效保留”开关，启用时隐藏不参与运算的旧边缘参数。序列帧编辑中的擦除、修复、笔刷大小、羽化、全局/单帧编辑继续工作。色键取帧移到目标帧内部，避免小数时间边界把前一帧当作当前帧。

`main.js` 两条透明视频编码路径移除重复预乘，使用 VP9 实际支持的 `yuva420p`。模块已加入 HTML、renderer 构建和运行时同步检查列表。

这是针对均匀绿幕的光效提取，不是任意背景上的通用特效语义识别。绿色主体与绿幕仍可能混淆，可关闭开关或用笔刷修复。

## 已完成的验证

- 六项针对性测试通过：主体保色、软透明光效、压缩噪点、错误背景拒绝、笔刷语义，以及两条实际 FFmpeg 编码路径的颜色回读。
- Electron 加载实际应用 bundle 和原始视频，通过色键按钮导出全部 73 张 PNG；未模拟色键算法、视频解码或 PNG 导出。
- 实际画布操作：擦除改变 10016 个像素，羽化产生 9580 个软边像素，修复恢复 10016 个像素；笔刷面板可见。
- 73 帧与原视频相邻帧逐一比较，没有发现明显取帧错位。预览与同帧 PNG 的少量画布量化差不超过 1/255。
- AI 图片路径另用分割 IPC 替身验证：即使模型遮罩未包含光效，新路径仍保留遮罩外的软透明蓝光。图片黑屏回归同时通过；不将此项称为完整视频模型推理验收。
- WebM 全片回读：73 帧，Alpha 最大差 1/255；每帧保留软透明像素，左上角 100×100 背景区域最大 Alpha 为 0。ProRes 4444 全片回读最大 Alpha 差 2/255，因此 MOV 不宣称逐字节无损。
- 已查看灰底、白底的剑光细节及多个时间点；原先明显的黑色光晕边圈已消除。最终视觉验收交由用户确认。
- `npm run check:runtime`：PASS；`npm run check:entry`：Overall GO。补丁脚本重复运行无变化，主进程和 bundle 语法检查通过。

证据：`logs/green-screen-video-final/report.json`、`frame-alignment.json`、`mov-roundtrip.json`；`logs/green-screen-ai-image-final/after.json`。验收素材位于 `C:\Users\jiang\OneDrive\Desktop\NovaFlow\光效透明抠图验收_20260913`，包含透明 MOV、透明 WebM、PNG 序列、从透明 WebM 回读制作的灰白底预览和验证数据，音频沿用原视频。

## 亮背景硬边反馈与后续修复

用户随后提供了亮色场景合成截图，以及 `C:\Users\jiang\OneDrive\Desktop\新建文件夹\NovaFlow\images\bg.png`。初版消除了黑圈，但在绿、蓝通道亮度接近时，`dominance <= 0` 的分支仍会突然把低红色的青色光晕当作不透明物体；与此同时，光晕归一化权重接近零，产生深青色硬边。此前只看黑底和灰白底的检查没有充分发现这个问题。

后续修复让青色光晕在绿/蓝通道交界处连续求解透明度，并通过周围青色光的覆盖程度保护角色内部零散的冷色暗部。明亮剑芯、中性/暖色区域和紫色角色保留不透明度。最终仍直接输出单层透明 PNG/WebM/MOV；分层加色/滤色曾做过原型比较，本次未作为程序功能交付。

新增通道交界回归及孤立冷色像素保护测试，针对性测试共 9 项通过。实际 Electron 组件再次导出 73 帧并验证擦除、修复和羽化。用用户的背景图完成整段左右对比：左为初版，右为柔边修复；主体中心区域没有新增透明像素。黑底颜色贡献平均差为 0.00147/255，最大差约 2.86/255，基本保留原先黑底外观。透明 WebM 回读保留软 Alpha，背景角落最大 Alpha 为 0。

当前验收文件夹：`C:\Users\jiang\OneDrive\Desktop\NovaFlow\光效柔边验收_20260913`。证据包括其中的 `bright-background-validation.json`、`validation.json`，以及 `logs/green-screen-soft-edge-final/report.json`。亮背景对比图及视频使用同一张用户背景，光效处理不依赖该背景。

## 当前程序交付状态

source、desktop renderer 和 `dist/win-unpacked` 已同步。已通过 `build:win:nobump` 重新生成 2.3.214 安装包，并提供明确命名的 `particle-editor-desktop/dist/NovaFlow Setup 2.3.214 - 光效柔边修复.exe`，250104520 字节。SHA256：`bf4e5656891ac742b4e00002196c57448d798c302953bff4217ab87eb12b7bac`。从安装包提取主进程、HTML、主 bundle 和抠图模块，四个文件均与当前源文件哈希一致；打包后运行时检查 PASS，锁定入口 GO。校验记录：`logs/vfx-soft-edge-installer/verification.json`。

`C:\Program Files\NovaFlowPortable` 中的旧版仍在运行，尚未安装新包。用户退出旧客户端后，可安装上述安装包测试。


## 多底色扩展（2026-09-13）

开关现名为“光效透明保留”，保留原开关的状态和滑动样式，自动识别均匀绿底、蓝底、黑底和白底。绿幕继续使用已验证的原解法；蓝幕交换绿/蓝通道后复用解法。黑白底由实测背景 RGB 求可行软透明度，并联合去除背景混色。

黑底的暗色实体和半透明光不能仅靠 RGB 区分。因此 AI 模式将同一 decodedFrameIndex 的真实分割遮罩传给合成器，并支持不同尺寸的遮罩。保留主体及其抗锯齿边缘；不再侵蚀主体后全图去黑，以免制造白色亮边。遮罩中的小型独立碎点回到光效解法，避免产生不透明暗点。纯色键模式仍可直接处理纯光效，界面在黑/白底下提示含角色素材使用 AI 抠图。非均匀背景继续回退原流程。

白底上已与背景融为相同纯白的光不含可恢复的颜色/透明度信息，不能声称完整还原。这是单图解混的限制，参见 [MIT matting formulation](https://people.csail.mit.edu/alevin/papers/Matting-TR.pdf)；黑白底去混色的用途也可参见 [Adobe keying effects](https://helpx.adobe.com/ca/after-effects/desktop/animate-in-after-effects/work-with-keying-effects/keying-effects.html)。

验证：16 项算法和实际 VP9 编码测试通过，包含黑白底软光、绿主体保护、蓝底、白对白的不可恢复情况和模型零碎噪点。原绿幕视频的实际色键组件、擦除/恢复/羽化回归通过；白底与绿底图片的真实 React 预览/PNG 导出通过。AI 处理尚未返回 manifest 时出现的既有瞬时 missing timelineToDecodedFrameMap 记录单列在 startupErrors；稳定结果与导出无错误，不将启动阶段称为零错误。

用户黑底素材 kling_20260203_Image_to_Video_在2秒内_石头精灵变_4154_0.mp4：980×2116，24 fps，122 帧。使用当前主进程内的原版 Python 推理脚本和本机 RMBG-2.0 生成全片真实遮罩；通过二进制 IPC 回放到实际 React AI 视频组件（遮罩减半尺寸以覆盖重采样），导出完整 122 帧。擦除改变 19600 像素，羽化产生 1173 个软边像素，恢复 19532 像素。这里验证了真实模型输出与渲染/导出链，不冒充完整主进程 IPC 推理调度验收。

证据：logs/multiscreen-video-ui/report.json；验收素材：C:/Users/jiang/OneDrive/Desktop/NovaFlow/多底色光效验收_20260913，包含真实组件 PNG 序列、ProRes 4444 MOV 和灰/白底视频对比。查看了第 0、48、96 帧。白底与蓝底目前只有合成测试，尚无对应真实原视频验收。

多底色版安装包：D:\AI_APP\NovaFlow\particle-editor-desktop\dist\NovaFlow Setup 2.3.214 - 多底色光效透明.exe，250106349 字节，SHA256 b76820a6c6b4114c8c3fb3d8b3e6136eb4f1f7694f0d4b429e159a25ae7a2699。安装包内部四项文件与源码一致；打包后 runtime PASS、entry GO。logs\multiscreen-installer-1789286271791\verification.json。MOV 回读第 0/48/96 帧，Alpha 最大误差 1/255。
