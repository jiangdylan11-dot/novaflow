# Runtime Shell Manifest

This directory is being treated as a static runtime shell workspace, not as a live Vite or TypeScript source application.

## Top-Level Runtime Entry Files

Direct runtime shell entry:

- `index.html`

Top-level runtime helper and support files currently present beside the entry shell:

- `ui-render-trace.js`
- `runtime-fetch-proxy.js`
- `proxy-electron-api.js`
- `runtime-detect-stabilizer.js`
- `aifx-dom-prune.js`
- `aifx-inline-v4.js`
- `aifx-repaint-runtime.js`
- `aifx-restyle.workflow.js`
- `aifx-restyle-client.js`
- `aifx-shape-detect.js`
- `aifx-v3-bridge.js`
- `spine-official-runtime.js`
- `ai-background-removal-runtime.js`
- `png-remove-black.tool.js`
- `spine-split-runtime.js`
- `ribbon-event-markers.js`
- `novaflow-brand-runtime.js`
- `favicon.svg`
- `icons.svg`
- `robots.txt`

## `index.html` Referenced Scripts And Bundles

Top-level helper scripts referenced from `index.html`:

- `./ui-render-trace.js?v=20260516-chain-unified-12`
- `./runtime-fetch-proxy.js?v=20260611-runtime-proxy-1`
- `./proxy-electron-api.js?v=20260516-chain-unified-12`
- `./runtime-detect-stabilizer.js?v=20260611-runtime-proxy-1`
- `./spine-official-runtime.js?v=20260516-chain-unified-12`
- `./ai-background-removal-runtime.js?v=20260719-unmult-1`
- `./aifx-shape-detect.js?v=20260920-aifx-ref-2`
- `./aifx-restyle.workflow.js?v=20260920-aifx-styles54-3`
- `./aifx-restyle-client.js?v=20260919-aifx-restyle-2`
- `./aifx-repaint-runtime.js?v=20260920-aifx-sequence-2`
- `./spine-split-runtime.js?v=20260516-chain-unified-19`
- `./novaflow-brand-runtime.js?v=20260920-art-prompt-guard-1`
- `./ribbon-event-markers.js?v=20260516-chain-unified-19`

Static asset bundle filenames currently referenced from `index.html`:

- `./assets/index-Bqc1waVn.js?v=20260516-chain-unified-20`
- `./assets/index-g5_V6IX0.css?v=20260516-chain-unified-20`

Other direct `index.html` references:

- `./assets/asset-CLAJAQ7J.ico`
- `./assets/favicon.ico` (runtime fallback set by `novaflow-brand-runtime.js`)
- external stylesheet: Font Awesome CDN (`https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css`)

## Asset Roots That Must Be Preserved

Preserve these roots as runtime data and shell content:

- `assets/**`
- `templates/**`
- `debug-assets/**`

## Duplicate-Looking Paths Requiring Confirmation Before Any Deletion

These paths look redundant or migration-related, but should not be deleted without explicit cleanup confirmation:

- `assets/` contains many hashed bundles, while `index.html` currently references only `assets/index-Bqc1waVn.js` and `assets/index-g5_V6IX0.css`
- `templates/` and `templates/templates/`
- `debug-assets/` and `debug-assets/debug-assets/`
- root shell files (`index.html`, `favicon.svg`, `icons.svg`, `robots.txt`)