# Work-only v10 native cross-reference suite

The initial web-reference ideas were superseded before model execution. Existing research assets are preserved but excluded. The executed suite uses only eight complete user-local references, including one of the three related Chinese fantasy character sheets (绯瑶). Seven-reference CPU preparation was superseded without inference. This controller has no built-in style/reference selection and does not run a model by default.

Actual closeout: `experiment-summary-20261025.json` and `visual-review.json` record the results. The first session's second complete answer was incorrectly rejected because source facts were paraphrased rather than copied verbatim. Original failure records remain intact. `run-flash-suite-continuation.py` executed only the six unattempted requests; `finalize-native-suite.py` validated all eight original SSE answers without rewriting the prompts or repeating either completed request. Per-request timing and both real load/unload sessions remain separate.

The first drawing attempt hit the unchanged 4GiB available-RAM guard and produced no image. A separate fresh process with `--fast-disk --disable-pinned-memory` completed all eight native generations, followed by two generation-only color-cast negative controls. Ten complete images were inspected and published to the work gallery's `#user-references` panel. Color-cast controls improved the two tested palettes but did not establish general reference-style fidelity. No product/runtime/default/package/deployment was changed.

Root supplies a fixed JSON input, for example:

```json
{
  "suiteId": "user-seven-v10n-20261025",
  "expectedCaseCount": 7,
  "cases": [
    {"name": "new-safe-case-id", "referencePath": "absolute/original/reference.png", "sha256": "original-file-sha256"}
  ]
}
```

The actual input must contain all seven selected entries. `expectedCaseCount` is required and the controller has no built-in count. `path` aliases `referencePath`; `sha256` is optional but, when present, is verified before preparation. All actual bytes are SHA-frozen regardless. Identifiers and paths are audit data, never prompt text. The same two-image native call must observe each actual reference without a supplied visual answer.

WEBP alone uses full-size RGBA PNG analysis transport. `losslessPngPath`/`losslessPngSHA256` may name an existing verified PNG; otherwise a new PNG is made under the work suite's transport directory. Full decoded RGBA bytes and dimensions are compared exactly. The reference record preserves `originalPath`/`originalSHA256` for original-WEBP Qwen generation. PNG/JPEG inputs keep their complete original bytes. This is format transport, with no crop, resize, padding, recoloring or visual edit.

Use the already installed Strata Python:

```powershell
$py = 'C:/ProgramData/NovaFlow/AI-Runtime/engine/strata/control-0.1.49.2/python/python.exe'
$script = 'D:/AI_APP/NovaFlow-Web/work/qwen-reference-adapter-research/cross-style-generalization-20261025/run-flash-suite.py'
& $py $script prepare --suite-input 'absolute/root-selected-suite.json'
& $py $script preflight --manifest 'absolute/suites/suite-id/suite-manifest.json'
# Root only, after review and an idle-resource preflight:
& $py $script run --manifest 'absolute/suites/suite-id/suite-manifest.json' --execute-model
```

`prepare` calls only the existing `run-analysis.py.prepare()` CPU function. It never calls its `run()` or `/free`. Generated cases live under `adapted-ab/<case-id>`; the new shared contract, empty-negative policy, manifest and batch receipts live under `suites/<suiteId>`. Baseline control/server files and the original v10 design are only read and SHA-checked. Old policies and accepted results are not overwritten.

Frozen analysis is the exact v10 system (`9a56dcafcfe02d084b30cf5f2a82014c877af5380014071ab4620b6508841c35` UTF-8), same user and source, temperature .4, top_p .95, seed 957282577, reasoning budget 1024, 2048 visual tokens/image. Generation policy is Turbo8 CFG3, seed54792256, 1280x960, dedicated sigmas, frequency node OFF and empty negative for every reference. This script does not generate pictures or promote defaults.

Preflight only GETs `/queue` on 8188/8189/8190 and probes that 8191/8192/8198 are closed. It never frees or interrupts drawing services. A future explicit run repeats this check, requires at least 30GiB available RAM and <=2500MiB used VRAM before load, and reuses the existing 4GiB RAM /768MiB VRAM /2s guard (immediate 2GiB/512MiB limits). It loads only the first case's fresh owned configuration and verifies exact model identity. All requests are sequential independent `system + user(two images)` messages: no conversation, source cache, second-stage call or per-reference fix.

Native SSE bytes, content deltas, reasoning deltas, event timestamps, parsed JSON and complete prompt are retained. Optional outer JSON fences and literal control whitespace inside a JSON string are transport-only tolerances, with a receipt only when needed; the extracted prompt is never rewritten. There is no marker insertion, wording repair or semantic filtering. Other malformed/incomplete responses fail that request and stop the suite without a retry. Wrong visual interpretation remains visible for review rather than being rewritten by a rule.

Only the batch owns load/unload/total timings. Per-case `requestMs` is measured independently and never receives fake load/unload/total times. `request-result.json` makes no release assertion. After the actual shared owned unload and status confirm HTTP plus heavy children gone, final per-case results receive release/status proof; shared identity/release receipts are copied byte-for-byte with `shared-runtime-provenance.json` explicitly saying they are shared, not independent unloads. Exclusive batch/request sentinels prohibit rerecording or restarting a partial suite in place.

`test-flash-suite.py` uses temporary 2px fixture images and fake HTTP/control/memory/guard objects. It performs no real model/service/GPU operation and is not image-quality evidence.
