// Minimal test harness. No framework: these tests boot a real Postgres and a
// real HTTP server, so the useful output is "which assertion failed and what
// did the database actually contain", not a reporter.

let failures = 0;
let passes = 0;
const results = [];

export function check(name, condition, detail) {
  if (condition) {
    passes += 1;
    results.push({ name, ok: true });
    console.log('  PASS  ' + name);
  } else {
    failures += 1;
    results.push({ name, ok: false, detail });
    console.log('  FAIL  ' + name + (detail === undefined ? '' : '  <- ' + JSON.stringify(detail)));
  }
  return condition;
}

export function checkEqual(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return check(name, ok, ok ? undefined : { actual, expected });
}

export async function checkThrows(name, fn, matcher) {
  try {
    await fn();
    return check(name, false, 'expected it to throw, it did not');
  } catch (error) {
    const message = String(error?.message || error);
    const ok = !matcher || (matcher instanceof RegExp ? matcher.test(message) : message.includes(matcher));
    return check(name, ok, ok ? undefined : { message });
  }
}

export function section(title) {
  console.log('\n' + title);
}

export function summary(suiteName) {
  console.log('\n' + suiteName + ': ' + passes + ' passed, ' + failures + ' failed');
  return { passes, failures, results };
}

export function finish(suiteName) {
  const s = summary(suiteName);
  process.exit(s.failures > 0 ? 1 : 0);
}

export function resetCounters() {
  failures = 0;
  passes = 0;
  results.length = 0;
}

/** Small fetch wrapper that returns { status, body } and never throws on 4xx. */
export async function call(baseUrl, method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let parsed = null;
  const text = await res.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

export function uuid() {
  return crypto.randomUUID();
}

export async function waitFor(predicate, { timeoutMs = 15000, intervalMs = 120, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for ' + label);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Simulate a privileged administrator approving a machine in the throwaway test DB.
 * This helper is never shipped and exposes no production approval endpoint. */
export async function approveComputeWorker(db,workerId,{sharing=true}={}) {
  await db.query('update public.gpu_workers set enabled=true,owner_enabled=true,sharing_enabled=$2 where id=$1',
    [workerId,sharing]);
}
