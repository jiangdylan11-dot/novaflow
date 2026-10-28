# NovaFlow Backend Edge Function

Cloud endpoint:

```text
https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend
```

This function is the lightweight NovaFlow cloud gateway. It handles:

- Email/password registration and login through Supabase Auth.
- Signed NovaFlow session verification.
- Service-side license and machine verification without exposing the licenses table.
- User status and credit balance reads.
- Per-user Provider call quotas for `grok`.
- Gateway Lite checks for `/api/ai/tasks`.
- Grok chat, prompt optimization, and image reverse-prompt forwarding through
  the backend only.

It intentionally does not store prompts, full workflow JSON, task records, consumption records, or AI logs. The NovaFlow client builds the workflow; the backend only verifies, checks quotas, and forwards approved Provider calls.

Required secrets:

```text
NOVAFLOW_SESSION_SECRET
NOVAFLOW_RUNNINGHUB_API_KEY
```

Online text and vision use `NOVAFLOW_RUNNINGHUB_LLM_BASE_URL` (default
`https://llm.runninghub.ai/v1`) and `NOVAFLOW_RUNNINGHUB_LLM_MODEL` (default
`xai/grok-4.7`). Set those two as function secrets only when the defaults are
not the ones you want. This function does not read `NOVAFLOW_GROK_*`.

Supabase provides `SUPABASE_URL`, Service Role, and publishable/anon keys to Edge Functions. Service Role and Provider API keys must never be exposed to the renderer or public client.

Shared modules:

Supabase bundles this function from `supabase/functions`. `index.ts`,
`smart-ai-grok.workflow.mjs`, and `art-direction.mjs` import `../_art-shared/`.
That directory is a generated copy of `novaflow-web/packages/shared/src`, not a
second implementation, and it is not deployed as its own function. An import of
`novaflow-web/packages/shared` is outside the bundle and the deploy fails.
After editing a shared source, and before `supabase functions deploy`, regenerate
and check the copies:

```bash
node novaflow-web/tools/sync-novaflow-backend-shared.mjs
node novaflow-web/tools/sync-novaflow-backend-shared.mjs --check
```

From `novaflow-web` the same commands are `npm run sync:backend-shared` and
`npm run check:backend-shared`. `--check` exits non-zero when a copy is missing
or differs from its source. `edge-shared-sync.test.mjs` runs that check and
rejects any deployable import that leaves `supabase/functions`.

Client Grok routes:

```text
POST /api/client/grok/prompt-optimize
POST /api/client/grok/image-reverse
```

Pre-login license verification:

```text
POST /api/client/license/verify
Content-Type: application/json

{"licenseKey":"...","machineId":"<64 lowercase hex characters>"}
```

This route intentionally does not require an account session because NovaFlow
must verify the signed local license before opening the account UI. It uses the
Service Role to query an exact `license_key` plus `machine_id` pair and selects
only `status`, `expire_at`, and `permissions`. A successful response contains
only `ok`, `valid`, `status`, `expireAt`, and `permissions`; it never returns the
license key or machine ID. Missing licenses, machine mismatches, banned or
expired licenses, and unsupported statuses all return the same
`{ "ok": true, "valid": false, "reason": "license_rejected" }` result.

The request body is limited to 2 KiB, license keys to 200 characters, and
machine IDs to the NovaFlow 64-character SHA-256 format. Before every database
lookup, the function hashes the license key, machine ID, and Edge-observed
client IP, then calls the durable atomic RPC:

```text
public.check_novaflow_license_verify_rate_limit(
  p_identity_hash text,
  p_window_seconds integer,
  p_max_attempts integer
) returns jsonb
```

The RPC must return an object with a boolean `allowed` field. The Edge route is
fail-closed: a missing RPC, a database error, or a malformed RPC result returns
HTTP 503 without querying `licenses`; an exhausted bucket returns HTTP 429.
There is deliberately no process-memory fallback because Edge instances are
ephemeral and an in-memory counter would be bypassable. Deploy the matching
database migration before deploying this function.

All three Grok routes require `Authorization: Bearer <token>`. The function accepts
both NovaFlow `nfs_` sessions and Supabase access-token JWTs, because current
desktop password login uses the latter. `supabase/config.toml` keeps
`verify_jwt = false` so the function can validate either token itself; do not
remove the in-function authentication check.

Quota behavior matches the desktop Node gateway:

- Prompt optimization and image reverse consume one call only after a valid
  provider result is returned.
- Failed provider calls do not consume quota.
- Prompt/image successes and failures append metadata-only entries to the
  existing `recent_calls` history (status, mode, token counts, duration,
  model, and sanitized error). Existing quota value fields are preserved.

The image route accepts at most 10 MiB of JSON request data; text routes
accept at most 512 KiB. Oversized requests return HTTP 413.
Prompts, images, raw provider output, and workflows are not persisted by this
function.

Deploy:

```bash
supabase functions deploy novaflow-backend \
  --project-ref cjakoblszlmbmotchzva \
  --no-verify-jwt \
  --use-api
```

`--no-verify-jwt` is required because this function validates both NovaFlow
sessions and Supabase access-token JWTs inside the route handler. `--use-api`
keeps deployment independent of a local Docker daemon.

Local contract tests (Node 20+):

```bash
node novaflow-web/tools/sync-novaflow-backend-shared.mjs --check
node --test supabase/functions/novaflow-backend/edge-shared-sync.test.mjs supabase/functions/novaflow-backend/backend-contract.test.mjs
```

Readiness:

```text
GET /ready
```
