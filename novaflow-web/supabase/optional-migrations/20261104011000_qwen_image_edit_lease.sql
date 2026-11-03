-- Candidate only. Depends on 20261104010000_qwen_image_edit_ownership_generation.
-- One SQL statement observes the task, owner, session and worker together;
-- callers must still verify on every transfer and before/after inference.
begin;

create or replace function public.novaflow_qwen_image_edit_authorize_v1(
  p_task_id uuid, p_worker_id uuid, p_user_id uuid, p_session_id uuid,
  p_attempt integer, p_op text, p_sha256 text default null, p_bytes integer default null
) returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select coalesce((
    select true
    from public.web_ai_tasks t
    join public.gpu_workers w on w.id=t.assigned_worker_id
    join public.users u on u.id=t.user_id
    join public.user_sessions s on s.id=p_session_id and s.user_id=t.user_id
    where t.id=p_task_id and t.user_id=p_user_id and w.id=p_worker_id
      and t.task_type='prompt_assistant' and t.model_id='qwen3.5-9b-heretic-qwen21-local-image-edit-v1'
      and t.attempt_count=p_attempt and p_attempt between 1 and 20
      and t.expires_at > now()
      and ((p_op in ('wait','upload') and t.status in ('assigned','uploading'))
        or (p_op in ('infer','complete') and t.status='processing')
        or (p_op='download' and t.status='completed' and t.result_expired=false))
      and w.owner_id=t.user_id and w.enabled=true and w.owner_enabled=true
      and lower(coalesce(u.status,'active'))='active' and (u.expires_at is null or u.expires_at>now())
      and s.revoked_at is null
      and t.input_manifest->'parameters'->>'assistant_tool_scope'='qwen21-local-image-edit-v1'
      and t.input_manifest->'parameters'->>'action'='optimize-prompt'
      and t.input_manifest->'parameters'->>'model_id'='qwen3.5-9b-heretic'
      and t.input_manifest->'qwen_foart_plan'->>'scope'='qwen21-local-image-edit-v1'
      and t.input_manifest->'qwen_foart_plan'->>'worker_id'=p_worker_id::text
      and t.input_manifest->'qwen_foart_plan'->>'user_id'=p_user_id::text
      and t.input_manifest->'qwen_foart_plan'->>'session_id'=p_session_id::text
      and t.input_manifest->'qwen_foart_plan'->>'ownership_generation'=w.ownership_generation::text
      and case when t.input_manifest->'qwen_foart_plan'->>'session_expires_epoch' ~ '^[0-9]{1,12}$'
        then (t.input_manifest->'qwen_foart_plan'->>'session_expires_epoch')::bigint > extract(epoch from now())
        else false end
      and t.input_manifest->'qwen_foart_plan'->>'request_id'=t.input_manifest->'parameters'->>'request_id'
      and t.input_manifest->'qwen_foart_plan'->>'request_sha256'=t.input_manifest->'parameters'->>'request_sha256'
      and t.input_manifest->'qwen_foart_plan'->>'request_bytes'=t.input_manifest->'parameters'->>'request_bytes'
      and ((p_sha256 is null and p_bytes is null) or
        (p_op='upload' and p_sha256 ~ '^[0-9a-f]{64}$' and p_bytes between 1 and 16777216
         and p_sha256=t.input_manifest->'qwen_foart_plan'->>'request_sha256'
         and p_bytes::text=t.input_manifest->'qwen_foart_plan'->>'request_bytes'))
  ),false);
$$;

revoke all on function public.novaflow_qwen_image_edit_authorize_v1(uuid,uuid,uuid,uuid,integer,text,text,integer) from public, anon, authenticated;
grant execute on function public.novaflow_qwen_image_edit_authorize_v1(uuid,uuid,uuid,uuid,integer,text,text,integer) to service_role;
commit;
