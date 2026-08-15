-- The live NovaFlow project predated the manual schema's one-row-per-user rule.
-- Settlement needs this uniqueness guarantee for safe credit-row creation.

do $$
begin
  if exists (
    select 1
      from public.credits
     group by user_id
    having count(*) > 1
  ) then
    raise exception 'cannot create credits_user_id_unique_idx: duplicate credit rows exist';
  end if;
end;
$$;

create unique index if not exists credits_user_id_unique_idx
  on public.credits(user_id);
