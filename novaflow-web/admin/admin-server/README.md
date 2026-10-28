# NovaFlow Admin Server

This is the minimal NovaFlow backend service foundation for admin-side and future client-side integration.

Current production entry:

- Cloud endpoint: `https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend`
- Source: `../../supabase/functions/novaflow-backend/index.ts`
- Runtime: Supabase Edge Functions
- Local Node service: development and fallback only

Current scope:

- Runs as a Supabase Edge Function for the public NovaFlow client flow.
- Runs as a local Node HTTP service.
- Uses `NOVAFLOW_SUPABASE_URL` and `NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY` only on the server side.
- Uses `NOVAFLOW_SUPABASE_PUBLISHABLE_KEY` or `NOVAFLOW_SUPABASE_ANON_KEY` only on the server side for Supabase Auth password login.
- The only operator-writable online provider secret is `NOVAFLOW_RUNNINGHUB_API_KEY`, stored in the admin/server environment. It is not a Supabase Edge secret in this phase.
- Existing call paths may still read `NOVAFLOW_COMFYUI_*` and `NOVAFLOW_GROK_*` when those values are already present. The admin UI no longer writes them.
- Provides admin-issued account/password login through Supabase Auth. Self-registration is disabled.
- Issues signed stateless session tokens.
- Checks user status before AI task requests. ComfyUI generation is not blocked by either balance.
- Checks per-user Provider remaining call count before Provider requests.
- Provides a Gateway Lite check for `/api/ai/tasks`.
- Provides a read-only ComfyUI Provider health check.
- Provides a Grok Provider chat gateway that records only `used_count`.
- Does not call AI generation endpoints or forward real AI work.
- Writes only the minimal idempotent ComfyUI settlement record; it does not store prompt text, full workflow JSON, or generic task records.

## Start

From `particle-editor-desktop`:

```bash
npm run admin:server
```

Environment variables:

```text
NOVAFLOW_ADMIN_SERVER_HOST=127.0.0.1
NOVAFLOW_ADMIN_SERVER_PORT=4761
NOVAFLOW_ADMIN_SERVER_ENV=development
NOVAFLOW_ADMIN_SERVER_CORS_ORIGINS=http://127.0.0.1:4783,http://localhost:4783
NOVAFLOW_ADMIN_SERVER_REQUEST_LOGS=1
NOVAFLOW_ADMIN_SERVER_ENABLE_DEV_LOGIN=0
NOVAFLOW_ADMIN_API_TOKEN=change-this-local-admin-token
NOVAFLOW_CLIENT_LOGIN_CODE=change-this-temporary-login-code
NOVAFLOW_SESSION_SECRET=change-this-long-random-session-secret
NOVAFLOW_SESSION_TTL_SECONDS=86400
NOVAFLOW_SUPABASE_URL=https://...
NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY=...
NOVAFLOW_SUPABASE_PUBLISHABLE_KEY=...
# or:
NOVAFLOW_SUPABASE_ANON_KEY=...
# Only this key is writable from the admin UI. Leave it empty in git.
# Do not put it in Supabase Edge secrets in this phase.
NOVAFLOW_RUNNINGHUB_API_KEY=
```

The default host is `127.0.0.1`. Do not bind to `0.0.0.0` unless there is a real deployment firewall, HTTPS, and token management plan.

NovaFlow main process uses the Supabase Edge Function above by default for login/bootstrap IPC. Override with `NOVAFLOW_CLIENT_API_BASE_URL` or `NOVAFLOW_BACKEND_URL` only for local development or a future backend deployment. Use `http://127.0.0.1:4761` when explicitly testing the local Node service.

If `NOVAFLOW_SUPABASE_PUBLISHABLE_KEY` and `NOVAFLOW_SUPABASE_ANON_KEY` are not set, the server can reuse the existing bundled `license/config.js` publishable key. Service Role still has no bundled fallback and must come from the backend/admin environment.

On Windows, the server reads the process environment first and then falls back to the current user's environment variables. This matches the admin GUI behavior and lets the portable package use values saved under the Windows user profile without writing secrets into the repository.

`NOVAFLOW_CLIENT_LOGIN_CODE` is only used by `POST /api/auth/dev-login` for local acceptance testing. It is not a production password system and is not part of the user self-registration flow.

