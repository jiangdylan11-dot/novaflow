-- User-owned consent/evidence follows the user. Published methods and review
-- reports remain; only the deleted account's historical actor link is cleared.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  prefix text;
  spec record;
  target regclass;
  old_fk record;
begin
  foreach prefix in array array['art_', 'qa_art_'] loop
    for spec in select * from (values
      ('learning_consents', 'user_id', 'cascade'),
      ('method_evidence', 'user_id', 'cascade'),
      ('knowledge_policy', 'publisher_user_id', 'set null'),
      ('knowledge_reviews', 'prepared_by', 'set null'),
      ('knowledge_releases', 'reviewed_by', 'set null')
    ) as refs(suffix, column_name, delete_action) loop
      target := to_regclass(format('public.%I', prefix || spec.suffix));
      if target is null then continue; end if;
      if spec.delete_action = 'set null' then
        execute format('alter table %s alter column %I drop not null', target, spec.column_name);
      end if;
      for old_fk in
        select c.conname from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.conrelid = target
          and c.confrelid = 'public.users'::regclass
          and cardinality(c.conkey) = 1 and a.attname = spec.column_name
      loop
        execute format('alter table %s drop constraint %I', target, old_fk.conname);
      end loop;
      execute format('alter table %s add constraint %I foreign key (%I) references public.users(id) on delete %s',
        target, prefix || spec.suffix || '_' || spec.column_name || '_fkey', spec.column_name, spec.delete_action);
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
