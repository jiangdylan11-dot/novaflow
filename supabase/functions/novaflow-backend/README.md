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
- Grok chat, prompt optimization, image reverse-prompt, and strict nine-shot
  Storyboard forwarding through the backend only.

It intentionally does not store prompts, full workflow JSON, task records, consumption records, or AI logs. The NovaFlow client builds the workflow; the backend only verifies, checks quotas, and forwards approved Provider calls.

Required secrets:

```text
NOVAFLOW_SESSION_SECRET
NOVAFLOW_GROK_BASE_URL
NOVAFLOW_GROK_MODEL
NOVAFLOW_GROK_API_KEY
```

Supabase provides `SUPABASE_URL`, Service Role, and publishable/anon keys to Edge Functions. Service Role and Provider API keys must never be exposed to the renderer or public client.

Client Grok routes:

```text
POST /api/client/grok/prompt-optimize
POST /api/client/grok/image-reverse
POST /api/client/grok/storyboard-unified-nine-shots
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
- Storyboard consumes the number of successful provider responses actually
  used: one initial call and, when quality repair is needed and quota permits,
  one repair call. A successful provider response followed by strict nine-shot
  parsing failure is still recorded because the provider was called.
- Storyboard never silently falls back to the local director.

The image route accepts at most 10 MiB of JSON request data; text and
Storyboard routes accept at most 512 KiB. Oversized requests return HTTP 413.
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
node --test supabase/functions/novaflow-backend/backend-contract.test.mjs
```

The test also enforces byte-for-byte Storyboard workflow equivalence with the
desktop source, except for the required CommonJS-to-ESM export statement. If
the desktop workflow changes, mechanically refresh the cloud copy and rerun
the test before deployment.

Readiness:

```text
GET /ready
```
