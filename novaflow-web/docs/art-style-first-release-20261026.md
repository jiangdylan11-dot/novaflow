# 首版风格迁移框架基线：2026-10-26

用户确认：“暂时先这样吧。这个作为首版 风格迁移框架。”当前保留的六种效果作为首版基线冻结，停止本轮调图，不再自动生成新候选。

| 风格 | 首版采用的结果 | 已知问题 |
| --- | --- | --- |
| 明亮动漫 | D:/AI_APP/NovaFlow-Web/work/art-fidelity-speed-20261026/adaptive-finish-pass/generation/bright/output.png | 按当前效果保留。 |
| 冷调动漫 | D:/AI_APP/NovaFlow-Web/work/art-fidelity-speed-20261026/color-light-pass/generation/dark/output.png | 整体偏蓝，后续需要在保住层次的前提下改善色彩。 |
| CG 材质 | D:/AI_APP/NovaFlow-Web/work/art-fidelity-speed-20261026/adaptive-finish-pass/generation/cg/output.png | 右侧紫色环境反光仍待优化，大片绿光方案不采用。 |
| 柔和插画 | D:/AI_APP/NovaFlow-Web/work/art-fidelity-speed-20261026/continuity-framework/generation/soft/output.png | 按当前效果保留。 |
| 湿润高光 | D:/AI_APP/NovaFlow-Web/work/art-fidelity-speed-20261026/owner-feedback-pass/generation/wet/output.png | 按当前效果保留。 |
| 红黑平面 | D:/AI_APP/NovaFlow-Web/work/art-fidelity-speed-20261026/continuity-graphic-anchor/generation/graphic/output.png | 按当前效果保留。 |

六张原始成图、完整画风参考、原生回答、生成图表、参数与输出证明已独立复制到 D:/AI_APP/NovaFlow-Web/work/art-fidelity-speed-20261026/first-style-framework-v1。checkpoint.json 固定了每张图的完整 SHA-256、提示词和来源，不依赖“最新版本”等口头称呼。

共同候选框架为 1.0.11（系统散列 9ee27938e8cba9864728f84540e22deb5ad7c1727677cb92396ef3a00e846c28），Qwen Turbo 保持 CFG 3、8 步，图像均为从原照片单次生成的原始输出。过绿、退化及过锐的二次编辑版本不纳入首版，二次编辑路线未采用。

这次确认是首版框架与当前效果基线的确认，不代表全部已知缺点消失或通用质量已经全面验证。正式运行时技能仍为 1.0.1；本次未切换活动指针、写入 Supabase、发布共享经验、打包或部署。后续发布仍按既有约定，先准备具体版本，再由用户确认。
