const assert = require("assert");
const fs = require("fs");

const indexHtml = fs.readFileSync("particle-editor-desktop/license-admin-gui/index.html", "utf8");
const renderer = fs.readFileSync("particle-editor-desktop/license-admin-gui/renderer.js", "utf8");
const adminData = fs.readFileSync("particle-editor-desktop/license-admin-gui/admin-data.js", "utf8");
const onlineAdmin = fs.readFileSync("particle-editor-desktop/license-admin-online.js", "utf8");

function functionBody(source, name) {
  const marker = `async function ${name}`;
  const start = source.indexOf(marker);
  assert(start >= 0, `${name} should exist`);
  const next = source.indexOf("\nasync function ", start + marker.length);
  return source.slice(start, next > start ? next : source.length);
}

assert(
  indexHtml.includes("dashboardComfyBudgetBalance"),
  "dashboard should expose a ComfyUI manual balance metric"
);
assert(
  renderer.includes("providerBudgetBalanceFromSettings") &&
    renderer.includes("dashboardComfyBudgetBalance"),
  "renderer should read provider_budget_comfyui into the dashboard"
);
assert(
  renderer.includes("verifyDeletedUserGone") &&
    renderer.includes("verifyDeletedLicenseGone"),
  "admin UI should verify deleted users/licenses are gone after write calls"
);
assert(
  adminData.includes("verifyAdminUserDeleted") &&
    adminData.includes("verifyAdminUserPasswordReset"),
  "admin-data should verify destructive user operations after Supabase writes"
);
assert(
  onlineAdmin.includes("NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY") &&
    onlineAdmin.includes("readEnvOnlineConfig"),
  "online license admin should prefer current Service Role env before saved legacy config"
);
assert(
  indexHtml.includes("passwordEditDialog") &&
    indexHtml.includes("passwordEditValue") &&
    indexHtml.includes("passwordEditConfirmValue"),
  "admin UI should provide an in-app password edit dialog"
);
assert(
  renderer.includes('resetButton.textContent = "修改密码"') &&
    renderer.includes("openPasswordEditDialog") &&
    renderer.includes("submitPasswordEditDialog"),
  "user table should expose a password edit dialog instead of a reset prompt"
);
assert(
  !functionBody(renderer, "resetUserPassword").includes("prompt("),
  "resetUserPassword should not use the native prompt dialog"
);

console.log("admin dashboard action contract tests passed");
