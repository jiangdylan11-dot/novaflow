# SmoothMix T2V Low v4 image-wash validation

The user-provided safetensors file ran successfully in five standard ComfyUI KSampler jobs.
This was an isolated model experiment; no production routing or model files were changed.

Manual inspection: low strength is promising for fidelity. Medium/high strength produces substantial redraw, but the source style drifts toward glossy semi-3D materials. Full replacement is not accepted.

See `index.html` for source, reused original Wan baselines, strength comparisons, and alternate parameter results. `verification.json` records exact model/seed/settings, prompt IDs, source/output hashes, manual assessments, and scope limits. All saved workflows were checked against returned execution history.

The author v4 guide confirms the anime style trigger and a photorealistic default without style triggers. Candidate tests remove the original external acceleration LoRA; they are not strict weight-only comparisons. Only one non-explicit anime source and one seed were evaluated. No old experiments were rerun.

Run a new unrecorded case with `tools/smoothmix-t2v-image-wash-smoke.cjs`; it refuses to overwrite existing case records and never changes the application's default. Rebuild this report with `tools/build-smoothmix-t2v-wash-report.py`.
