// Runs only against the task-owned loopback PostgreSQL prepared by the caller.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),exe=process.env.FOART_TEST_PSQL,port=process.env.FOART_TEST_PG_PORT;
if(!exe||!/^\d+$/.test(port||'')||!process.env.PGPASSWORD){console.log('skipped: needs a task-owned PostgreSQL');process.exit(0);}
const base=['-X','-q','-w','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'];
const query=async sql=>(await exec(exe,[...base,'-c',sql],{env:process.env,timeout:15000})).stdout.trim();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const model='xai/grok-4.7',hash='b'.repeat(64),version='sha256:'+'a'.repeat(64);
const reserve=(n,key)=>`select public.reserve_xiaotao_credits_v2('${id(n)}','${key}','xiaotao-text',1,'${model}',jsonb_build_object('model','${model}','art_stage','structure','art_request_hash','${hash}','art_session_id','s1'),10,80,public.get_xiaotao_pricing_cap_v2()->'config','${version}')`;
const mark=(n,key,session='s1',h=hash)=>`select public.mark_xiaotao_art_dispatched_v2('${id(n)}','${key}','xiaotao-text','${model}','structure','${h}','${session}','${version}',10)`;
const release=(n,key)=>`select public.release_feature_credits('${id(n)}','${key}','xiaotao-text','test','{}')`;
const settle=(n,key,credits=4,session='s1')=>`select public.settle_xiaotao_credits_v2('${id(n)}','${key}','xiaotao-text',1,'${model}',jsonb_build_object('model','${model}','art_stage','structure','art_request_hash','${hash}','art_session_id','${session}','usage',jsonb_build_object('prompt_tokens',10,'completion_tokens',5)),${credits},0.01,'rh_consume_money')`;
const row=async key=>JSON.parse(await query(`select row_to_json(t) from (select status,estimated_credits,settled_credits,art_dispatched_at is not null as sent,expires_at='infinity'::timestamptz as protected from public.credit_ledger where usage_key='${key}') t`));

