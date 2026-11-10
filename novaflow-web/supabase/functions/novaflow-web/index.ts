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
import { createControlPlane, qwenRotationControlOptions } from './control-plane.mjs';
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
  async listXiaotaoMemory(userId: string) {
    const {data,error}=await admin().from('xiaotao_user_memories').select('id,category,slot,memory_text,source,updated_at').eq('user_id',userId).order('updated_at',{ascending:false}).limit(20);
    if(error)throw error;return (data||[]).map((r:any)=>({id:r.id,category:r.category,slot:r.slot,text:r.memory_text,source:r.source,updatedAt:r.updated_at}));
  },
  async saveXiaotaoMemory(userId: string,item: any){const {data,error}=await admin().rpc('xiaotao_memory_save',{p_user_id:userId,p_category:item.category,p_slot:item.slot,p_text:item.text,p_source:item.source});if(error)throw error;return data;},
  async deleteXiaotaoMemory(userId: string,id: string|null){
    let query=admin().from('xiaotao_user_memories').delete({count:'exact'}).eq('user_id',userId);
    if(id)query=query.eq('id',id);
    const {count,error}=await query;if(error)throw error;return count||0;
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

  async enrollPendingWorker({workerId,workerName,secretHash,hardware,peerHash}: any) {
    const {data,error}=await admin().rpc('novaflow_web_enroll_pending_worker', {
      p_worker_id:workerId,p_worker_name:workerName,p_secret_hash:secretHash,p_hardware:hardware||{},p_peer_hash:peerHash
    });
    if(error)throw error;return unwrapRpc(data);
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

  async countCapableWorkers(modelId: string, minVramMb: number, heartbeatTimeoutSeconds: number, workerId: string | null = null, allowPremium = true, userId: string | null = null, allowShared = true) {
    const {data,error}=await admin().rpc('novaflow_web_count_capable_workers', {
      p_model_id:modelId,p_min_vram:minVramMb,p_timeout:heartbeatTimeoutSeconds,p_worker_id:workerId,
      p_allow_premium:allowPremium,p_user_id:userId,p_allow_shared:allowShared
    });
    if(error)throw error;return Number(data||0);
  },

  async listPoolWorkers() {
    const { data, error } = await admin()
      .from('gpu_workers')
      .select('id,owner_id,worker_name,status,tier,gpu_name,vram_mb,last_heartbeat,enabled,owner_enabled,sharing_enabled,sharing_scope,allowed_user_ids')
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

  async listCapableModelDetails(modelId: string, minVramMb: number, heartbeatTimeoutSeconds: number, userId: string | null = null, allowPremium = true, allowShared = true) {
    const {data,error}=await admin().rpc('novaflow_web_capable_model_details', {
      p_model_id:modelId,p_min_vram:minVramMb,p_timeout:heartbeatTimeoutSeconds,p_user_id:userId,
      p_allow_premium:allowPremium,p_allow_shared:allowShared
    });
    if(error)throw error;return data||[];
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

  async createAudioTaskOnce({ userId, taskId, taskType, modelId, inputManifest, estimatedCreditCost, expiresAt }: any) {
    const { data, error } = await admin().rpc('novaflow_web_create_audio_once_v1', {
      p_user_id: userId, p_task_id: taskId, p_task_type: taskType, p_model_id: modelId,
      p_input_manifest: inputManifest || {}, p_estimated_credit_cost: estimatedCreditCost, p_expires_at: expiresAt
    });
    if (error) throw error;
    const result=unwrapRpc(data);
    if(!result?.task || typeof result.idempotent!=='boolean')throw new Error('assistant_audio_status_unknown');
    return {task:result.task,idempotent:result.idempotent};
  },

  async createH3TaskOnce({ userId, taskId, taskType, modelId, inputManifest, estimatedCreditCost, expiresAt }: any) {
    const { data, error } = await admin().rpc('novaflow_web_create_h3_once_v1', {
      p_user_id:userId, p_task_id:taskId, p_task_type:taskType, p_model_id:modelId,
      p_input_manifest:inputManifest || {}, p_estimated_credit_cost:estimatedCreditCost, p_expires_at:expiresAt
    });
    if(error) throw error;
    const result=unwrapRpc(data);
    if(!result?.task || typeof result.idempotent!=='boolean')throw new Error('h3_status_unknown');
    return {task:result.task,idempotent:result.idempotent};
  },

  async countH3CapableWorkers(minVramMb: number, heartbeatTimeoutSeconds: number, targetWorkerId: string | null,
    allowPremiumNodes: boolean, userId: string | null, allowShared: boolean) {
    const {data,error}=await admin().rpc('novaflow_web_count_h3_idempotent_workers_v1', {
      p_min_vram_mb:minVramMb, p_heartbeat_timeout_seconds:heartbeatTimeoutSeconds,
      p_target_worker_id:targetWorkerId, p_allow_premium_nodes:allowPremiumNodes,
      p_user_id:userId, p_allow_shared:allowShared
    });
    if(error) throw error;
    return data;
  },

  async claimH3Task({workerId,ownerId,ownershipGeneration,heartbeatTimeoutSeconds}: any) {
    const {data,error}=await admin().rpc('novaflow_web_h3_claim_task_v1', {
      p_worker_id:workerId,p_expected_owner:ownerId,p_expected_generation:ownershipGeneration,
      p_heartbeat_timeout_seconds:heartbeatTimeoutSeconds
    });
    if(error)throw error;
    const result=unwrapRpc(data);
    return result?.id ? result : null;
  },

  async getTask(taskId: string) {
    if (!UUID_RE.test(String(taskId || ''))) return null;
    const { data, error } = await admin()
      .from('web_ai_tasks').select('*').eq('id', taskId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async getH3RecoverySnapshot(taskId: string, workerId: string) {
    if (!UUID_RE.test(String(taskId || '')) || !UUID_RE.test(String(workerId || ''))) return null;
    // A single joined read gives the task and its current node owner under one
    // database snapshot; worker-owned grant keys are not owner proof.
    const {data,error}=await admin().from('web_ai_tasks')
      .select('id,user_id,task_type,model_id,status,prompt_id,input_manifest,output_manifest,result_expired,assigned_worker_id,attempt_count,credit_settled,recovery_user:users!web_ai_tasks_user_id_fkey(id,plan,status,expires_at),recovery_worker:gpu_workers!web_ai_tasks_assigned_worker_id_fkey(id,owner_id,enabled,owner_enabled,sharing_enabled,sharing_scope,allowed_user_ids,tier,endpoint_url,transport,ownership_generation,capabilities:worker_models!worker_models_worker_id_fkey(model_id,status))')
      .eq('id',taskId).eq('assigned_worker_id',workerId).maybeSingle();
    if(error) throw error;
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

  async stopWorkerTask({taskId,workerId,attempt}: any) {
    const {data,error}=await admin().rpc('novaflow_web_stop_worker_task_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_expected_attempt:attempt
    });
    if(error)throw error;
    return unwrapRpc<any>(data);
  },

  async workerStopReady(signal: AbortSignal) {
    const {data,error}=await admin().rpc('novaflow_web_worker_stop_readiness_v1').abortSignal(signal);
    if(error)throw error;
    const result=unwrapRpc<any>(data);
    return result?.ready===true && result?.protocol==='worker-stop-v1';
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

  async updateH3TaskStatus({ taskId, workerId, ownerId, ownershipGeneration, attempt, expectedStatus, toStatus, progress, note, detail }: any) {
    const {data,error}=await admin().rpc('novaflow_web_h3_update_task_status_v1', {
      p_task_id:taskId, p_worker_id:workerId, p_expected_owner:ownerId, p_expected_generation:ownershipGeneration,
      p_attempt:attempt, p_expected_status:expectedStatus,
      p_to_status:toStatus, p_progress:progress, p_progress_note:note || '', p_detail:detail || {}
    });
    if(error) throw error;
    const result=unwrapRpc(data);
    if(!result?.id)throw new Error('h3_status_unknown');
    return result;
  },

  async completeH3AndSettle({taskId,workerId,ownerId,ownershipGeneration,attempt,inputManifest,promptId,outputManifest,chargeAmount,pricingSource,pricingDetails}: any) {
    const {data,error}=await admin().rpc('novaflow_web_h3_complete_and_settle_v1', {
      p_task_id:taskId,p_worker_id:workerId,p_expected_owner:ownerId,p_expected_generation:ownershipGeneration,
      p_attempt:attempt,p_expected_input_manifest:inputManifest,p_prompt_id:promptId,p_output_manifest:outputManifest,
      p_charge_amount:chargeAmount,p_pricing_source:pricingSource,p_pricing_details:pricingDetails
    });
    if(error) throw error;
    const result=unwrapRpc(data);
    if(!result?.task || typeof result.idempotent!=='boolean' || !result.settlement)throw new Error('h3_settlement_unknown');
    return result;
  },

  async verifyQwenImageEditLease({taskId,workerId,userId,sessionId,attempt,op,sha256=null,bytes=null}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_image_edit_authorize_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_user_id:userId,p_session_id:sessionId,
      p_attempt:attempt,p_op:op,p_sha256:sha256,p_bytes:bytes
    });
    if(error)throw error;
    return data===true;
  },

  async authorizeQwenRotationLease({ taskId, workerId, userId, sessionId, attempt, op, proofExpiresAtMs, uploadSha256=null, uploadBytes=null }: any) {
    const { data, error } = await admin().rpc('novaflow_qwen_rotation_authorize_v1', {
      p_task_id: taskId, p_worker_id: workerId, p_user_id: userId, p_session_id: sessionId,
      p_attempt: attempt, p_op: op, p_proof_expires_at_ms: proofExpiresAtMs,
      p_upload_sha256: uploadSha256, p_upload_bytes: uploadBytes
    });
    if (error) throw error;
    return data === true;
  },

  async createQwenRotationCandidate({ userId, sessionId, sessionExpiresAt, workerId, requestId, sha256, bytes }: any) {
    const { data, error } = await admin().rpc('novaflow_qwen_rotation_create_v1', {
      p_user_id:userId, p_session_id:sessionId, p_session_expires_epoch:sessionExpiresAt,
      p_worker_id:workerId, p_request_id:requestId, p_request_digest:sha256, p_input_bytes:bytes
    });
    if (error) throw error;
    return unwrapRpc(data);
  },

  async listQwenRotationCandidates({ workerId, ownerId, limit }: any) {
    const { data, error } = await admin().from('web_ai_tasks').select('id')
      .eq('status','queued').eq('user_id',ownerId).eq('model_id','qwen3.5-9b-heretic-foart-rotation-candidate-v1')
      .gte('id','fa047a0a-0000-0000-0000-000000000000').lt('id','fa047a0b-0000-0000-0000-000000000000')
      .eq('input_manifest->>target_worker_id',workerId).order('created_at').limit(Math.min(4,Math.max(1,Number(limit)||4)));
    if (error) throw error;
    return data || [];
  },

  async claimQwenRotationCandidate({taskId,workerId,userId,sessionId,sessionExpiresAt,expectedAttempt,heartbeatTimeoutSeconds}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_rotation_claim_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_user_id:userId,p_session_id:sessionId,
      p_session_expires_epoch:sessionExpiresAt,p_expected_attempt:expectedAttempt,p_heartbeat_timeout_seconds:heartbeatTimeoutSeconds
    });
    if(error)throw error;
    const row=unwrapRpc<any>(data);return row && row.id ? row : null;
  },

  async startQwenRotationCandidate({taskId,workerId,userId,sessionId,attempt,proofExpiresAtMs,sha256,bytes}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_rotation_start_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_user_id:userId,p_session_id:sessionId,p_attempt:attempt,
      p_proof_expires_at_ms:proofExpiresAtMs,p_uploaded_sha256:sha256,p_uploaded_bytes:bytes
    });
    if(error)throw error;return data===true;
  },

  async completeQwenRotationCandidate({taskId,workerId,userId,sessionId,attempt,proofExpiresAtMs,bytes}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_rotation_complete_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_user_id:userId,p_session_id:sessionId,p_attempt:attempt,
      p_proof_expires_at_ms:proofExpiresAtMs,p_result_bytes:bytes
    });
    if(error)throw error;return data===true;
  },

  async failQwenRotationCandidate({taskId,workerId,userId,sessionId,attempt,proofExpiresAtMs}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_rotation_fail_v1',{
      p_task_id:taskId,p_worker_id:workerId,p_user_id:userId,p_session_id:sessionId,p_attempt:attempt,
      p_proof_expires_at_ms:proofExpiresAtMs
    });
    if(error)throw error;return data===true;
  },

  async cancelQwenRotationCandidate({taskId,userId,sessionId,sessionExpiresAt,expectedAttempt}: any) {
    const {data,error}=await admin().rpc('novaflow_qwen_rotation_cancel_v1',{
      p_task_id:taskId,p_user_id:userId,p_session_id:sessionId,p_session_expires_epoch:sessionExpiresAt,
      p_expected_attempt:expectedAttempt
    });
    if(error)throw error;return data===true;
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
  // Do not enable until the worker protocol, scheduling filter and RPC are verified together.
  h3CreateOnceEnabled: false,
  h3RecoveryEnabled: false,
  h3DownloadEnabled: false,
  h3AtomicCompletionEnabled: false,
  // Non-secret opt-in; every advertisement and stop checks the DB readiness
  // RPC as well. The RPC and its limited ACL require separate deployment.
  workerExplicitStopEnabled: env('FOART_WORKER_EXPLICIT_STOP_ENABLED')==='true',
  workerStopReadiness: ({signal}: {signal:AbortSignal}) => supabaseStore.workerStopReady(signal),
  // Default closed until the separately reviewed RPC and client flow exist.
  assistantAudioCreateOnceEnabled: env('FOART_ASSISTANT_AUDIO_CREATE_ONCE_ENABLED')==='true',
  // Deployment-only, non-secret opt-ins. Creation can be stopped while the
  // verifier remains available to finish and download already-created work.
  ...qwenRotationControlOptions({verify:env('FOART_QWEN_ROTATION_VERIFY_ENABLED'),create:env('FOART_QWEN_ROTATION_CREATE_ENABLED')}),
  // Release-managed, non-secret gate for the verified ordinary-task 9B preview.
  // Set false in a rollback after draining existing preview tasks.
  qwenPlanEnabled: true,
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

Deno.serve(async (req: Request, info: Deno.ServeHandlerInfo) => {
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
    // Peer comes from the server, never a caller-controlled forwarding header.
    // Hosted gateways can share this quota until their trusted client-IP contract is verified.
    clientAddress: "hostname" in info.remoteAddr ? info.remoteAddr.hostname : "edge-gateway",
    path,
    headers,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  return new Response(result.body == null ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-foart-deployment': env('DENO_DEPLOYMENT_ID') || 'unknown', ...CORS }
  });
});