For deployment, copy `admin-server/deploy.env.example` to the target environment manager and replace every placeholder. Do not commit a filled env file.

## Supabase Edge Function Deployment

The cloud function is deployed as `novaflow-backend`.

Edge Function secrets still read by the unmigrated Grok call path. Do not add `NOVAFLOW_RUNNINGHUB_API_KEY` here in this phase:

```text
NOVAFLOW_SESSION_SECRET
NOVAFLOW_GROK_BASE_URL
NOVAFLOW_GROK_MODEL
NOVAFLOW_GROK_API_KEY
```

Supabase also provides project-scoped secrets to Edge Functions, including `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEYS`, and `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEYS`. The Service Role key must stay only in the backend/admin environment. It must never be shipped to the NovaFlow renderer, client bundle, or public installer.

JWT verification must stay disabled for this Edge Function because NovaFlow uses its own signed session token after Supabase Auth login. The function still verifies each NovaFlow session before returning user, credit, Provider quota, or Gateway data.

Deploy/update command when the Supabase CLI has an access token:

```bash
supabase functions deploy novaflow-backend --project-ref cjakoblszlmbmotchzva
```

Readiness check:

```text
GET https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend/ready
```

The response must report `supabase_url`, `service_role`, `auth_key`, `session_secret`, and `grok_api_key` as configured.

## Routes

Health check:

```text
GET /health
```

Readiness check for deployment:

```text
GET /ready
```

`/health` only confirms the process is running. `/ready` verifies Supabase Service Role, Supabase Auth, session secret, admin token, and production-only guardrails. In `NOVAFLOW_ADMIN_SERVER_ENV=production`, startup fails if required production checks fail.

Admin routes require either:

```text
Authorization: Bearer <NOVAFLOW_ADMIN_API_TOKEN>
```

or:

```text
X-NovaFlow-Admin-Token: <NOVAFLOW_ADMIN_API_TOKEN>
```

Active admin read routes:

```text
GET /api/admin/users
GET /api/admin/credits
GET /api/admin/ai-providers
GET /api/admin/providers/comfyui/status
GET /api/admin/system-settings
GET /api/admin/provider-quotas/:providerKey
```

Compatibility read routes that return disabled empty results:

```text
GET /api/admin/credit-logs
GET /api/admin/ai-models
GET /api/admin/ai-tasks
```

Active admin write routes:

```text
POST /api/admin/users
PATCH /api/admin/users/:id
POST /api/admin/users/:id/password
DELETE /api/admin/users/:id
POST /api/admin/credits/adjust
POST /api/admin/provider-quotas/:providerKey
POST /api/admin/ai-providers
PATCH /api/admin/ai-providers/:providerKey
POST /api/admin/system-settings
PATCH /api/admin/system-settings/:key
```

Model write compatibility routes currently return disabled errors:

```text
POST /api/admin/ai-models
PATCH /api/admin/ai-models/:modelKey
```

Provider writes accept `provider_key`, `name`, `status`, `billing_multiplier`, and `api_key_secret_ref`. They reject raw `apiKey`/`api_key` payloads. API keys must be stored only in a backend secret system, not in Supabase plain text or the renderer.

`POST /api/admin/users` creates a Supabase Auth identity plus matching `public.users` and `credits` rows. The request uses a user-visible `accountName` and `password`; the account name does not need email format. Current account names must be 2-64 lowercase letters, numbers, dots, underscores, or hyphens. The backend maps the account to an internal Supabase Auth email and never exposes Service Role to the client.

`POST /api/admin/users/:id/password` resets the Supabase Auth password for an existing managed user. Password recovery is intentionally admin-managed in the current light backend.

`DELETE /api/admin/users/:id` is a dangerous admin cleanup route. It requires `confirmAccount` in the JSON body, deletes matching Supabase Auth identity when found, deletes `credits`, and deletes `public.users`. It does not delete existing `licenses` records.

`GET /api/admin/providers/comfyui/status` runs a server-side read-only ComfyUI account check. It reads the Base URL and API key from backend/admin environment variables, redacts secrets from errors, and never submits workflow JSON, creates task records, or deducts credits.

`GET /api/admin/provider-quotas/:providerKey` returns each user's allocation, used count, and remaining count. `POST /api/admin/provider-quotas/:providerKey` sets `allocated_count` for one user. The current quota provider key is `grok`. ComfyUI uses credit settlement instead of call quotas.

