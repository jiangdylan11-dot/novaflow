# NovaFlow Performance P2E Mutation Families

## Scope

- Phase: Performance P2E brand mutation family attribution
- Base commit at sampling: `e20b9b82 perf: add layout refresh caller attribution`
- Sample time: 2026-06-30 02:15 ICT (`2026-06-29T19:15:16.303Z`)
- Entry: locked `http://127.0.0.1:4783/`
- Probe: `window.__NFAnimationPerfProbe`, version `20260616-animation-1-5`
- Browser: Chrome 149 headless on Windows 10 x64
- Viewport: 1440 x 960

This pass only added mutation type/family attribution to the existing performance probe and this report. It did not change MutationObserver scope, mutation filtering, refresh conditions, delay values, UI, workflow JSON, Storyboard V5, Prompt Assistant, Electron IPC, resource/preview state, or AI sequence/skeleton switching logic.

The sampled page logged upstream `502` resource errors from the local backend path. These samples only exercised 4783 UI/probe behavior and did not invoke workflow generation.

## New Probe Fields

The probe now records:

- `callsiteCounts.brandMutationFamily.<family>`
- `callsiteCounts.brandMutationType.<type>`
- `callsiteCounts.brandMutationFlushFamily.<family>`

Mutation types:

- `childList`
- `attributes`
- `characterData`
- `unknown`

Semantic mutation families:

- `modalDialog`
- `aiSequence`
- `skeleton`
- `artDrawing`
- `resourceCard`
- `preview`
- `topbarHelpFile`
- `unknown`

The classifier only reads lightweight metadata such as `nodeName`, `id`, `className`, `dataset`, `aria-label`, `title`, short text-node snippets, and `attributeName`. It does not store DOM nodes, mutation objects, large payloads, images, resource data URLs, or workflow data. It does not read layout or call `getBoundingClientRect`.

## Scenario 1: Secondary Entry Switching

Path: Animation -> AI sequence animation -> Skeleton animation -> Art -> UI -> Drawing.

| Metric | Value |
| --- | ---: |
| Actual duration ms | 10053 |
| `brandMutationFlushScheduled` count | 198 |
| `brandMutationFlushRun` count | 198 |
| `observedLayoutRefreshScheduled` count | 193 |
| `runFullLayoutRefresh` count | 198 |
| `runFullLayoutRefresh` via `brandMutationFlush` | 193 |
| `applyPreviewRuntimeLayout` count | 200 |
| `normalizeNovaflowVisualRhythm` count | 782 |
| `querySelectorAllStar` count | 787 |

Mutation family ranking:

| Family | Count |
| --- | ---: |
| `skeleton` | 221 |
| `aiSequence` | 88 |
| `unknown` | 78 |
| `preview` | 16 |
| `modalDialog` | 9 |
| `resourceCard` | 3 |
| `topbarHelpFile` | 1 |

Mutation type ranking:

| Type | Count |
| --- | ---: |
| `childList` | 220 |
| `attributes` | 196 |

Flush family ranking:

| Family | Count |
| --- | ---: |
| `skeleton` | 220 |
| `aiSequence` | 45 |
| `unknown` | 22 |
| `modalDialog` | 9 |
| `topbarHelpFile` | 1 |
| `preview` | 1 |

## Scenario 2: Art Drawing Dialog Open-Close

Path: Art -> Drawing -> Enhance panel -> image upscale, image wash, and outpaint dialogs opened and closed. A temporary 64 x 64 source resource was added through the existing debug bridge and then deleted after sampling.

| Metric | Value |
| --- | ---: |
| Actual duration ms | 10040 |
| `brandMutationFlushScheduled` count | 217 |
| `brandMutationFlushRun` count | 217 |
| `observedLayoutRefreshScheduled` count | 216 |
| `runFullLayoutRefresh` count | 217 |
| `runFullLayoutRefresh` via `brandMutationFlush` | 216 |
| `applyPreviewRuntimeLayout` count | 217 |
| `normalizeNovaflowVisualRhythm` count | 872 |
| `querySelectorAllStar` count | 872 |

Mutation family ranking:

| Family | Count |
| --- | ---: |
| `skeleton` | 240 |
| `modalDialog` | 2 |

Mutation type ranking:

| Type | Count |
| --- | ---: |
| `attributes` | 220 |
| `childList` | 22 |

Flush family ranking:

| Family | Count |
| --- | ---: |
| `skeleton` | 240 |
| `modalDialog` | 2 |

All three dialog interactions opened one dialog and closed it successfully:

- Image upscale: opened `1`, closed successfully
- Image wash: opened `1`, closed successfully
- Outpaint: opened `1`, closed successfully

## Combined Ranking

Combined semantic mutation families:

| Family | Count |
| --- | ---: |
| `skeleton` | 461 |
| `aiSequence` | 88 |
| `unknown` | 78 |
| `preview` | 16 |
| `modalDialog` | 11 |
| `resourceCard` | 3 |
| `topbarHelpFile` | 1 |

Combined mutation types:

| Type | Count |
| --- | ---: |
| `attributes` | 416 |
| `childList` | 242 |

Combined flush families:

| Family | Count |
| --- | ---: |
| `skeleton` | 460 |
| `aiSequence` | 45 |
| `unknown` | 22 |
| `modalDialog` | 11 |
| `topbarHelpFile` | 1 |
| `preview` | 1 |

## Interpretation

P2D showed that `brandMutationFlush` is the dominant caller for `runFullLayoutRefresh`.

P2E narrows that further: in the two sampled heavy paths, the dominant flush family is `skeleton`. This is consistent with the brand MutationObserver attribute filter, which watches:

- `data-novaflow-spine-split-workspace-active`
- `data-novaflow-spine-split-hidden-display`

This does not yet prove which writer is redundant. It only proves that the highest measured flush family is tied to the spine/split workspace attribute surface. The current data is not enough to safely suppress refreshes or change animation/skeleton switching behavior.

## P2F First-Cut Recommendation

Do not begin P2F by changing global delay values, disabling MutationObserver, shrinking the observer scope, or skipping `runFullLayoutRefresh`.

Recommended first cut:

1. Add a very narrow writer/attribute attribution for the `skeleton` family only, recording which of the two watched attributes is causing the repeated flushes and which runtime surface is writing it.
2. If that confirms repeated idempotent writes to `data-novaflow-spine-split-workspace-active`, consider a minimal writer-side guard such as "only set the attribute when the value changes".
3. Do not touch AI sequence/skeleton switching rules until the writer attribution proves the repeated writes are redundant.

Reasoning:

- `skeleton` accounts for `460 / 540` combined flush-family mutations in the sampled hotspots.
- `attributes` are the highest combined mutation type at `416`.
- The likely low-risk optimization candidate is idempotent attribute write avoidance, not scheduler throttling.
- Changing scheduler timing would reduce symptoms globally but could mask real state transitions and is riskier.

## Validation Commands

```powershell
node --check particle-editor/novaflow-brand-runtime.js
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```
