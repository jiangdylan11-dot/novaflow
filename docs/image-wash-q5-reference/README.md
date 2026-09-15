# Remix Q5 原图参考验证

目标：保持 Remix Q5，检验高强度重绘能否沿用原图画风。此目录是独立实验，未替换安装版洗图流程。

## 方法

使用现有 Q5、UMT5 和 Wan VAE，源图仍是橙色衬衫女孩。固定 seed=9122026、denoise=0.65、20 steps、CFG=4、Euler / Beta、shift=1，无 LoRA。没有最终图片混合，没有降低 denoise。

- **关闭参考**：原 Q5 采样，作为 512 × 512 的同时期对照。
- **特征统计参考**：每个采样步将原图 latent 加至对应噪声水平，提取每层注意力输出的均值、方差，约束目标特征。参考强度 0.6，在 sigma ≤ 0.55 时启用。
- **共享原图注意力**：每步读取原图的 Q 统计及 K/V，目标注意力同时访问原图和自身的 K/V。参考强度 1，全采样阶段启用。K/V 存入 CPU 内存，逐层回传，避免长期占用 GPU 显存。
- **正式分辨率验证**：复用已有 1 MP 对照的 `ImageScaleToTotalPixels(lanczos, 1, 1)`，并由相同 VAE 编码；复用旧的 1 MP Q5 输出作比较，不重跑旧实验。

这是针对已安装 Wan 注意力接口的实验性实现，不是可以直接套用的 SD StyleAligned 节点。共享注意力思路参考 [Style Aligned Image Generation via Shared Attention](https://arxiv.org/abs/2312.02133)，本实现不包含论文的反演流程，不能据此声称具有论文效果。

## 代码与复现

- `tools/wan_wash_reference.py`：两种参考实现。
- `tools/wan-wash-reference-smoke.py`：独立 ComfyUI 推理进程，使用已安装 GGUF loader。
- `particle-editor-desktop/tests/test_wan_wash_reference.py`：参考关闭的精确旁路、条件及输入保护、缺失 hook 报错、统计插值、实际读取参考 K/V、异常时恢复方法，共 7 个 CPU 测试。

```powershell
& 'C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe' tools/wan-wash-reference-smoke.py --size 512 --reference '0,0.6'
& 'C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe' tools/wan-wash-reference-smoke.py --size 512 --reference 1 --reference-mode shared-kv --max-sigma 1 --output docs/image-wash-q5-reference/shared-kv
& 'C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe' tools/wan-wash-reference-smoke.py --production-size --reference 1 --reference-mode shared-kv --max-sigma 1 --output docs/image-wash-q5-reference/full-resolution
```

独立进程会先检查 8188 队列为空，并释放其模型显存；不要同时提交其他 GPU 任务。推理模式与 ComfyUI PromptExecutor 一致。最初未设置 inference_mode 的试跑在第二张前出现显存保留，已中止并修正，当前结果来自修正后的运行。

## 适用范围

目前只验证一张 RGB 动漫插画，不代表所有画风、透明图、不同种子或成人内容均通过。测试时临时替换独立进程内 Wan 实例的注意力方法，退出后恢复；没有改动 ComfyUI 的安装文件或模型权重。这个实现需要额外原图前向计算及 CPU/GPU 特征传输，明显增加耗时。

运行记录、PNG 和最终观察以同目录 `index.html` 与各 `*-run.json` 为准。运行成功和画质通过是两件事。
