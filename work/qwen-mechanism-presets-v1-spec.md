# Qwen 2.1 机制预设：最小隔离规格

状态更新（2026-10-25）：设计中的末8层节点已在独立 work 包实现，通过16项CPU检查及明亮／暗色OFF/ON四张实图核验；未证实足够的整体美感或画风收益，因此未采用、未改产品或默认。详见 `qwen-reference-adapter-research/quality-first-node-progress-20261025.md`。下文保留原始设计及其验证边界；目标仍是一个 Flash 请求生成完整执行词并给一个枚举路由，不是四轮 AI，也不是四个已解耦的美术旋钮。

## 底层实际能控制什么

| 可控项 | 真实操作 | 不能承诺的含义 |
|---|---|---|
| source/style reference gain | target query 对指定完整 reference K 区间的 attention logits 加 `log(gain)` | 该区间包含供体人物、服饰、背景与画法，不能叫“纯风格强度”或“质感强度” |
| style K spatial-pair modulation | post-RoPE style K 的两个空间轴各 28 对通道改幅度；axis0、Q、其他 K、全部 V 不改 | 高频/低频是 RoPE 通道频率，不是对像素做频段分解；几何、细节、配色仍耦合 |
| sigma gate | 按真实 sigma [0,1] 开关上述操作 | 前期不等于只改造型，后期不等于只改颜色；已有前四步实验未解决罩色 |
| layer gate（新候选，尚未实现） | 从 native `transformer_options.block_index` 读取实际层号，只在指定层的 target attention 修改 | 未知哪几层代表材质、氛围或光效；不能给层组贴已验证语义标签 |
| 输出/首图条件尺寸、步数、CFG | 真正改变空间/采样/条件计算 | 分辨率是计算预算，不是独立“精度”；CFG 影响整个条件且增加负向分支成本；Turbo 仍固定专用 8 步 |

“质感、氛围、光效”先作为 Flash 一次回答中的连贯美术要求；“精度”先作为显式计算预算。当前没有证据支持它们各自独立映射成四个张量旋钮。不得用全局滤镜冒充光色迁移。

## 少量机制候选

1. `native`：现有完整双图原生路径；gain=1，frequency=1。唯一可作基线的路由。Flash 的完整美术叙述负责目标材质/光色，用户手动采样最高优先。
2. `reference_keys`：复用现有 reference-gain 原型，参数是固定版本的 source/style 权重，不由模型随意填浮点。保留为诊断能力，**当前不再排重复盲测**：既有 style gain 1.15/2、source .4/style2 未明显改善目标，且有内容泄漏风险。
3. `spatial_keys_limited_layers`：唯一下一项新节点候选。复用已冻结 frequency 向量 `.5/1.5, beta=2`，全 sigma 生效，但只作用实际层 **24–31（最后八层）**；其余层原样 target attention。这样仅改变“作用层范围”，不同时改向量、CFG、sigma、输入尺寸或 prompt。这段层号是可证伪的固定研究取样，**不是已知材质层或细节层**。

三者都不是预先命名的“动漫/CG/暗/亮”路线，不允许按参考文件或本轮结果分别挑数值。路由 2/3 在同规则跨图回归前不作正式自动推荐；初期 Flash 可以报告候选枚举，但执行端 allowlist 只开放已经完成效果验收的版本，其余明确留在 `native`，不能静默宣称已执行。

## 一次 Flash 路由契约

同一个已核模型、同一次完整双图请求：输出原有 `sourceContent`、唯一完整 `prompt`、`renderingClass`，另加一个小字段：

```json
{"mechanism":{"id":"native","reason":"one short observation-grounded reason"}}
```

共享 system 说明各枚举的真实操作和限制。模型根据当前图像的表现方法和用户需求推荐，不根据 donor 人物类别、文件名或 anime 标签直接选。程序从固定版本 registry 取节点参数；模型不能输出代码、节点类、任意层列表、URL 或任意强度。完整 prompt 不按路由替换或缩短，不再调用另一个 AI 分析“材质/光影/精度”。未识别枚举或未验收机制保持可见的 native 处理，不自动重试。用户显式选择/手动参数覆盖自动推荐并留审计记录。

