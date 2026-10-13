// Store adapter over a raw Postgres connection (PGlite locally).
//
// Every method is a thin call into the SQL functions created by
// supabase/migrations/20260922010000_novaflow_web_worker_fabric.sql. The
// Supabase adapter calls the same functions through PostgREST rpc(), so the
// two deployments cannot drift in behaviour - only in transport.

export function createPgStore(db) {
  async function one(sql, params) {
    const res = await db.query(sql, params);
    return res.rows[0] || null;
  }
  async function many(sql, params) {
    const res = await db.query(sql, params);
    return res.rows || [];
  }

  return {
    async getUserById(userId) {
      return await one(
        'select id, email, display_name, role, plan, status, expires_at from public.users where id = $1',
        [userId]
      );
    },

    async getUserSession(sessionId) {
      if (!/^[0-9a-f-]{36}$/i.test(String(sessionId))) return null;
      return await one(
        'select id, user_id, revoked_at from public.user_sessions where id = $1',
        [sessionId]
      );
    },

    async getUserByEmail(email) {
      return await one(
        'select id, email, display_name, role, plan, status from public.users where lower(email) = lower($1)',
        [email]
      );
    },

    async getCreditBalance(userId) {
      const row = await one('select balance from public.credits where user_id = $1', [userId]);
      return Number(row?.balance || 0);
    },

    async registerWorker({ workerId, ownerId, workerName, secretHash, hardware }) {
      return await one(
        'select * from public.novaflow_web_register_worker($1, $2, $3, $4, $5::jsonb)',
        [workerId, ownerId, workerName, secretHash, JSON.stringify(hardware || {})]
      );
    },

    async getWorkerById(workerId) {
      if (!workerId) return null;
      // A malformed id must read as "no such worker", not as a 500.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(workerId))) return null;
      return await one('select * from public.gpu_workers where id = $1', [workerId]);
    },

    async listWorkers(ownerId) {
      return await many(
        'select * from public.gpu_workers where owner_id = $1 order by created_at',
        [ownerId]
      );
    },

    async heartbeat({ workerId, status, currentTaskId, hardware }) {
      return await one(
        'select * from public.novaflow_web_worker_heartbeat($1, $2, $3, $4::jsonb)',
        [workerId, status, currentTaskId || null, JSON.stringify(hardware || {})]
      );
    },

    async reportModels(workerId, models) {
      const row = await one(
        'select public.novaflow_web_report_models($1, $2::jsonb) as count',
        [workerId, JSON.stringify(models || [])]
      );
      return Number(row?.count || 0);
    },

    async countCapableWorkers(modelId, minVramMb, heartbeatTimeoutSeconds, workerId = null, allowPremium = true) {
      const row = await one(
        `select count(*)::int as count
           from public.gpu_workers w
          where w.status in ('idle', 'busy')
            and ($4::uuid is null or w.id = $4::uuid)
            and ($5::boolean or w.tier <> 'premium')
            and w.vram_mb >= $2
            and w.last_heartbeat is not null
            and w.last_heartbeat > now() - make_interval(secs => $3)
            and exists (
              select 1 from public.worker_models wm
               where wm.worker_id = w.id and wm.model_id = $1 and wm.status = 'ready'
            )`,
        [modelId, minVramMb, heartbeatTimeoutSeconds, workerId || null, allowPremium !== false]
      );
      return Number(row?.count || 0);
    },

    async listPoolWorkers() {
      return await many(
        'select id, worker_name, status, tier, gpu_name, vram_mb, last_heartbeat from public.gpu_workers order by worker_name'
      );
    },

    async setWorkerTier(workerId, tier) {
      return await one(
        `update public.gpu_workers set tier = $2, updated_at = now() where id = $1 returning *`,
        [workerId, tier === 'premium' ? 'premium' : 'standard']
      );
    },

    async listCapableModelDetails(modelId, minVramMb, heartbeatTimeoutSeconds) {
      return await many(`select wm.detail from public.worker_models wm join public.gpu_workers w on w.id=wm.worker_id
        where wm.model_id=$1 and wm.status='ready' and w.status in ('idle','busy') and w.vram_mb >= $2
        and w.last_heartbeat > now() - make_interval(secs => $3)`, [modelId, minVramMb, heartbeatTimeoutSeconds]);
    },

    async createTask({ userId, taskType, modelId, inputManifest, estimatedCreditCost, expiresAt }) {
      return await one(
        'select * from public.novaflow_web_create_task($1, $2, $3, $4::jsonb, $5, $6)',
        [userId, taskType, modelId, JSON.stringify(inputManifest || {}), estimatedCreditCost, expiresAt]
      );
    },

    async getTask(taskId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(taskId || ''))) return null;
      return await one('select * from public.web_ai_tasks where id = $1', [taskId]);
    },

    async listTasks(userId, limit) {
      return await many(
        'select * from public.web_ai_tasks where user_id = $1 order by created_at desc limit $2',
        [userId, limit]
      );
    },

    async claimTask(workerId, heartbeatTimeoutSeconds) {
      const row = await one(
        'select * from public.novaflow_web_claim_task($1, $2)',
        [workerId, heartbeatTimeoutSeconds]
      );
      // The function returns an all-null record when nothing was claimable.
      return row && row.id ? row : null;
    },

    async listActiveAssignedTasks(workerId) {
      return await many(
        "select id, status from public.web_ai_tasks where assigned_worker_id = $1 and status in ('assigned', 'uploading', 'processing') limit 10",
        [workerId]
      );
    },

    async updateTaskStatus({ taskId, workerId, toStatus, progress, note, detail }) {
      return await one(
        'select * from public.novaflow_web_update_task_status($1, $2, $3, $4, $5, $6::jsonb)',
        [taskId, workerId || null, toStatus, progress, note || '', JSON.stringify(detail || {})]
      );
    },

    async markCharged(taskId, amount) {
      return await one(
        `update public.web_ai_tasks
            set charged_credit_cost = $2, credit_settled = true, updated_at = now()
          where id = $1 returning *`,
        [taskId, amount]
      );
    },

    async sweep({ heartbeatTimeoutSeconds, assignTimeoutSeconds, processingTimeoutSeconds, maxAttempts }) {
      const row = await one(
        'select public.novaflow_web_sweep($1, $2, $3, $4) as result',
        [heartbeatTimeoutSeconds, assignTimeoutSeconds, processingTimeoutSeconds, maxAttempts]
      );
      return row?.result || {};
    },

    async markResultsExpired(taskIds) {
      const row = await one(
        'select public.novaflow_web_mark_result_expired($1::uuid[]) as count',
        [taskIds || []]
      );
      return Number(row?.count || 0);
    },

    async consumeRegistrationCode(codeHash) {
      return await one(
        `update public.web_worker_registration_codes
            set used_count = used_count + 1
          where code_hash = $1
            and expires_at > now()
            and used_count < max_uses
          returning owner_id, label, tier`,
        [codeHash]
      );
    },

    async listRegistrationCodes(ownerId) {
      // The hash is never selected: an owner's own listing must not be a way
      // to recover a code that was shown once.
      return await many(
        `select label, tier, max_uses, used_count, expires_at, created_at
           from public.web_worker_registration_codes
          where owner_id = $1
          order by created_at desc
          limit 50`,
        [ownerId]
      );
    },

    async revokeRegistrationCodes(ownerId, label) {
      // Revoking expires the row rather than deleting it, so a code that was
      // already spent still shows in the owner's history.
      const rows = await many(
        `update public.web_worker_registration_codes
            set expires_at = now()
          where owner_id = $1
            and expires_at > now()
            and ($2::text is null or label = $2)
        returning code_hash`,
        [ownerId, label]
      );
      return rows.length;
    },

    async createRegistrationCode({ ownerId, codeHash, label, maxUses, expiresAt, tier }) {
      return await one(
        `insert into public.web_worker_registration_codes (code_hash, owner_id, label, max_uses, expires_at, tier)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [codeHash, ownerId, label || '', maxUses || 1, expiresAt, tier === 'premium' ? 'premium' : 'standard']
      );
    },

    // Reuses the PRODUCTION settlement function unchanged. Idempotent on
    // usage_key, atomic across user credits and the provider budget.
    async settleCredits({ userId, promptId, taskType, modelId, estimatedCreditCost, chargeAmount, pricingSource, pricingDetails }) {
      const row = await one(
        `select public.settle_comfy_usage($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) as result`,
        [
          'comfyui:' + promptId,
          userId,
          promptId,
          'comfyui',
          modelId || '',
          taskType,
          estimatedCreditCost,
          chargeAmount,
          pricingSource,
          JSON.stringify(pricingDetails || {})
        ]
      );
      return row?.result || null;
    },

    async taskEvents(taskId) {
      return await many(
        'select from_status, to_status, actor, created_at from public.web_task_events where task_id = $1 order by id',
        [taskId]
      );
    }
  };
}
