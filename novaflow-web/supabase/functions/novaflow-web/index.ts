// NovaFlow Web control plane - Supabase Edge Function.
//
// A NEW function deployed ALONGSIDE the existing novaflow-backend. It does not
// modify, wrap or replace that function, so the stable Desktop product is
// unaffected whether or not this is deployed.
//
// It contains no routing or business logic of its own: the whole API lives in
// packages/shared/src/control-plane.mjs, which the local control plane runs
// too. This file is the Supabase-shaped edge of that one implementation - a
// store adapter plus request plumbing.
//
// Secrets it needs (supabase secrets set ...):
//   NOVAFLOW_SUPABASE_URL              (or SUPABASE_URL)
//   NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY)
//   NOVAFLOW_SESSION_SECRET            the SAME value novaflow-backend uses,
//                                      so a Desktop login works on the Web
//   NOVAFLOW_WEB_CONTROL_SECRET        Web-line only: signs worker tokens and
//                                      derives per-worker grant keys

import { createClient } from 'npm:@supabase/supabase-js@2';
import { createControlPlane } from './control-plane.mjs';
import { resolveControlSecret } from './tokens.mjs';

const FUNCTION_NAME = 'novaflow-web';
const MAX_BODY_BYTES = 256 * 1024;

function env(name: string): string {
  return String(Deno.env.get(name) || '').trim();
}

function supabaseUrl(): string {
  return (env('NOVAFLOW_SUPABASE_URL') || env('SUPABASE_URL')).replace(/\/+$/, '');
}

function serviceRoleKey(): string {
  return env('NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
}

function sessionSecret(): string {
  return env('NOVAFLOW_SESSION_SECRET');
}

// Optional. When it is not set it is derived from NOVAFLOW_SESSION_SECRET,
// so a deployment has one fewer secret to create by hand. See
// resolveControlSecret in tokens.mjs for why that is safe.
function controlSecret(): string {
  return env('NOVAFLOW_WEB_CONTROL_SECRET');
}

let cachedAdmin: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!cachedAdmin) {
    const url = supabaseUrl();
    const key = serviceRoleKey();
    if (!url || !key) throw new Error('Supabase service role is not configured');
    cachedAdmin = createClient(url, key, { auth: { persistSession: false } });
  }
  return cachedAdmin;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unwrapRpc<T>(data: unknown): T | null {
  // A plpgsql function returning a table type comes back as an array of one.
  if (Array.isArray(data)) return (data[0] ?? null) as T | null;
  return (data ?? null) as T | null;
}

/**
 * Store adapter. Every method calls the SAME SQL function the local PgStore
 * calls, through PostgREST rpc() instead of a direct connection, so behaviour
 * cannot diverge between the two deployments.
 */
