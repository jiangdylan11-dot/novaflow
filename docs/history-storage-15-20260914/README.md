# AI sequence history persistence and reverse failure diagnostics — 2026-09-14

The AI sequence history hook still defaulted to six entries, and both positive and negative prompt callsites explicitly passed six. Previous display-only tests missed this. The hook truncates records on load and on mutations, so a fifteen-row component cannot recover those records.

The default and both callsites now retain fifteen combined saved/recent entries. Five saved slots remain available and count toward the total. Existing six-entry data loads unchanged and grows as new prompts are used; previously discarded entries are not fabricated or restored.

`prompt-history-display-limit.test.mjs` now executes the shipped storage hook with state/effect scheduling and localStorage roundtrips. It exercises twenty-two writes, five saved entries, remount, removal, legacy data, both actual callsite options, and rendering fifteen rows from persisted state. The hook runner is a test harness, not installed-app UI acceptance.

The reported local reverse failure log identifies `visual-person-count` during the first reference image analysis. It does not retain the raw model result, so the exact mismatch cannot be established. Main-process error serialization previously dropped this category. It now forwards only an allowlist of fixed diagnostic categories; the UI displays the person-count reason. Validation and model generation behavior are unchanged. This is a diagnostic improvement, not a claim that the user's explicit-content example now generates successfully.

Validation:

- Twelve focused tests passed, including persistence, display, diagnostic transport and prior cutout export/mask-only contracts.
- `sync:runtime` and `check:runtime` passed, including the rebuilt package tree.
- The actual NSIS installer was extracted. Seventeen relevant files matched source hashes; history persistence/display tests passed against its bundle. See `package-validation.json` and `packaged-history-tests.txt`.
- `check:entry` remains NO-GO: locked port 4783 unavailable, direct 8188 probe succeeded, and the existing AI effects integration gate remains incomplete. Installed UI behavior has not been accepted.
- Neutral, fully clothed portrait FL2VA live run passed both reference analysis and supplementary-requirement refinement, with renderer validation: two provider calls, no cached first stage, 138058 ms, 432 output characters. Evidence is stored as `local-first-last-reverse-*`. This fixture does not validate the user's explicit-content case.

Installer: `particle-editor-desktop/dist/NovaFlow Setup 2.3.214 - 历史15条存储与反推错误提示修复.exe` (version unchanged). Includes the prior video cutout performance and export changes. Existing installed processes were not replaced.
