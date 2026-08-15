# Project Entry Lock

- This directory is a static mirror shell of the locked runtime, not an independent preview app.
- The only accepted runtime entry is `http://127.0.0.1:4783/`.
- The source-of-truth runtime chain is `tools/preview_runtime_server.py` -> `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html` -> `assets/index-Bqc1waVn.js` plus `assets/index-g5_V6IX0.css`.
- `particle-editor/index.html` must stay aligned with the active runtime shell, but it must not introduce or validate through `5173`, `4173`, Vite source preview, or Electron dev.
- If a task touches shared shell files, update the locked 4783 runtime first and mirror intentionally rather than creating a second validation lane.
- `npm run dev:source` is retired by design. Use `http://127.0.0.1:4783/` and `python tools/check_4783_runtime.py`.