Client/session routes:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/verify
POST /api/auth/dev-login
GET /api/auth/me
POST /api/auth/logout
GET /api/client/credits
GET /api/client/bootstrap
GET /api/client/ai-config
GET /api/client/credit-logs
GET /api/client/tasks
POST /api/client/credits/check
POST /api/provider/grok/chat
POST /api/ai/tasks
POST /api/ai/tasks/usage
```

`GET /api/client/credit-logs` and `GET /api/client/tasks` return disabled empty results in light mode.

`GET /api/client/bootstrap` is the preferred light-mode startup endpoint after login. It verifies the session and returns the current user, credits, client-safe AI Provider config, the current user's Provider call quotas, and the current Gateway Lite contract in one request. It does not call ComfyUI by default.

Optional Provider status check:

```text
GET /api/client/bootstrap?includeProviderStatus=1
```

Only use that optional flag for acceptance checks or explicit diagnostics, because it performs a read-only ComfyUI Provider request.

`POST /api/auth/register` is disabled and returns `410 Gone`. NovaFlow users are created only from the admin tool so the administrator can assign credits and Provider call quota explicitly.

```json
{
  "ok": false,
  "error": "self registration is disabled; ask the NovaFlow administrator to create an account"
}
```

`POST /api/auth/login` signs in an existing admin-issued account with account name and password, syncs the public profile, and issues a NovaFlow server session token:

```json
{
  "account": "artist01",
  "password": "user-password"
}
```

`POST /api/auth/verify` is kept only as a compatibility route and returns `410 Gone`. The main NovaFlow client no longer uses email verification codes.

Client routes use:

```text
Authorization: Bearer <session token returned by /api/auth/login>
```

Recommended minimal client startup flow:

```text
POST /api/auth/login
GET /api/client/bootstrap
POST /api/ai/tasks
POST /api/ai/tasks/usage  # only after successful ComfyUI history output
```

## Grok Provider Gateway

`POST /api/provider/grok/chat` is the light Grok gateway for future NovaFlow client use:

1. Verify session.
2. Verify active user.
3. Check `provider_quota_grok_<user_id>` remaining count.
4. Call xAI Chat Completions at `POST https://api.x.ai/v1/chat/completions`.
5. On success, increment `used_count` by 1.
6. Return the provider result to the client.

Request shape:

```json
{
  "messages": [
    { "role": "system", "content": "You are a concise assistant." },
    { "role": "user", "content": "Optimize this prompt..." }
  ],
  "temperature": 0.3,
  "max_tokens": 1000
}
```

The model is controlled by `NOVAFLOW_GROK_MODEL`; the client cannot send or receive the API key. The service does not store prompt text, messages, task records, consumption records, or workflow JSON. Failed Grok calls do not increment `used_count`.

`POST /api/auth/dev-login` keeps the old login-code flow for local tests only:

```json
{
  "email": "user@example.com",
  "code": "NOVAFLOW_CLIENT_LOGIN_CODE"
}
```

In production mode, `/api/auth/dev-login` is disabled unless `NOVAFLOW_ADMIN_SERVER_ENABLE_DEV_LOGIN=1`. Keep it disabled for real users.

## Gateway Lite

`POST /api/ai/tasks` performs a formal preflight check. For `provider=comfyui`, it never rejects generation because either balance is low. It returns the workflow-provided charge or `pending_pricing` without inventing a fixed fallback.

`POST /api/ai/tasks/usage` is called only after ComfyUI history contains a successful media output:

1. Derive the durable key `comfyui:<prompt_id>` on the server.
2. Call the service-only `settle_comfy_usage` PostgreSQL RPC.
3. Replays of the same key return the stored result without another deduction.
4. A known charge is atomically deducted from both `credits.balance` and `provider_budget_comfyui.value.balance`.
5. Low balances do not reject settlement; negative balances represent real overdraft usage.
6. Unknown pricing creates `pending_pricing` and deducts zero rather than using a fixed 500/1000 fallback.

For Comfy images, exact settlement is intentionally narrower than estimate display. Only
`taskType=local_workflow_image` together with
`pricingSource=comfy_api_exact_price_v1` may send a positive, fixed six-decimal
`chargeAmount` such as `4.270000`. That string is the authoritative charge; the
separate `estimatedCreditCost` remains informational. Legacy one-decimal Comfy
`Price:` messages and price-badge estimates never settle money. Video and generic
Gateway paths retain their existing integer round-up rules.

