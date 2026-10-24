# Native common-style batch harness

Initial authoring and CPU checks did not start a model. Actual execution subsequently completed eight user-reference native jobs and two color-cast controls using the separate no-pinned runners. See `../cross-style-generalization-20261025/experiment-summary-20261025.json`. The initial pinned-memory run hit the RAM guard before an image completed and is preserved separately.

The native generation route has no layer-window/frequency node. It uses only the existing `ComfyUI-GGUF-leejet` and `novaflow_qwen_bf16_loader` whitelist, the successful owned8192 lifecycle and `--fast-disk`. The resource guard is fixed at4GiB available RAM,768MiB free VRAM, sustained for2seconds, plus the inherited fatal driver/error stops. Fast-disk is not a guaranteed resource or quality improvement.

The current suite uses eight original images supplied locally by the user: Bright (RVDS), Dark (A1W8), Warm (P8E), CG (92S8), Soft (70DS), Wet (KDS), Graphic (YS6), and 绯瑶. The web-reference plan was cancelled; no downloaded web reference is used. Root supplies the final eight formal case directories after the actual new Flash analyses have completed and released.

`--freeze-plan` accepts2–8 formal case directories in intended generation order. It verifies completed native SSE/raw/parsed/prompt identity, model identity and final AI release, formal builder and graph hashes, original source/style bytes, same actual system/user/settings, uniform empty negative, Turbo8/CFG3/seed54792256 and the source-aligned1280×960 canvas. Reference resizing follows the unchanged shared pixel-budget rule. It writes a new immutable plan; it does not start or query services. Unsupported or individually rewritten cases fail rather than being silently adapted.

After root sets `$qaFormalCaseDirs` to the eight actual completed formal directories, use:

```powershell
$qaPython = 'C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe'
$qaHarness = 'D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/native-batch-harness-20261025/run-native-batch.py'
$qaPlan = 'D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/native-eight-commonstyles-plan-20261025.json'
$qaRun = 'D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/native-eight-commonstyles-run-20261025'

& $qaPython $qaHarness --freeze-plan $qaFormalCaseDirs --plan-out $qaPlan
& $qaPython $qaHarness --plan $qaPlan --run-root $qaRun --preflight-only
& $qaPython $qaHarness --plan $qaPlan --run-root $qaRun --run
```

Without explicit `--run`, the execution interface only preflights. The plan is revalidated before launch. Run roots must be fresh separate directories inside repository `work/`, outside the existing native/formal records and gallery. Repeat preflight is idempotent for the exact same plan/controller hash, but existing load/result/owner records block a second launch.

Preflight refuses occupied8192, active8191/8198, or any running/pending job at8188/8189/8190. Existing services receive read-only requests; they are never unloaded/interrupted. All own inputs/outputs/temp/user/cache/custom-node paths stay inside the fresh run root; the local custom-node folder stays empty. Weights and the two existing loaders are read-only under `E:/NovaFlow`.

Each case runs sequentially. Only upload names and SaveImage prefix change from its frozen formal graph; complete native prompt/negative/model/sampling/geometry remain unchanged. Actual history must match the submitted graph. Downloaded PNG and isolated output bytes, SHA256, decodedRGBA hash, original reference uploads, individual timings, log slices and `/free`/idle-headroom checks are retained per job. No new AI analysis occurs. Recorded original-analysis timings are traceability only, not charged again. Cold/warm job timings are not controlled speed comparisons and outputs receive no automatic quality acceptance or gallery publication.

Analysis timing retains its original scope. Older independent records with `totalMs` keep their full analysis seconds. Shared Flash batches expose each actual `requestMs` as request seconds and bind the shared batch/load/identity/release/status receipts. Their per-case full analysis total is `null`, never zero: load/unload and whole-batch seconds remain shared and are not divided between cases or charged to every image. `analysisTimingScope` distinguishes these records; render-time additional AI analysis remains zero because the render harness makes no AI request.

A CPU-validated composite can index multiple actual owned sessions without changing the earlier failed batch or its native outputs. Every request remains bound to its own original session, identity/release receipts and request duration. Session load/unload/execution times must equal the original hashed session records; their sums are separate from the wall-clock span, which includes the gap between sessions. The initial requests are never assigned the continuation's new load time. A composite per-case full analysis total remains `null`.

Finally, only the runner-owned PID/create-time/cmdline identities are terminated. The original accepted Dark13 files and originals, accepted Bright assets/records and gallery manifests are hash protected. `owned_comfy_runtime.py` contains16 lifecycle/helper definitions copied verbatim from the successful fast-disk controller; `runtime-core-origin.json` binds that source SHA. Neither old controller nor any prior records were copied or changed.