const supabaseStore = {
  async readArtKnowledge(skillId: string,knownVersion?: string) {
    const {data,error}=await admin().from('art_knowledge_releases').select('version,methods,skill').eq('skill_id',skillId).eq('active',true).maybeSingle();
    if(data && data.version===knownVersion)return {version:data.version,unchanged:true};
    if(error)throw error;return data || {version:'0',methods:[]};
  },
  async getArtLearningConsent(userId: string){const {data,error}=await admin().from('art_learning_consents').select('allowed').eq('user_id',userId).maybeSingle();if(error)throw error;return data?.allowed===true;},
  async isArtPublisher(userId: string){const {data,error}=await admin().from('art_knowledge_policy').select('singleton').eq('publisher_user_id',userId).maybeSingle();if(error)throw error;return Boolean(data);},
  async setArtLearningConsent(userId: string,allow: boolean){const {error}=await admin().from('art_learning_consents').upsert({user_id:userId,allowed:allow,updated_at:new Date().toISOString()});if(error)throw error;},
  async submitArtMethod(userId: string,input: any) {
    const {data,error}=await admin().rpc('novaflow_art_submit_method',{p_user_id:userId,p_scope:input.scope,p_method:input.method,p_evidence:input.evidence});
    if(error)throw error;return data;
  },
  async listArtCandidates() {
    // Provenance remains server-only. The review API exposes abstract methods.
    const {data,error}=await admin().rpc('novaflow_art_review_candidates');
    if(error)throw error;return data || [];
  },
  async saveArtReview(userId: string,report: any){
    const {error:oldError}=await admin().from('art_knowledge_reviews').update({state:'outdated'}).eq('state','pending').eq('report->publishRequest->>skillId',report.publishRequest.skillId).neq('batch_sha256',report.batchSHA256);if(oldError)throw oldError;
    const {error}=await admin().from('art_knowledge_reviews').upsert({batch_sha256:report.batchSHA256,report,prepared_by:userId},{onConflict:'batch_sha256'});if(error)throw error;
  },
  async getArtReview(){const {data,error}=await admin().from('art_knowledge_reviews').select('report').eq('state','pending').order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return data?.report||null;},
  async publishArtKnowledge(userId: string,input: any) {
    const {data,error}=await admin().rpc('novaflow_art_publish_knowledge',{p_admin_id:userId,p_skill_id:input.skillId,p_version:input.version,p_candidate_ids:input.candidateIds,p_validation:input.validation,p_skill:input.skill||null});
    if(error)throw error;return data;
  },
  async rollbackArtKnowledge(userId: string,input: any) {
    const {data,error}=await admin().rpc('novaflow_art_rollback_knowledge',{p_admin_id:userId,p_skill_id:input.skillId,p_version:input.version});
    if(error)throw error;return data;
  },
  async getUserById(userId: string) {
    if (!UUID_RE.test(String(userId))) return null;
    const { data, error } = await admin()
      .from('users')
      .select('id,email,display_name,role,plan,status,expires_at')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getUserSession(sessionId: string) {
    if (!UUID_RE.test(String(sessionId))) return null;
    const { data, error } = await admin()
      .from('user_sessions')
      .select('id,user_id,revoked_at')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getCreditBalance(userId: string) {
    const { data, error } = await admin()
      .from('credits')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return Number(data?.balance || 0);
  },

  async registerWorker({ workerId, ownerId, workerName, secretHash, hardware }: any) {
    const { data, error } = await admin().rpc('novaflow_web_register_worker', {
      p_worker_id: workerId,
      p_owner_id: ownerId,
      p_worker_name: workerName,
      p_secret_hash: secretHash,
      p_hardware: hardware || {}
    });
    if (error) throw error;
    return unwrapRpc(data);
  },

  async getWorkerById(workerId: string) {
    if (!UUID_RE.test(String(workerId || ''))) return null;
    const { data, error } = await admin()
      .from('gpu_workers').select('*').eq('id', workerId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async listWorkers(ownerId: string) {
    const { data, error } = await admin()
      .from('gpu_workers').select('*').eq('owner_id', ownerId).order('created_at');
    if (error) throw error;
    return data || [];
  },

  async heartbeat({ workerId, status, currentTaskId, hardware }: any) {
    const { data, error } = await admin().rpc('novaflow_web_worker_heartbeat', {
      p_worker_id: workerId,
      p_status: status,
      p_current_task_id: currentTaskId || null,
      p_hardware: hardware || {}
    });
    if (error) throw error;
    return unwrapRpc(data);
  },

  async reportModels(workerId: string, models: unknown[]) {
    const { data, error } = await admin().rpc('novaflow_web_report_models', {
      p_worker_id: workerId,
      p_models: models || []
    });
    if (error) throw error;
    return Number(data || 0);
  },

  async countCapableWorkers(modelId: string, minVramMb: number, heartbeatTimeoutSeconds: number, workerId: string | null = null, allowPremium = true) {
    const since = new Date(Date.now() - heartbeatTimeoutSeconds * 1000).toISOString();
    let query = admin()
      .from('worker_models')
      .select('worker_id, gpu_workers!inner(id,status,tier,vram_mb,last_heartbeat)')
      .eq('model_id', modelId)
      .eq('status', 'ready')
      .in('gpu_workers.status', ['idle', 'busy'])
      .gte('gpu_workers.vram_mb', minVramMb)
      .gt('gpu_workers.last_heartbeat', since);
    if (workerId) query = query.eq('worker_id', workerId);
    // A 中级账户 counts 普通 nodes alone.
    if (allowPremium === false) query = query.neq('gpu_workers.tier', 'premium');
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).length;
  },

  async listPoolWorkers() {
    const { data, error } = await admin()
      .from('gpu_workers')
      .select('id,worker_name,status,tier,gpu_name,vram_mb,last_heartbeat')
      .order('worker_name');
    if (error) throw error;
    return data || [];
  },

  async setWorkerTier(workerId: string, tier: string) {
    const { data, error } = await admin()
      .from('gpu_workers')
      .update({ tier: tier === 'premium' ? 'premium' : 'standard', updated_at: new Date().toISOString() })
      .eq('id', workerId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listCapableModelDetails(modelId: string, minVramMb: number, heartbeatTimeoutSeconds: number) {
    const { data, error } = await admin().from('worker_models')
      .select('detail, gpu_workers!inner(status,vram_mb,last_heartbeat)')
      .eq('model_id', modelId).eq('status', 'ready')
      .in('gpu_workers.status', ['idle', 'busy']).gte('gpu_workers.vram_mb', minVramMb)
      .gt('gpu_workers.last_heartbeat', new Date(Date.now() - heartbeatTimeoutSeconds * 1000).toISOString());
    if (error) throw error;
    return data || [];
  },

  async createTask({ userId, taskType, modelId, inputManifest, estimatedCreditCost, expiresAt }: any) {
    const { data, error } = await admin().rpc('novaflow_web_create_task', {
      p_user_id: userId,
      p_task_type: taskType,
      p_model_id: modelId,
      p_input_manifest: inputManifest || {},
      p_estimated_credit_cost: estimatedCreditCost,
      p_expires_at: expiresAt
    });
    if (error) throw error;
    return unwrapRpc(data);
  },

  async getTask(taskId: string) {
    if (!UUID_RE.test(String(taskId || ''))) return null;
    const { data, error } = await admin()
      .from('web_ai_tasks').select('*').eq('id', taskId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async listTasks(userId: string, limit: number) {
    const { data, error } = await admin()
      .from('web_ai_tasks').select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  // A waiting task's place in line (control plane queueView): counts and timestamps only.
  async queueSnapshot({ modelId, createdAt }: any) {
    const { count, error } = await admin()
      .from('web_ai_tasks').select('id', { count: 'exact', head: true })
      .eq('status', 'queued').eq('model_id', modelId).lt('created_at', createdAt);
    if (error) throw error;
    return { queuedAhead: count || 0 };
  },

  async queueStats({ modelId }: any) {
    const [running, recent] = await Promise.all([
      admin().from('web_ai_tasks').select('started_at,assigned_at,created_at')
        .eq('model_id', modelId).in('status', ['assigned', 'uploading', 'processing']).limit(50),
      admin().from('web_ai_tasks').select('started_at,completed_at')
        .eq('model_id', modelId).eq('status', 'completed')
        .not('started_at', 'is', null).not('completed_at', 'is', null)
        .order('completed_at', { ascending: false }).limit(20)
    ]);
    if (running.error) throw running.error;
    if (recent.error) throw recent.error;
    return {
      runningStartedAt: (running.data || []).map((t: any) => t.started_at || t.assigned_at || t.created_at),
      recentRuns: recent.data || []
    };
  },

  async claimTask(workerId: string, heartbeatTimeoutSeconds: number) {
    const { data, error } = await admin().rpc('novaflow_web_claim_task', {
      p_worker_id: workerId,
      p_heartbeat_timeout_seconds: heartbeatTimeoutSeconds
    });
    if (error) throw error;
    const row = unwrapRpc<any>(data);
    return row && row.id ? row : null;
  },

  async listActiveAssignedTasks(workerId: string) {
    const { data, error } = await admin()
      .from('web_ai_tasks').select('id,status')
      .eq('assigned_worker_id', workerId)
      .in('status', ['assigned', 'uploading', 'processing'])
      .limit(10);
    if (error) throw error;
    return data || [];
  },

  async updateTaskStatus({ taskId, workerId, toStatus, progress, note, detail }: any) {
    const { data, error } = await admin().rpc('novaflow_web_update_task_status', {
      p_task_id: taskId,
      p_worker_id: workerId || null,
      p_to_status: toStatus,
      p_progress: progress,
      p_progress_note: note || '',
      p_detail: detail || {}
    });
    if (error) throw error;
    return unwrapRpc(data);
  },

  async markCharged(taskId: string, amount: number) {
    const { data, error } = await admin()
      .from('web_ai_tasks')
      .update({ charged_credit_cost: amount, credit_settled: true, updated_at: new Date().toISOString() })
      .eq('id', taskId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async sweep({ heartbeatTimeoutSeconds, assignTimeoutSeconds, processingTimeoutSeconds, maxAttempts }: any) {
    const { data, error } = await admin().rpc('novaflow_web_sweep', {
      p_heartbeat_timeout_seconds: heartbeatTimeoutSeconds,
      p_assign_timeout_seconds: assignTimeoutSeconds,
      p_processing_timeout_seconds: processingTimeoutSeconds,
      p_max_attempts: maxAttempts
    });
    if (error) throw error;
    return data || {};
  },

  async markResultsExpired(taskIds: string[]) {
    const { data, error } = await admin().rpc('novaflow_web_mark_result_expired', {
      p_task_ids: taskIds || []
    });
    if (error) throw error;
    return Number(data || 0);
  },

  async createRegistrationCode({ ownerId, codeHash, label, maxUses, expiresAt, tier }: any) {
    const { data, error } = await admin()
      .from('web_worker_registration_codes')
      .insert({
        code_hash: codeHash, owner_id: ownerId,
        label: label || '', max_uses: maxUses || 1, expires_at: expiresAt,
        tier: tier === 'premium' ? 'premium' : 'standard'
      })
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async listRegistrationCodes(ownerId: string) {
    const { data, error } = await admin()
      .from('web_worker_registration_codes')
      .select('label, tier, max_uses, used_count, expires_at, created_at')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  },

  async revokeRegistrationCodes(ownerId: string, label: string | null) {
    let query = admin()
      .from('web_worker_registration_codes')
      .update({ expires_at: new Date().toISOString() })
      .eq('owner_id', ownerId)
      .gt('expires_at', new Date().toISOString());
    if (label) query = query.eq('label', label);
    const { data, error } = await query.select('code_hash');
    if (error) throw error;
    return (data || []).length;
  },

  async consumeRegistrationCode(codeHash: string) {
    // PostgREST cannot express "increment if under the cap" atomically, so we
    // read, then update with the used_count we saw as a guard. A racing second
    // use matches zero rows and is rejected.
    const { data: row, error } = await admin()
      .from('web_worker_registration_codes')
      .select('code_hash, owner_id, label, tier, max_uses, used_count, expires_at')
      .eq('code_hash', codeHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    if (!row || row.used_count >= row.max_uses) return null;

    const { data: claimed, error: claimError } = await admin()
      .from('web_worker_registration_codes')
      .update({ used_count: row.used_count + 1 })
      .eq('code_hash', codeHash)
      .eq('used_count', row.used_count)
      .select('owner_id, label, tier')
      .maybeSingle();
    if (claimError) throw claimError;
    return claimed || null;
  },

  // Reuses the PRODUCTION settlement function, unchanged. Idempotent on the
  // usage key, atomic across user credits and the provider budget.
  async settleCredits({ userId, promptId, taskType, modelId, estimatedCreditCost, chargeAmount, pricingSource, pricingDetails }: any) {
    const { data, error } = await admin().rpc('settle_comfy_usage', {
      p_usage_key: 'comfyui:' + promptId,
      p_user_id: userId,
      p_prompt_id: promptId,
      p_provider_key: 'comfyui',
      p_model_key: modelId || '',
      p_task_type: taskType,
      p_estimated_credit_cost: estimatedCreditCost,
      p_charge_amount: chargeAmount,
      p_pricing_source: pricingSource,
      p_pricing_details: pricingDetails || {}
    });
    if (error) throw error;
    return data;
  }
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, x-novaflow-grant',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400'
};

const plane = createControlPlane({
  store: supabaseStore,
  secrets: { sessionSecret: sessionSecret(), controlSecret: await resolveControlSecret({ controlSecret: controlSecret(), sessionSecret: sessionSecret() }) },
  logger: (message: string, meta: unknown) =>
    console.log(JSON.stringify({ fn: FUNCTION_NAME, message, meta }))
});

const FUNCTION_SLUG = 'novaflow-web';

/** /functions/v1/novaflow-web/api/... and /novaflow-web/api/... -> /api/... */
function routePath(pathname: string): string {
  let out = pathname;
  const viaGateway = '/functions/v1/' + FUNCTION_SLUG;
  if (out === viaGateway || out.startsWith(viaGateway + '/')) out = out.slice(viaGateway.length);
  const bare = '/' + FUNCTION_SLUG;
  if (out === bare || out.startsWith(bare + '/')) out = out.slice(bare.length);
  return out || '/';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  // Supabase routes a function by prefixing the path with its slug, so what
  // arrives here is /novaflow-web/api/web/... while every route, every test and
  // the local control plane speak /api/web/... . Strip the prefix rather than
  // teaching the shared router about a deployment detail - otherwise the two
  // deployments disagree about paths, which is exactly the drift the shared
  // implementation exists to prevent.
  const path = routePath(url.pathname);
  let body: unknown = {};
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ ok: false, error: 'request body too large' }), {
        status: 413,
        headers: { 'content-type': 'application/json', ...CORS }
      });
    }
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'request body must be JSON' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...CORS }
      });
    }
  }

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

  const result = await plane.handle({
    method: req.method,
    path,
    headers,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  return new Response(result.body == null ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS }
  });
});
