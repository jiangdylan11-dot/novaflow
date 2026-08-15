# Art Generate Provider Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every behavior change. This plan is executed in the current locked 4783 checkout because the accepted runtime and shipped mirror are bound to it.

**Goal:** Replace Art Generate's local/cloud buttons with the shared NovaFlow account card and a Local/GPT/Google selector, then run Local, GPT Image 2, and Google Gemini text/image generation through the existing Comfy Runtime, result bridge, and idempotent account settlement chain.

**Architecture:** New resource, workflow, and tool modules own provider capabilities, API-node workflow construction, price-frame decoding, and the left control UI. `spine-split-runtime.js` only exposes a host, while `novaflow-brand-runtime.js` dispatches between the historical local Qwen path and the new provider adapter. Provider secrets remain in the main/preview proxy injection path; actual Comfy credits are captured from the Runtime WebSocket and settle the existing pending usage row with the same `comfyui:<promptId>` key.

**Tech Stack:** Browser JavaScript UMD modules, Electron main/preload, ComfyUI API-format workflows, Node test runner, Python preview proxy, Supabase atomic Comfy settlement.

## Global Constraints

- The expanded Generate panel order is: shared `NovaFlow 账号` card, then one model select containing exactly `本地模型`, `GPT`, and `Google`.
- The account card shares one `NovaFlowClientAuth` state/action implementation with AI Sequence; do not copy session state or create a second login implementation.
- Text-to-image has no reference upload slots. Image-to-image has exactly three ordered reference upload slots for Local, GPT, and Google.
- GPT uses `gpt-image-2`; GPT image edit must consume all three supplied references when three are present.
- Google text-to-image uses `GeminiImageNode`/`gemini-2.5-flash-image`; Google image-to-image uses `GeminiImage2Node`/`gemini-3-pro-image-preview` and `BatchImagesNode` with up to three references.
- Provider API keys/tokens must never be placed in workflow JSON, Renderer state, localStorage, DOM, logs, or test snapshots.
- Local Qwen workflows, Storyboard, Prompt Assistant, AI Sequence, Bone Animation, Preview, and Resource behavior must remain compatible.
- New business logic belongs in modules. Runtime changes are dispatcher/host/adapter glue and must remain below 100 added lines per Runtime file.
- Source Runtime files are authoritative; renderer and `dist/win-unpacked` mirrors are generated only through `npm run sync:runtime`.
- Every behavior change follows RED -> GREEN. Final verification includes `npm run sync:runtime`, `npm run check:runtime`, `npm run check:entry`, all Node tests, `node --check`, live 4783 UI, and packaged Electron paid-path readiness checks.
- Real GPT/Google generation is externally billable. Automated tests must never enqueue a paid prompt; paid smoke tests require explicit test credentials already configured and use the lowest-cost settings.

---

### Task 1: Provider capability resource and workflow adapters

**Files:**
- Create: `particle-editor/art-generate-model.resource.js`
- Create: `particle-editor/art-generate-provider.workflow.js`
- Create: `particle-editor-desktop/tests/art-generate-provider-workflow.test.js`

**Interfaces:**
- Produces: `window.NovaFlowArtGenerateModels.getCapability(provider, mode)` and `providerOptions`.
- Produces: `window.NovaFlowArtGenerateProviderWorkflow.buildWorkflow(options)`, `parseComfyProgressTextFrame(value)`, and `createPriceObserver(options)`.
- `buildWorkflow(options)` returns `{ workflow, providerNodeIds, providerNodeType, modelKey, taskType }`.

