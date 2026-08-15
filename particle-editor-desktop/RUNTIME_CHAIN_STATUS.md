# Runtime Chain Status

Date: 2026-06-11

## Active Entry Files

- Live runtime checked at `http://127.0.0.1:4783/`.
- Runtime source-of-truth HTML: `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html`.
- Mirrored HTML: `particle-editor-desktop/renderer/index.html` and `particle-editor/index.html`.
- The live HTML response and all local HTML files point to the same active entry chain:
  - `./ui-render-trace.js?v=20260516-chain-unified-12`
  - `./runtime-fetch-proxy.js?v=20260611-runtime-proxy-1`
  - `./proxy-electron-api.js?v=20260516-chain-unified-12`
  - `./runtime-detect-stabilizer.js?v=20260611-runtime-proxy-1`
  - `./spine-official-runtime.js?v=20260516-chain-unified-12`
  - `./ai-background-removal-runtime.js?v=20260516-chain-unified-12`
  - `./aifx-repaint-runtime.js?v=20260516-chain-unified-12`
  - `./spine-split-runtime.js?v=20260516-chain-unified-19`
  - `./novaflow-brand-runtime.js?v=20260516-chain-unified-30`
  - `./ribbon-event-markers.js?v=20260516-chain-unified-19`
  - `./assets/index-Bqc1waVn.js?v=20260516-chain-unified-20`
  - `./assets/index-g5_V6IX0.css?v=20260516-chain-unified-20`

## Current Correction

- Removed stale entry-chain metadata for retired bundles and old query strings.
- `particle-sidebar-spacing.js` is not present in the current active chain and is not referenced by the active `index.html`.
- The runtime shell keeps split editing and ribbon calculation scripts in the active chain: `spine-split-runtime.js` and `ribbon-event-markers.js`.
- `ui-render-trace.js` remains active as the validation shim for first-frame and switch-flicker checks.

## Phase 2 Verification

- 4783 was started with the locked runtime server.
- `npm run check:entry`: `Overall: GO`.
- Runtime index, source/dist index match, active surface sync, main bundle content sync, AI effects takeover, and locked policy checks passed.
- `/__runtime_health` reports Runtime upstream reachability through the preview server.

## Runtime Patch Ledger Tags

- `novaflow-brand-runtime.js`: `KEEP`, `MIGRATE_TO_REACT`, `VERIFY_PACKAGED_FILE`.
- `spine-split-runtime.js`: `KEEP`, `PROTECTED_ISLAND`, `VERIFY_PACKAGED_FILE`.
- `aifx-repaint-runtime.js`: `KEEP`, `MIGRATE_TO_REACT`, `PROTECTED_ISLAND`.
- `proxy-electron-api.js`: `KEEP`, `VERIFY_PACKAGED_FILE`.
- `ui-render-trace.js`: `KEEP`, later `DELETE_CANDIDATE` after trace replacement.

## Deletion Guard

- Do not delete `assets/`, `templates/`, `debug-assets/`, hashed bundles, split-editing runtime, ribbon markers, Spine runtime/vendor files, or Electron IPC bridge files just because they look duplicated.
- Treat only the files referenced by the active `index.html` as the loaded runtime chain.
