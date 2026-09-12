# H3 prompt content optimization: local and Grok

The common renderer instruction previously described the assistant as a formatter. Local and Grok output validation accepted a copied narrative when the H3 structural requirements passed; a second failed answer could also be replaced with a deterministic copy plus generic prose and reported as success.

The renderer now requests content optimization followed by H3 compilation. Local Python, desktop Grok proxy, and Supabase Grok use the same content policy: turn vague motion descriptions into concise observable actions and timing, preserve hard constraints and reference roles, distinguish fixed framing from allowed local body movement, and describe loop closure when requested. Constant green screens and prohibited effects remain constraints. Audio remains independent from visual-effects instructions. The change does not force breathing or blinking on every subject.

## Checks and retry behavior

- A conservative narrative comparison ignores H3 field wrappers, shot/reference labels, punctuation, and known generic padding. Exact copies and very small padded changes are rejected. Audio-only edits do not count as narrative optimization during general optimization.
- Requested loops need a recognizable return-to-start description. Explicit requests to cancel a loop are respected. Explicit format-only requests may preserve the narrative.
- These checks are deliberately bounded heuristics, not a semantic or visual-quality guarantee. The shared instructions guide the actual rewrite; real output quality still needs user acceptance.
- A rejected answer uses the existing one-repair budget. If repair fails, optimization reports failure rather than fabricating a successful replacement from the original input.
- Reverse-image analysis is outside the new content gate; H3 fields, alignment, labels, and existing reference validation remain intact.

Shared source: `particle-editor-desktop/prompt_assistant/h3_prompt_enhance_policy.json`. Python uses it directly, the desktop proxy uses the JS implementation, and `scripts/sync-h3-prompt-enhance.mjs` generates the deployable Edge module. Runtime sync generates and copies these dependencies.

## Verification and delivery

- 115 Node tests passed, including existing backend, H3 frame/reference, renderer protocol, local/backend bridge, and Grok contracts plus new content/retry cases.
- 15 Python tests passed: 4 enhancement tests (including shared Chinese/English cases) and 11 H3 layout/reference tests.
- `sync:runtime` and `check:runtime` passed. JavaScript/Python syntax checks passed.
- `check:entry` remains NO-GO because locked port 4783 was unreachable; direct 8188 probe succeeded. No visual UI acceptance is claimed.
- No live optimization/model inference or video generation was run. Provider responses in regression tests were controlled fixtures.
- Before deployment, active cloud version 57 was downloaded into `.tmp-h3-enhance-cloud-before`; all four deployed source modules matched the repository baseline. This verified the deployment would not overwrite unrelated online edits.
- Supabase project `cjakoblszlmbmotchzva`, function `novaflow-backend`, was deployed as active version 58. The five deployed modules were downloaded into `.tmp-h3-enhance-cloud-after` and all matched this release.
- Installer built in isolated `particle-editor-desktop/dist/h3-content-enhance-update`; final `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe`, 249,829,571 bytes. Packaged optimizer service, policy, Python/JS implementations, renderer workflow and HTML match the source/mirror hashes.
- Existing Program Files installation requires covering installation and restart for the local change. The Grok cloud backend update is already deployed.
