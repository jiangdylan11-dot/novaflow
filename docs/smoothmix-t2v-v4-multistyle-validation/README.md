# SmoothMix T2V Low v4: four-source wash validation

User feedback accepted the previous model as substantially better and requested testing on different images.

This run uses four distinct sources: a painted anime character, a photorealistic cyberpunk portrait, a stylized 3D robot, and a coffee photograph. Each was visually inspected before its caption was written. These are manual source captions, not an automated Prompt Assistant test.

All 12 jobs completed using the supplied SmoothMix safetensors model, standard KSampler, 7 Euler/Beta steps, CFG 1, shift 8, 1 MP working size, seed 9122026, and strengths 0.2/0.65/0.9. The same prompt is used for all strengths of each fixture. Only the anime source uses the anime trigger. The other three explicitly describe their photographic or CG source medium without an anime trigger. No external acceleration LoRA, image blending or post-sharpening is used.

See `index.html` for all original images and raw generated results, `assessments.json` for manual observations, and `verification.json` for execution history and hash checks.

Low strength generally preserves the source while redrawing visible details. Medium/high strengths can substantially change identity, object design, composition and material finish. High strength is not linearly more different than medium. These observations cover the four sources and one seed only.

No old experiments were rerun. No model files or production model routes were changed. Formal UI integration, automatic source analysis, transparency and other media remain outside this test.

Build the report with `tools/build-smoothmix-multistyle-report.py`. The completed cases are intentionally protected against accidental reruns by the harness.
