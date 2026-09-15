# H3 prompt optimizer: five-section format, local and Grok

The prompt optimizer now writes the five requested sections: 任务定位, 说话者,
递进式详细提示词, 台词, 连续性与约束. Mode, duration, reference bindings and dialogue
come from the request; the cyber character example is test data, not a built-in preset.

The previous app contract required English fields and rejected Subject labels in I2V.
The local optimizer also had only 512 output tokens for I2V and 384 for repair.
Real-model tests additionally exposed invented Picture 2 bindings, dropped dialogue,
and differences in Chinese heading punctuation. The new optimizer uses the shared
five-section contract, explicit local mode/dialogue instructions, a 2048-token budget
for either attempt, and one repair attempt. H3 IPC/preview timeout is 900 seconds;
other optimizer timeouts remain unchanged.

Only mechanical heading, speaker-parenthesis and paragraph differences are normalized.
Validation rejects missing sections, invalid duration/ranges, unavailable references,
undefined speakers, dropped explicitly labeled dialogue, contradictory silence, and
unchanged narrative. Failed optimization preserves the original prompt and reports the
failed gate. These bounded checks do not certify video quality.

Legacy image-reverse visual projection retains its existing protocol. New prompts can
be optimized again without treating a defined speaker as an uploaded reference asset.
A workflow test verifies the five-section text reaches I2V conditioning unchanged,
with only its supplied first-frame image.

## Verification

- 41 Node tests and 4 Python tests passed.
- Real local Qwen2.5-VL I2V optimization: successful first attempt in 113.24 seconds,
  293 generated tokens; full original dialogue retained. See `local-output.txt` and
  `local-result.json`. Earlier failed attempts were used to correct the actual path.
- Real Grok call using the production request builder and result validator: successful
  first attempt in 10.97 seconds. See `grok-output.txt` and `grok-result.json`.
- These are prompt-optimization tests, not video generation or perceptual lip-sync tests.
- Cloud function `novaflow-backend` was upgraded from v58 to v59 (ACTIVE). The pre-deploy
  download matched repository HEAD; all five post-deploy modules matched the final source.
  Real provider testing used the production builder/parser directly; an authenticated
  end-to-end request through the deployed Edge endpoint was not performed.
- `sync:runtime` and final post-package `check:runtime` passed. Eleven files, including
  the renderer bundle, were extracted directly from the installer and match source
  hashes; see `package-manifest.json`. A source bundle change during the first build
  required resynchronization and repackaging before this final verification.
- Installer: `particle-editor-desktop/dist/NovaFlow Setup 2.3.214 - H3五段格式修复.exe`.
  Built using `build:win:nobump`; version remains 2.3.214.
- Updating `C:/Program Files/NovaFlowPortable` directly failed with Windows PermissionError
  on the first file. No installed file was changed. Cover-install and restart are required;
  the old renderer will reject the new cloud format until updated.
- Locked 4783 acceptance remains NO-GO: the server was unreachable and automatic approval
  rejected starting the preview with `blocked by policy`. Direct 8188 health succeeded.
  No browser/UI acceptance is claimed.
