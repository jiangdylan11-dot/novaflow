import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('art user foreign keys clean personal rows and retain review/release history atomically', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table users(id uuid primary key);
      create table credits(user_id uuid references users(id) on delete cascade, balance integer);
      insert into users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
      insert into credits values('11111111-1111-4111-8111-111111111111',123);`);
    for (const prefix of ['art_', 'qa_art_']) {
      for (const [table, field, required] of [
        ['learning_consents', 'user_id', true], ['method_evidence', 'user_id', true],
        ['knowledge_policy', 'publisher_user_id', false], ['knowledge_reviews', 'prepared_by', true],
        ['knowledge_releases', 'reviewed_by', true]
      ]) {
        await db.exec(`create table ${prefix}${table} (id integer primary key, ${field} uuid ${required ? 'not null' : ''} references users(id), payload text);
          insert into ${prefix}${table} values(1,'11111111-1111-4111-8111-111111111111','keep history'),(2,'22222222-2222-4222-8222-222222222222','other user');`);
      }
    }
    await assert.rejects(db.exec(`delete from users where id='11111111-1111-4111-8111-111111111111'`), /foreign key/);
    const migration = await readFile(new URL('../../supabase/optional-migrations/20261028010000_art_user_deletion.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Safe to apply again.
    // Any unrelated blocker must roll back every cascade, including credits.
    await db.exec(`create table unrelated_blocker(user_id uuid references users(id)); insert into unrelated_blocker values('11111111-1111-4111-8111-111111111111');`);
    await assert.rejects(db.exec(`delete from users where id='11111111-1111-4111-8111-111111111111'`), /foreign key/);
    assert.equal((await db.query('select balance from credits')).rows[0].balance, 123);
    assert.equal((await db.query('select count(*)::int n from qa_art_learning_consents')).rows[0].n, 2);
    await db.exec(`delete from unrelated_blocker; delete from users where id='11111111-1111-4111-8111-111111111111'`);
    assert.equal((await db.query('select count(*)::int n from credits')).rows[0].n, 0);
    for (const prefix of ['art_', 'qa_art_']) {
      for (const table of ['learning_consents', 'method_evidence']) {
        assert.deepEqual((await db.query(`select id from ${prefix}${table} order by id`)).rows, [{ id: 2 }]);
      }
      for (const [table, field] of [['knowledge_policy', 'publisher_user_id'], ['knowledge_reviews', 'prepared_by'], ['knowledge_releases', 'reviewed_by']]) {
        const rows = (await db.query(`select ${field} actor, payload from ${prefix}${table} order by id`)).rows;
        assert.equal(rows.length, 2);
        assert.equal(rows[0].actor, null);
        assert.equal(rows[0].payload, 'keep history');
        assert.equal(rows[1].actor, '22222222-2222-4222-8222-222222222222');
      }
    }
  } finally { await db.close(); }
});
