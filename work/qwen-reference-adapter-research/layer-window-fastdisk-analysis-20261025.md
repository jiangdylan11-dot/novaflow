# Layer-window fast-disk post-run audit

Actual graphs, native prompt, original images, history, downloaded files and decoded RGBA hashes were rechecked. No image edit or service action. Visual quality remains pending root/user review.

| Job | Successful history(s) | Individual full job(s) | Actual output |
|---|---:|---:|---|
| bright-off | 54.704 | 58.797 | [PNG](D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/layer-window-fastdisk-probe-20261025/jobs/bright-off/output.png) |
| bright-on | 56.360 | 59.422 | [PNG](D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/layer-window-fastdisk-probe-20261025/jobs/bright-on/output.png) |
| dark-off | 58.860 | 62.859 | [PNG](D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/layer-window-fastdisk-probe-20261025/jobs/dark-off/output.png) |
| dark-on | 62.375 | 66.516 | [PNG](D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/layer-window-fastdisk-probe-20261025/jobs/dark-on/output.png) |

OFF/ON canonical graphs differ only by node901.enabled. Each ON has16 conditional forwards, eight K copies per forward,128 total; only layers24–31 receive target modification. Prefixes are computed on the first positive and first negative forward (160 then320 calls), then cached unchanged for forwards3–16.

bright: old baseline versus new OFF RGBA identical = False; current OFF versus ON RGBA identical = False.

dark: old baseline versus new OFF RGBA identical = False; current OFF versus ON RGBA identical = False.

Sampled peak VRAM 15409.0MiB; minimum available RAM 5.025GiB. Owned processes are gone and recorded8192 is closed. Four raw timings include uncontrolled cold/warm differences and are not node-speedup claims. No new AI analysis or automatic quality acceptance. Full evidence: [layer-window-fastdisk-analysis-20261025.json](D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/layer-window-fastdisk-analysis-20261025.json).
