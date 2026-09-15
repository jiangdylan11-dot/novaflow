# Original Wan versus SmoothMix: matched-source image-wash comparison

The user asked for direct original-Wan comparisons after finding the SmoothMix results insufficiently refined and disliking high-strength colors.

Twelve original-Wan jobs were generated on the same four sources and strengths as the existing SmoothMix matrix. The twelve SmoothMix images are reused unchanged. This is a newly requested comparison, not a rerun of obsolete experiments.

Shared settings: source pixels, manually observed base caption, seed 9122026, 1 MP scaling, Wan VAE, UMT5, negative prompt, 7 Euler/Beta steps, CFG 1, shift 8, and denoise 0.2/0.65/0.9. Native recipe differences are explicit: original Wan Q4_K_S uses the original external Lightx2v LoRA at strength 1; SmoothMix FP8 mixed uses no external LoRA and adds the author's anime trigger only for the anime fixture. This is not a pure weight-only ablation.

All 24 output files were visually inspected. `verification.json` checks paired source hashes, shared workflow nodes, executed history and output hashes. `index.html` offers source/model comparison with fixture and strength filters; `assessments.json` contains the visual findings.

Original Wan better retains the tested 2D drawing treatment, skin texture and weathered material handling. SmoothMix often makes surfaces smoother and shinier. Low-strength and coffee outputs are much closer. Both models change identity, design and composition at high strength. No full replacement quality acceptance or production routing change is claimed.

Six supplemental SmoothMix parameter tests at 0.35 also completed: increasing 7 steps to 12 did not materially improve quality, while lowering shift preserved more source appearance by reducing redraw. These are linked as supporting evidence, not presented as a high-strength color fix.

No color matching, filtering, sharpening or original-image blending was applied to either model's outputs. Four sources and one seed do not establish universal quality superiority or NSFW suitability.
