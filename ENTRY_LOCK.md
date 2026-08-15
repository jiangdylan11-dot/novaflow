# Entry Lock

- The only accepted runtime entry is `http://127.0.0.1:4783/`.
- The real runtime chain is `tools/preview_runtime_server.py` -> `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html` -> JS `assets/index-Bqc1waVn.js`, CSS `assets/index-g5_V6IX0.css`, and icon `assets/asset-CLAJAQ7J.ico`.
- `5173`, `4173`, `particle-editor` Vite, source preview, and Electron dev are retired validation paths. They must not be treated as active entries, backup entries, or day-to-day verification ports.
- By default, code changes must apply directly to `D:\AI_APP\NovaFlow\particle-editor-desktop\dist\win-unpacked\resources\app\renderer`.
- Mirror the same change to `D:\AI_APP\NovaFlow\particle-editor-desktop\renderer` only when needed to prevent drift between renderer copies.
- `particle-editor` is a static mirror shell for the locked runtime, not a separate validation target.
- The root verification command is `python tools/check_4783_runtime.py`. Use it to confirm both runtime health and 4783-only policy alignment.
- `RUNTIME_SURFACE_HASH_SNAPSHOT.json` records explicit active-surface hash acceptances for locked-runtime-only guard patches. It is verification metadata only and must not be used to imply a Source runtime or generation behavior change.
- Before editing code, list the target files, why each file must change, whether the entry chain is affected, and whether any existing module will be removed.