- [ ] **Step 1: Write the failing adapter tests**

  Assert the following real workflow shapes:

  ```js
  assert.deepEqual(models.providerOptions.map((item) => item.value), ["local", "gpt", "google"])
  assert.equal(models.getCapability("gpt", "txt2img").referenceLimit, 0)
  assert.equal(models.getCapability("gpt", "img2img").referenceLimit, 3)
  assert.equal(models.getCapability("google", "img2img").referenceLimit, 3)

  const gptEdit = workflow.buildWorkflow({
    provider: "gpt",
    mode: "img2img",
    prompt: "replace the product",
    uploadedNames: ["one.png", "two.png", "three.png"],
    outputPrefix: "NF_GPT",
    settings: { quality: "low", size: "1024x1024", customWidth: 1024, customHeight: 1024 }
  })
  assert.equal(gptEdit.providerNodeType, "OpenAIGPTImageNodeV2")
  assert.deepEqual(
    Object.keys(gptEdit.workflow[gptEdit.providerNodeIds[0]].inputs).filter((key) => key.startsWith("model.images.")),
    ["model.images.image_1", "model.images.image_2", "model.images.image_3"],
  )

  const googleText = workflow.buildWorkflow({ provider: "google", mode: "txt2img", prompt: "a lantern", uploadedNames: [], outputPrefix: "NF_GOOGLE", settings: { aspectRatio: "1:1" } })
  assert.equal(googleText.providerNodeType, "GeminiImageNode")
  assert.equal("images" in googleText.workflow[googleText.providerNodeIds[0]].inputs, false)

  const googleEdit = workflow.buildWorkflow({ provider: "google", mode: "img2img", prompt: "merge references", uploadedNames: ["one.png", "two.png", "three.png"], outputPrefix: "NF_GOOGLE_EDIT", settings: { aspectRatio: "1:1", resolution: "1K" } })
  const batch = Object.values(googleEdit.workflow).find((node) => node.class_type === "BatchImagesNode")
  assert.deepEqual(Object.keys(batch.inputs), ["images.image0", "images.image1", "images.image2"])
  ```

  Build a binary Comfy TEXT frame with big-endian event type `3`, node-id length, node-id bytes, and `Price: 8.25 credits`; assert the parser returns `{ nodeId, credits: 8.25 }` and rejects non-TEXT frames.

- [ ] **Step 2: Run RED**

  Run: `node --test particle-editor-desktop/tests/art-generate-provider-workflow.test.js`

  Expected: FAIL because both modules and globals are absent.

- [ ] **Step 3: Implement the resource and adapter modules**

  The capability registry exposes provider-specific fields:

  ```js
  {
    local: { txt2img: { referenceLimit: 0, fields: ["width", "height", "steps", "cfg", "denoise", "seed", "nsfw"], negativePrompt: true }, img2img: { referenceLimit: 3, fields: ["width", "height", "steps", "cfg", "denoise", "seed", "nsfw"], negativePrompt: true } },
    gpt: { txt2img: { referenceLimit: 0, fields: ["quality", "size"], negativePrompt: false }, img2img: { referenceLimit: 3, fields: ["quality", "size"], negativePrompt: false } },
    google: { txt2img: { referenceLimit: 0, fields: ["aspectRatio"], negativePrompt: false }, img2img: { referenceLimit: 3, fields: ["aspectRatio", "resolution"], negativePrompt: false } }
  }
  ```

  Workflow builders identify behavior by `class_type`, never exported node IDs. GPT V2 uses Comfy's API-prompt form for `COMFY_DYNAMICCOMBO_V3`: `model` selects `gpt-image-2`, while nested runtime values are supplied through flattened keys such as `model.size`, `model.quality`, and `model.images.image_1..3`. Gemini text mode omits `images`; Gemini edit mode creates one `LoadImage` per upload, one `BatchImagesNode`, and one `GeminiImage2Node`. Every workflow ends in `SaveImage` with the supplied prefix and `n=1`.

  The price observer opens `ws(s)://<runtime>/ws?clientId=<clientId>` before `/prompt`, filters decoded TEXT frames to the provider node IDs, keeps the latest positive credit value, exposes `waitForCredits(timeoutMs)` and `close()`, and never logs payloads.

- [ ] **Step 4: Run GREEN**

  Run: `node --test particle-editor-desktop/tests/art-generate-provider-workflow.test.js`

  Expected: PASS with all four workflow modes and binary price decoding verified.

---

### Task 2: Provider authorization, credential injection, and exact image settlement

