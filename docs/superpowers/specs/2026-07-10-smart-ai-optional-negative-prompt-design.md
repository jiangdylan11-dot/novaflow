# Smart AI Optional Negative Prompt Design

## Status

Approved in conversation on 2026-07-10.

## Requirement

Smart AI must follow the prompt controls that actually exist on the active page:

- When a positive and negative prompt control both exist, generate and write both values.
- When only a positive prompt control exists, generate and write only the positive value.
- A missing positive prompt control remains an error.
- A missing negative prompt control is an expected page capability, not an error.

## Root Cause

The backend currently requires every Smart AI response to contain a non-empty `negative_prompt`. The frontend writes the positive value first and then throws `未找到负面提示词框` when the active Seedance surface has no negative control. This produces a partial success followed by a misleading failure.

## Architecture

The renderer derives a boolean capability from the active DOM target and sends it as `supportsNegativePrompt`. The admin server defaults this capability to `true` for compatibility with older clients, but switches prompt instructions, result parsing, and response metadata to positive-only behavior when the value is `false`.

No provider/model name is used for routing. The active page structure remains the source of truth.

## Data Flow

1. `getPromptTextareasFromContext(...)` returns the current positive and optional negative controls.
2. `runSmartAi()` computes `supportsNegativePrompt` from the negative control.
3. Prompt optimization and image reverse requests carry that capability through the existing Electron bridge.
4. The backend requests either `{ "prompt": "..." }` or `{ "prompt": "...", "negative_prompt": "..." }` from Grok.
5. The parser forces `negative_prompt: ""` and `has_negative_prompt: false` for positive-only requests.
6. The renderer always writes the positive prompt and writes the negative prompt only when the page supports it.

## Compatibility

- Missing capability fields default to `true`, preserving existing callers.
- Art Generate and local animation surfaces with a negative control keep their current two-field behavior.
- Seedance, Kling, or any future surface without a negative control receives positive-only output automatically.
- No workflow, generation parameter, credit, provider quota, or layout behavior changes.

## Error Handling

- Missing/disconnected positive target: retain `未找到提示词框`.
- Missing negative target when capability is false: success.
- Missing/disconnected negative target when capability was true: retain write failure because the page changed during the request.
- Invalid or empty positive provider output: retain generation failure.

## Verification

- Add a contract that fails until the renderer sends and honors `supportsNegativePrompt`.
- Assert the backend preserves default two-field behavior and supports positive-only output.
- Run Smart AI contracts, syntax checks, Runtime synchronization checks, locked `4783` entry verification, and `git diff --check`.

