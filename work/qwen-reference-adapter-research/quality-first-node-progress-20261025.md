# Quality-first style-transfer node evaluation

The user wants attractive, refined, high-quality images with genuinely similar reference art direction. Natural changes to facial drawing and pose are allowed while the source person, held object and airport remain recognizable. Similarity alone, an attention-hook hit, and a changed hairstyle are not acceptance.

## Completed isolated test

`prototype_frequency_layers_v2` passed its frozen 16 CPU checks and four real Turbo8/CFG3 image jobs: Bright v3 OFF/ON and accepted Dark r10 OFF/ON. Both pairs used unchanged native Flash prompt text, negative text, original input bytes, seed54792256, 1280×960 source-aligned canvas and Turbo sigmas. Only the new MODEL node's `enabled` field differs within a canonical pair. No new AI analysis was run.

The first storage profile aborted before sampling because physical RAM stayed below the unchanged 4GiB guard. Its records remain in `layer-window-probe-20261025`. A fresh isolated sibling added only the native `--fast-disk` storage flag and completed all four jobs without lowering guard limits. This does not alter BF16 weight precision. The second run's sampled minimum available RAM was5.025GiB, peak whole-device VRAM15409MiB; its owned process tree and8192 listener were released. External app/model services were not mutated.

Both ON images actually reached layers24–31 for16 conditional forwards, eight K copies each,128 total. Positive and negative prefix branches each computed once, then reused their native caches. This validates the hook and cache behavior for this trial, not style/content disentanglement or universal compatibility.

| Pair | OFF enqueue to successful history | ON enqueue to successful history | Visual decision |
|---|---:|---:|---|
| Bright |54.704s|56.360s|No convincing finish or reference-style gain; some hair/face/cup simplification.|
| Dark |58.860s|62.375s|Slightly rounder, cleaner-looking face; overall finish and art direction similar to OFF.|

These are individual raw timings with uncontrolled cold/warm differences, not a speed claim. Old baseline images and new OFF images are not pixel-identical; only the new OFF/ON pairs are matched comparisons.

## Decision

Do not adopt this layer-window preset or enable it by default. It avoided the older conspicuous blue-violet wash, but did not demonstrate the joint improvement in beauty, material/lighting finish and reference fidelity required by the user. Preserve the accepted Dark r10 and Bright v3's separate picture-quality acceptance. No new user acceptance is inferred.

The prototype remains work-only, outside the product and maintained Comfy installation. No formal Flash default, installed application, environment package or online deployment changed. Four original PNGs, actual graphs/history, resource samples and runtime audits remain under `layer-window-fastdisk-probe-20261025`; post-run independent verification is in `layer-window-fastdisk-analysis-20261025.json`. Local gallery diagnostic cards show all four PNGs without image processing.

## Direction boundary

An automatic preset must earn its place by improving completed images across references. Texture, atmosphere, lighting and precision are coupled goals; this code has not made them four independent controls. A future route should keep one coherent Flash analysis and a small validated execution registry. Additional calls or nodes require measurable quality benefit and recorded latency. Broadly boosting a shared phrase such as “crisp, confident linework” is not automatically appropriate: the Bright reference needs selective soft/hard edges and material depth, and stronger outlines alone could worsen it.

Reference perception and the generator's use of those observations remain the unresolved generalization problem. No trained, disentangled Qwen2.1 reference adapter has been established by this experiment.
