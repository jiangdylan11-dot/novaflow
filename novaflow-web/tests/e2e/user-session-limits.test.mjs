// Per-account sign-in limit and validity period, over real HTTP against real
// PostgreSQL running the production migration
// (supabase/migrations/20261013010000_user_session_limits.sql).
//
// A login opens a user_sessions row and the token carries its id (sid). More
// live sessions than users.max_sessions pushes out the oldest; a request with
// a pushed-out token gets 401 session_replaced. users.expires_at in the past
// gets 403 account_expired. Tokens minted before the migration (no sid) stay
// valid until their own exp.

import { startLocalControlPlane, mintLocalSessionToken } from '../../control-local/src/server.mjs';
import { seedUser } from '../../control-local/src/db.mjs';
import { base64UrlJson, hmacSha256 } from '../../packages/shared/src/tokens.mjs';
import { check, checkEqual, call, section, finish } from '../helpers.mjs';

const ctx = await startLocalControlPlane({ port: 0 });
const BASE = ctx.url;
const db = ctx.db;

// What novaflow-backend's handleLogin does: open a session, sign a token with its sid.
async function login(user) {
  const res = await db.query('select public.novaflow_open_user_session($1, $2) as id', [user.id, 'test-agent']);
  const sid = res.rows[0].id;
  const now = Math.floor(Date.now() / 1000);
  const encoded = base64UrlJson({ sub: String(user.id), sid, email: user.email, plan: user.plan, status: 'active', iat: now, exp: now + 3600, nonce: sid });
  return { sid, token: 'nfs_' + encoded + '.' + await hmacSha256(encoded, ctx.sessionSecret) };
}

async function me(token) {
  return await call(BASE, 'GET', '/api/web/me', { token });
}

async function liveSessions(userId) {
  const res = await db.query('select id from public.user_sessions where user_id = $1 and revoked_at is null order by created_at', [userId]);
  return res.rows.map((row) => row.id);
}

section('schema defaults');
{
  const user = await seedUser(db, { email: 'limits-defaults@test.local' });
  const row = (await db.query('select max_sessions, expires_at from public.users where id = $1', [user.id])).rows[0];
  checkEqual('existing/new accounts default to 1 seat', row.max_sessions, 1);
  checkEqual('existing/new accounts default to permanent', row.expires_at, null);
}

section('limit 1: a second login pushes the first out');
{
  const user = await seedUser(db, { email: 'limits-one@test.local' });
  const first = await login(user);
  const firstMe = await me(first.token);
  check('first login works', firstMe.status === 200, firstMe.body);

  const second = await login(user);
  const kicked = await me(first.token);
  checkEqual('first token is refused after the second login', kicked.status, 401);
  checkEqual('refusal says session_replaced', kicked.body.code, 'session_replaced');
  checkEqual('refusal message for the login screen', kicked.body.error, '账号已在其他设备登录');
  const secondMe = await me(second.token);
  check('second login works', secondMe.status === 200, secondMe.body);
  checkEqual('only one live session row', (await liveSessions(user.id)).length, 1);
}

section('limit 2: the third login pushes out only the oldest');
{
  const user = await seedUser(db, { email: 'limits-two@test.local' });
  await db.query('update public.users set max_sessions = 2 where id = $1', [user.id]);
  const a = await login(user);
  const b = await login(user);
  const c = await login(user);
  checkEqual('oldest refused', (await me(a.token)).status, 401);
  checkEqual('middle still works', (await me(b.token)).status, 200);
  checkEqual('newest works', (await me(c.token)).status, 200);
  checkEqual('two live session rows', (await liveSessions(user.id)).length, 2);

  // Admin lowers the limit to 1 (admin-data.js trims right away).
  await db.query('update public.users set max_sessions = 1 where id = $1', [user.id]);
  await db.query("select public.novaflow_trim_user_sessions($1, 1, 'limit')", [user.id]);
  checkEqual('after lowering to 1 the older of the two is refused', (await me(b.token)).status, 401);
  checkEqual('the newest keeps working', (await me(c.token)).status, 200);

  // Admin changes the password (admin-data.js trims to 0).
  await db.query("select public.novaflow_trim_user_sessions($1, 0, 'password')", [user.id]);
  checkEqual('password change signs out everywhere', (await me(c.token)).status, 401);
}

section('validity period');
{
  const user = await seedUser(db, { email: 'limits-expiry@test.local' });
  const session = await login(user);
  await db.query("update public.users set expires_at = now() + interval '1 day' where id = $1", [user.id]);
  checkEqual('future expiry: still works', (await me(session.token)).status, 200);
  await db.query("update public.users set expires_at = now() - interval '1 minute' where id = $1", [user.id]);
  const expired = await me(session.token);
  checkEqual('past expiry: refused', expired.status, 403);
  checkEqual('refusal says account_expired', expired.body.code, 'account_expired');
  checkEqual('refusal message for the login screen', expired.body.error, '账号已到期，请联系管理员');
  await db.query('update public.users set expires_at = null where id = $1', [user.id]);
  checkEqual('cleared expiry (permanent): works again', (await me(session.token)).status, 200);
}

section('tokens from before the migration (no sid)');
{
  const user = await seedUser(db, { email: 'limits-legacy@test.local' });
  const legacy = await mintLocalSessionToken(user);
  await login(user);
  checkEqual('a legacy token is not pushed out by a new login', (await me(legacy)).status, 200);
  await db.query("update public.users set expires_at = now() - interval '1 minute' where id = $1", [user.id]);
  checkEqual('but expiry still applies to it', (await me(legacy)).status, 403);
}

section('a sid that belongs to another account');
{
  const owner = await seedUser(db, { email: 'limits-owner@test.local' });
  const other = await seedUser(db, { email: 'limits-other@test.local' });
  const { sid } = await login(owner);
  const now = Math.floor(Date.now() / 1000);
  const encoded = base64UrlJson({ sub: String(other.id), sid, iat: now, exp: now + 3600 });
  const forged = 'nfs_' + encoded + '.' + await hmacSha256(encoded, ctx.sessionSecret);
  checkEqual('refused', (await me(forged)).status, 401);
}

await ctx.server.close();
finish('user-session-limits');