## 新 layer gate 的 CPU 实现边界

- native 实际模型须核 32 层、head dim128、RoPE [16,56,56]；从每次真实 attention 的 `transformer_options.block_index` 取层号，缺失/越界拒绝，不能按调用次数猜层。
- 继续使用 target-only `optimized_attention_override`；不装 `attn1_patch`、`post_input`、`single_block`、`patches_replace`。prefix query 调用原样；K 先克隆，仅修改选中 style span，不污染原 K/V 或 cached prefix。
- 未选层、禁用和 identity 必须原张量/原 mask透传。layer-gate原型需核所有32层 preferred attention function 均为 None，避免与纯 native OFF 比较时混入 backend 切换；不得假定 CPU tiny-model证明了实际模型配置。
- 不改 image_slots、参考顺序、RoPE位置或条件长度；首图与目标工作尺寸保持已修正的同源比例对齐。
- CPU 回归：native32次层号选择只中24–31；prefix调用零修改；selected层以外输出/输入完全相同；初次/缓存命中一致；正负条件不同长度仍正确；同层mask及未知override组合不默默丢失。

## 缓存与代价

本机 native 在每层循环设置 block_index；prefix cache key 绑定 context、refs、slots和目标尺寸。文本/参考从 t=0 计算。当前 gain/frequency 不触发 native 的四类禁用 hook，因此可保留干净 prefix cache；这不代表 donor 内容被解耦，也不保证等速。

gain 的 O(K) additive mask 可能使 attention backend 改走慢路径。frequency 当前每个选中 target attention 需复制完整 K：10k keys、32heads、BF16 时约78MiB临时副本。只选8/32层可减少副本次数，不能把峰值显存说成降到四分之一；prefix计算量也不会随之降到四分之一。新候选不增加模型、VAE编码、采样步或扩散 pass，实际秒数仍需日志测量。

## 最小实测，不开参数矩阵

先对同一新鲜 Flash 完整输出做 native / last-eight-layer frequency 一组配对，原生 prompt、完整原图、首图对齐、负向、seed、Turbo8CFG3全部冻结。先用一个原困难样本和冻结的已认可 Dark 做“新增能力/保护已认可效果”检查；候选必须同配置，不能逐图改层数/颜色。只有总体美感、参考画法、光色主次与源内容共同改善且无明显罩色/供体泄漏，才扩到其余原参考，再谈自动选路。文本路由正确不能替代成图验收。

计时：记录 Flash load/request/unload、生图总秒、每步、prefix计算/命中、target/prefix calls、选中层、K clone次数与峰值显存；一次路由的小字段不能被包装成已经证明没有速度损失。

## 当前代码证据

- `C:/ProgramData/NovaFlow/AI-Runtime/engine/ComfyUI/comfy/ldm/qwen_image21/model.py:185` cache key；`:198`默认32层；`:329`cache禁用hook；`:347`每层 block_index；`:353`cached prefix K/V。
- `C:/ProgramData/NovaFlow/AI-Runtime/engine/ComfyUI/comfy/ldm/modules/attention.py:200` override/backend dispatch；`:213–223`把 transformer_options 交给 override。
- `work/qwen-reference-adapter-research/prototype/reference_attention.py:104–141` target-only log gain。
- `work/qwen-reference-adapter-research/prototype_frequency_keys/reference_frequency_keys.py:36–52` pair向量；`:104–146` target-only K clone；`:153–190` sigma gate；`:258–271`preferred-backend guard。
- 实际旧 QA `work/qwen-reference-adapter-research/runtime8192-r10/stderr.log:176` 记录 checked_layers=32、non_null_count=0；这只证明该次配置。
