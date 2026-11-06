-- Run together with rollback_20261106100000.sql: puts the readiness pin back on the original body.
begin;
do $fix$
declare definition text;
begin
  definition := pg_get_functiondef('public.get_xiaotao_decimal_v1_readiness'::regproc);
  if position('c6b152987aedca41a75b1f1ffcc572f0' in definition) = 0 and position('392ae9c16ec9d6332d5fe30d3f5e8bce' in definition) > 0 then
    return;
  end if;
  execute regexp_replace(definition, '(finalize_xiaotao_operation_v3\(uuid,uuid,text,text,text,text,text\)'',\s*'')[0-9a-f]{32}', '\1392ae9c16ec9d6332d5fe30d3f5e8bce');
end
$fix$;
commit;