Deploy decimal settlement in this order: apply
`20260712000000_decimal_comfy_image_settlement.sql`, confirm the PostgREST schema
reload, deploy the Edge Function, then distribute the desktop/Runtime update. The
new numeric RPC accepts legacy integer callers, while a new desktop client cannot
safely target the old integer RPC.

For non-Comfy Gateway Lite requests, the preflight continues to:

1. Verify session.
2. Verify active user.
3. Calculate `credit_cost` server-side from backend defaults/settings and Provider multiplier.
4. Check `credits.balance`.
5. Return `mode: "gateway_lite_check"`.

It does not:

- Call ComfyUI or any other AI Provider.
- Deduct credits.
- Insert `ai_tasks`.
- Insert `credit_logs`.
- Save `workflow_json`.
- Save `workflow_hash`.

Current request shape:

```json
{
  "provider": "comfyui",
  "model_key": "client-selected-model",
  "task_type": "cloud_image",
  "workflow_json": {
    "1": {
      "class_type": "ExampleNode",
      "inputs": {}
    }
  },
  "workflow_version": "novaflow-v1",
  "prompt": "owned by NovaFlow",
  "negative_prompt": "owned by NovaFlow",
  "images": [],
  "parameters": {
    "width": 1024,
    "height": 1024
  }
}
```

The server accepts `workflow_json` as opaque client payload for the future forwarding contract, but in this light mode it does not parse, mutate, hash, or store it. NovaFlow remains responsible for Workflow, Prompt, images, model selection, and creative parameters.

`recordUsage`, `record_usage`, `commitUsage`, and `commit_usage` remain disabled on `/api/ai/tasks`; completed ComfyUI usage must use the dedicated `/api/ai/tasks/usage` route.

## Deployment Boundary

- Put this service behind HTTPS before connecting NovaFlow client login.
- Set `NOVAFLOW_ADMIN_SERVER_CORS_ORIGINS` to explicit origins only. Do not use `*` for production clients.
- Use `/ready` as the deployment readiness probe and `/health` as the liveness probe.
- Keep `NOVAFLOW_ADMIN_API_TOKEN` and `NOVAFLOW_SESSION_SECRET` long random values.
- Keep `NOVAFLOW_ADMIN_SERVER_ENABLE_DEV_LOGIN=0` in production.
- ComfyUI Provider health checks are read-only and must not submit workflow JSON.

## Security Boundary

- Service Role must stay in this server or a future deployed backend service.
- Publishable/anon key is used only by this server for Supabase Auth password login. NovaFlow client should call this backend, not Supabase directly.
- NovaFlow client must never hold Service Role.
- NovaFlow client must not create users directly. Account creation, password reset, credit allocation, and Provider quota allocation stay in the admin tool.
- AI Provider API keys must not be saved in renderer or client code.
- ComfyUI API keys must stay in backend/admin environment variables or a future secret manager; Supabase should store only `api_key_secret_ref`.
- The dev login code must not be treated as production authentication.
- AI task forwarding must be added only after Provider forwarding and credit deduction rules are implemented server-side.
## RunningHub provider configuration (China)

This phase adds admin-only configuration and read-only account checks, without migrating GPT/Google generation, Grok prompt services or credit settlement. Protected by the existing admin-token authentication:

- `GET /api/admin/providers/runninghub/status`: redacted configuration and last check, no external request.
- `POST /api/admin/providers/runninghub/check`: read-only `POST /uc/openapi/accountStatus` check; no generation/LLM call.
- `POST /api/admin/providers/runninghub/config`: the only persisted secret is `apiKey` (`NOVAFLOW_RUNNINGHUB_API_KEY`). A blank `apiKey` preserves the saved key; `clearApiKey: true` clears it. Address and model fields are read-only and are not written. Requests that name ComfyUI, Grok, Google, or their env vars are rejected. The key is never returned.

See `deploy.env.example` for the RunningHub placeholders. The real API key stays in the admin/server environment and is not a Supabase Edge secret in this phase. Defaults target the domestic `.cn` service. Saving the key does not switch existing Grok, GPT, Google, or cloud ComfyUI call paths.
