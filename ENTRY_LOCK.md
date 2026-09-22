# 当前 Web 主线入口（2026-09-23）

本仓库已独立迁移为 NovaFlow Web。当前维护入口以根目录 `README.md`、`AGENTS.md` 和 `novaflow-web/docs/INDEPENDENT_WORKSPACE.md` 为准：

- 启动助手：`npm run dev`，本地浏览器工作台默认 `http://127.0.0.1:4784/`，授权连接由助手打开。
- 后台管理：`npm run admin:start`，源码 `novaflow-web/admin/`。
- 网页构建和校验：`npm run sync:runtime`、`npm run check:runtime`、`npm run check:entry`。

以下 4783/桌面 renderer 锁定规则仅作为旧桌面产品历史记录，不作为当前 Web 主线的验收入口。

---

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
