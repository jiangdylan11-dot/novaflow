const assert = require("assert");

const clientAuth = require("../client-auth-direct");

assert.strictEqual(
  clientAuth.accountToAuthEmail("acc-test"),
  "acc-test@accounts.novaflow.local"
);

assert.strictEqual(
  clientAuth.accountNameFromEmail("acc-test@accounts.novaflow.local"),
  "acc-test"
);

assert.strictEqual(clientAuth.validatePassword("123456"), "");

assert.strictEqual(
  clientAuth.normalizeDirectAuthError({ message: "Invalid login credentials" }, 401),
  "账号或密码错误"
);

assert.strictEqual(clientAuth.CLIENT_AUTH_TRANSPORT, "supabase-direct");

assert.deepStrictEqual(clientAuth.PROVIDER_QUOTA_KEYS, ["grok"]);

console.log("client-auth-direct tests passed");
