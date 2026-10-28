const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function fixture({ blocked = false, mismatch = false } = {}) {
  const filename = path.resolve(__dirname, "../license-admin-gui/admin-data.js");
  const realRequire = createRequire(filename);
  const user = { id: "user-fixture", email: "artist@accounts.novaflow.local" };
  const state = { user: { ...user }, balance: 123, auth: true, events: [] };
  const client = {
    from(table) {
      const query = { operation: "read", select() { return this; }, delete() { this.operation = "delete"; return this; }, eq() { return this; }, like() { return this; }, maybeSingle() { this.single = true; return this; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (table === "users" && this.operation === "delete") {
              state.events.push("public.delete");
              if (blocked) return { data: null, error: { code: "23503", message: "fixture foreign key blocker" } };
              const deleted = state.user;
              state.user = null; state.balance = null;
              return { data: deleted };
            }
            if (table === "users") return { data: state.user };
            if (table === "credits") {
              assert.equal(this.operation, "read", "credits must be removed by the same database delete, never ahead of it");
              return { data: [{ user_id: user.id, balance: state.balance }] };
            }
            if (table === "system_settings") { state.events.push("quota.delete"); return { data: [] }; }
            throw Error("unexpected table: " + table);
          }).then(resolve, reject);
        }
      };
      return query;
    },
    auth: { admin: {
      async getUserById() { return state.auth ? { data: { user: { ...user, email: mismatch ? "other@example.test" : user.email } } } : { error: { message: "User not found" } }; },
      async deleteUser() { state.events.push("auth.delete"); state.auth = false; return {}; }
    } }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, console: { log() {}, warn() {} },
    process: { env: { NOVAFLOW_SUPABASE_URL: "https://fixture.supabase.co", NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY: "fixture-only" }, platform: "linux" },
    require: (name) => name === "@supabase/supabase-js" ? { createClient: () => client } : realRequire(name)
  }, { filename });
  return { state, api: module.exports };
}

test("a blocked public user delete preserves the login and credit balance", async () => {
  const { state, api } = fixture({ blocked: true });
  const result = await api.deleteAdminUser({ userId: "user-fixture", confirmAccount: "artist" });
  assert.equal(result.status, "error");
  assert.equal(state.auth, true);
  assert.equal(state.balance, 123);
  assert(state.user);
  assert.deepEqual(state.events, ["public.delete"]);
});

test("successful deletion uses database cascade before clearing quotas and Auth", async () => {
  const { state, api } = fixture();
  const result = await api.deleteAdminUser({ userId: "user-fixture", confirmAccount: "artist" });
  assert.equal(result.ok, true);
  assert.equal(state.user, null);
  assert.equal(state.balance, null);
  assert.equal(state.auth, false);
  assert.deepEqual(state.events, ["public.delete", "quota.delete", "auth.delete"]);
  assert.equal(result.deletedCredits[0].balance, 123);
});

test("confirmation and Auth identity mismatch never mutate any user data", async () => {
  for (const [options, account] of [[{}, "wrong"], [{ mismatch: true }, "artist"]]) {
    const { state, api } = fixture(options);
    const result = await api.deleteAdminUser({ userId: "user-fixture", confirmAccount: account });
    assert.equal(result.status, "error");
    assert.deepEqual(state.events, []);
    assert.equal(state.balance, 123);
    assert.equal(state.auth, true);
  }
});