**Files:**
- Modify: `particle-editor/comfyui-workflow-credit-cost.js`
- Modify: `particle-editor-desktop/main.js`
- Modify: `particle-editor-desktop/preload.js`
- Modify: `tools/preview_runtime_server.py`
- Modify: `particle-editor-desktop/tests/comfyui-workflow-credit-cost.test.js`
- Create: `particle-editor-desktop/tests/comfyui-image-provider-contract.test.js`

**Interfaces:**
- Consumes: `SUPPORTED_NODE_TYPES` from the shared pricing helper.
- Produces: image API-node detection with `taskType: "local_workflow_image"`, `creditCost: 0`, and `pricingStatus: "pending_pricing"` until actual Runtime credits arrive.

- [ ] **Step 1: Write failing provider-registry tests**

  Assert `SUPPORTED_NODE_TYPES` includes `OpenAIGPTImage1`, `OpenAIGPTImageNodeV2`, `GeminiImageNode`, and `GeminiImage2Node`. Assert an image workflow estimate returns provider `comfyui`, task type `local_workflow_image`, pending pricing, and zero charge. Assert main and preload derive their Set from the shared helper and the Python preview allowlist contains the same four image classes.

- [ ] **Step 2: Run RED**

  Run: `node --test particle-editor-desktop/tests/comfyui-workflow-credit-cost.test.js particle-editor-desktop/tests/comfyui-image-provider-contract.test.js`

  Expected: FAIL because image nodes are absent from the authority and injection paths.

- [ ] **Step 3: Implement shared recognition**

  Extend the helper's immutable node list and classify image classes separately from video classes. Keep their estimate pending so the automatic history observer creates/updates the pending usage row but does not fabricate a charge. Main and preload create provider Sets from `loadComfyWorkflowCreditCostApi().SUPPORTED_NODE_TYPES`, with a complete fallback containing the same classes. The Python preview proxy receives the same class additions.

- [ ] **Step 4: Run GREEN and the existing settlement tests**

  Run: `node --test particle-editor-desktop/tests/comfyui-workflow-credit-cost.test.js particle-editor-desktop/tests/comfyui-image-provider-contract.test.js particle-editor-desktop/tests/comfyui-usage-settlement-contract.test.js particle-editor-desktop/tests/preload-comfyui-usage-owner.test.js`

  Expected: PASS; legacy Kling/ByteDance estimates remain unchanged and image prompts are pending until exact-price settlement.

---

### Task 3: Shared account card multi-host support and Generate left controls

**Files:**
- Create: `particle-editor/art-generate-mode.tool.js`
- Modify: `particle-editor/novaflow-client-auth.js`
- Modify: `particle-editor/spine-split-runtime.js`
- Create: `particle-editor-desktop/tests/art-generate-mode-tool.test.js`
- Create: `particle-editor-desktop/tests/client-auth-multi-host.test.js`

**Interfaces:**
- Produces: `NovaFlowClientAuth.mount(surfaceKey, HTMLElement)` and `unmount(surfaceKey)` while retaining the existing automatic AI Sequence host.
- Produces: `NovaFlowArtGenerateModeTool.mount({ host, provider, onProviderChange })`.
- Produces: source Runtime host `[data-novaflow-art-generate-control-host="1"]`.

- [ ] **Step 1: Write failing UI and auth contract tests**

  Assert the Generate section source no longer contains the two placeholder items `文生图`/`图生图` and instead renders the dedicated host. Assert the tool's exported options are exactly `本地模型`, `GPT`, `Google`, the account slot precedes the select, and change callbacks emit `local|gpt|google`. Assert client auth maintains a host registry, renders every connected host from one state, and its global click handler resolves the clicked auth host instead of a singleton.

- [ ] **Step 2: Run RED**

  Run: `node --test particle-editor-desktop/tests/art-generate-mode-tool.test.js particle-editor-desktop/tests/client-auth-multi-host.test.js particle-editor-desktop/tests/client-auth-panel-refresh.test.js`

  Expected: FAIL because the Generate host, tool, and auth mount API do not exist.

