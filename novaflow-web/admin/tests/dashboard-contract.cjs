const assert = require("assert");
const fs = require("fs");
process.chdir(require("path").join(__dirname, ".."));

const indexHtml = fs.readFileSync("license-admin-gui/index.html", "utf8");
const renderer = fs.readFileSync("license-admin-gui/renderer.js", "utf8");
const adminData = fs.readFileSync("license-admin-gui/admin-data.js", "utf8");
const onlineAdmin = fs.readFileSync("license-admin-online.js", "utf8");
const artReview = fs.readFileSync("license-admin-gui/art-knowledge-review.js", "utf8");

function functionBody(source, name) {
  const marker = `async function ${name}`;
  const start = source.indexOf(marker);
  assert(start >= 0, `${name} should exist`);
  const next = source.indexOf("\nasync function ", start + marker.length);
  return source.slice(start, next > start ? next : source.length);
}

assert(indexHtml.includes("dashboardRhDomesticBalance"), "dashboard should expose the domestic RunningHub balance");
assert(indexHtml.includes('data-activity-tab="ledger"'), "dashboard activity should have a credit ledger tab");
assert(indexHtml.includes('data-activity-tab="tasks"'), "dashboard activity should have a compute task tab");
assert(!indexHtml.includes("dashboardComfyBudgetBalance"), "dashboard must not expose a ComfyUI manual balance");
assert(!renderer.includes("dashboardComfyBudgetBalance"), "renderer must not fill a ComfyUI manual balance");
assert(renderer.includes("renderDashboardRhCard"), "renderer should render the domestic balance card");
assert(renderer.includes("admin_adjust_feature_credits") === false || adminData.includes("admin_adjust_feature_credits"), "credit adjustments go through the ledger RPC");
assert(adminData.includes("admin_adjust_feature_credits"), "admin-data should call admin_adjust_feature_credits");
assert(adminData.includes("collectPages"), "ledger and task reads should page with collectPages");
assert(indexHtml.includes('id="module-art-knowledge"'), "专业经验 should be a main module panel");
assert(indexHtml.includes('data-module="art-knowledge"'), "专业经验 should be a sidebar module");
assert(!artReview.includes("showModal"), "专业经验 should not open a modal");
assert(!artReview.includes("关闭"), "专业经验 page should not have a close button");
assert(
  renderer.includes("verifyDeletedUserGone"),
  "admin UI should verify deleted users are gone after write calls"
);
assert(!indexHtml.includes('id="module-licenses"'), "online admin must retire machine-code licensing UI");
assert(!indexHtml.includes('data-module="licenses"'), "licensing must not appear in navigation");
assert(!indexHtml.includes('data-module-link="licenses"'), "licensing shortcuts must be removed");
assert(!indexHtml.includes('id="dashboardLicensesCount"'), "dashboard must stop counting licenses");
assert(indexHtml.includes('id="dashboardWorkersCount"'), "dashboard should show compute machines");
assert(!indexHtml.includes('dashboardSupportGrid') && !indexHtml.includes('dashboardSystemRows'), "dashboard must merge status into the top cards");
assert(!indexHtml.includes('class="quickLink"'), "dashboard must remove redundant shortcut entries");
assert(!indexHtml.includes('id="openCreditLedger"'), "user header must remove the redundant ledger entry");
for (const id of ['dashboardUsersMeta', 'dashboardWorkersMeta', 'dashboardRhConnection']) assert(indexHtml.includes(`id="${id}"`), "top metric status must remain available: " + id);
assert(indexHtml.includes('id="backendConnectionDrawer"'), "backend connection settings must remain reachable");
for (const id of ["computeMintDrawer", "computeCodesTableBody", "computeMintCode"]) assert(!indexHtml.includes(`id="${id}"`), "registration-code UI must be retired: " + id);
assert(!renderer.includes('loadAdminDataset("getAdminWorkerCodes")'), "node page must not load retired registration codes");
assert(renderer.includes('workerPendingApproval'), "new unassigned nodes must be clearly pending approval");
assert(indexHtml.includes('id="onlineSupabaseUrl"') && indexHtml.includes('id="onlineSecretKey"'), "backend connection fields must remain available");
for (const operation of ["queryOnlineLicense", "getDefaultPaths", "getStatus", "readPrivateKey", "readPublicKey", "issueLicense", "verifyLicense"]) {
  assert(!renderer.includes(`window.adminAPI.${operation}(`), `online admin must never call legacy ${operation}`);
}
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
