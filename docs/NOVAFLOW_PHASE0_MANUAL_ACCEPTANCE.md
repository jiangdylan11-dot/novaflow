# NovaFlow Phase 0 Manual Acceptance Matrix

## Purpose

This matrix records the manual smoke paths that must remain stable before and after low-risk refactor work. Phase 0 does not require real AI generation success. It verifies that stable UI surfaces, entry routing, state isolation, and error handling do not regress.

## Preconditions

- Start the accepted runtime entry only when needed:

```powershell
npm run dev:runtime
```

- Open:

```text
http://127.0.0.1:4783/
```

- Do not use retired source preview ports as acceptance proof.
- Do not edit Comfy workflow JSON, Storyboard V5, Prompt Assistant, or business Runtime files during Phase 0.

## Acceptance Matrix

| Area | Path | Expected result | Notes |
|---|---|---|---|
| Startup | Open `http://127.0.0.1:4783/` | Main UI loads without blank screen or runtime script errors. | 8188 may be disconnected; record it instead of patching. |
| Primary navigation | Click `特效` | Feature area switches without stuck overlay or broken layout. | Verify left rail active state. |
| Primary navigation | Click `动画` | Animation area opens and previous primary state does not visually leak. | Check AI sequence and skeleton entry availability. |
| Primary navigation | Click `美工` | Art area opens without legacy bone panel leaking into art workspace. | Check secondary entries. |
| Primary navigation | Click `工具` | Tools area opens and upload/drop zones remain visible. | No UI style changes expected. |
| Primary navigation | Click `仓库` | Repository entry opens or reports the current expected unavailable state without crash. | Record exact visible result. |
| Primary navigation | Click `导出` | Export entry opens expected modal or expected authorization state. | Do not save/export unless explicitly testing output. |
| Secondary navigation | `动画` -> `AI序列动画` | AI sequence surface opens with resource area, prompt area, and preview area coherent. | No skeleton controls should remain active. |
| Secondary navigation | `动画` -> `骨骼动画` | Skeleton animation surface opens with skeleton preview and controls. | No AI sequence overlays should remain active. |
| Secondary navigation | `美工` -> `UI` | UI art section opens without drawing workspace state leaking. | Record if unavailable. |
| Secondary navigation | `美工` -> `绘图` | Drawing workspace opens and split tool panel can mount. | Do not run heavy generation unless explicitly required. |
| Dialog smoke | Open/close export dialog | Dialog opens, can close, and backdrop state clears. | Check topbar and body classes visually. |
| Dialog smoke | Open/close HD upscale dialog | Dialog opens and closes without starting a task. | Trigger through drawing/enhance entry. |
| Dialog smoke | Open/close wash image dialog | Dialog opens and closes without starting a task. | No workflow execution required. |
| Dialog smoke | Open/close outpaint dialog | Dialog opens and closes without starting a task. | No workflow execution required. |
| Dialog smoke | Open/close angle adjust dialog | Dialog opens and closes without starting a task. | No workflow execution required. |
| Dialog smoke | Open/close Storyboard dialog | Dialog opens and closes only. | Do not change Storyboard settings or logic. |
| Resource cards | Add a resource | New resource card appears in the expected panel. | Use a small local image. |
| Resource cards | Select a resource | Preview and active card update together. | No stale active card highlight. |
| Resource cards | Delete a resource | Card is removed and selection falls back predictably. | No console crash or blank workspace. |
| Resource cards | Append a result resource | Result card is added without replacing unrelated resources. | Can be tested with existing data URL or previous output. |
| Preview | Image preview | Preview shows selected image without stretching or blank state. | Check both art and AI sequence paths if possible. |
| Preview | Black background | Black/gray background mode appears only on the correct preview surface. | No cross-surface body class leak. |
| Preview | Switch resource | Preview updates to the newly selected resource. | No delayed wrong image flash. |
| AI link smoke | AI optimize button | Button is clickable or reports expected error without crashing UI. | Real optimization is not required. |
| AI link smoke | AI reverse prompt button | Button is clickable or reports expected error without crashing UI. | Real reverse prompt is not required. |
| Animation isolation | AI sequence -> skeleton | Skeleton surface appears without AI first-frame flash, stuck buttons, or layout residue. | Watch first 2 seconds after switch. |
| Animation isolation | Skeleton -> AI sequence | AI sequence surface returns without skeleton controls or stale stage residue. | Watch first 2 seconds after switch. |
| Export / repository | Open repository | Repository opens or reports expected state without affecting current primary entry. | Do not mutate assets. |
| Export / repository | Open export dialog | Dialog opens from the expected entry and closes cleanly. | Do not write output unless explicitly testing export. |
| Export / repository | Topbar file hidden state | Confirm topbar file/export visibility matches the current surface. | No unexpected File menu resurrection. |