- [ ] **Step 3: Implement the host/tool and shared auth registry**

  `spine-split-runtime.js` renders only a neutral host in the Generate body. The tool renders an account slot first and a labelled model select second, then calls `NovaFlowClientAuth.mount("art-generate", accountSlot)`. The auth module retains one state, one observer, one focus refresh, and one action pipeline; it renders the automatic AI Sequence host plus registered external hosts and never duplicates session storage.

- [ ] **Step 4: Run GREEN**

  Run: `node --test particle-editor-desktop/tests/art-generate-mode-tool.test.js particle-editor-desktop/tests/client-auth-multi-host.test.js particle-editor-desktop/tests/client-auth-panel-refresh.test.js`

  Expected: PASS, including the existing AI Sequence refresh behavior.

---

### Task 4: Art Generate runtime dispatcher, capability-aware editor, and result settlement

**Files:**
- Modify: `particle-editor/novaflow-brand-runtime.js`
- Create: `particle-editor-desktop/tests/art-generate-provider-runtime-contract.test.js`

**Interfaces:**
- Consumes: all three new globals and existing `NovaFlowClientAuth.commitAiTaskUsage`.
- Preserves: historical `patchArtWorkflow()` for Local only.

- [ ] **Step 1: Write the failing Runtime contract test**

  Assert the Runtime:

  ```js
  assert.match(source, /NovaFlowArtGenerateModeTool/)
  assert.match(source, /NovaFlowArtGenerateProviderWorkflow/)
  assert.match(source, /NovaFlowArtGenerateModels/)
  assert.doesNotMatch(source, /provider === "cloud"[\s\S]{0,160}云端AI暂未接入/)
  assert.match(source, /usageKey:\s*`comfyui:\$\{promptId\}`/)
  assert.match(source, /pricingSource:\s*"comfy_api_response_v1"/)
  ```

  Also extract and exercise the provider render-signature helper so switching Local -> GPT while remaining in `txt2img` invalidates the cached bottom panel.

- [ ] **Step 2: Run RED**

  Run: `node --test particle-editor-desktop/tests/art-generate-provider-runtime-contract.test.js`

  Expected: FAIL because the cloud early return and local-only renderer remain.

- [ ] **Step 3: Implement minimal Runtime glue**

  Add provider settings to `ART_GENERATE_STATE` and mount the left tool during the existing sync. Provider changes force the bottom editor to re-render. Local renders all existing fields and negative prompt. GPT renders quality and size (plus custom width/height only for Custom) and no negative prompt. Google text renders aspect ratio; Google edit renders aspect ratio and resolution; both omit negative prompt. Image mode keeps the existing ordered three-slot reference grid.

  In `runArtGenerate()` upload references as today, dispatch Local to `patchArtWorkflow()` and GPT/Google to `buildWorkflow()`, validate all classes through `/object_info`, open the provider price observer before `/prompt`, and retain the current `/history`, `/view`, result-state, and `NovaFlowSpineSplitBridge` paths. After successful media output, wait briefly for actual credits and call:

  ```js
  await window.NovaFlowClientAuth.commitAiTaskUsage({
    providerKey: "comfyui",
    modelKey,
    taskType: "local_workflow_image",
    promptId,
    usageKey: `comfyui:${promptId}`,
    estimatedCreditCost: credits,
    creditCost: Math.ceil(credits),
    parameters: { runtime: "comfyui", workflowNodeType, pricingStatus: "known", pricingSource: "comfy_api_response_v1", source: "art-generate-provider-workflow" }
  })
  ```

  Close the observer in `finally`. If exact price is unavailable, preserve the successful result, leave the server row pending, refresh the account card, and show `生成完成，计费待核对` instead of claiming deduction.

- [ ] **Step 4: Run GREEN plus all focused tests**

  Run: `node --test particle-editor-desktop/tests/art-generate-provider-runtime-contract.test.js particle-editor-desktop/tests/art-generate-provider-workflow.test.js particle-editor-desktop/tests/art-generate-mode-tool.test.js particle-editor-desktop/tests/client-auth-multi-host.test.js particle-editor-desktop/tests/comfyui-image-provider-contract.test.js`

  Expected: PASS.

