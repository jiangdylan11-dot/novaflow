# NovaFlow Electron Desktop Profiling P5B

## Current commit

- Base commit before P5B: `1dabb2843bfeb6fe33c5d348fbb477d05c66d39f`
- Scope: Electron Desktop profiling and explicit A/B switches only.
- Runtime business code was not changed.

## What changed

P5B adds an Electron main-process profiling gate. It is disabled by default and only turns on with:

- `NF_ELECTRON_PROFILE=1`
- `--nf-electron-profile`

When enabled, the probe records in memory and prints console snapshots. It does not write probe data files.

The probe captures:

- Electron / Chrome / Node / V8 versions
- `app.getGPUFeatureStatus()`
- `app.getAppMetrics()`
- main process CPU and memory summary
- main process event loop delay
- BrowserWindow focus / blur / show / hide / resize / move / maximize / fullscreen events
- webContents loading, DOM ready, frame finish, load failure, render gone, responsive/unresponsive events
- `ipcMain.handle/on` channel counts and durations
- `runtime-status-changed` send count
- system mouse helper start/sample/bypass counters

P5B also exposes a narrow preload bridge for manual sampling:

- `window.__NFElectronProfile.snapshot()`
- `window.__NFElectronProfile.reset()`

This bridge is observational only and does not modify `window.electronAPI`.

## A/B switches

All switches are default-off:

- `--nf-electron-ab-http-renderer=4783`
  - Loads `http://127.0.0.1:4783/` in the Electron BrowserWindow.
  - Default remains file renderer.
- `--nf-electron-ab-background-throttling-off`
  - Sets `webPreferences.backgroundThrottling = false` only for that launch.
- `--nf-electron-ab-no-runtime-autostart`
  - Skips automatic Runtime startup only for that launch.
- `--nf-electron-ab-no-system-mouse-helper`
  - Uses the Electron screen fallback instead of starting the PowerShell mouse helper only for that launch.

## Sampling method

Sampling was lightweight CDP-driven A/B, not a manual human perception test.

The app was launched through Electron 32.2.0 / Chromium 128 with profiling enabled. Each scenario reset the Electron profile after initial load, dispatched mouse input to the primary entry, waited for the switch window, then read `window.__NFElectronProfile.snapshot()`.

Chrome 149 / 4783 remains the external baseline from the current P5 problem statement and earlier P3/P4 observations: it feels noticeably smoother than Desktop Electron.

## Sampling matrix

| Scenario | Renderer URL | Main event-loop max | IPC during switch | Window/webContents event anomaly | GPU |
| --- | --- | ---: | --- | --- | --- |
| File renderer -> 特效 | `file:///.../particle-editor-desktop/renderer/index.html` | 33 ms | none | none | compositing/rasterization enabled |
| File renderer -> 动画 | `file:///.../particle-editor-desktop/renderer/index.html` | 33 ms | `window-ensure-min-size` 0.12 ms, `runtime-get-status` 1.85 ms | none | enabled |
| File renderer 动画 -> 特效 -> 动画 | `file:///.../particle-editor-desktop/renderer/index.html` | 34 ms | `window-ensure-min-size` count 3 total 0.31 ms; `runtime-get-status` count 2 total 8.70 ms, max 6.69 ms | none | enabled |
| Electron-load-4783 -> 特效 | `http://127.0.0.1:4783/` | 33 ms | none | none | enabled |
| Electron-load-4783 -> 动画 | `http://127.0.0.1:4783/` | 33 ms | `runtime-get-status` 1.52 ms | none | enabled |
| Electron-load-4783 动画 -> 特效 -> 动画 | `http://127.0.0.1:4783/` | 34 ms | `runtime-get-status` count 2 total 7.16 ms, max 4.76 ms | none | enabled |

Startup-only observations:

- GPU initially reports software/off before the renderer/GPU process is fully initialized, then switches to enabled.
- Startup can include slow user-data/license IPC, but those were outside the reset switch windows.
- `runtime-status-changed` was seen during animation windows, but the associated `runtime-get-status` durations were single-digit milliseconds.
- `systemMouseHelper` did not appear in the sampled switch windows.

## Electron-load-4783 conclusion

Electron-load-4783 did not show an Electron main-process event-loop, BrowserWindow event, webContents event, GPU-disabled, or high-IPC signature in the sampled switch windows.

This does not prove that Electron-load-4783 feels smooth. The sampling was automated and cannot replace foreground human perception. It does show that the current Desktop jank is unlikely to be caused by:

- main process event-loop stalls
- BrowserWindow resize/focus/show/hide storms
- captured IPC duration
- disabled GPU acceleration
- system mouse helper activity during these windows

## Desktop file vs Electron-http vs Chrome-http

- Desktop file and Electron-http had very similar Electron main-process profiles during entry switches.
- Chrome-http 4783 is still the smoother user baseline, but Chrome does not have this Electron main probe.
- Because Electron-http did not show main-process anomalies, the next suspect is below the current P5B probe layer: Electron Chromium 128 renderer/compositor/input/paint behavior versus Chrome 149.

Current interpretation:

- If a human foreground A/B confirms Electron-load-4783 is still noticeably worse than Chrome 149, the issue is likely Electron/Chromium host, compositor, or renderer process scheduling.
- If Electron-load-4783 feels close to Chrome 149, the issue shifts back toward Desktop file/preload/main environment that is not visible in the current main-process counters.

## Highest suspects after P5B

1. Electron 32 / Chromium 128 renderer and compositor behavior versus Chrome 149.
2. Renderer-process main-thread or compositor frame stalls not visible from main process event-loop delay.
3. Desktop foreground input-to-paint path, which needs manual A/B or tracing rather than CDP synthetic input alone.
4. File/preload/Desktop environment remains a secondary suspect, but P5B did not find a main-process or IPC signature for it.

## P5C recommendation

P5C should not optimize defaults yet.

Recommended first step:

1. Run foreground manual A/B with the new switches:
   - default Desktop file renderer
   - `--nf-electron-ab-http-renderer=4783`
   - Chrome 149 `http://127.0.0.1:4783/`
2. Record perceived jank on:
   - 特效
   - 动画
   - 动画 -> 特效 -> 动画
3. Keep `NF_ELECTRON_PROFILE=1` enabled and collect snapshots before and after each path.
4. If Electron-load-4783 is still worse than Chrome, add renderer/compositor tracing next:
   - Electron `contentTracing`
   - renderer frame timing
   - input-to-paint markers
   - compositor frame/drop indicators
5. Only after that, test one A/B switch at a time:
   - `--nf-electron-ab-background-throttling-off`
   - Electron/Chromium version A/B
   - GPU raster/zero-copy flags as diagnostic-only switches

Do not continue Runtime guard work for P5C.