## Failure Recording Template

## Execution Record - 2026-06-29

Runtime:

- Date/time: 2026-06-29 22:54:33 +07:00
- Entry: `http://127.0.0.1:4783/`
- 4783: PASS, HTTP 200
- 8188: PASS, HTTP 200
- Scope: manual UI smoke only; no workflow execution, no Storyboard generation, no export write.
- Result: PASS 30 / WARNING 0 / FAIL 0

Notes:

- Export was tested in the current unlicensed state. The expected protected modal was `需要授权`; no export file was written.
- Resource add/append was covered through NovaFlow's existing split source-resource smoke path, then select/delete/preview were verified through visible resource-card UI.
- Storyboard dialog was opened and closed only; no Storyboard settings or logic were changed.

| Area | Path | Result | Evidence |
|---|---|---|---|
| Startup | Open 4783 | PASS | NovaFlow title loaded; page did not blank. |
| Primary navigation | 特效 | PASS | `active=特效`. |
| Primary navigation | 动画 | PASS | `active=动画`. |
| Primary navigation | 美工 | PASS | `active=美工`. |
| Primary navigation | 工具 | PASS | `active=工具`. |
| Primary navigation | 仓库 | PASS | Right resource/repository workspace visible with resource card panel. |
| Primary navigation | 导出 | PASS | Unlicensed export opened the expected `需要授权` protected modal. |
| Secondary navigation | 动画 > AI序列动画 | PASS | Active secondary changed to `AI序列动画`; AI assistant buttons visible. |
| Secondary navigation | 动画 > 骨骼动画 | PASS | Active secondary changed to `骨骼动画`; `novaflow-skeleton-animation-layout` active. |
| Secondary navigation | 美工 > UI | PASS | Active secondary changed to `UI`. |
| Secondary navigation | 美工 > 绘图 | PASS | Active secondary changed to `绘图`; split drawing workspace mounted. |
| Dialog smoke | Export dialog | PASS | Current unlicensed state opened and closed authorization modal. |
| Dialog smoke | HD upscale | PASS | `高清放大` dialog opened and closed; no task started. |
| Dialog smoke | Wash image | PASS | `洗图` dialog opened and closed; no task started. |
| Dialog smoke | Outpaint | PASS | `无限扩图` dialog opened and closed; no task started. |
| Dialog smoke | Angle adjust | PASS | `角度调整` dialog opened and closed; no task started. |
| Dialog smoke | Storyboard | PASS | `一键分镜` dialog opened and closed only. |
| Resource cards | Add resource | PASS | Source-resource smoke produced cards for `source-resource-a.png` and `source-resource-b.png`. |
| Resource cards | Select resource | PASS | Clicking cards switched active highlight between source resources. |
| Resource cards | Delete resource | PASS | UI delete button removed `source-resource-a.png`; fallback selection remained valid. |
| Resource cards | Append result resource | PASS | Source-resource append smoke path added resources without replacing unrelated cards. |
| Preview | Image preview | PASS | Selected source image was visible in the preview workspace. |
| Preview | Black background | PASS | Art preview stayed in the expected dark workspace surface. |
| Preview | Switch resource | PASS | Preview data changed when switching source cards. |
| AI link smoke | AI optimize button | PASS | Button returned to enabled state and showed expected `请先输入正向提示词` handling. |
| AI link smoke | AI reverse prompt button | PASS | Button returned to enabled state and showed expected `请先添加参考图、首帧或尾帧` handling. |
| Animation isolation | AI sequence -> skeleton | PASS | AI assistant buttons disappeared; skeleton layout active; no dialog residue. |
| Animation isolation | Skeleton -> AI sequence | PASS | AI assistant buttons returned; skeleton layout class cleared; no dialog residue. |
| Animation isolation | No flash/stuck/residue check | PASS | No first-frame flash symptom, stuck assistant buttons, or visible layout residue observed during switches. |
| Export / repository | Open repository | PASS | Repository/resource workspace remained accessible without mutating assets. |
| Export / repository | Open export dialog | PASS | Export entry opened expected authorization state and closed cleanly. |
| Export / repository | Topbar file hidden state | PASS | Topbar file button visibility read as `false`. |

Use this template when a path fails:

```text
Path:
Expected:
Actual:
Surface:
4783 available: yes/no
8188 available: yes/no
Console/log evidence:
Screenshot/video:
Suspected module:
```

## Phase 0 Manual Acceptance Rule

A future refactor step is not accepted unless every path it can affect is rechecked. If a path is not testable because 4783 or 8188 is unavailable, record it as blocked instead of treating it as passed.