---

### Task 5: Runtime manifests, mirrors, live verification, and archive

**Files:**
- Modify: `particle-editor/index.html`
- Modify: `scripts/sync-runtime.mjs`
- Modify: `scripts/check-runtime-sync.mjs`
- Modify: `particle-editor-desktop/scripts/build-renderer.mjs`
- Modify: `logs/debug.log`
- Generated by sync: `particle-editor-desktop/renderer/**`
- Generated by sync: `particle-editor-desktop/dist/win-unpacked/resources/app/**`

**Interfaces:**
- Loads resource -> workflow -> tool before `novaflow-brand-runtime.js`.
- Makes every new module part of source/mirror SHA verification and packaging.

- [ ] **Step 1: Write/extend a failing load-order and mirror contract**

  Extend the provider Runtime contract test to assert `index.html` loads `art-generate-model.resource.js`, then `art-generate-provider.workflow.js`, then `art-generate-mode.tool.js`, all before `novaflow-brand-runtime.js`; assert sync/check/build manifests name all three files.

- [ ] **Step 2: Run RED**

  Run: `node --test particle-editor-desktop/tests/art-generate-provider-runtime-contract.test.js`

  Expected: FAIL because the new files are not registered.

- [ ] **Step 3: Register modules and append the required debug record**

  Update source manifests and cache-buster tags. Append one UTF-8 entry to `logs/debug.log` using the mandated format with problem, cause, solution, and affected scope; do not alter historical entries.

- [ ] **Step 4: Run GREEN and generate mirrors**

  Run:

  ```powershell
  node --test (Get-ChildItem particle-editor-desktop/tests/*.test.js | Sort-Object Name | Select-Object -ExpandProperty FullName)
  npm run sync:runtime
  npm run check:runtime
  npm run check:entry
  node --check particle-editor/art-generate-model.resource.js
  node --check particle-editor/art-generate-provider.workflow.js
  node --check particle-editor/art-generate-mode.tool.js
  node --check particle-editor/novaflow-client-auth.js
  node --check particle-editor/novaflow-brand-runtime.js
  node --check particle-editor/spine-split-runtime.js
  node --check particle-editor-desktop/main.js
  node --check particle-editor-desktop/preload.js
  python -m py_compile tools/preview_runtime_server.py
  ```

  Expected: all commands exit 0 and runtime SHA checks report source/mirror parity.

- [ ] **Step 5: Validate the accepted surfaces without paid generation**

  On `http://127.0.0.1:4783/`, open Art -> Generate and verify: no local/cloud buttons; account shell precedes the model select; the select has three exact options; Local/GPT/Google changes keep one stable outer editor; text mode has zero reference slots; image mode has three; provider-specific controls match the capability registry. Re-open AI Sequence and verify its account card and controls still work.

  In packaged Electron, verify auth bridge visibility, login state reuse, credential injection readiness, and that no provider key appears in Renderer/localStorage/log output. Do not click Start Generation during this step.

- [ ] **Step 6: Optional paid smoke matrix when credentials and balance are explicitly approved**

  Run four lowest-cost jobs: GPT text low/1024, GPT edit low/1024 with three refs, Google Flash text 1:1, Google Pro edit 1K with three refs. For each, prove `/prompt` success, `/history/<promptId>` media output, all intended reference links, exact WebSocket credits, one `comfy_usage_settlements` row with the same usage key, matching user/provider deductions, account-card refresh, and result placement. If paid approval is absent, report these four tests as not executed rather than claiming end-to-end external success.

- [ ] **Step 7: Review, auto-commit, and clean-tree proof**

  Request a read-only whole-change review, resolve all Critical/Important findings, rerun focused and final verification, then run `npm run auto-commit` followed by `git status --short`. Expected final commit subject is `auto-save: YYYY-MM-DD HH:mm:ss` and the working tree is clean.
