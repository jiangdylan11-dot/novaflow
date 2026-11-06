-- The decimal ledger readiness check pins a hash of finalize_xiaotao_operation_v3's body. The refund
-- patch rewrote that body, so readiness turned false and every 小桃 online model went unavailable.
-- This repoints the pin at the function now in the database. Run after the refund patch.
begin;
do $fix$
declare current_hash text; definition text;
begin
  select md5(replace(prosrc, chr(13), '')) into strict current_hash
    from pg_catalog.pg_proc
   where oid = 'public.finalize_xiaotao_operation_v3(uuid,uuid,text,text,text,text,text)'::regprocedure;
  definition := pg_get_functiondef('public.get_xiaotao_decimal_v1_readiness'::regproc);
  if position('392ae9c16ec9d6332d5fe30d3f5e8bce' in definition) = 0 then
    raise exception 'readiness pin not found';
  end if;
  execute replace(definition, '392ae9c16ec9d6332d5fe30d3f5e8bce', current_hash);
end
$fix$;
commit;