test('task fixture starts with clean users and explicitly configured pricing',async()=>{
 await query(`insert into public.system_settings(key,value) values('feature_credit_config','{"xiaotao_online":{"message_cap_credits":80}}') on conflict(key) do update set value=excluded.value;
 insert into public.users(id,email) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'artguard'||n||'@example.invalid' from generate_series(1,18) n;
 insert into public.credits(user_id,balance) select id,case when email='artguard3@example.invalid' then 10 else 100 end from public.users where email like 'artguard%@example.invalid';`);
});
test('failure before dispatch uses existing release',async()=>{
 await query(reserve(1,'art-before'));assert.equal(JSON.parse(await query(release(1,'art-before'))).status,'released');
 assert.equal(Number(await query(`select balance from public.credits where user_id='${id(1)}'`)),100);
});
test('dispatched unknown cannot expire, use legacy release, or use legacy settlement',async()=>{
 await query(reserve(2,'art-unknown'));assert.equal(JSON.parse(await query(mark(2,'art-unknown'))).first_dispatch,true);
 assert.equal(JSON.parse(await query(mark(2,'art-unknown'))).first_dispatch,false);
 await assert.rejects(query(mark(2,'art-unknown','wrong')));
 await assert.rejects(query(mark(2,'art-unknown','s1','c'.repeat(64))));
 await assert.rejects(query(mark(1,'art-unknown')));
 await query('select public.release_stale_feature_credits(200)');
 await assert.rejects(query(release(2,'art-unknown')));
 await assert.rejects(query(`select public.settle_feature_credits('${id(2)}','art-unknown','xiaotao-text',1,'${model}','{}',4,0.01,'rh_consume_money')`));
 await assert.rejects(query(`select public.release_grok_quota('${id(2)}','art-unknown','test','{}')`));
 await assert.rejects(query(`select public.settle_grok_quota('${id(2)}','art-unknown',1,true,'[]','{}')`));
 assert.equal(await query("select status from public.grok_quota_reservations where usage_key='art-unknown'"),'reserved');
 await assert.rejects(query("update public.credit_ledger set model='other-model' where usage_key='art-unknown'"));
 await assert.rejects(query("update public.credit_ledger set xiaotao_policy_cap=999 where usage_key='art-unknown'"));
 const x=await row('art-unknown');assert.equal(x.status,'reserved');assert.equal(x.protected,true);assert.equal(x.sent,true);
 assert.equal(Number(await query(`select balance from public.credits where user_id='${id(2)}'`)),90);
 assert.equal(await query(`select expires_at='infinity'::timestamptz from public.grok_quota_reservations where usage_key='art-unknown'`),'t');
});
test('settlement rejects wrong session and preserves true shortfall on replay',async()=>{
 await query(reserve(3,'art-short'));await query(mark(3,'art-short'));
 await assert.rejects(query(settle(3,'art-short',40,'wrong')));
 const first=JSON.parse(await query(settle(3,'art-short',40))),again=JSON.parse(await query(settle(3,'art-short',40)));
 assert.equal(first.balance_short,true);assert.equal(Number(first.uncollected_credits),30);
 assert.equal(again.balance_short,true);assert.equal(Number(again.uncollected_credits),30);assert.equal(again.idempotent,true);
 assert.equal((await row('art-short')).status,'settled');
});
test('explicit provider no-charge rejection releases once',async()=>{
 await query(reserve(4,'art-reject'));await query(mark(4,'art-reject'));
 const fn=`select public.reject_xiaotao_art_dispatched_v2('${id(4)}','art-reject','${hash}','s1')`;
 assert.equal(JSON.parse(await query(fn)).status,'released');assert.equal(JSON.parse(await query(fn)).idempotent,true);
 assert.equal(Number(await query(`select balance from public.credits where user_id='${id(4)}'`)),100);
});
test('two simultaneous dispatch attempts have one winner',async()=>{
 await query(reserve(5,'art-race'));
 assert.equal(JSON.parse(await query(reserve(5,'art-race'))).idempotent,true);
 await assert.rejects(query(reserve(5,'art-race').replace(hash,'c'.repeat(64))));
 await assert.rejects(query(reserve(5,'art-race').replace("'s1'","'s2'")));
 await assert.rejects(query(reserve(1,'art-race')));
 const results=await Promise.all([query(mark(5,'art-race')),query(mark(5,'art-race'))]);
 assert.deepEqual(results.map(x=>JSON.parse(x).first_dispatch).sort(),[false,true]);
});
test('two concurrent same-key reservations retain one hold',async()=>{
 const results=await Promise.all([query(reserve(11,'reserve-race')),query(reserve(11,'reserve-race'))]);
 assert.deepEqual(results.map(x=>JSON.parse(x).status).sort(),['duplicate','reserved']);
 assert.equal(Number(await query(`select balance from public.credits where user_id='${id(11)}'`)),90);
});
test('dispatch transaction holding row cannot be swept by concurrent expiry pass',async()=>{
 await query(reserve(6,'art-sweep-race'));
 await Promise.all([query(`begin; ${mark(6,'art-sweep-race')}; select pg_sleep(0.3); commit`),query('select public.release_stale_feature_credits(200)')]);
 assert.equal((await row('art-sweep-race')).status,'reserved');
});
test('dispatch and legacy release competition cannot release a dispatched hold',async()=>{
 await query(reserve(12,'dispatch-release-race'));
 const [sent,released]=await Promise.allSettled([query(mark(12,'dispatch-release-race')),query(release(12,'dispatch-release-race'))]);
 assert.equal([sent.status,released.status].filter(x=>x==='fulfilled').length,1);
 const r=await row('dispatch-release-race');
 if(sent.status==='fulfilled'){assert.equal(r.status,'reserved');assert.equal(r.sent,true);}
 else {assert.equal(r.status,'released');assert.equal(r.sent,false);}
});
test('legacy settlement and release still work for unmarked reservations',async()=>{
 await query(reserve(7,'legacy-compatible'));assert.equal(JSON.parse(await query(release(7,'legacy-compatible'))).status,'released');
 await query(reserve(8,'legacy-settle'));const out=JSON.parse(await query(`select public.settle_feature_credits('${id(8)}','legacy-settle','xiaotao-text',1,'${model}','{}',4,0.01,'rh_consume_money')`));
 assert.equal(out.status,'settled');
});
test('expired reservation race refuses dispatch and refunds once',async()=>{
 await query(reserve(9,'expired-before-send'));
 await query("update public.credit_ledger set expires_at=clock_timestamp()-interval '1 second' where usage_key='expired-before-send'");
 const outcomes=await Promise.allSettled([query(mark(9,'expired-before-send')),query('select public.release_stale_feature_credits(200)')]);
 assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'fulfilled');
 // The first sweep may legitimately skip the row while mark holds its lock.
 await query('select public.release_stale_feature_credits(200)');
 assert.equal((await row('expired-before-send')).status,'released');
 assert.equal(Number(await query(`select balance from public.credits where user_id='${id(9)}'`)),100);
});
test('late settlement replay retains original direct-charge receipt',async()=>{
 await query(reserve(10,'legacy-stale'));
 await query("update public.credit_ledger set expires_at=clock_timestamp()-interval '1 second' where usage_key='legacy-stale'");
 await query('select public.release_stale_feature_credits(200)');
 const first=JSON.parse(await query(settle(10,'legacy-stale'))),again=JSON.parse(await query(settle(10,'legacy-stale')));
 assert.equal(first.direct_charge,true);assert.equal(again.direct_charge,true);assert.equal(again.idempotent,true);
 assert.equal(first.settled_credits,again.settled_credits);
});
test('untrusted roles cannot invoke dispatch or rejection RPCs',async()=>{
 await assert.rejects(query(`set role anon; ${mark(2,'art-unknown')}`));
 await assert.rejects(query(`set role authenticated; select public.reject_xiaotao_art_dispatched_v2('${id(2)}','art-unknown','${hash}','s1')`));
 assert.equal(await query("select has_function_privilege('service_role','public.reserve_xiaotao_credits_v2_art_base(uuid,text,text,integer,text,jsonb,numeric,numeric,jsonb,text)','EXECUTE')"),'f');
 assert.equal(await query("select has_function_privilege('service_role','public.settle_xiaotao_credits_v2_art_base(uuid,text,text,integer,text,jsonb,numeric,numeric,text)','EXECUTE')"),'f');
});
test('missing quota mirror setting fails before dispatch',async()=>{
 await query(reserve(13,'missing-mirror-setting'));
 await query(`delete from public.system_settings where key='provider_quota_grok_${id(13)}'`);
 await assert.rejects(query(mark(13,'missing-mirror-setting')));
 const x=await row('missing-mirror-setting');assert.equal(x.status,'reserved');assert.equal(x.sent,false);
});
test('service role uses granted RPC without direct access to renamed v2 functions',async()=>{
 // The local bootstrap does not reproduce live Supabase grants. Grant only
 // the tables needed by this isolated mark-RPC test and keep that limit explicit.
 await query('grant select,update on public.credit_ledger,public.system_settings,public.grok_quota_reservations to service_role');
 await query(reserve(14,'service-role-mark'));
 const answer=JSON.parse(await query(`set role service_role; ${mark(14,'service-role-mark')}`));
 assert.equal(answer.first_dispatch,true);
});
test('null stage or hash cannot be dispatched when metadata is missing or JSON null',async()=>{
 const cases=[
  {n:15,key:'null-stage-missing',stage:'null',digest:`'${hash}'`,metadata:`jsonb_build_object('art_request_hash','${hash}','art_session_id','s1')`},
  {n:16,key:'null-hash-missing',stage:"'structure'",digest:'null',metadata:"jsonb_build_object('art_stage','structure','art_session_id','s1')"},
  {n:17,key:'null-stage-json',stage:'null',digest:`'${hash}'`,metadata:`jsonb_build_object('art_stage',null,'art_request_hash','${hash}','art_session_id','s1')`},
  {n:18,key:'null-hash-json',stage:"'structure'",digest:'null',metadata:"jsonb_build_object('art_stage','structure','art_request_hash',null,'art_session_id','s1')"}
 ];
 for(const c of cases){
  await query(`select public.reserve_xiaotao_credits_v2('${id(c.n)}','${c.key}','xiaotao-text',1,'${model}',${c.metadata},10,80,public.get_xiaotao_pricing_cap_v2()->'config','${version}')`);
  await assert.rejects(query(`select public.mark_xiaotao_art_dispatched_v2('${id(c.n)}','${c.key}','xiaotao-text','${model}',${c.stage},${c.digest},'s1','${version}',10)`));
  const current=await row(c.key);assert.equal(current.status,'reserved');assert.equal(current.sent,false);
 }
});
