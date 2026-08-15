# NovaFlow Runtime Entry Policy

## Purpose

NovaFlow has three surfaces that can look similar but are not equivalent:

1. Source mirror: `D:\AI_APP\NovaFlow\particle-editor`
2. Repo dist runtime: `D:\AI_APP\NovaFlow\particle-editor-desktop\dist\win-unpacked`
3. Installed local copy: `C:\Program Files\NovaFlowPortable`

Development validation and installed-build validation are separate workflows. A fix is considered ready for development verification only when it is validated against the locked `4783` runtime and the repo `dist\win-unpacked` runtime.

## Development Validation Entries

Use only these entries for development validation:

1. Locked browser runtime: `http://127.0.0.1:4783/`
2. Repo dist desktop runtime: `D:\AI_APP\NovaFlow\particle-editor-desktop\dist\win-unpacked`

The source mirror is not an independent validation entry. The installed Program Files copy is not a development validation entry.

The canonical entry check remains:

```powershell
npm run check:entry
```

## Installed Build Entry

The installed copy lives at:

```text
C:\Program Files\NovaFlowPortable
```

Use the Program Files entry only for:

- Post-package validation
- Release-candidate validation
- Formal daily use after installation

The installed copy is reached through the formal package and reinstall flow. It is not a long-term sync target for development changes.

## Prohibited Workflow

Do not manually copy runtime files into `C:\Program Files\NovaFlowPortable` during development to judge whether a fix is effective.

Manual Program Files overwrites blur the difference between the development build and the installed build, and can make a stale installer look current.

## Recommended Flow

```text
CODEX fix
-> 4783 validation
-> dist validation
-> stage target reached
-> formal package
-> reinstall
-> installed-build validation
```

## Entry Diagnosis

`diagnose:entry` remains available:

```powershell
npm run diagnose:entry
```

Use it to identify which entry is currently running:

- `4783`
- `dist`
- `Program Files`

This avoids mistaking an installed copy for the locked development runtime.

## Not Development Verification Entries

Do not use these as day-to-day development verification entries:

- `C:\Program Files\NovaFlowPortable`
- Source preview servers such as Vite source preview
- Retired ports such as `5173` or `4173`
- Electron dev mode when the task is to prove shipped-renderer behavior

The installed Program Files copy can lag behind the repo dist runtime. If `4783` and repo dist are current but Program Files is old, the fix is not considered failed.

## Legacy Program Files Deployment Helper

`scripts\deploy-to-program-files.ps1` is retained as a legacy emergency deployment helper.

Legacy emergency deployment helper.
Not part of normal development workflow.

The helper is only for emergency verification when explicitly requested. It is not the standard development flow, and its result cannot replace formal packaging, reinstalling, or installed-build validation.

Dry-run only:

```powershell
npm run deploy:program-files
```

Confirmed copy:

```powershell
npm run deploy:program-files:confirm
```

The deploy script copies from:

```text
D:\AI_APP\NovaFlow\particle-editor-desktop\dist\win-unpacked
```

to:

```text
C:\Program Files\NovaFlowPortable
```

It does not delete target-only files. It does not rebuild the app or create a new installer.
It skips the top-level `user-data` directory to avoid overwriting local mutable data during Program Files deployment.

## Required Closeout

After any code or configuration change, run:

```powershell
npm run auto-commit
git status
```

The final state must be a clean working tree.

## Decision Rules

- If `4783` and repo dist are current but Program Files is old, the fix is not considered failed.
- If the user reports behavior from Program Files, first diagnose which executable path is running.
- Do not sync Program Files by default or use it as development proof.
- Do not manually overwrite Program Files runtime files to test a development fix.
- Package and reinstall before using Program Files for release or formal-use validation.
- Do not delete or overwrite user data or target-only files during legacy emergency deployment.
