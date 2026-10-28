function $(id) {
  return document.getElementById(id);
}

// Every native alert()/confirm() left the page unable to take typing on
// Windows (an input after 新建用户 stayed dead until a restart).
// Ask the main process to hand keyboard focus back as each one closes.
for (const name of ["alert", "confirm"]) {
  const nativeDialog = window[name].bind(window);
  window[name] = (...args) => {
    try {
      return nativeDialog(...args);
    } finally {
      window.adminAPI?.refocusWindow?.();
    }
  };
}

// Fill an optional summary element. The stat strips, count pills and topbar
// crumb are layout sugar: a missing id must never break the data render.
function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = String(text ?? "-");
}

// Side drawers hold the "create" forms (new account, new compute node) so the
// tables keep the full page width. Opening one is plain show/hide; every
// input inside keeps its id, so the existing handlers work unchanged.
function openDrawer(id) {
  const overlay = $(id);
  if (!overlay) return;
  overlay.hidden = false;
  const first = overlay.querySelector("input:not([readonly]), select, textarea");
  setTimeout(() => { try { first?.focus(); } catch (_) {} }, 30);
}

function closeDrawer(overlay) {
  if (overlay) overlay.hidden = true;
}

function closeOpenDrawers() {
  let closed = false;
  document.querySelectorAll(".drawerOverlay").forEach((overlay) => {
    if (!overlay.hidden) {
      overlay.hidden = true;
      closed = true;
    }
  });
  return closed;
}

function toast(msg) {
  const el = $("toast");
  el.textContent = String(msg || "");
  el.classList.add("show");
  clearTimeout((toast)._t);
  (toast)._t = setTimeout(() => el.classList.remove("show"), 1800);
}

function safePathText(p) {
  const s = String(p || "");
  return s.length > 90 ? s.slice(0, 42) + "..." + s.slice(-42) : s;
}

let adminDataStatusLocked = false;
let userManagementState = {
  usersResult: null,
  creditsResult: null,
  users: [],
  credits: [],
  writable: false,
  createWritable: false,
  deleteWritable: false
};
let passwordEditState = {
  userId: "",
  accountLabel: ""
};
// Last signing-key status from refresh(); the dashboard's system panel shows it.
let signingKeyStatusText = "";

const USER_STATUS_OPTIONS = [
  ["active", "active"],
  ["disabled", "disabled"]
];

// users.plan decides where a user's work may run: 普通 (trial) only on the
// machine the local assistant opened, 中级 (standard) also on 普通 pool
// nodes, 高级 (pro) on every pool node. Legacy team is the same as pro.
const USER_PLAN_OPTIONS = [
  ["trial", "普通（仅本机）"],
  ["standard", "中级（普通节点）"],
  ["pro", "高级（所有节点）"]
];

// gpu_workers.tier: 普通 nodes serve 中级 and 高级 accounts, 高级 nodes serve
// 高级 accounts only.
const GPU_WORKER_TIER_OPTIONS = [
  ["standard", "普通节点"],
  ["premium", "高级节点"]
];
const GPU_WORKER_TIER_TEXT = { standard: "普通节点", premium: "高级节点" };

function normalizeGpuWorkerTier(value) {
  return String(value || "").trim().toLowerCase() === "premium" ? "premium" : "standard";
}

function setGlobalStatus(text, tone, options = {}) {
  if (adminDataStatusLocked && !options.force) return;
  const el = $("globalStatus");
  if (!el) return;
  el.textContent = String(text || "");
  el.classList.remove("sourceSupabase", "sourceMock", "sourceError");
  if (tone) el.classList.add(tone);
}

function showTab(tabName) {
  const name = String(tabName || "online");
  document.querySelectorAll(".tab[data-tab]").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-tab") === name);
  });
  document.querySelectorAll(".tabPanel").forEach((el) => {
    el.classList.toggle("active", el.id === `tab-${name}`);
  });
}

function showModule(moduleName) {
  const name = String(moduleName || "dashboard");
  document.querySelectorAll(".moduleNavButton").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-module") === name);
  });
  document.querySelectorAll(".modulePanel").forEach((el) => {
    el.classList.toggle("active", el.id === `module-${name}`);
  });
  const activeNav = document.querySelector(`.moduleNavButton[data-module="${name}"]`);
  if (activeNav) setText("topbarModuleName", activeNav.textContent.trim());
  if (["dashboard", "ai-services"].includes(name)) {
    void loadAdminData();
  }
  if (name === "compute") {
    void loadComputeData();
  }
  if (name === "art-knowledge") {
    void window.NovaFlowArtKnowledgeReview?.open();
  }
}

function setDataBadge(id, result, fallbackText) {
  const el = $(id);
  if (!el) return;
  el.classList.remove("sourceSupabase", "sourceMock", "sourceError", "skeletonPill");
  if (typeof result === "string") {
    if (result === "loading") {
      el.textContent = "";
      el.classList.add("skeletonPill");
    } else {
      el.textContent = result;
    }
    return;
  }
  if (!result) {
    el.textContent = fallbackText || "";
    if (!fallbackText) el.classList.add("skeletonPill");
    return;
  }
  if (result.status === "error") {
    el.textContent = "Supabase Error";
    el.classList.add("sourceError");
    return;
  }
  if (result.source === "supabase") {
    el.textContent = "Supabase";
    el.classList.add("sourceSupabase");
  } else {
    el.textContent = result.source === "disabled" ? "暂无日志" : "未配置";
    el.classList.add("sourceMock");
  }
}

function formatDateTime(value) {
  const s = String(value || "").trim();
  if (!s) return "-";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s.replace("T", " ").replace(/\.\d+Z$/, "Z");
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "-");
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCreditAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "-");
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  }).format(n);
}

function formatProviderBalance(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  }).format(n);
}

function formatProviderBalanceInput(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(6).replace(/(?:\.0+|(?:(\.\d*?)0+))$/, "$1");
}

function shortHash(value) {
  const s = String(value || "").trim();
  return s ? s.slice(0, 12) : "-";
}

function durationText(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return n >= 1000 ? `${Math.round(n / 1000)}s` : `${n}ms`;
}

function statusClass(value) {
  const s = String(value || "").toLowerCase();
  if (["active", "enabled", "success", "normal", "bound", "connected", "configured"].includes(s)) return "active";
  if (["disabled", "banned"].includes(s)) return "disabled";
  if (["failed", "error"].includes(s)) return "error";
  if (["queued", "running", "low", "expired", "pending", "not configured", "not_configured", "unsupported"].includes(s)) return "expired";
  return "";
}

function statusBadge(value, fallback) {
  const badge = document.createElement("span");
  const text = String(value || fallback || "-");
  badge.className = `badge ${statusClass(text)}`;
  badge.textContent = text;
  return badge;
}

function textCell(text, className) {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = String(text ?? "-");
  return td;
}

function nodeCell(node) {
  const td = document.createElement("td");
  td.appendChild(node);
  return td;
}

function replaceRows(tbodyId, rows, colSpan, emptyText) {
  const body = $(tbodyId);
  if (!body) return;
  body.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = colSpan;
    td.className = "emptyTableCell";
    const wrap = document.createElement("div");
    wrap.className = "tableEmpty";
    const title = document.createElement("div");
    title.className = "emptyTitle";
    title.textContent = emptyText || "暂无数据";
    const hint = document.createElement("div");
    hint.className = "emptyText";
    hint.textContent = String(emptyText || "").startsWith("Supabase Error")
      ? "请检查 Supabase 配置或刷新列表"
      : "点击左侧创建或者刷新列表";
    wrap.appendChild(title);
    wrap.appendChild(hint);
    td.appendChild(wrap);
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  rows.forEach((row) => body.appendChild(row));
}

function isErrorResult(result) {
  return result?.status === "error";
}

function isUnconfiguredResult(result) {
  return Boolean(result) && result.configured === false && result.status !== "error" && result.source !== "supabase";
}

const UNCONFIGURED_TEXT = "Supabase 未配置。请设置 NOVAFLOW_SUPABASE_URL 与 Service Role 后刷新。";

function resultErrorText(result) {
  return result?.error || "Supabase Error";
}

function hasSupabaseResult(results) {
  return results.some((item) => item?.source === "supabase" && item?.status !== "error");
}

function hasErrorResult(results) {
  return results.some(isErrorResult);
}

function setAdminDataSourceStatus(results) {
  const list = Array.isArray(results) ? results : [];
  adminDataStatusLocked = true;
  if (hasErrorResult(list)) {
    setGlobalStatus("● Supabase Error", "sourceError", { force: true });
  } else if (hasSupabaseResult(list)) {
    setGlobalStatus("● Supabase Connected", "sourceSupabase", { force: true });
  } else {
    setGlobalStatus("● 未配置", "sourceMock", { force: true });
  }
}

function isToday(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

function renderSettingRows(containerId, entries, emptyText) {
  const container = $(containerId);
  if (!container) return;
  container.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    const title = document.createElement("div");
    title.className = "emptyTitle";
    title.textContent = emptyText || "暂无数据";
    const hint = document.createElement("div");
    hint.className = "emptyText";
    hint.textContent = String(emptyText || "").startsWith("Supabase Error")
      ? "请检查 Supabase 配置或刷新列表"
      : "点击左侧创建或者刷新列表";
    empty.appendChild(title);
    empty.appendChild(hint);
    container.appendChild(empty);
    return;
  }
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "settingRow";
    const label = document.createElement("span");
    label.textContent = String(entry.label || entry.key || "-");
    const value = document.createElement("strong");
    value.textContent = String(entry.value ?? "-");
    row.appendChild(label);
    row.appendChild(value);
    container.appendChild(row);
  });
}

function displayNameByUserId(userMap, userId, fallback) {
  const user = userMap.get(String(userId || ""));
  return fallback || userAccountLabel(user) || user?.display_name || String(userId || "-");
}

function normalizeUserStatusValue(value) {
  const s = String(value || "active").trim().toLowerCase();
  return USER_STATUS_OPTIONS.some(([key]) => key === s) ? s : "active";
}

function normalizeUserPlanValue(value) {
  const s = String(value || "trial").trim().toLowerCase();
  if (s === "team") return "pro";
  return USER_PLAN_OPTIONS.some(([key]) => key === s) ? s : "trial";
}

function userDisplayName(user) {
  return user?.display_name || userAccountLabel(user) || user?.id || "-";
}

function accountNameFromEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  const suffix = "@accounts.novaflow.local";
  if (!email.endsWith(suffix)) return email;
  const local = email.slice(0, -suffix.length);
  const prefix = "acct_";
  if (!local.startsWith(prefix)) return local;
  try {
    const base64 = local.slice(prefix.length).replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const account = new TextDecoder().decode(bytes) || "";
    return /^[a-z0-9._-]{2,64}$/.test(account) ? account : email;
  } catch {
    return email;
  }
}

function userAccountLabel(user) {
  return user?.account || accountNameFromEmail(user?.email) || "";
}

function normalizeAccountInput(value) {
  return String(value || "").trim().toLowerCase();
}

function createTableSelect(options, value, disabled, fieldName) {
  const select = document.createElement("select");
  select.className = "tableSelect";
  select.dataset.field = fieldName;
  select.disabled = Boolean(disabled);
  options.forEach(([key, label]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = label;
    if (fieldName === "plan") option.className = `plan-${key}`;
    select.appendChild(option);
  });
  select.value = value;
  if (fieldName === "plan") {
    const updateTone = () => { select.dataset.plan = normalizeUserPlanValue(select.value); };
    updateTone();
    select.addEventListener("change", updateTone);
  }
  return select;
}

function userMaxSessions(user) {
  const count = Number(user?.max_sessions);
  return Number.isInteger(count) && count >= 1 ? count : 1;
}

// expires_at (ISO) -> the YYYY-MM-DD a date input shows, on this computer's clock.
function localDateInputValue(iso) {
  const time = Date.parse(String(iso || ""));
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isUserExpired(user) {
  const time = Date.parse(String(user?.expires_at || ""));
  return Number.isFinite(time) && time <= Date.now();
}

function userManagementWritable(result) {
  return result?.source === "supabase" && result?.status !== "error";
}

function searchableUserText(user) {
  return [
    user?.id,
    userAccountLabel(user),
    user?.email,
    user?.display_name,
    user?.name
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

async function loadAdminDataset(apiName, badgeId) {
  setDataBadge(badgeId, "loading");
  const api = window.adminAPI?.[apiName];
  if (typeof api !== "function") throw new Error(`${apiName}_missing`);
  const res = await api();
  if (!res?.ok) {
    const result = {
      source: "supabase",
      status: "error",
      configured: true,
      records: [],
      error: `Supabase Error: ${String(res?.error || "unknown")}`,
      durationMs: 0
    };
    setDataBadge(badgeId, result);
    return result;
  }
  setDataBadge(badgeId, res.result);
  return res.result || { source: "mock", records: [] };
}

async function verifyDeletedUserGone(userId) {
  const res = await window.adminAPI.getAdminUsers();
  if (!res?.ok) throw new Error(String(res?.error || "用户删除后刷新用户列表失败"));
  const records = res?.result?.records || [];
  const stillExists = records.some((item) => String(item?.id || "") === String(userId || ""));
  if (stillExists) {
    throw new Error("删除请求已返回成功，但刷新后仍能看到该用户；请检查 Supabase Service Role 权限。");
  }
}

function verifyPasswordResetResult(result) {
  if (!result?.auth?.passwordReset) {
    throw new Error("重置请求未返回 Supabase Auth 密码更新确认。");
  }
}

async function loadAdminProviderStatus(apiName) {
  const api = window.adminAPI?.[apiName];
  if (typeof api !== "function") {
    return {
      source: "provider",
      status: "error",
      configured: false,
      error: `${apiName}_missing`
    };
  }
  const res = await api();
  if (!res?.ok) {
    return {
      source: "provider",
      status: "error",
      configured: true,
      connected: false,
      accountStatus: "unknown",
      balance: { text: "读取失败", supported: false },
      error: String(res?.error || "读取失败")
    };
  }
  return res.result || { source: "provider", status: "mock", configured: false };
}

function systemSettingEntry(record) {
  const value = record?.value && typeof record.value === "object" ? record.value : {};
  return {
    key: record?.key || "",
    label: value.label || record?.key || "",
    value: value.value ?? record?.value ?? ""
  };
}

function findSettingRecord(settingsResult, key) {
  return (settingsResult?.records || []).find((record) => String(record?.key || "") === key) || null;
}

function renderUsers(usersResult, creditsResult) {
  const updateWritable = userManagementWritable(usersResult);
  const createWritable = updateWritable && userManagementWritable(creditsResult);
  userManagementState = {
    usersResult,
    creditsResult,
    users: usersResult?.records || [],
    credits: creditsResult?.records || [],
    writable: updateWritable,
    createWritable,
    deleteWritable: updateWritable
  };
  const createButton = $("createAdminUser");
  const createStatus = $("createUserStatus");
  if (createButton) createButton.disabled = !userManagementState.createWritable;
  if (createStatus) {
    createStatus.textContent = userManagementState.createWritable
      ? "Supabase 可写"
      : updateWritable ? "开户需积分表正常"
      : usersResult?.status === "error" ? "Supabase Error" : "未配置，不能写入";
  }

  if (isErrorResult(usersResult) || isUnconfiguredResult(usersResult)) {
    ["usersStatTotal", "usersStatActive", "usersStatDisabled", "usersStatStandard", "usersStatPro", "usersStatCredits"].forEach((id) => setText(id, "—"));
    replaceRows("usersTableBody", [], 8, isErrorResult(usersResult) ? resultErrorText(usersResult) : UNCONFIGURED_TEXT);
    return;
  }
  const creditMap = new Map((creditsResult?.records || []).map((item) => [String(item.user_id || ""), item]));
  const filter = String($("userSearchInput")?.value || "").trim().toLowerCase();
  const sourceRows = (usersResult.records || []).filter((user) => {
    if (!filter) return true;
    return [
      user.id,
      userAccountLabel(user),
      user.email,
      user.display_name,
      user.status
    ].some((value) => String(value || "").toLowerCase().includes(filter));
  });

  const allUsers = usersResult.records || [];
  const activeCount = allUsers.filter((user) => normalizeUserStatusValue(user.status) === "active").length;
  const proCount = allUsers.filter((user) => normalizeUserPlanValue(user.plan) === "pro").length;
  const standardCount = allUsers.filter((user) => normalizeUserPlanValue(user.plan) === "standard").length;
  const creditTotal = allUsers.reduce((sum, user) => {
    const credit = creditMap.get(String(user.id || ""));
    return sum + (Number(user.current_credits ?? credit?.balance ?? 0) || 0);
  }, 0);
  setText("usersStatTotal", formatNumber(allUsers.length));
  setText("usersStatActive", formatNumber(activeCount));
  setText("usersStatDisabled", formatNumber(allUsers.length - activeCount));
  setText("usersStatPro", formatNumber(proCount));
  setText("usersStatStandard", formatNumber(standardCount));
  setText("usersStatCredits", formatCreditAmount(creditTotal));
  setText("usersCount", filter ? `匹配 ${sourceRows.length} / ${allUsers.length}` : `共 ${allUsers.length} 个`);

  const rows = sourceRows.map((user) => {
    const credit = creditMap.get(String(user.id || ""));
    const tr = document.createElement("tr");
    const accountLabel = userAccountLabel(user);
    tr.appendChild(textCell(accountLabel || userDisplayName(user), "monoCell"));
    tr.appendChild(textCell(formatDateTime(user.created_at)));

    const balance = Number(user.current_credits ?? credit?.balance ?? 0) || 0;
    const creditCell = textCell(formatCreditAmount(balance));
    creditCell.classList.toggle("creditZero", balance === 0);
    const creditActions = document.createElement("div");
    creditActions.className = "userCreditActions";
    const adjustButton = document.createElement("button");
    adjustButton.type = "button";
    adjustButton.className = "btn secondary";
    adjustButton.textContent = "调整";
    adjustButton.disabled = !userManagementState.createWritable;
    adjustButton.addEventListener("click", () => selectMemberForAdjust(user.id));
    creditActions.append(...creditCell.childNodes, adjustButton);
    creditCell.appendChild(creditActions);
    tr.appendChild(creditCell);

    const planSelect = createTableSelect(
      USER_PLAN_OPTIONS,
      normalizeUserPlanValue(user.plan),
      !userManagementState.writable,
      "plan"
    );
    const planCell = document.createElement("td");
    planCell.appendChild(planSelect);
    tr.appendChild(planCell);

    const statusSelect = createTableSelect(
      USER_STATUS_OPTIONS,
      normalizeUserStatusValue(user.status),
      !userManagementState.writable,
      "status"
    );
    tr.appendChild(nodeCell(statusSelect));

    const sessionsInput = document.createElement("input");
    sessionsInput.type = "number";
    sessionsInput.min = "1";
    sessionsInput.max = "99";
    sessionsInput.step = "1";
    sessionsInput.className = "tableInput sessions";
    sessionsInput.dataset.field = "maxSessions";
    sessionsInput.value = String(userMaxSessions(user));
    sessionsInput.title = "同一账号最多同时登录几处，超出时挤掉最早登录的";
    sessionsInput.disabled = !userManagementState.writable;
    tr.appendChild(nodeCell(sessionsInput));

    const expiryInput = document.createElement("input");
    expiryInput.type = "date";
    expiryInput.className = "tableInput expiry";
    expiryInput.dataset.field = "expiresAt";
    expiryInput.value = localDateInputValue(user.expires_at);
    const expired = isUserExpired(user);
    expiryInput.classList.toggle("expired", expired);
    expiryInput.title = expired ? "已到期；留空 = 永久" : "到这一天结束；留空 = 永久";
    expiryInput.disabled = !userManagementState.writable;
    tr.appendChild(nodeCell(expiryInput));

    const actionWrap = document.createElement("div");
    actionWrap.className = "tableActions";
    const ledgerButton = document.createElement("button");
    ledgerButton.type = "button";
    ledgerButton.className = "btn secondary";
    ledgerButton.textContent = "流水";
    ledgerButton.title = "查看该用户的积分流水";
    ledgerButton.addEventListener("click", () => openUserLedger(user));
    actionWrap.appendChild(ledgerButton);
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "btn secondary";
    saveButton.textContent = "保存";
    saveButton.disabled = !userManagementState.writable;
    saveButton.dataset.userId = String(user.id || "");
    saveButton.addEventListener("click", async () => {
      await saveUserRow(saveButton);
    });

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "btn secondary";
    resetButton.textContent = "修改密码";
    resetButton.disabled = !userManagementState.writable;
    resetButton.dataset.userId = String(user.id || "");
    resetButton.addEventListener("click", async () => {
      await resetUserPassword(resetButton);
    });
    actionWrap.appendChild(resetButton);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn danger";
    deleteButton.textContent = "删除";
    deleteButton.disabled = !userManagementState.deleteWritable;
    deleteButton.dataset.userId = String(user.id || "");
    deleteButton.addEventListener("click", async () => {
      await deleteUserRow(deleteButton);
    });
    actionWrap.append(saveButton, deleteButton);

    tr.appendChild(nodeCell(actionWrap));
    return tr;
  });
    replaceRows("usersTableBody", rows, 8, filter ? "没有匹配的用户" : "暂无用户数据");
}

let memberState = { users: [], credits: [], writable: false };
let memberAdjust = { userId: "", mode: "set" };

function syncCreditAdjustment(usersResult, creditsResult) {
  memberState = {
    users: usersResult?.records || [],
    credits: creditsResult?.records || [],
    writable: userManagementWritable(usersResult) && userManagementWritable(creditsResult)
  };
  renderMemberAdjust();
}

function memberAdjustUser() {
  return memberState.users.find((user) => String(user.id || "") === memberAdjust.userId) || null;
}

function memberAdjustBalance() {
  const user = memberAdjustUser();
  if (!user) return null;
  const credit = memberState.credits.find((item) => String(item.user_id || "") === memberAdjust.userId);
  return Number(user.current_credits ?? credit?.balance ?? 0) || 0;
}

function selectMemberForAdjust(userId) {
  memberAdjust.userId = String(userId || "");
  $("memberAdjustReason").value = "";
  $("memberAdjustNote").value = "";
  $("memberAdjustValue").value = "";
  setText("memberAdjustStatus", "");
  openDataDialog("memberAdjustDialog");
  renderMemberAdjust({ prefill: true });
  const input = $("memberAdjustValue");
  if (input && !input.disabled) {
    input.focus();
    input.select();
  }
}

function renderMemberAdjust({ prefill = false } = {}) {
  const target = $("memberAdjustTarget");
  const label = $("memberAdjustLabel");
  const hint = $("memberAdjustHint");
  const input = $("memberAdjustValue");
  const reason = $("memberAdjustReason");
  const note = $("memberAdjustNote");
  const mode = $("memberAdjustMode");
  const submit = $("memberAdjustSubmit");
  if (!target || !label || !hint || !input || !submit) return;
  const kind = mode?.value === "add" || mode?.value === "deduct" ? mode.value : "set";
  memberAdjust.mode = kind;
  label.textContent = kind === "add" ? "充值积分" : kind === "deduct" ? "扣减积分" : "新的积分余额";
  const user = memberAdjustUser();
  const balance = memberAdjustBalance();
  const enabled = Boolean(user) && memberState.writable && balance != null;
  input.disabled = !enabled;
  if (reason) reason.disabled = !enabled;
  if (note) note.disabled = !enabled;
  if (mode) mode.disabled = !enabled;
  submit.disabled = !enabled;
  if (!user || balance == null) {
    target.textContent = "请在用户列表点「调整」选择用户";
    hint.textContent = "";
    input.value = "";
    setText("memberAdjustStatus", "");
    return;
  }
  target.textContent = `用户：${userAccountLabel(user) || userDisplayName(user)}`;
  hint.textContent = `当前积分 ${formatCreditAmount(balance)}`;
  if (prefill && kind === "set") input.value = String(balance);
  setText("memberAdjustStatus", memberState.writable ? "" : "Supabase 未配置，不能写入");
}

async function submitMemberAdjust() {
  const status = $("memberAdjustStatus");
  const input = $("memberAdjustValue");
  const user = memberAdjustUser();
  const balance = memberAdjustBalance();
  if (!user || balance == null) {
    alert("请先在列表里点「调整」选择用户");
    return;
  }
  if (!memberState.writable) {
    alert("当前不是 Supabase 可写数据，不能写入。");
    return;
  }
  const mode = $("memberAdjustMode")?.value === "add" || $("memberAdjustMode")?.value === "deduct" ? $("memberAdjustMode").value : "set";
  const value = Number(input?.value);
  const reason = String($("memberAdjustReason")?.value || "").trim();
  const note = String($("memberAdjustNote")?.value || "").trim();
  if (input?.value === "" || !Number.isInteger(value) || value < 0 || (mode !== "set" && value <= 0)) {
    alert(mode === "set" ? "请输入大于等于 0 的整数" : "请输入大于 0 的整数");
    return;
  }
  if (!reason || reason.length > 200) {
    alert("请填写不超过 200 字的调整原因");
    return;
  }
  const who = userAccountLabel(user) || userDisplayName(user);
  const delta = mode === "set" ? value - balance : mode === "deduct" ? -value : value;
  const after = balance + delta;
  if (after < 0) {
    alert("扣减后积分不能小于 0");
    return;
  }
  if (delta === 0) {
    toast("数值没有变化");
    return;
  }
  const confirmed = confirm(`确定${mode === "add" ? "充值" : mode === "deduct" ? "扣减" : "把余额设为"} ${formatCreditAmount(mode === "set" ? value : value)}？\n${who}：${formatCreditAmount(balance)} → ${formatCreditAmount(after)}\n原因：${reason}`);
  if (!confirmed) return;

  if (status) status.textContent = "写入中...";
  try {
    const res = await window.adminAPI.adjustAdminUserCredits({
      userId: user.id,
      mode,
      amount: value,
      feature: reason,
      reason,
      note
    });
    const result = res?.result || {};
    if (!res?.ok || result.status === "error" || result.ok === false) {
      if (status) status.textContent = "写入失败";
      alert(result.error || res?.error || "写入失败");
      return;
    }
    const afterBalance = result.adjustment?.afterBalance ?? result.adjustment?.after_balance ?? after;
    if (status) status.textContent = `已写入：${formatCreditAmount(balance)} → ${formatCreditAmount(afterBalance)}`;
    toast(`${who} 的积分已更新`);
    await loadAdminData();
    if (status) status.textContent = `已写入：${formatCreditAmount(balance)} → ${formatCreditAmount(afterBalance)}`;
  } catch (err) {
    if (status) status.textContent = "写入失败";
    alert(`写入失败：${String(err?.message || err)}`);
  }
}

function isRunningHubProvider(provider) {
  return String(provider?.provider_key || "").toLowerCase() === "runninghub";
}

function ensureCoreAiProviders(providers) {
  const list = (Array.isArray(providers) ? providers : []).filter(isRunningHubProvider);
  if (!list.length) {
    list.push({ id: "provider-runninghub-ui", name: "RunningHub（国内站）", provider_key: "runninghub", status: "disabled", billing_multiplier: null });
  }
  return list;
}

function renderProviderRuntimeConfigControls(_comfyStatus, _grokStatus, runninghubStatus) {
  const status = $("providerRuntimeConfigStatus");

  const runninghubFields = {
    BaseUrl: runninghubStatus?.baseUrl || "https://www.runninghub.cn",
    LlmBaseUrl: runninghubStatus?.llmBaseUrl || "https://llm.runninghub.ai/v1",
    LlmModel: runninghubStatus?.llmModel || "xai/grok-4.7",
    GptImageEndpoint: runninghubStatus?.gptImageEndpoint || ""
  };
  for (const [field, value] of Object.entries(runninghubFields)) {
    if ($(`runninghubRuntime${field}`)) $(`runninghubRuntime${field}`).value = value;
  }
  if ($("runninghubRuntimeApiKey")) $("runninghubRuntimeApiKey").value = "";
  if ($("runninghubRuntimeClearKey")) $("runninghubRuntimeClearKey").checked = false;
  if ($("runninghubRuntimeConfigHint")) $("runninghubRuntimeConfigHint").textContent = runninghubStatus?.configured ? "当前 Key 已配置" : "当前 Key 未配置";

  if (status) status.textContent = "写入本机后台环境变量";
}

function renderRunningHubProviderHealth(status) {
  const connection = !status?.configured ? "未配置 Key" : status?.connected ? "账户连接正常" : status?.checked ? "检测失败" : "已配置，尚未检测";
  renderSettingRows("runninghubProviderHealthRows", [
    { label: "生成 API 地址", value: status?.baseUrl || "https://www.runninghub.cn" },
    { label: "连接状态", value: connection },
    { label: "国内站余额", value: status?.balance?.text ? `国内站 ${status.balance.text}` : "未检测" },
    { label: "当前运行任务数", value: status?.currentTaskCounts == null ? "-" : String(status.currentTaskCounts) },
    { label: "上次检测时间", value: status?.checkedAt ? formatDateTime(status.checkedAt) : "尚未检测" },
    { label: "在线语言模型", value: status?.llmModel || "xai/grok-4.7" },
    { label: "检测耗时", value: durationText(status?.durationMs) },
    { label: "错误提示", value: status?.error || "-" }
  ], "尚未检测");
}

function runningHubProviderRow(provider, status) {
  const tr = document.createElement("tr");
  tr.appendChild(textCell(provider.name || "RunningHub（国内站）"));
  tr.appendChild(textCell(status?.configured ? "已配置（不回显）" : "未配置"));
  const badge = document.createElement("span");
  badge.className = "badge " + (status?.connected ? "active" : status?.checked ? "error" : "disabled");
  badge.textContent = status?.connected ? "已连接" : status?.checked ? "检测失败" : status?.configured ? "已配置" : "未配置";
  badge.title = status?.error || (status?.checked ? "只读账户检测；模型调用未验证" : "尚未检测账户");
  tr.appendChild(nodeCell(badge));
  tr.appendChild(textCell(status?.connected ? "账户可用" : status?.checked ? "检测失败" : "尚未检测"));
  const usd = status?.balance?.money == null ? null : formatUsdAmount(status.balance.money);
  const currency = String(status?.balance?.currency || "").toUpperCase();
  tr.appendChild(textCell(!status?.checked ? "未检测" : usd && (currency === "" || currency === "USD") ? `${usd} USD` : "未检测"));
  return tr;
}

function renderAiServices(providersResult, _settingsResult, _comfyStatus, _grokStatus, runninghubStatus) {
  renderRunningHubProviderHealth(runninghubStatus);
  if (isErrorResult(providersResult)) {
    replaceRows("aiProvidersTableBody", [], 5, resultErrorText(providersResult));
    return;
  }
  const providerRows = ensureCoreAiProviders(providersResult.records || []).map((provider) => runningHubProviderRow(provider, runninghubStatus));
  replaceRows("aiProvidersTableBody", providerRows, 5, "暂无 Provider 数据");
}

const WEB_TASK_STATUS_TEXT = {
  created: "已创建",
  queued: "排队中",
  assigned: "已分配",
  uploading: "上传中",
  processing: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  expired: "已过期"
};

let dashboardActivityTab = "ledger";
let dashboardSnapshot = null;
let rhRefreshLockedUntil = 0;

function formatUsdAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function activityStamp(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return { text: "-", title: "" };
  const pad = (n) => String(n).padStart(2, "0");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const text = sameYear
    ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
  return { text, title: `${formatDateTime(value)}:${pad(d.getSeconds())}` };
}

function ledgerStatusBadge(status) {
  const badge = document.createElement("span");
  const key = String(status || "");
  if (key === "settled") {
    badge.className = "badge active";
    badge.textContent = "已扣费";
  } else if (key === "released") {
    badge.className = "badge";
    badge.textContent = "已释放";
  } else if (key === "reserved") {
    badge.className = "badge info";
    badge.textContent = "预留";
  } else {
    badge.className = "badge";
    badge.textContent = key || "-";
  }
  return badge;
}

function ledgerCreditNode(row) {
  const span = document.createElement("span");
  const status = String(row?.status || "");
  const details = row?.pricing_details && typeof row.pricing_details === "object" ? row.pricing_details : {};
  const delta = Number(details.delta);
  if (status === "released") {
    span.className = "creditMuted";
    span.textContent = "0";
    return span;
  }
  if (status === "reserved") {
    span.className = "creditMuted";
    span.textContent = formatCreditAmount(row.estimated_credits ?? 0);
    return span;
  }
  const amount = Number(row.settled_credits ?? 0) || 0;
  const signed = Number.isFinite(delta) && details.mode ? delta : -Math.abs(amount);
  span.className = signed > 0 ? "creditPlus" : signed < 0 ? "creditMinus" : "creditMuted";
  span.textContent = signed > 0 ? `+${formatCreditAmount(signed)}` : signed < 0 ? `−${formatCreditAmount(Math.abs(signed))}` : "0";
  return span;
}

function setCountPill(id, count) {
  const el = $(id);
  if (!el) return;
  el.textContent = count > 0 ? String(count) : "";
}

function renderDashboardRecentActivity() {
  const container = $("dashboardRecentActivity");
  if (!container) return;
  container.replaceChildren();
  const data = dashboardSnapshot || {};
  const empty = (title, hint) => {
    const wrap = document.createElement("div");
    wrap.className = "emptyState";
    wrap.appendChild(Object.assign(document.createElement("div"), { className: "emptyTitle", textContent: title }));
    wrap.appendChild(Object.assign(document.createElement("div"), { className: "emptyText", textContent: hint }));
    container.appendChild(wrap);
  };
  document.querySelectorAll("[data-activity-tab]").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-activity-tab") === dashboardActivityTab);
  });

  if (dashboardActivityTab === "tasks") {
    const usageResult = data.usage;
    if (isUnconfiguredResult(usageResult)) {
      empty("Supabase 未配置", UNCONFIGURED_TEXT);
      setCountPill("dashboardTaskCount", 0);
      return;
    }
    if (isErrorResult(usageResult)) {
      empty("算力任务读取失败", "请检查 Supabase 配置或刷新列表");
      setCountPill("dashboardTaskCount", 0);
      return;
    }
    const userById = new Map((data.users?.records || []).map((user) => [String(user.id || ""), user]));
    const workerById = new Map((data.workers?.records || []).map((worker) => [String(worker.id || ""), worker]));
    const tasks = (Array.isArray(usageResult?.records) ? usageResult.records : []).slice(0, 20);
    setCountPill("dashboardTaskCount", tasks.length);
    if (!tasks.length) {
      empty("暂无算力任务", "有用户在算力节点上生成后会显示在这里");
      return;
    }
    const table = document.createElement("table");
    table.className = "dataTable activityTable";
    table.innerHTML = "<thead><tr><th>时间</th><th>用户</th><th>节点</th><th>状态</th></tr></thead>";
    const body = document.createElement("tbody");
    tasks.forEach((task) => {
      const user = userById.get(String(task.user_id || ""));
      const worker = workerById.get(String(task.assigned_worker_id || ""));
      const stamp = activityStamp(task.completed_at || task.created_at || "");
      const tr = document.createElement("tr");
      const time = textCell(stamp.text);
      time.title = stamp.title;
      tr.appendChild(time);
      tr.appendChild(textCell(userAccountLabel(user) || user?.display_name || "-"));
      tr.appendChild(textCell(worker?.worker_name || "尚未分配"));
      const badge = document.createElement("span");
      const status = String(task.status || "");
      badge.className = "badge " + (status === "completed" ? "active" : status === "failed" ? "error" : "info");
      badge.textContent = WEB_TASK_STATUS_TEXT[status] || status || "-";
      tr.appendChild(nodeCell(badge));
      body.appendChild(tr);
    });
    table.appendChild(body);
    container.appendChild(table);
    return;
  }

  const ledger = data.ledger;
  if (isUnconfiguredResult(ledger)) {
    empty("Supabase 未配置", UNCONFIGURED_TEXT);
    setCountPill("dashboardLedgerCount", 0);
    return;
  }
  if (ledger?.error) {
    empty("积分流水读取失败", "请刷新数据或打开完整流水");
    setCountPill("dashboardLedgerCount", 0);
    return;
  }
  const rows = (Array.isArray(ledger?.records) ? ledger.records : []).filter((row) => row.status === "settled").slice(0, 20);
  setCountPill("dashboardLedgerCount", rows.length);
  if (!rows.length) {
    empty("暂无已结算积分记录", "实际发生积分变动后显示在这里");
    return;
  }
  const table = document.createElement("table");
  table.className = "dataTable activityTable";
  table.innerHTML = "<thead><tr><th>时间</th><th>用户</th><th>功能</th><th>模型</th><th>状态</th><th class=\"num\">积分</th><th class=\"num\">估算 RH 成本</th></tr></thead>";
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const stamp = activityStamp(row.created_at);
    const tr = document.createElement("tr");
    const time = textCell(stamp.text);
    time.title = stamp.title;
    tr.appendChild(time);
    tr.appendChild(textCell(row.user_email_or_account || "-"));
    tr.appendChild(textCell(row.feature || "-"));
    tr.appendChild(textCell(row.model || "-"));
    tr.appendChild(nodeCell(ledgerStatusBadge(row.status)));
    const credit = document.createElement("td");
    credit.className = "num";
    credit.appendChild(ledgerCreditNode(row));
    tr.appendChild(credit);
    const cost = textCell(row.rh_cost_usd == null || row.rh_cost_usd === "" ? "-" : formatUsdAmount(row.rh_cost_usd) || "-");
    cost.classList.add("num");
    tr.appendChild(cost);
    body.appendChild(tr);
  });
  table.appendChild(body);
  container.appendChild(table);
}

function renderDashboardRhCard(view) {
  const card = $("dashboardRhCard");
  const value = $("dashboardRhDomesticBalance");
  const meta = $("dashboardRhDomesticMeta");
  const notice = $("dashboardRhNotice");
  const refresh = $("dashboardRhRefresh");
  if (!card || !value || !meta) return;
  card.classList.remove("rh-warning", "rh-danger", "rh-error", "rh-stale");
  if (refresh) refresh.disabled = view?.state === "loading" || Date.now() < rhRefreshLockedUntil;
  if (view?.state === "loading") {
    value.replaceChildren(Object.assign(document.createElement("span"), { className: "skeletonLine" }));
    value.removeAttribute("title");
    meta.textContent = "读取国内站余额…";
    if (notice) notice.hidden = true;
    return;
  }
  if (view?.state === "error") {
    card.classList.add("rh-error");
    value.textContent = "—";
    value.title = "";
    meta.textContent = String(view.message || "余额读取失败").slice(0, 40);
    if (notice) notice.hidden = true;
    return;
  }
  const balance = view?.domesticBalance || {};
  const low = view?.lowBalance || {};
  const currency = String(balance.currency || "").toUpperCase();
  const usd = currency === "" || currency === "USD" ? formatUsdAmount(balance.remainMoney) : null;
  if (!usd) {
    card.classList.add("rh-error");
    value.textContent = "—";
    meta.textContent = balance.remainMoney == null ? "尚未检测" : "余额读取失败";
    if (notice) notice.hidden = true;
    return;
  }
  const money = Number(balance.remainMoney);
  const tone = low.stale ? "stale" : money < 2 ? "danger" : money < 5 ? "warning" : "ok";
  if (tone === "danger") card.classList.add("rh-danger");
  if (tone === "warning") card.classList.add("rh-warning");
  if (tone === "stale") card.classList.add("rh-stale");
  value.replaceChildren(document.createTextNode(usd), Object.assign(document.createElement("span"), { className: "unit", textContent: "USD" }));
  value.title = usd + " USD";
  const checked = balance.checkedAt ? `更新于 ${formatDateTime(balance.checkedAt)}` : "尚未检测";
  const bits = ["国内站", checked];
  if (tone === "danger") bits.push("低于阈值");
  if (tone === "warning") bits.push("接近阈值");
  if (tone === "stale") bits.push("缓存已过期");
  meta.textContent = bits.join(" · ");
  if (!notice) return;
  notice.classList.remove("danger", "warning");
  if (tone === "danger") {
    notice.hidden = false;
    notice.classList.add("danger");
    notice.replaceChildren(
      Object.assign(document.createElement("div"), { className: "tipTitle", textContent: "国内站余额低于阈值" }),
      Object.assign(document.createElement("div"), { textContent: `当前 ${usd} USD，低于 2 USD。新的云任务会拒绝，不扣积分，本地任务不受影响。` })
    );
  } else if (tone === "warning") {
    notice.hidden = false;
    notice.classList.add("warning");
    notice.replaceChildren(
      Object.assign(document.createElement("div"), { className: "tipTitle", textContent: "国内站余额接近阈值" }),
      Object.assign(document.createElement("div"), { textContent: `当前 ${usd} USD，低于 5 USD 警告线，暂不阻断新的云任务。` })
    );
  } else if (tone === "stale" && low.blocked) {
    notice.hidden = false;
    notice.classList.add("warning");
    notice.replaceChildren(
      Object.assign(document.createElement("div"), { className: "tipTitle", textContent: "国内站余额缓存已过期" }),
      Object.assign(document.createElement("div"), { textContent: "缓存已过期，已阻断新云任务。不扣积分，本地任务不受影响。" })
    );
  } else if (tone === "stale") {
    notice.hidden = false;
    notice.classList.add("warning");
    notice.replaceChildren(
      Object.assign(document.createElement("div"), { className: "tipTitle", textContent: "国内站余额缓存已过期" }),
      Object.assign(document.createElement("div"), { textContent: "缓存已过期。当前策略是放行并告警，不阻断新的云任务。" })
    );
  } else {
    notice.hidden = true;
    notice.replaceChildren();
  }
}

function renderDashboard(data) {
  dashboardSnapshot = data;
  const results = [data.users, data.credits, data.providers, data.settings].filter(Boolean);
  const users = data.users?.records || [];
  const credits = data.credits?.records || [];
  const totalCredits = credits.reduce((sum, item) => sum + (Number(item.balance || 0) || 0), 0);
  const sourceLabel = hasErrorResult(results) ? "Supabase Error" : hasSupabaseResult(results) ? "Supabase" : "未配置";
  const usersUnconfigured = isUnconfiguredResult(data.users);
  const creditsUnconfigured = isUnconfiguredResult(data.credits);
  const usersEl = $("dashboardUsersCount");
  if (usersEl) usersEl.textContent = usersUnconfigured ? "—" : formatNumber(users.length);
  const creditEl = $("dashboardCreditCost");
  if (creditEl) creditEl.textContent = creditsUnconfigured ? "—" : formatCreditAmount(totalCredits);
  setDataBadge("dashboardDataBadge", hasErrorResult(results) ? { status: "error" } : hasSupabaseResult(results) ? { source: "supabase" } : { source: "mock" });
  renderDashboardRecentActivity();
  const activeUsers = users.filter((user) => normalizeUserStatusValue(user.status) === "active").length;
  const rh = data.runninghubStatus || {};
  const connection = !rh.configured ? "未配置 Key" : rh.connected ? "账户连接正常" : rh.checked ? "检测失败" : "已配置，尚未检测";
  renderSettingRows("dashboardSystemRows", [
    { label: "数据源", value: sourceLabel },
    { label: "RunningHub 连接", value: connection },
    { label: "在线语言模型", value: rh.configured ? `已配置 · ${rh.llmModel || "xai/grok-4.7"}` : "未配置" },
    { label: "签名密钥", value: signingKeyStatusText || "读取中..." },
    { label: "启用用户", value: usersUnconfigured ? "—" : `${formatNumber(activeUsers)} / ${formatNumber(users.length)}` }
  ], "暂无状态数据");
}

let dataDialogTrigger = null;
function openDataDialog(id) {
  dataDialogTrigger = document.activeElement;
  $(id).hidden = false;
  $(id).querySelector('[role="dialog"]').focus();
}

function closeDataDialog(id) {
  $(id).hidden = true;
  if (dataDialogTrigger?.isConnected) dataDialogTrigger.focus();
  else $("userSearchInput").focus();
}

function openUserLedger(user) {
  $("ledgerUser").value = user ? userAccountLabel(user) || user.id || "" : "";
  for (const id of ["ledgerFeature", "ledgerStatus", "ledgerFrom", "ledgerTo"]) $(id).value = "";
  setText("creditLedgerTarget", user ? `用户：${userAccountLabel(user) || userDisplayName(user)}` : "全部用户");
  openDataDialog("creditLedgerDialog");
  void queryLedger(false);
}

function openActivityDestination() {
  if (dashboardActivityTab === "tasks") {
    showModule("compute");
    return;
  }
  openUserLedger();
}

async function refreshDomesticBalance() {
  const now = Date.now();
  if (now < rhRefreshLockedUntil) return;
  rhRefreshLockedUntil = now + 30000;
  const refresh = $("dashboardRhRefresh");
  const other = $("refreshDomesticBalance");
  if (refresh) {
    refresh.disabled = true;
    refresh.textContent = "刷新中";
  }
  if (other) other.disabled = true;
  try {
    const response = await window.adminAPI.checkAdminRunningHubProviderStatus();
    if (!response?.ok) throw new Error(response?.error || "余额读取失败");
    await renderFeatureCreditAdmin();
    toast("已更新国内站余额");
  } catch (err) {
    renderDashboardRhCard({ state: "error", message: "余额读取失败" });
    toast("余额读取失败");
  } finally {
    if (refresh) refresh.textContent = "刷新国内站余额";
    if (other) other.disabled = false;
    const wait = Math.max(0, rhRefreshLockedUntil - Date.now());
    setTimeout(() => {
      if (refresh) refresh.disabled = false;
    }, wait);
  }
}

// ---------------------------------------------------------------------------
// 算力节点
//
// The GPU pool behind NovaFlow Web. A machine joins by installing the Worker
// and pasting a one-time code minted here; nobody edits a table, configures an
// IP or touches source to add one. This page is the whole operator side of
// that - the app itself only shows whether compute is available.

let computeState = { users: [], writable: false };

const COMPUTE_WORKER_STATUS = {
  idle: "空闲",
  busy: "工作中",
  offline: "离线",
  maintenance: "已停用"
};

// Until the Web migration is applied to this Supabase project, every call here
// comes back "Could not find the table". That is true and useless: it reads
// like a bug when it is just a step nobody has done yet. Say the step.
const COMPUTE_MIGRATION_HINT =
  "这个 Supabase 项目还没有算力池的表。先执行 novaflow-web 的迁移" +
  "（20260922010000_novaflow_web_worker_fabric.sql），再回到这一页。";

function computeErrorText(result) {
  const text = resultErrorText(result);
  if (/Could not find the table/i.test(text) &&
      /gpu_workers|worker_models|web_worker_registration_codes|web_ai_tasks/.test(text)) {
    return COMPUTE_MIGRATION_HINT;
  }
  return text;
}

function computeHeartbeatText(value) {
  if (!value) return "从未";
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms)) return "-";
  if (ms < 60000) return Math.max(1, Math.round(ms / 1000)) + " 秒前";
  if (ms < 3600000) return Math.round(ms / 60000) + " 分钟前";
  return formatDateTime(value);
}

function renderComputeWorkers(workersResult) {
  const status = $("computeWorkerStatus");
  const writable = workersResult.source === "supabase" && workersResult.status !== "error";
  if (status) {
    status.textContent = isErrorResult(workersResult)
      ? computeErrorText(workersResult)
      : (isUnconfiguredResult(workersResult) ? "未配置" : (writable ? (workersResult.records || []).length + " 台" : "Supabase 未配置，不能写入"));
  }

  if (isUnconfiguredResult(workersResult)) {
    ["computeStatTotal", "computeStatIdle", "computeStatBusy", "computeStatOffline", "computeStatCompleted"].forEach((id) => setText(id, "—"));
    replaceRows("computeWorkersTableBody", [], 9, UNCONFIGURED_TEXT);
    return;
  }
  const workers = workersResult.records || [];
  const countByStatus = (value) => workers.filter((item) => String(item.status || "") === value).length;
  const sumOf = (field) => workers.reduce((sum, item) => sum + (Number(item[field] || 0) || 0), 0);
  setText("computeStatTotal", formatNumber(workers.length));
  setText("computeStatIdle", formatNumber(countByStatus("idle")));
  setText("computeStatBusy", formatNumber(countByStatus("busy")));
  setText("computeStatOffline", formatNumber(countByStatus("offline") + countByStatus("maintenance")));
  setText("computeStatCompleted", `${formatNumber(sumOf("total_completed"))} / ${formatNumber(sumOf("total_failed"))}`);

  const rows = workers.map((item) => {
    const tr = document.createElement("tr");
    tr.appendChild(textCell(item.worker_name || item.id));
    tr.appendChild(textCell(
      (item.gpu_name || "GPU 未知") + (item.vram_mb ? " · " + Math.round(Number(item.vram_mb) / 1024) + "GB" : "")
    ));
    tr.appendChild(textCell(item.comfy_version || "-"));
    tr.appendChild(textCell(Number(item.total_completed || 0) + " / " + Number(item.total_failed || 0)));
    tr.appendChild(textCell(computeHeartbeatText(item.last_heartbeat)));

    // Whether anyone but the owner can fetch results from this node.
    //
    // A node behind a home router has no address to publish, so it registers
    // 127.0.0.1 - which resolves to the VIEWER's own machine for everybody
    // else. The Worker opens a Cloudflare tunnel to solve that; when it has
    // not, results only reach a browser running on the node itself. That is
    // invisible from every other column here, and it is the first thing to
    // look at when somebody says they cannot download.
    const reachable = String(item.transport || "") === "tunnel";
    // statusBadge picks its colour from the English status words, so a Chinese
    // label would come out unstyled. Build the badge directly.
    const badge = document.createElement("span");
    badge.className = "badge " + (reachable ? "active" : "expired");
    badge.textContent = reachable ? "对外可达" : "仅本机";
    const address = nodeCell(badge);
    address.title = reachable
      ? "已开隧道：任何人都能从这台机器取回结果" + (item.endpoint_url ? "\n" + item.endpoint_url : "")
      : "没有对外地址：只有这台机器上的浏览器能取回结果。请确认 Worker 是 0.4.0 或更新，并且能连外网。";
    tr.appendChild(address);

    // 普通 / 高级节点. Changing it takes effect at once: the scheduler reads
    // the tier off the row for every claim.
    const tierSelect = createTableSelect(GPU_WORKER_TIER_OPTIONS, normalizeGpuWorkerTier(item.tier), !writable, "tier");
    tierSelect.addEventListener("change", async () => {
      tierSelect.disabled = true;
      try {
        const res = await window.adminAPI.setAdminGpuWorkerTier({ id: item.id, tier: tierSelect.value });
        if (!res?.ok || res.result?.ok === false) {
          throw new Error(String(res?.error || res?.result?.error || "修改等级失败"));
        }
        toast(`${item.worker_name || "节点"} 已设为${GPU_WORKER_TIER_TEXT[normalizeGpuWorkerTier(tierSelect.value)]}`);
        await loadComputeData();
      } catch (err) {
        if (status) status.textContent = String(err?.message || err);
        tierSelect.value = normalizeGpuWorkerTier(item.tier);
        tierSelect.disabled = false;
      }
    });
    tr.appendChild(nodeCell(tierSelect));

    tr.appendChild(nodeCell(statusBadge(COMPUTE_WORKER_STATUS[item.status] || item.status)));

    const action = document.createElement("td");
    if (writable) {
      const actions = document.createElement("div");
      actions.className = "tableActions";
      const stopped = item.status === "maintenance";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn secondary";
      button.textContent = stopped ? "恢复" : "停用";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const res = await window.adminAPI.setAdminGpuWorkerStatus({
            id: item.id,
            status: stopped ? "idle" : "maintenance"
          });
          if (!res?.ok || res.result?.ok === false) {
            throw new Error(String(res?.error || res?.result?.error || "操作失败"));
          }
          await loadComputeData();
        } catch (err) {
          if (status) status.textContent = String(err?.message || err);
          button.disabled = false;
        }
      });
      actions.appendChild(button);

      // A node that is gone for good. Only once it stopped heartbeating (or
      // was taken out of service), so a running Worker never loses its row.
      const beat = Date.parse(item.last_heartbeat || "") || 0;
      const live = ["idle", "busy"].includes(String(item.status || "")) && Date.now() - beat < 2 * 60 * 1000;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn danger";
      remove.textContent = "删除";
      remove.disabled = live;
      remove.title = live ? "节点在线时不能删除：先停用，等它离线" : "删除这台节点的记录";
      remove.addEventListener("click", async () => {
        const name = String(item.worker_name || item.id || "");
        const confirmed = await confirmByTyping({
          title: "删除算力节点",
          hint: name,
          warning: "会删除这台节点的记录和它上报的模型清单；已完成任务的历史保留，只是不再关联到这台机器。要重新接入需要新的注册码。",
          label: "输入节点名称确认",
          expected: name,
          confirmText: "确认删除"
        });
        if (!confirmed) return;
        remove.disabled = true;
        try {
          const res = await window.adminAPI.deleteAdminGpuWorker({ id: item.id });
          if (!res?.ok || res.result?.ok === false) {
            throw new Error(String(res?.error || res?.result?.error || "删除失败"));
          }
          toast("算力节点已删除");
          await loadComputeData();
        } catch (err) {
          if (status) status.textContent = String(err?.message || err);
          remove.disabled = false;
        }
      });
      actions.appendChild(remove);
      action.appendChild(actions);
    } else {
      action.textContent = "-";
    }
    tr.appendChild(action);
    return tr;
  });

  replaceRows(
    "computeWorkersTableBody",
    rows,
    9,
    isErrorResult(workersResult) ? computeErrorText(workersResult) : "还没有算力节点，发一个注册码接入一台"
  );
}

function renderComputeCodes(codesResult) {
  const status = $("computeCodesStatus");
  const writable = codesResult.source === "supabase" && codesResult.status !== "error";
  if (status) {
    status.textContent = isErrorResult(codesResult)
      ? computeErrorText(codesResult)
      : (writable ? "" : "Supabase 未配置，不能写入");
  }

  const rows = (codesResult.records || []).map((item) => {
    const expired = Date.parse(item.expires_at) <= Date.now();
    const used = Number(item.used_count || 0);
    const max = Number(item.max_uses || 1);
    const spent = expired || used >= max;

    const tr = document.createElement("tr");
    tr.appendChild(textCell(item.label || "(无备注)"));
    const tier = normalizeGpuWorkerTier(item.tier);
    const tierBadge = document.createElement("span");
    tierBadge.className = "badge " + (tier === "premium" ? "expired" : "");
    tierBadge.textContent = GPU_WORKER_TIER_TEXT[tier];
    tr.appendChild(nodeCell(tierBadge));
    tr.appendChild(textCell(used + " / " + max));
    tr.appendChild(textCell((expired ? "已失效 · " : "到期 ") + formatDateTime(item.expires_at)));

    const action = document.createElement("td");
    if (writable) {
      const button = document.createElement("button");
      button.type = "button";
      // A live code is revoked (it stays in the list as spent); a spent one
      // can be dropped from the list for good.
      button.className = spent ? "btn danger" : "btn secondary";
      button.textContent = spent ? "删除" : "吊销";
      button.addEventListener("click", async () => {
        if (spent && !confirm(`删除注册码「${item.label || "(无备注)"}」的记录？`)) return;
        button.disabled = true;
        try {
          const res = spent
            ? await window.adminAPI.deleteAdminWorkerCode({ codeHash: item.code_hash })
            : await window.adminAPI.revokeAdminWorkerCode({ codeHash: item.code_hash });
          if (!res?.ok || res.result?.ok === false) {
            throw new Error(String(res?.error || res?.result?.error || (spent ? "删除失败" : "吊销失败")));
          }
          await loadComputeData();
        } catch (err) {
          if (status) status.textContent = String(err?.message || err);
          button.disabled = false;
        }
      });
      action.appendChild(button);
    } else {
      action.textContent = "-";
    }
    tr.appendChild(action);
    return tr;
  });

  const purgeButton = $("computePurgeCodes");
  if (purgeButton) {
    const spentCount = (codesResult.records || []).filter((item) =>
      Date.parse(item.expires_at) <= Date.now() || Number(item.used_count || 0) >= Number(item.max_uses || 1)).length;
    purgeButton.disabled = !writable || !spentCount;
    purgeButton.textContent = spentCount ? `清理失效注册码（${spentCount}）` : "清理失效注册码";
  }

  replaceRows(
    "computeCodesTableBody",
    rows,
    5,
    isUnconfiguredResult(codesResult) ? UNCONFIGURED_TEXT : isErrorResult(codesResult) ? computeErrorText(codesResult) : "还没有发出过注册码"
  );
}

function renderComputeMintControls(usersResult) {
  const select = $("computeCodeOwner");
  const button = $("computeMintCode");
  const status = $("computeMintStatus");
  if (!select || !button || !status) return;

  const users = usersResult.records || [];
  const writable = usersResult.source === "supabase" && usersResult.status !== "error";
  computeState = { users, writable };

  const current = select.value;
  select.replaceChildren();
  if (!users.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = writable ? "暂无用户，请先在用户管理里创建" : "Supabase 未配置，不能写入";
    select.appendChild(option);
  } else {
    users.forEach((user) => {
      const option = document.createElement("option");
      option.value = String(user.id || "");
      option.textContent = userAccountLabel(user) || user.display_name || user.id;
      select.appendChild(option);
    });
    if (current && users.some((user) => String(user.id || "") === current)) select.value = current;
  }

  button.disabled = !writable || !users.length;
  status.textContent = writable ? (users.length ? "-" : "先创建一个用户") : "Supabase 未配置，不能写入";
}

async function mintComputeCode() {
  const button = $("computeMintCode");
  const status = $("computeMintStatus");
  const result = $("computeCodeResult");
  const value = $("computeCodeValue");
  if (!button || !status) return;

  const ownerId = $("computeCodeOwner")?.value || "";
  if (!ownerId) {
    status.textContent = "请选择归属用户";
    return;
  }

  button.disabled = true;
  status.textContent = "生成中…";
  try {
    const res = await window.adminAPI.createAdminWorkerCode({
      ownerId,
      label: $("computeCodeLabel")?.value || "",
      tier: normalizeGpuWorkerTier($("computeCodeTier")?.value),
      maxUses: Number($("computeCodeUses")?.value || 1),
      validDays: Number($("computeCodeDays")?.value || 7)
    });
    if (!res?.ok) throw new Error(String(res.error || "生成失败"));
    const payload = res.result || {};
    if (payload.ok === false || !payload.registrationCode) {
      throw new Error(String(payload.error || "生成失败"));
    }
    if (result) result.style.display = "";
    if (value) {
      value.value = payload.registrationCode;
      value.select?.();
    }
    // loadComputeData re-renders the owner select and resets this status
    // line, so the "generated" message has to be written after it.
    await loadComputeData();
    status.textContent = "已生成，" + formatDateTime(payload.expiresAt) + " 过期";
  } catch (err) {
    const text = String(err?.message || err);
    status.textContent = computeErrorText({ error: text });
  } finally {
    button.disabled = false;
  }
}

// Who generated, how much, and on whose machine.
//
// Deliberately no prompt, no parameters, no output: the columns that hold
// them are not even selected. Seeing that a user ran 40 generations on a
// given node is an operations question; reading what they made is not, and
// an admin screen is the wrong place to answer it by accident.
function renderComputeUsage(usageResult, usersResult, workersResult) {
  const status = $("computeUsageStatus");
  const tasks = usageResult?.records || [];
  const userById = new Map((usersResult?.records || []).map((u) => [String(u.id || ""), u]));
  const workerById = new Map((workersResult?.records || []).map((w) => [String(w.id || ""), w]));

  if (status) {
    status.textContent = isErrorResult(usageResult)
      ? computeErrorText(usageResult)
      : tasks.length
        ? tasks.length + " 条任务"
        : "";
  }
  const purgeButton = $("computePurgeUsage");
  if (purgeButton) purgeButton.disabled = !(usageResult?.source === "supabase" && usageResult?.status !== "error") || !tasks.length;

  const byUser = new Map();
  for (const task of tasks) {
    const key = String(task.user_id || "");
    if (!byUser.has(key)) {
      byUser.set(key, { total: 0, failed: 0, workers: new Map(), latest: "" });
    }
    const row = byUser.get(key);
    row.total += 1;
    if (String(task.status || "") === "failed") row.failed += 1;
    const workerId = String(task.assigned_worker_id || "");
    if (workerId) {
      const worker = workerById.get(workerId);
      const name = worker?.worker_name || workerId.slice(0, 8);
      row.workers.set(workerId, (row.workers.get(workerId) || 0) + 1);
      row.workerNames = row.workerNames || new Map();
      row.workerNames.set(workerId, name);
    }
    const at = String(task.created_at || "");
    if (at > row.latest) row.latest = at;
  }

  const rows = [...byUser.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([userId, row]) => {
      const user = userById.get(userId);
      const tr = document.createElement("tr");
      tr.appendChild(textCell(userAccountLabel(user) || user?.display_name || userId.slice(0, 8) || "(未知用户)"));
      tr.appendChild(textCell(
        row.failed ? `${row.total}（失败 ${row.failed}）` : String(row.total)
      ));
      const names = [...(row.workerNames || new Map()).entries()]
        .map(([id, name]) => name + " ×" + row.workers.get(id));
      tr.appendChild(textCell(names.length ? names.join("、") : "-"));
      tr.appendChild(textCell(row.latest ? formatDateTime(row.latest) : "-"));
      return tr;
    });

  replaceRows(
    "computeUsageTableBody",
    rows,
    4,
    isUnconfiguredResult(usageResult) ? UNCONFIGURED_TEXT : isErrorResult(usageResult) ? computeErrorText(usageResult) : "还没有生成记录"
  );
}

// The two "clean up" buttons on the 算力节点 page: spent registration codes,
// and finished usage rows older than the chosen number of days.
async function purgeComputeCodes() {
  const button = $("computePurgeCodes");
  const status = $("computeCodesStatus");
  if (!confirm("删除所有已失效、已吊销或已用完的注册码记录？\n正在生效的注册码不受影响。")) return;
  if (button) button.disabled = true;
  try {
    const res = await window.adminAPI.purgeAdminWorkerCodes();
    if (!res?.ok || res.result?.ok === false) {
      throw new Error(String(res?.error || res?.result?.error || "清理失败"));
    }
    toast(`已清理 ${formatNumber(res.result?.deleted || 0)} 条注册码记录`);
    await loadComputeData();
  } catch (err) {
    if (status) status.textContent = String(err?.message || err);
    if (button) button.disabled = false;
  }
}

async function purgeComputeUsage() {
  const button = $("computePurgeUsage");
  const status = $("computeUsageStatus");
  const days = Math.max(1, Number($("computeUsagePurgeDays")?.value || 30) || 30);
  if (!confirm(`删除 ${days} 天前已完成、失败、取消或过期的生成记录？\n排队中和进行中的任务不会被删除。`)) return;
  if (button) button.disabled = true;
  try {
    const res = await window.adminAPI.purgeAdminWebTasks({ olderThanDays: days });
    if (!res?.ok || res.result?.ok === false) {
      throw new Error(String(res?.error || res?.result?.error || "清理失败"));
    }
    toast(`已清理 ${formatNumber(res.result?.deleted || 0)} 条生成记录`);
    await loadComputeData();
    await loadAdminData();
  } catch (err) {
    if (status) status.textContent = String(err?.message || err);
    if (button) button.disabled = false;
  }
}

async function loadComputeData() {
  try {
    const workers = await loadAdminDataset("getAdminGpuWorkers", "computeDataBadge");
    const codes = await loadAdminDataset("getAdminWorkerCodes");
    const users = await loadAdminDataset("getAdminUsers");
    const usage = await loadAdminDataset("getAdminWebTaskUsage");
    renderComputeWorkers(workers);
    renderComputeCodes(codes);
    renderComputeMintControls(users);
    renderComputeUsage(usage, users, workers);
  } catch (err) {
    const status = $("computeWorkerStatus");
    if (status) status.textContent = String(err?.message || err);
  }
}

async function loadDashboardLedger() {
  if (typeof window.adminAPI?.queryCreditLedger !== "function") return { records: [], error: "余额读取失败" };
  const response = await window.adminAPI.queryCreditLedger({
    status: "settled",
    limit: 20
  });
  if (!response?.ok) return { records: [], error: "积分流水读取失败" };
  return response.result || { records: [] };
}

async function loadAdminData() {
  try {
    renderDashboardRhCard({ state: "loading" });
    const [users, credits, providers, settings, runninghubStatus, usage, workers, ledger] = await Promise.all([
      loadAdminDataset("getAdminUsers", "usersDataBadge"),
      loadAdminDataset("getAdminCredits"),
      loadAdminDataset("getAdminAiProviders", "aiServicesDataBadge"),
      loadAdminDataset("getAdminSystemSettings", "settingsDataBadge"),
      loadAdminProviderStatus("getAdminRunningHubProviderStatus"),
      typeof window.adminAPI?.getAdminWebTaskUsage === "function"
        ? window.adminAPI.getAdminWebTaskUsage({ limit: 100 }).then((response) => response?.result || { records: [] })
        : { records: [] },
      loadAdminDataset("getAdminGpuWorkers"),
      loadDashboardLedger()
    ]);
    const results = [users, credits, providers, settings];

    setAdminDataSourceStatus(results);
    setDataBadge("aiServicesDataBadge", hasErrorResult([providers, settings]) ? { status: "error" } : hasSupabaseResult([providers, settings]) ? { source: "supabase" } : { source: "mock" });

    renderUsers(users, credits);
    renderAiServices(providers, settings, null, null, runninghubStatus);
    renderProviderRuntimeConfigControls(null, null, runninghubStatus);
    syncCreditAdjustment(users, credits);
    renderDashboard({ users, credits, providers, settings, runninghubStatus, usage, workers, ledger });
    await renderFeatureCreditAdmin();
  } catch (err) {
    const message = `Supabase Error: ${String(err?.message || err)}`;
    setAdminDataSourceStatus([{ status: "error" }]);
    ["dashboardDataBadge", "usersDataBadge", "aiServicesDataBadge"].forEach((id) => setDataBadge(id, "Supabase Error"));
    replaceRows("usersTableBody", [], 8, message);
    replaceRows("aiProvidersTableBody", [], 5, message);
    dashboardSnapshot = { usage: { source: "supabase", status: "error", records: [], error: message }, ledger: { records: [], error: message } };
    renderDashboardRecentActivity();
    renderDashboardRhCard({ state: "error", message: "余额读取失败" });
  }
}

function createAdminUserPayload() {
  return {
    accountName: $("newUserAccount")?.value.trim() || "",
    password: $("newUserPassword")?.value || "",
    displayName: $("newUserDisplayName")?.value.trim() || "",
    plan: normalizeUserPlanValue($("newUserPlan")?.value),
    status: $("newUserStatus")?.value || "active",
    initialCredits: Number($("newUserInitialCredits")?.value || 0),
    maxSessions: Number($("newUserMaxSessions")?.value || 1),
    expiresAt: $("newUserExpiresAt")?.value || "",
    note: $("newUserNote")?.value.trim() || ""
  };
}

function clearCreateAdminUserForm() {
  if ($("newUserAccount")) $("newUserAccount").value = "";
  if ($("newUserPassword")) $("newUserPassword").value = "";
  if ($("newUserDisplayName")) $("newUserDisplayName").value = "";
  if ($("newUserPlan")) $("newUserPlan").value = "trial";
  if ($("newUserStatus")) $("newUserStatus").value = "active";
  if ($("newUserInitialCredits")) $("newUserInitialCredits").value = "0";
  if ($("newUserMaxSessions")) $("newUserMaxSessions").value = "1";
  if ($("newUserExpiresAt")) $("newUserExpiresAt").value = "";
  if ($("newUserNote")) $("newUserNote").value = "";
}

async function createAdminUser() {
  const status = $("createUserStatus");
  const payload = createAdminUserPayload();
  if (!userManagementState.createWritable) {
    alert("当前不是完整 Supabase 可写数据，不能创建后台用户。请确认 users 和 credits 能正常读取。");
    return;
  }
  const accountName = normalizeAccountInput(payload.accountName);
  if (!accountName) {
    alert("请填写账号");
    return;
  }
  if (accountName.length < 2 || accountName.length > 64 || !/^[a-z0-9._-]+$/.test(accountName)) {
    alert("账号需要 2-64 个字符，只能包含小写字母、数字、点、下划线或短横线");
    return;
  }
  if (!payload.password || payload.password.length < 6) {
    alert("初始密码至少需要 6 位");
    return;
  }
  if (!Number.isInteger(payload.initialCredits) || payload.initialCredits < 0) {
    alert("初始积分必须是大于等于 0 的整数");
    return;
  }
  if (!Number.isInteger(payload.maxSessions) || payload.maxSessions < 1 || payload.maxSessions > 99) {
    alert("同时在线数必须是 1-99 的整数");
    return;
  }

  const confirmed = confirm(`确定创建登录账号 ${accountName}？\n初始积分：${formatNumber(payload.initialCredits)}\n同时在线：${payload.maxSessions} 处\n有效期：${payload.expiresAt ? `至 ${payload.expiresAt}` : "永久"}\n用户将使用此账号和初始密码登录 NovaFlow。`);
  if (!confirmed) return;

  try {
    if (status) status.textContent = "创建中...";
    const res = await window.adminAPI.createAdminUser(payload);
    const result = res?.result || {};
    if (!res?.ok || result.status === "error" || result.ok === false) {
      if (status) status.textContent = "创建失败";
      alert(result.error || res?.error || "创建用户失败");
      return;
    }
    if (status) status.textContent = "已创建";
    clearCreateAdminUserForm();
    closeDrawer($("userCreateDrawer"));
    toast("后台用户已创建");
    await loadAdminData();
  } catch (err) {
    if (status) status.textContent = "创建失败";
    alert(`创建用户失败：${String(err?.message || err)}`);
  }
}

async function saveUserRow(button) {
  const row = button?.closest("tr");
  const userId = button?.dataset?.userId || "";
  if (!userManagementState.writable) {
    alert("当前不是 Supabase 可写数据，不能更新用户。");
    return;
  }
  if (!row || !userId) {
    alert("无法识别要更新的用户");
    return;
  }
  const status = row.querySelector('select[data-field="status"]')?.value || "active";
  const plan = normalizeUserPlanValue(row.querySelector('select[data-field="plan"]')?.value);
  const maxSessions = Number(row.querySelector('input[data-field="maxSessions"]')?.value || 0);
  const expiresAt = row.querySelector('input[data-field="expiresAt"]')?.value || "";
  const user = userManagementState.users.find((item) => String(item.id || "") === String(userId));
  const oldStatus = normalizeUserStatusValue(user?.status);
  const oldPlan = normalizeUserPlanValue(user?.plan);
  const oldMaxSessions = userMaxSessions(user);
  const oldExpiresAt = localDateInputValue(user?.expires_at);
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 99) {
    alert("同时在线数必须是 1-99 的整数");
    return;
  }
  if (status === oldStatus && plan === oldPlan && maxSessions === oldMaxSessions && expiresAt === oldExpiresAt) {
    toast("用户信息没有变化");
    return;
  }
  const planLabel = (value) => (USER_PLAN_OPTIONS.find(([key]) => key === value) || [value, value])[1];
  const expiryLabel = (value) => value ? `至 ${value}` : "永久";
  const changes = [];
  const patch = { userId };
  if (plan !== oldPlan) {
    changes.push(`账户类型：${planLabel(oldPlan)} -> ${planLabel(plan)}`);
    patch.plan = plan;
  }
  if (status !== oldStatus) {
    changes.push(`状态：${oldStatus} -> ${status}`);
    patch.status = status;
  }
  if (maxSessions !== oldMaxSessions) {
    changes.push(`同时在线：${oldMaxSessions} -> ${maxSessions}${maxSessions < oldMaxSessions ? "（多出的登录会被挤下线）" : ""}`);
    patch.maxSessions = maxSessions;
  }
  if (expiresAt !== oldExpiresAt) {
    changes.push(`有效期：${expiryLabel(oldExpiresAt)} -> ${expiryLabel(expiresAt)}`);
    patch.expiresAt = expiresAt;
  }
  const confirmed = confirm(`确定更新 ${userAccountLabel(user) || userId}？\n${changes.join("\n")}`);
  if (!confirmed) return;

  try {
    button.disabled = true;
    button.textContent = "保存中...";
    const res = await window.adminAPI.updateAdminUser(patch);
    const result = res?.result || {};
    if (!res?.ok || result.status === "error" || result.ok === false) {
      alert(result.error || res?.error || "更新用户失败");
      return;
    }
    toast("用户已更新");
    await loadAdminData();
  } catch (err) {
    alert(`更新用户失败：${String(err?.message || err)}`);
  } finally {
    button.disabled = false;
    button.textContent = "保存";
  }
}

// Type-to-confirm, because window.prompt does not exist here.
//
// Electron's renderer THROWS "prompt() is not supported." rather than
// returning null, so `const typed = prompt(...)` took the whole handler down
// with it. Both delete buttons went through one, inside an async click
// handler with no catch, so the exception became an unhandled rejection and
// the button did nothing at all - every time, with nothing on screen to say
// why.
//
// One dialog now states the consequence and keeps its button disabled until
// the name is typed exactly, which is what the confirm()+prompt() pair was
// reaching for.
function confirmByTyping({ title, hint, warning, label, expected, confirmText }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay";

    const panel = document.createElement("div");
    panel.className = "modalPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "modalHeader";
    const headings = document.createElement("div");
    const titleEl = document.createElement("div");
    titleEl.className = "modalTitle";
    titleEl.textContent = title;
    headings.appendChild(titleEl);
    if (hint) {
      const hintEl = document.createElement("div");
      hintEl.className = "modalHint";
      hintEl.textContent = hint;
      headings.appendChild(hintEl);
    }
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "iconButton";
    closeButton.setAttribute("aria-label", "关闭");
    closeButton.textContent = "×";
    header.appendChild(headings);
    header.appendChild(closeButton);

    const body = document.createElement("div");
    body.className = "modalBody";
    if (warning) {
      const warn = document.createElement("div");
      warn.className = "modalStatus";
      warn.textContent = warning;
      body.appendChild(warn);
    }
    const field = document.createElement("label");
    field.className = "modalField";
    const fieldLabel = document.createElement("span");
    fieldLabel.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = expected;
    field.appendChild(fieldLabel);
    field.appendChild(input);
    body.appendChild(field);

    const actions = document.createElement("div");
    actions.className = "modalActions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn secondary";
    cancel.textContent = "取消";
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "btn danger";
    submit.textContent = confirmText || "确认删除";
    submit.disabled = true;
    actions.appendChild(cancel);
    actions.appendChild(submit);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const matches = () =>
      String(input.value).trim().toLowerCase() === String(expected).trim().toLowerCase();

    function finish(result) {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    }
    function onKey(event) {
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
      else if (event.key === "Enter" && matches()) { event.preventDefault(); finish(true); }
    }

    input.addEventListener("input", () => { submit.disabled = !matches(); });
    submit.addEventListener("click", () => { if (matches()) finish(true); });
    cancel.addEventListener("click", () => finish(false));
    closeButton.addEventListener("click", () => finish(false));
    overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) finish(false); });
    document.addEventListener("keydown", onKey, true);
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 30);
  });
}

async function deleteUserRow(button) {
  const userId = button?.dataset?.userId || "";
  if (!userManagementState.deleteWritable) {
    alert("当前不是 Supabase 可写数据，不能删除用户。");
    return;
  }
  if (!userId) {
    alert("无法识别要删除的用户");
    return;
  }
  const user = userManagementState.users.find((item) => String(item.id || "") === String(userId));
  const accountLabel = userAccountLabel(user);
  if (!accountLabel) {
    alert("无法识别要删除用户的账号");
    return;
  }
  const confirmed = await confirmByTyping({
    title: "删除用户",
    hint: accountLabel,
    warning: "会删除后台用户资料、积分余额和可匹配的 Auth 登录身份。不可恢复。",
    label: "输入账号确认",
    expected: accountLabel
  });
  if (!confirmed) return;

  try {
    button.disabled = true;
    button.textContent = "删除中...";
    const res = await window.adminAPI.deleteAdminUser({
      userId,
      confirmAccount: accountLabel
    });
    const result = res?.result || {};
    if (!res?.ok || result.status === "error" || result.ok === false) {
      alert(result.error || res?.error || "删除用户失败");
      return;
    }
    await verifyDeletedUserGone(userId);
    toast("用户已删除");
    await loadAdminData();
  } catch (err) {
    alert(`删除用户失败：${String(err?.message || err)}`);
  } finally {
    button.disabled = false;
    button.textContent = "删除";
  }
}

async function resetUserPassword(button) {
  const userId = button?.dataset?.userId || "";
  if (!userManagementState.writable) {
    alert("当前不是 Supabase 可写数据，不能修改密码。");
    return;
  }
  const user = userManagementState.users.find((item) => String(item.id || "") === String(userId));
  const accountLabel = userAccountLabel(user);
  if (!userId || !accountLabel) {
    alert("无法识别要修改密码的用户");
    return;
  }
  openPasswordEditDialog({ userId, accountLabel });
}

function setPasswordEditStatus(message, tone) {
  const el = $("passwordEditStatus");
  if (!el) return;
  el.textContent = String(message || "");
  el.classList.remove("error", "success");
  if (tone) el.classList.add(tone);
}

function openPasswordEditDialog(payload) {
  passwordEditState = {
    userId: String(payload?.userId || ""),
    accountLabel: String(payload?.accountLabel || "")
  };
  $("passwordEditAccount").textContent = passwordEditState.accountLabel
    ? `账号：${passwordEditState.accountLabel}`
    : "-";
  $("passwordEditValue").value = "";
  $("passwordEditConfirmValue").value = "";
  setPasswordEditStatus("密码只写入 Supabase Auth，不会显示给用户。");
  $("passwordEditDialog").hidden = false;
  setTimeout(() => $("passwordEditValue")?.focus(), 0);
}

function closePasswordEditDialog() {
  $("passwordEditDialog").hidden = true;
  $("passwordEditValue").value = "";
  $("passwordEditConfirmValue").value = "";
  passwordEditState = { userId: "", accountLabel: "" };
  setPasswordEditStatus("");
}

async function submitPasswordEditDialog() {
  const userId = passwordEditState.userId;
  const accountLabel = passwordEditState.accountLabel;
  const password = String($("passwordEditValue")?.value || "");
  const confirmPassword = String($("passwordEditConfirmValue")?.value || "");
  const submitButton = $("passwordEditSubmit");
  if (!userManagementState.writable) {
    setPasswordEditStatus("当前不是 Supabase 可写数据，不能修改密码。", "error");
    return;
  }
  if (!userId || !accountLabel) {
    setPasswordEditStatus("无法识别要修改密码的用户。", "error");
    return;
  }
  if (password.length < 6) {
    setPasswordEditStatus("新密码至少需要 6 位。", "error");
    $("passwordEditValue")?.focus();
    return;
  }
  if (password !== confirmPassword) {
    setPasswordEditStatus("两次输入的密码不一致。", "error");
    $("passwordEditConfirmValue")?.focus();
    return;
  }
  try {
    submitButton.disabled = true;
    submitButton.textContent = "修改中...";
    setPasswordEditStatus("正在写入 Supabase Auth...");
    const res = await window.adminAPI.resetAdminUserPassword({ userId, password });
    const result = res?.result || {};
    if (!res?.ok || result.status === "error" || result.ok === false) {
      setPasswordEditStatus(result.error || res?.error || "修改密码失败", "error");
      return;
    }
    verifyPasswordResetResult(result);
    setPasswordEditStatus("密码已修改。", "success");
    toast("密码已修改");
    closePasswordEditDialog();
    await loadAdminData();
  } catch (err) {
    setPasswordEditStatus(`修改密码失败：${String(err?.message || err)}`, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "确认修改";
  }
}

function providerRuntimeConfigPayload(providerKey) {
  const key = String(providerKey || "").toLowerCase();
  if (key !== "runninghub") throw new Error("Unsupported Provider");
  const apiKey = $("runninghubRuntimeApiKey")?.value.trim() || "";
  return {
    providerKey: "runninghub",
    apiKey,
    updateApiKey: Boolean(apiKey),
    clearApiKey: Boolean($("runninghubRuntimeClearKey")?.checked),
    baseUrl: $("runninghubRuntimeBaseUrl")?.value.trim() || "https://www.runninghub.cn",
    llmBaseUrl: $("runninghubRuntimeLlmBaseUrl")?.value.trim() || "https://llm.runninghub.cn/v1",
    llmModel: $("runninghubRuntimeLlmModel")?.value.trim() || "",
    gptImageEndpoint: $("runninghubRuntimeGptImageEndpoint")?.value.trim() || ""
  };
}

async function saveProviderRuntimeConfig(providerKey) {
  const key = String(providerKey || "").toLowerCase();
  const status = $("providerRuntimeConfigStatus");
  const payload = providerRuntimeConfigPayload(key);
  if (payload.clearApiKey && payload.apiKey) {
    alert("清空 Key 和填写新 Key 不能同时操作。");
    return;
  }
  const providerName = "RunningHub";
  const willChangeKey = payload.clearApiKey ? "清空当前 API Key" : payload.updateApiKey ? "覆盖当前 API Key" : "不修改当前 API Key";
  const confirmed = confirm(`确定保存 ${providerName} 配置？\n${willChangeKey}\n真实 Key 只写入本机后台环境变量，不会回显。`);
  if (!confirmed) return;

  try {
    if (status) status.textContent = "保存中...";
    const res = await window.adminAPI.setAdminProviderRuntimeConfig(payload);
    const result = res?.result || {};
    if (!res?.ok || result.status === "error" || result.ok === false) {
      if (status) status.textContent = "保存失败";
      alert(result.error || res?.error || `保存 ${providerName} 配置失败`);
      return;
    }
    if ($("runninghubRuntimeApiKey")) $("runninghubRuntimeApiKey").value = "";
    if ($("runninghubRuntimeClearKey")) $("runninghubRuntimeClearKey").checked = false;
    if (status) status.textContent = "已保存";
    toast(`${providerName} 配置已保存`);
    await loadAdminData();
    if (key === "runninghub") await checkRunningHubProvider();
  } catch (err) {
    if (status) status.textContent = "保存失败";
    alert(`保存 ${providerName} 配置失败：${String(err?.message || err)}`);
  }
}

async function checkRunningHubProvider() {
  const button = $("checkRunninghubProvider");
  const hint = $("runninghubRuntimeConfigHint");
  if (button) button.disabled = true;
  if (hint) hint.textContent = "检测已保存配置中...";
  try {
    const response = await window.adminAPI.checkAdminRunningHubProviderStatus();
    if (!response?.ok) throw new Error(response?.error || "检测失败");
    const status = response.result;
    renderRunningHubProviderHealth(status);
    if (hint) hint.textContent = !status.configured ? "请先保存 API Key" : status.connected ? "账户连接正常；模型尚未验证" : status.error || "尚未检测";
    // Reload reads the cached result and never submits a second provider request.
    await loadAdminData();
    if (hint) hint.textContent = !status.configured ? "请先保存 API Key" : status.connected ? "账户连接正常；模型尚未验证" : status.error || "尚未检测";
  } catch (err) {
    if (hint) hint.textContent = String(err?.message || err);
  } finally {
    if (button) button.disabled = false;
  }
}

function toDateInputValue(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}

function stringifyPermissions(value) {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "");
  }
}

function formatOnlineRecord(record) {
  if (!record) return "-";
  return JSON.stringify(record, null, 2);
}

function formatShortDate(value) {
  const s = String(value || "").trim();
  if (!s) return "-";
  return s.replace("T", " ").replace(/\.\d+Z$/, "Z").replace(/\+00:00$/, "Z");
}

function setOnlineStatus(text) {
  $("onlineActionStatus").textContent = String(text || "-");
}

function fillOnlineFormFromRecord(record) {
  if (!record) return;
  if (record.license_key) $("onlineLicenseKey").value = String(record.license_key);
  if (record.machine_id) $("onlineMachineId").value = String(record.machine_id);
  if (record.status) $("onlineStatus").value = String(record.status);
  if (record.expire_at) $("onlineExpireAt").value = toDateInputValue(record.expire_at);
  $("onlinePermissions").value = stringifyPermissions(record.permissions);
}

function renderOnlineRecords(records) {
  const list = Array.isArray(records) ? records : [];
  $("onlineResult").textContent = list.length ? JSON.stringify(list, null, 2) : "未找到记录";
  renderOnlineList(list);
  if (list[0]) fillOnlineFormFromRecord(list[0]);
}

function renderOnlineList(records, selectedLicenseKey) {
  const list = Array.isArray(records) ? records : [];
  const container = $("onlineList");
  const status = $("onlineListStatus");
  if (!container) return;
  container.replaceChildren();
  if (status) status.textContent = list.length ? `共 ${list.length} 条记录` : "暂无记录";

  // Status summary above the table, and the dashboard's "有效授权" card, which
  // used to show a hard-coded number.
  const countStatus = (value) => list.filter((record) => String(record.status || "").toLowerCase() === value).length;
  setText("licStatTotal", formatNumber(list.length));
  setText("licStatActive", formatNumber(countStatus("active")));
  setText("licStatExpired", formatNumber(countStatus("expired")));
  setText("licStatBanned", formatNumber(countStatus("banned")));
  setText("dashboardLicensesCount", formatNumber(countStatus("active")));

  if (!list.length) {
    replaceRows("onlineList", [], 6, "没有可显示的授权记录");
    return;
  }
  const current = String(selectedLicenseKey || $("onlineLicenseKey")?.value || "").trim();
  list.forEach((record) => {
    // One table row per licence; click or Enter selects it into the form.
    const item = document.createElement("tr");
    item.tabIndex = 0;
    item.className = "recordItem";
    if (record.license_key && record.license_key === current) item.classList.add("active");

    item.appendChild(textCell(record.license_key || "(空 license_key)", "recordKey"));
    const badge = document.createElement("span");
    badge.className = `badge ${String(record.status || "").toLowerCase()}`;
    badge.textContent = record.status || "-";
    item.appendChild(nodeCell(badge));
    const machine = textCell(record.machine_id || "-", "recordMachine");
    machine.title = record.machine_id || "";
    item.appendChild(machine);
    item.appendChild(textCell(formatShortDate(record.expire_at)));
    item.appendChild(textCell(formatShortDate(record.created_at)));

    const actions = document.createElement("div");
    actions.className = "recordActions";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn danger recordDeleteButton";
    deleteButton.textContent = "删除";
    deleteButton.title = "删除该授权记录";
    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteOnlineLicense(record);
    });

    // The licence code is not stored on the record - it is made when the
    // licence is issued and then only lives in the issue tab and the .nfl.
    // Reading one back meant re-issuing and retyping the machine id, so this
    // signs a fresh one from what the record already holds.
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "btn secondary recordCopyButton";
    copyButton.textContent = "复制授权码";
    copyButton.title = "为这条记录生成并复制一个授权码";
    copyButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      const original = copyButton.textContent;
      copyButton.disabled = true;
      copyButton.textContent = "生成中...";
      try {
        const res = await window.adminAPI.licenseCodeFor({
          licenseKey: record.license_key,
          machineId: record.machine_id,
          expiresAt: record.expire_at,
          featuresText: record.permissions == null
            ? ""
            : typeof record.permissions === "string"
              ? record.permissions
              : JSON.stringify(record.permissions)
        });
        const text = res?.result?.licenseText;
        if (!res?.ok || !text) throw new Error(String(res?.error || "生成授权码失败"));
        await copyToClipboard(text, "已复制授权码");
      } catch (err) {
        alert(`生成授权码失败：${String(err?.message || err)}`);
      } finally {
        copyButton.disabled = false;
        copyButton.textContent = original;
      }
    });

    actions.appendChild(copyButton);
    actions.appendChild(deleteButton);
    item.appendChild(nodeCell(actions));

    const selectRecord = () => {
      fillOnlineFormFromRecord(record);
      $("onlineResult").textContent = formatOnlineRecord(record);
      renderOnlineList(list, record.license_key);
      setOnlineStatus("已选择记录");
    };
    item.addEventListener("click", selectRecord);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectRecord();
      }
    });
    container.appendChild(item);
  });
}

async function loadOnlineConfig() {
  const res = await window.adminAPI.getOnlineConfig();
  if (!res?.ok) {
    $("onlineConfigStatus").textContent = `配置读取失败：${String(res?.error || "unknown")}`;
    return null;
  }
  const cfg = res.config || {};
  $("onlineSupabaseUrl").value = cfg.supabaseUrl || "";
  $("onlineSecretKey").value = "";
  $("issueSyncOnline").checked = Boolean(cfg.hasSecretKey);
  $("onlineConfigStatus").textContent = cfg.hasSecretKey
    ? `已保存：${cfg.secretPreview || "secret"}`
    : "未保存 Secret Key";
  setGlobalStatus(cfg.hasSecretKey ? "在线管理已配置" : "在线管理未配置");
  return cfg;
}

async function saveOnlineConfig() {
  const res = await window.adminAPI.saveOnlineConfig({
    supabaseUrl: $("onlineSupabaseUrl").value.trim(),
    secretKey: $("onlineSecretKey").value.trim()
  });
  if (!res?.ok) {
    alert(`保存在线配置失败：${String(res?.error || "unknown")}`);
    return;
  }
  $("onlineSecretKey").value = "";
  const cfg = res.config || {};
  $("issueSyncOnline").checked = Boolean(cfg.hasSecretKey);
  $("onlineConfigStatus").textContent = cfg.hasSecretKey
    ? `已保存：${cfg.secretPreview || "secret"}`
    : "未保存 Secret Key";
  setGlobalStatus(cfg.hasSecretKey ? "在线管理已配置" : "在线管理未配置");
  toast("在线配置已保存");
}

async function testOnlineConfig() {
  $("onlineConfigStatus").textContent = "测试中...";
  const res = await window.adminAPI.testOnlineConfig();
  if (!res?.ok) {
    $("onlineConfigStatus").textContent = "连接失败";
    alert(`Supabase 连接失败：${String(res?.error || "unknown")}`);
    return;
  }
  $("onlineConfigStatus").textContent = "连接正常";
  toast("Supabase 连接正常");
}

function onlinePayload() {
  return {
    licenseKey: $("onlineLicenseKey").value.trim(),
    machineId: $("onlineMachineId").value.trim(),
    status: $("onlineStatus").value,
    expireAt: $("onlineExpireAt").value.trim(),
    permissionsText: $("onlinePermissions").value.trim(),
    limit: 100
  };
}

async function queryOnlineLicense() {
  const payload = onlinePayload();
  const hasFilter = Boolean(payload.licenseKey || payload.machineId);
  setOnlineStatus(hasFilter ? "查询中..." : "刷新列表中...");
  const res = await window.adminAPI.queryOnlineLicense(payload);
  if (!res?.ok) {
    setOnlineStatus("查询失败");
    alert(`查询失败：${String(res?.error || "unknown")}`);
    return;
  }
  renderOnlineRecords(res?.result?.records || []);
  setOnlineStatus(hasFilter ? "查询完成" : "列表已刷新");
}

async function refreshOnlineList(options) {
  const silent = Boolean(options?.silent);
  if (!silent) setOnlineStatus("刷新列表中...");
  const res = await window.adminAPI.queryOnlineLicense({ limit: 100 });
  if (!res?.ok) {
    if (!silent) {
      setOnlineStatus("列表刷新失败");
      alert(`刷新列表失败：${String(res?.error || "unknown")}`);
    }
    return;
  }
  const records = res?.result?.records || [];
  renderOnlineList(records);
  if (!silent) setOnlineStatus("列表已刷新");
}

async function upsertOnlineLicense() {
  const payload = onlinePayload();
  if (!payload.licenseKey) {
    alert("请先从列表选择一条授权记录，或填写 License Key。");
    return;
  }

  // This card edits an existing licence. A new one comes from 新建授权码,
  // which signs the file and the record together - a record created here
  // would have no licence file behind it and nothing could be issued from it.
  setOnlineStatus("查询中...");
  const existing = await window.adminAPI.queryOnlineLicense({ licenseKey: payload.licenseKey, limit: 1 });
  if (!existing?.ok) {
    setOnlineStatus("查询失败");
    alert(`查询失败：${String(existing?.error || "unknown")}`);
    return;
  }
  if (!(existing?.result?.records || []).length) {
    setOnlineStatus("没有这条记录");
    alert(`线上没有 ${payload.licenseKey} 这条授权记录。
新建请到「新建授权码」页签，那里会连授权文件一起签发。`);
    return;
  }

  setOnlineStatus("写入中...");
  const res = await window.adminAPI.upsertOnlineLicense(payload);
  if (!res?.ok) {
    setOnlineStatus("更新失败");
    alert(`更新失败：${String(res?.error || "unknown")}`);
    return;
  }
  const record = res?.result?.record;
  $("onlineResult").textContent = formatOnlineRecord(record);
  fillOnlineFormFromRecord(record);
  await refreshOnlineList({ silent: true });
  setOnlineStatus("已更新");
  toast("线上授权已更新");
}

async function setOnlineLicenseStatus(status) {
  const licenseKey = $("onlineLicenseKey").value.trim();
  if (!licenseKey) {
    alert("请先填写 License Key");
    return;
  }
  setOnlineStatus("更新状态中...");
  const res = await window.adminAPI.setOnlineLicenseStatus({ licenseKey, status });
  if (!res?.ok) {
    setOnlineStatus("状态更新失败");
    alert(`状态更新失败：${String(res?.error || "unknown")}`);
    return;
  }
  const records = res?.result?.records || [];
  renderOnlineRecords(records);
  await refreshOnlineList({ silent: true });
  setOnlineStatus(status === "active" ? "已启用" : status === "banned" ? "已关闭" : "已设为过期");
  toast(status === "active" ? "授权已启用" : status === "banned" ? "授权已关闭" : "授权已设为过期");
}

async function verifyDeletedLicenseGone(target) {
  const licenseKey = String(target?.licenseKey || "").trim();
  const id = target?.id == null || target?.id === "" ? "" : String(target.id).trim();
  if (!licenseKey) throw new Error("删除后校验缺少授权码");
  const res = await window.adminAPI.queryOnlineLicense({ licenseKey, limit: 100 });
  if (!res?.ok) throw new Error(String(res?.error || "授权删除后刷新失败"));
  const records = res?.result?.records || [];
  const stillExists = id
    ? records.some((item) => String(item?.id || "") === id)
    : records.some((item) => String(item?.license_key || "").trim() === licenseKey);
  if (stillExists) {
    throw new Error("删除请求已返回成功，但刷新后仍能看到该授权记录；请检查 Supabase Service Role 权限。");
  }
}

async function deleteOnlineLicense(record) {
  const licenseKey = String(record?.license_key || $("onlineLicenseKey")?.value || "").trim();
  const id = record?.id == null ? "" : String(record.id);
  if (!licenseKey) {
    alert("请先选择或填写要删除的授权码");
    return;
  }

  const scopeText = id
    ? `将删除该条授权记录：ID ${id}`
    : "将按 license_key 删除匹配记录；如果历史数据存在同名授权码，会一起删除。";
  const confirmed = await confirmByTyping({
    title: "删除授权码",
    hint: licenseKey,
    warning: scopeText + " 不可恢复。",
    label: "输入授权码确认",
    expected: licenseKey
  });
  if (!confirmed) return;

  setOnlineStatus("删除中...");
  const res = await window.adminAPI.deleteOnlineLicense({ id, licenseKey });
  if (!res?.ok) {
    setOnlineStatus("删除失败");
    alert(`删除授权失败：${String(res?.error || "unknown")}`);
    return;
  }
  const deletedCount = Number(res?.result?.deletedCount || 0);
  if (deletedCount <= 0) {
    setOnlineStatus("删除失败");
    alert("删除授权失败：Supabase 没有返回已删除记录");
    return;
  }
  try {
    await verifyDeletedLicenseGone({ id, licenseKey });
  } catch (err) {
    setOnlineStatus("删除校验失败");
    alert(`删除授权校验失败：${String(err?.message || err)}`);
    return;
  }
  $("onlineResult").textContent = formatOnlineRecord({
    deletedCount,
    records: res?.result?.records || []
  });
  if (String($("onlineLicenseKey")?.value || "").trim() === licenseKey) {
    $("onlineLicenseKey").value = "";
  }
  setOnlineStatus(`已删除 ${deletedCount} 条授权记录`);
  await refreshOnlineList({ silent: true });
  toast("授权记录已删除");
}

async function copyToClipboard(text, okMsg) {
  const s = String(text || "");
  if (!s.trim()) {
    alert("没有可复制的内容");
    return false;
  }
  try {
    await navigator.clipboard.writeText(s);
    toast(okMsg || "已复制");
    return true;
  } catch {
    alert(s);
    return false;
  }
}

async function refresh() {
  const pubPath = $("pubPath").value;
  const privPath = $("privPath").value;
  const res = await window.adminAPI.getStatus({ publicKeyPath: pubPath, privateKeyPath: privPath });
  if (!res?.ok) {
    signingKeyStatusText = "状态读取失败";
    $("statusText").textContent = signingKeyStatusText;
    $("fingerprint").textContent = "-";
    $("pubPreview").textContent = "-";
    return;
  }
  const st = res.status;
  const ok = st.pubExists && st.privExists;
  signingKeyStatusText = ok ? "密钥已存在" : st.pubExists || st.privExists ? "密钥不完整" : "未生成密钥";
  $("statusText").textContent = signingKeyStatusText;
  $("fingerprint").textContent = st.pubFingerprint || "-";
  $("pubPreview").textContent = st.pubPreview || "-";
  setGlobalStatus(ok ? "密钥正常" : "密钥未就绪");
}

async function issueLicense() {
  const priv = $("privPath").value;
  const machineId = $("issueMachineId").value.trim();
  const licenseKey = $("issueLicenseKey").value.trim();
  const expiresAt = $("issueExpiresAt").value.trim();
  const featuresText = $("issueFeatures").value.trim();
  const outPath = $("issueOutPath").value.trim();
  const syncOnline = Boolean($("issueSyncOnline")?.checked);

  if (!machineId) {
    alert("请先填写机器码");
    return;
  }
  if (!outPath) {
    alert("请先选择输出文件路径");
    return;
  }

  const res = await window.adminAPI.issueLicense({
    machineId,
    licenseKey,
    privateKeyPath: priv,
    expiresAt: expiresAt || "",
    featuresText: featuresText || "",
    outPath,
    syncOnline,
    remoteExpireAt: expiresAt || ""
  });
  if (!res?.ok) {
    $("issueResult").textContent = "失败";
    alert(`签发失败：${String(res?.error || "unknown")}`);
    return;
  }
  const p = res?.result?.outPath;
  const t = res?.result?.licenseText;
  const generatedLicenseKey = res?.result?.payload?.licenseKey;
  const onlineResult = res?.result?.online;
  const onlineRecord = res?.result?.online?.record;
  if (typeof t === "string") $("issueLicenseText").value = t;
  if (generatedLicenseKey) $("issueLicenseKey").value = String(generatedLicenseKey);
  if (generatedLicenseKey) $("onlineLicenseKey").value = String(generatedLicenseKey);
  if (machineId) $("onlineMachineId").value = machineId;
  if (expiresAt) $("onlineExpireAt").value = expiresAt;
  if (featuresText) $("onlinePermissions").value = featuresText;
  if (onlineRecord) {
    $("onlineResult").textContent = formatOnlineRecord(onlineRecord);
    fillOnlineFormFromRecord(onlineRecord);
  }
  if (syncOnline && onlineResult && onlineResult.ok === false) {
    $("issueResult").textContent = `已生成：${safePathText(p)} | license_key: ${String(generatedLicenseKey || "-")} | 线上同步失败`;
    $("onlineResult").textContent = `线上同步失败：${String(onlineResult.error || "unknown")}`;
    toast("授权文件已生成，线上同步失败");
    return;
  }
  // Put it in the list. Issuing with 在线同步 writes the record and then said
  // "已同步线上" while the 授权列表 tab still showed what it had loaded
  // earlier - usually 暂无记录 - so a licence that had just been created
  // looked as though it had not been.
  if (syncOnline) await refreshOnlineList({ silent: true });

  $("issueResult").textContent = `已生成：${safePathText(p)} | license_key: ${String(generatedLicenseKey || "-")}${syncOnline ? " | 已同步线上" : ""}`;
  toast(syncOnline ? "已生成并同步线上授权" : "已生成授权文件");
}

async function verifyLicense() {
  const pub = $("pubPath").value;
  const licensePath = $("verifyLicensePath").value.trim();
  const machineId = $("verifyMachineId").value.trim();
  if (!licensePath) {
    alert("请先选择或拖入授权文件");
    return;
  }
  const res = await window.adminAPI.verifyLicense({
    licensePath,
    publicKeyPath: pub,
    machineId: machineId || ""
  });
  if (!res?.ok) {
    $("verifyResult").textContent = "失败";
    alert(`校验失败：${String(res?.error || "unknown")}`);
    return;
  }
  const r = res?.result;
  $("verifyResult").textContent = r?.ok ? "OK" : String(r?.code || "NOT_OK");
  toast(r?.ok ? "校验通过" : "校验不通过");
}

async function init() {
  const def = await window.adminAPI.getDefaultPaths();
  $("pubPath").value = def.publicKeyPath || "";
  $("privPath").value = def.privateKeyPath || "";
  $("issueOutPath").value = def.defaultLicenseOutPath || "";
  await refresh();
  const onlineConfig = await loadOnlineConfig();
  if (onlineConfig?.hasSecretKey) await refreshOnlineList({ silent: true });
  const bundledKeyMode = def.mode === "bundled";
  if (bundledKeyMode) {
    $("generate").disabled = true;
    $("delete").disabled = true;
    $("generate").title = "Bundled keys are read-only in the packaged NovaFlow 后台管理.";
    $("delete").title = "Bundled keys are read-only in the packaged NovaFlow 后台管理.";
  }

  $("userSearchInput").addEventListener("input", () => {
    renderUsers(
      userManagementState.usersResult || { records: [] },
      userManagementState.creditsResult || { records: [] }
    );
  });
  $("createAdminUser").addEventListener("click", async () => {
    await createAdminUser();
  });
  $("memberAdjustMode")?.addEventListener("change", () => renderMemberAdjust({ prefill: false }));
  document.querySelectorAll("[data-activity-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardActivityTab = button.getAttribute("data-activity-tab") === "tasks" ? "tasks" : "ledger";
      renderDashboardRecentActivity();
    });
  });
  $("dashboardActivityViewAll")?.addEventListener("click", () => openActivityDestination());
  $("dashboardRhRefresh")?.addEventListener("click", () => { void refreshDomesticBalance(); });
  $("memberAdjustSubmit")?.addEventListener("click", () => { void submitMemberAdjust(); });
  $("memberAdjustValue")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitMemberAdjust();
    }
  });
  $("computeMintCode")?.addEventListener("click", () => { void mintComputeCode(); });
  $("computePurgeCodes")?.addEventListener("click", () => { void purgeComputeCodes(); });
  $("computePurgeUsage")?.addEventListener("click", () => { void purgeComputeUsage(); });
  $("saveRunninghubRuntimeConfig").addEventListener("click", async () => {
    await saveProviderRuntimeConfig("runninghub");
  });
  $("checkRunninghubProvider").addEventListener("click", checkRunningHubProvider);
  $("refreshDomesticBalance")?.addEventListener("click", () => { void refreshDomesticBalance(); });
  $("saveFeatureCredits")?.addEventListener("click", () => { void saveFeatureCreditForm(); });
  $("queryCreditLedger")?.addEventListener("click", () => { void queryLedger(false); });
  $("exportCreditLedger")?.addEventListener("click", () => { void queryLedger(true); });
  $("runQuotaMigration")?.addEventListener("click", () => { void runQuotaMigration(); });
  setInterval(() => {
    if (!document.getElementById("module-ai-services")?.classList.contains("active")) return;
    void checkRunningHubProvider();
  }, 5 * 60 * 1000);

  $("pickPub").addEventListener("click", async () => {
    const res = await window.adminAPI.pickPublicPath({ defaultPath: $("pubPath").value });
    if (res?.canceled) return;
    if (res?.filePath) $("pubPath").value = res.filePath;
    await refresh();
  });

  $("pickPriv").addEventListener("click", async () => {
    const res = await window.adminAPI.pickPrivatePath({ defaultPath: $("privPath").value });
    if (res?.canceled) return;
    if (res?.filePath) $("privPath").value = res.filePath;
    await refresh();
  });

  $("refresh").addEventListener("click", async () => {
    await refresh();
    toast("已刷新");
  });

  $("saveOnlineConfig").addEventListener("click", async () => {
    await saveOnlineConfig();
  });

  $("testOnlineConfig").addEventListener("click", async () => {
    await testOnlineConfig();
  });

  $("refreshOnlineList").addEventListener("click", async () => {
    await refreshOnlineList();
  });

  $("queryOnlineLicense").addEventListener("click", async () => {
    await queryOnlineLicense();
  });

  $("upsertOnlineLicense").addEventListener("click", async () => {
    await upsertOnlineLicense();
  });

  $("activateOnlineLicense").addEventListener("click", async () => {
    await setOnlineLicenseStatus("active");
  });

  $("expireOnlineLicense").addEventListener("click", async () => {
    const confirmed = confirm("确定把该授权设为过期吗？\n用户重启 NovaFlow 后会被锁定。");
    if (!confirmed) return;
    await setOnlineLicenseStatus("expired");
  });

  $("openFolder").addEventListener("click", async () => {
    const p = $("privPath").value || $("pubPath").value;
    if (!p) return;
    await window.adminAPI.openFolder({ path: p });
  });

  $("copyPubKey").addEventListener("click", async () => {
    const pubPath = $("pubPath").value;
    const res = await window.adminAPI.readPublicKey({ publicKeyPath: pubPath });
    if (!res?.ok) {
      alert(`读取公钥失败：${String(res?.error || "unknown")}`);
      return;
    }
    await copyToClipboard(res?.text, "已复制公钥");
  });

  $("copyPrivKey").addEventListener("click", async () => {
    const confirmed = confirm("确定复制私钥吗？\n私钥只能保存在管理员电脑，泄露会导致任何人都能签发授权。");
    if (!confirmed) return;
    const privPath = $("privPath").value;
    const res = await window.adminAPI.readPrivateKey({ privateKeyPath: privPath });
    if (!res?.ok) {
      alert(`读取私钥失败：${String(res?.error || "unknown")}`);
      return;
    }
    await copyToClipboard(res?.text, "已复制私钥");
  });

  $("generate").addEventListener("click", async () => {
    if (bundledKeyMode) {
      alert("打包版内置密钥只读，不能在这里重新生成。请直接签发授权文件。");
      return;
    }
    const pub = $("pubPath").value;
    const priv = $("privPath").value;
    const confirmed = confirm("确定生成新的密钥对吗？\n如果你替换了旧密钥，旧授权文件将全部失效。");
    if (!confirmed) return;
    const res = await window.adminAPI.generate({ publicKeyPath: pub, privateKeyPath: priv });
    if (!res?.ok) {
      alert(`生成失败：${String(res?.error || "unknown")}`);
      return;
    }
    await refresh();
    toast(`已生成，指纹：${String(res?.result?.pubFingerprint || "")}`);
  });

  $("delete").addEventListener("click", async () => {
    if (bundledKeyMode) {
      alert("打包版内置密钥只读，不能在这里删除。");
      return;
    }
    const pub = $("pubPath").value;
    const priv = $("privPath").value;
    const confirmed = confirm("确定删除密钥文件吗？\n删除后无法再签发/校验已有授权（除非你有备份）。");
    if (!confirmed) return;
    const res = await window.adminAPI.deleteKeys({ publicKeyPath: pub, privateKeyPath: priv });
    if (!res?.ok) {
      alert(`删除失败：${String(res?.error || "unknown")}`);
      return;
    }
    await refresh();
    toast("已删除");
  });

  $("pickIssueOut").addEventListener("click", async () => {
    const res = await window.adminAPI.pickLicenseOutPath({ defaultPath: $("issueOutPath").value });
    if (res?.canceled) return;
    if (res?.filePath) $("issueOutPath").value = res.filePath;
  });

  $("issue").addEventListener("click", async () => {
    await issueLicense();
  });

  $("copyIssueText").addEventListener("click", async () => {
    await copyToClipboard($("issueLicenseText").value, "已复制授权码");
  });

  $("pickVerifyIn").addEventListener("click", async () => {
    const res = await window.adminAPI.pickLicenseInPath();
    if (res?.canceled) return;
    if (res?.filePath) $("verifyLicensePath").value = res.filePath;
  });

  $("verify").addEventListener("click", async () => {
    await verifyLicense();
  });

  $("passwordEditClose").addEventListener("click", closePasswordEditDialog);
  $("passwordEditCancel").addEventListener("click", closePasswordEditDialog);
  $("passwordEditSubmit").addEventListener("click", async () => {
    await submitPasswordEditDialog();
  });
  ["passwordEditValue", "passwordEditConfirmValue"].forEach((id) => {
    $(id).addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await submitPasswordEditDialog();
      }
    });
  });
  $("passwordEditDialog").addEventListener("click", (event) => {
    if (event.target === $("passwordEditDialog")) closePasswordEditDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("passwordEditDialog").hidden) closePasswordEditDialog();
    else if (!$("creditLedgerDialog").hidden) closeDataDialog("creditLedgerDialog");
    else if (!$("memberAdjustDialog").hidden) closeDataDialog("memberAdjustDialog");
    else closeOpenDrawers();
  });

  $("openCreditLedger").addEventListener("click", () => openUserLedger());
  document.querySelectorAll("[data-dialog-close]").forEach((button) => {
    button.addEventListener("click", () => closeDataDialog(button.dataset.dialogClose));
  });
  for (const id of ["creditLedgerDialog", "memberAdjustDialog"]) {
    $(id).addEventListener("click", (event) => { if (event.target === $(id)) closeDataDialog(id); });
    $(id).addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const fields = [...$(id).querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
      const first = fields[0], last = fields[fields.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement.getAttribute("role") === "dialog")) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    });
  }

  document.querySelectorAll("[data-drawer-open]").forEach((el) => {
    el.addEventListener("click", () => openDrawer(el.getAttribute("data-drawer-open") || ""));
  });
  document.querySelectorAll("[data-drawer-close]").forEach((el) => {
    el.addEventListener("click", () => closeDrawer(el.closest(".drawerOverlay")));
  });
  document.querySelectorAll(".drawerOverlay").forEach((overlay) => {
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) closeDrawer(overlay);
    });
  });

  // Dashboard shortcuts: jump to a module, optionally straight into one of
  // its tabs or create drawers.
  document.querySelectorAll("[data-module-link]").forEach((el) => {
    el.addEventListener("click", () => {
      showModule(el.getAttribute("data-module-link") || "dashboard");
      const tab = el.getAttribute("data-tab-after");
      if (tab) showTab(tab);
      const drawer = el.getAttribute("data-drawer-after");
      if (drawer) openDrawer(drawer);
    });
  });

  $("globalRefresh")?.addEventListener("click", async () => {
    const button = $("globalRefresh");
    button.disabled = true;
    try {
      await loadAdminData();
      if (document.querySelector('.moduleNavButton.active[data-module="compute"]')) await loadComputeData();
      await refreshOnlineList({ silent: true });
      toast("已刷新");
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll(".tab[data-tab]").forEach((el) => {
    el.addEventListener("click", () => showTab(el.getAttribute("data-tab") || "online"));
  });

  document.querySelectorAll(".moduleNavButton").forEach((el) => {
    el.addEventListener("click", () => showModule(el.getAttribute("data-module") || "dashboard"));
  });

  const dz = $("dropZone");
  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  dz.addEventListener("dragenter", (e) => {
    stop(e);
    dz.classList.add("drag");
  });
  dz.addEventListener("dragover", (e) => {
    stop(e);
    dz.classList.add("drag");
  });
  dz.addEventListener("dragleave", (e) => {
    stop(e);
    dz.classList.remove("drag");
  });
  dz.addEventListener("drop", async (e) => {
    stop(e);
    dz.classList.remove("drag");
    const f = e.dataTransfer?.files?.[0];
    const p = f?.path;
    if (p) {
      $("verifyLicensePath").value = p;
      await verifyLicense();
    }
  });
  await loadAdminData();
}

const FEATURE_PRICE_FIELDS = [
  ["xiaotao_vision", "小桃在线理解"],
  ["online_chat_turn", "在线对话"],
  ["prompt_optimize", "提示词优化"],
  ["image_reverse", "图像反推"],
  ["lean_research", "UI 目录分析"],
  ["gpt_image_2_5_economy", "GPT Image 2.5 图生图 / 张"],
  ["gpt_image_2_official", "GPT Image 2 官方 / 张"],
  ["grok_image_g42", "g-4.2 / 张"],
  ["local", "本地"]
];

const TOKEN_ESTIMATE_RESOLUTIONS = ["1k", "2k", "4k"];
const TOKEN_ESTIMATE_QUALITIES = ["low", "medium", "high"];

function renderTokenEstimateFields(table) {
  const host = $("tokenEstimateCredits");
  if (!host) return;
  host.innerHTML = "";
  for (const resolution of TOKEN_ESTIMATE_RESOLUTIONS) {
    for (const quality of TOKEN_ESTIMATE_QUALITIES) {
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("div");
      name.className = "label";
      name.textContent = `文生图预估 ${resolution} / ${quality}`;
      const field = document.createElement("div");
      field.className = "field";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.dataset.tokenEstimate = `${resolution}:${quality}`;
      const value = table && table[resolution] ? table[resolution][quality] : "";
      input.value = value == null ? "" : String(value);
      field.appendChild(input);
      row.append(name, field);
      host.appendChild(row);
    }
  }
}

function setIfIdle(id, value) {
  const node = $(id);
  if (!node || document.activeElement === node) return;
  node.value = value == null ? "" : String(value);
}

function renderFeaturePriceFields(prices) {
  const host = $("featureCreditPrices");
  if (!host) return;
  host.innerHTML = "";
  for (const [key, label] of FEATURE_PRICE_FIELDS) {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("div");
    name.className = "label";
    name.textContent = label;
    const field = document.createElement("div");
    field.className = "field";
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.dataset.featurePrice = key;
    input.value = prices && prices[key] != null ? String(prices[key]) : "";
    if (key === "local") input.readOnly = true;
    field.appendChild(input);
    row.append(name, field);
    host.appendChild(row);
  }
}

async function renderFeatureCreditAdmin() {
  const status = $("featureCreditStatus");
  if (!$("featureCreditPanel") || typeof window.adminAPI?.getFeatureCreditAdmin !== "function") return;
  try {
    const response = await window.adminAPI.getFeatureCreditAdmin();
    const result = response?.ok === false ? null : (response?.result || response);
    const config = result?.config || {};
    const prices = config.prices || {
      xiaotao_vision: 4, online_chat_turn: 4, prompt_optimize: 4, image_reverse: 4,
      lean_research: 14, gpt_image_2_5_economy: 20, gpt_image_2_official: 4, grok_image_g42: 6, local: 0
    };
    renderFeaturePriceFields(prices);
    const token = config.token_billing || {};
    const routes = config.gpt_image || {};
    renderTokenEstimateFields(token.estimate_credits || {});
    setIfIdle("featureCreditPerUsd", config.credits_per_usd ?? 211);
    setIfIdle("featureCreditMarkup", token.markup ?? 2);
    setIfIdle("featureCreditSettleCap", token.settle_cap_credits ?? 40);
    setIfIdle("featureCreditTextEndpoint", routes.text_endpoint || "");
    setIfIdle("featureCreditImageEndpoint", routes.image_endpoint || "");
    setIfIdle("featureCreditFallbackTextEndpoint", routes.fallback_text_endpoint || "");
    setIfIdle("featureCreditFallbackImageEndpoint", routes.fallback_image_endpoint || "");
    setIfIdle("featureCreditTextModel", routes.text_model || "");
    setIfIdle("featureCreditImageModel", routes.image_model || "");
    setIfIdle("featureCreditOfficialModel", routes.official_model || "");
    setIfIdle("featureCreditTokenMarkers", Array.isArray(routes.token_markers) ? routes.token_markers.join(",") : "");
    if ($("featureCreditLowBalance") && document.activeElement !== $("featureCreditLowBalance")) {
      $("featureCreditLowBalance").value = config.low_balance_usd ?? 2;
    }
    if ($("featureCreditLowBalanceCny") && document.activeElement !== $("featureCreditLowBalanceCny")) {
      $("featureCreditLowBalanceCny").value = config.low_balance_cny ?? 15;
    }
    if ($("featureCreditBalanceTtl") && document.activeElement !== $("featureCreditBalanceTtl")) {
      $("featureCreditBalanceTtl").value = String(Math.max(1, Math.round(Number(config.balance_ttl_seconds || 600) / 60)));
    }
    if ($("featureCreditStalePolicy") && document.activeElement !== $("featureCreditStalePolicy")) {
      $("featureCreditStalePolicy").value = config.stale_balance_policy === "block" ? "block" : "allow";
    }
    if ($("featureCreditCny") && document.activeElement !== $("featureCreditCny")) {
      $("featureCreditCny").value = config.credits_to_cny == null ? "" : String(config.credits_to_cny);
    }
    const balance = result?.domesticBalance || {};
    const low = result?.lowBalance || {};
    const currency = String(balance.currency || "").toUpperCase();
    const usd = balance.remainMoney == null || balance.remainMoney === "" || (currency && currency !== "USD")
      ? null
      : formatUsdAmount(balance.remainMoney);
    const money = usd ? `${usd} USD` : (balance.remainMoney == null || balance.remainMoney === "" ? "未检测" : "—");
    const cost = result?.estimatedRhCostUsd == null ? "暂无" : `${formatUsdAmount(result.estimatedRhCostUsd) || result.estimatedRhCostUsd} USD`;
    renderSettingRows("featureCreditOpsRows", [
      { label: "国内站余额", value: money },
      { label: "流水估算 RH 成本", value: cost },
      { label: "低余额阈值", value: `${config.low_balance_usd ?? 2} USD` },
      { label: "上次检测", value: balance.checkedAt ? formatDateTime(balance.checkedAt) : "尚未检测" },
      { label: "缓存", value: low.stale ? "缓存已过期" : "有效" }
    ], "尚未检测");
    const warning = $("rhLowBalanceWarning");
    const warningText = $("rhLowBalanceWarningText");
    const warningTitle = warning?.querySelector(".tipTitle");
    const moneyNumber = usd ? Number(balance.remainMoney) : null;
    const tone = low.stale ? "stale" : moneyNumber != null && moneyNumber < 2 ? "danger" : moneyNumber != null && moneyNumber < 5 ? "warning" : (low.blocked ? "danger" : "ok");
    if (warning) {
      warning.hidden = tone === "ok";
      warning.classList.toggle("danger", tone === "danger");
      warning.classList.toggle("warning", tone === "warning" || tone === "stale");
    }
    if (warningTitle) {
      warningTitle.textContent = tone === "warning" ? "国内站余额接近阈值" : tone === "stale" ? "国内站余额缓存已过期" : "国内站余额低于阈值";
    }
    if (warningText) {
      warningText.textContent = tone === "warning"
        ? `当前 ${usd} USD，低于 5 USD 警告线，暂不阻断新的云任务。`
        : tone === "stale"
          ? (low.blocked
            ? "缓存已过期，已阻断新云任务。不扣积分，本地任务不受影响。"
            : "缓存已过期。当前策略是放行并告警，不阻断新的云任务。")
          : `当前 ${usd || "—"} USD，低于 2 USD。新的云任务会拒绝，不扣积分，本地任务不受影响。`;
    }
    renderDashboardRhCard(result?.error ? { state: "error", message: "余额读取失败" } : { state: "ready", domesticBalance: balance, lowBalance: low });
    if (status) status.textContent = result?.error ? "余额读取失败" : "已读取";
  } catch (err) {
    if (status) status.textContent = "余额读取失败";
    renderDashboardRhCard({ state: "error", message: "余额读取失败" });
  }
}

async function saveFeatureCreditForm() {
  const status = $("featureCreditStatus");
  const prices = {};
  document.querySelectorAll("[data-feature-price]").forEach((input) => {
    prices[input.dataset.featurePrice] = input.value;
  });
  const estimate = {};
  document.querySelectorAll("[data-token-estimate]").forEach((input) => {
    const [resolution, quality] = String(input.dataset.tokenEstimate || "").split(":");
    if (!resolution || !quality) return;
    estimate[resolution] = estimate[resolution] || {};
    estimate[resolution][quality] = input.value;
  });
  try {
    const response = await window.adminAPI.saveFeatureCreditAdmin({
      prices,
      credits_to_cny: $("featureCreditCny")?.value ?? "",
      low_balance_usd: $("featureCreditLowBalance")?.value ?? "",
      low_balance_cny: $("featureCreditLowBalanceCny")?.value ?? "",
      balance_ttl_seconds: Math.round(Number($("featureCreditBalanceTtl")?.value || 10) * 60),
      stale_balance_policy: $("featureCreditStalePolicy")?.value || "allow",
      credits_per_usd: $("featureCreditPerUsd")?.value ?? "",
      token_billing: {
        markup: $("featureCreditMarkup")?.value ?? "",
        settle_cap_credits: $("featureCreditSettleCap")?.value ?? "",
        estimate_credits: estimate
      },
      gpt_image: {
        text_endpoint: $("featureCreditTextEndpoint")?.value ?? "",
        image_endpoint: $("featureCreditImageEndpoint")?.value ?? "",
        fallback_text_endpoint: $("featureCreditFallbackTextEndpoint")?.value ?? "",
        fallback_image_endpoint: $("featureCreditFallbackImageEndpoint")?.value ?? "",
        text_model: $("featureCreditTextModel")?.value ?? "",
        image_model: $("featureCreditImageModel")?.value ?? "",
        official_model: $("featureCreditOfficialModel")?.value ?? "",
        token_markers: String($("featureCreditTokenMarkers")?.value || "").split(",").map((item) => item.trim()).filter(Boolean)
      }
    });
    if (!response?.ok) throw new Error(response?.error || "保存失败");
    if (status) status.textContent = "已保存";
    await renderFeatureCreditAdmin();
  } catch (err) {
    if (status) status.textContent = String(err?.message || err);
  }
}

function ledgerQueryPayload() {
  return {
    user: $("ledgerUser")?.value || "",
    feature: $("ledgerFeature")?.value || "",
    status: $("ledgerStatus")?.value || "",
    from: $("ledgerFrom")?.value || "",
    to: $("ledgerTo")?.value || ""
  };
}

let ledgerQuerySequence = 0;
function showLedgerMessage(message) {
  const row = document.createElement("tr");
  const cell = textCell(message);
  cell.colSpan = 7;
  row.appendChild(cell);
  $("creditLedgerBody").replaceChildren(row);
}

async function queryLedger(download) {
  const sequence = ++ledgerQuerySequence;
  const payload = ledgerQueryPayload();
  setText("creditLedgerTarget", payload.user ? `用户：${payload.user}` : "全部用户");
  showLedgerMessage("读取中...");
  const status = $("ledgerStatusText");
  if (status) status.textContent = "读取中...";
  try {
    const response = await window.adminAPI.queryCreditLedger(payload);
    if (sequence !== ledgerQuerySequence) return;
    if (!response?.ok) throw new Error(response?.error || "查询失败");
    const result = response.result || {};
    const records = result.records || [];
    const body = $("creditLedgerBody");
    if (body) {
      body.innerHTML = "";
      if (!records.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 7;
        td.textContent = "没有匹配的流水";
        tr.appendChild(td);
        body.appendChild(tr);
      } else {
        for (const row of records) {
          const tr = document.createElement("tr");
          const stamp = activityStamp(row.created_at);
          const time = document.createElement("td");
          time.textContent = stamp.text;
          time.title = stamp.title;
          tr.appendChild(time);
          tr.appendChild(Object.assign(document.createElement("td"), { textContent: row.user_email_or_account || "" }));
          const featureCell = document.createElement("td");
          featureCell.textContent = row.feature || "";
          const details = row.pricing_details && typeof row.pricing_details === "object" ? row.pricing_details : {};
          const tokens = details.token_usage && typeof details.token_usage === "object" ? details.token_usage : null;
          const hint = [
            row.pricing_source || details.pricing_source || "",
            details.third_party_consume_money != null && details.third_party_consume_money !== "" ? `USD ${details.third_party_consume_money}` : "",
            tokens && tokens.total_tokens != null ? `tokens ${tokens.total_tokens}` : "",
            details.capped || details.settle_capped ? "已封顶" : "",
            details.usage_missing ? "缺少费用，按预估扣" : ""
          ].filter(Boolean).join(" · ");
          if (hint) featureCell.title = hint;
          tr.appendChild(featureCell);
          tr.appendChild(Object.assign(document.createElement("td"), { textContent: row.model || "" }));
          const statusCell = document.createElement("td");
          statusCell.appendChild(ledgerStatusBadge(row.status));
          tr.appendChild(statusCell);
          const credit = document.createElement("td");
          credit.className = "num";
          credit.appendChild(ledgerCreditNode(row));
          tr.appendChild(credit);
          const cost = document.createElement("td");
          cost.className = "num";
          cost.textContent = row.rh_cost_usd == null || row.rh_cost_usd === "" ? "" : (formatUsdAmount(row.rh_cost_usd) || "");
          tr.appendChild(cost);
          body.appendChild(tr);
        }
      }
    }
    if (status) status.textContent = download ? `已导出 ${records.length} 笔` : `${records.length} 笔`;
    if (download && result.csv) {
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "credit-ledger.csv";
      link.click();
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    if (sequence !== ledgerQuerySequence) return;
    showLedgerMessage("流水读取失败，请重试");
    if (status) status.textContent = String(err?.message || err);
  }
}

async function runQuotaMigration() {
  const status = $("quotaMigrationStatus");
  const batchId = String($("quotaMigrationBatch")?.value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(batchId)) {
    if (status) status.textContent = "批次号只能包含字母、数字、下划线和短横线";
    return;
  }
  if (!confirm(`把旧的剩余次数按理解单价向上取整迁入积分？\n批次 ${batchId}。失败会整批回滚。`)) return;
  try {
    const response = await window.adminAPI.migrateGrokQuotaToCredits({
      batchId,
      price: $("quotaMigrationPrice")?.value || null
    });
    if (!response?.ok) throw new Error(response?.error || "迁移失败");
    const result = response.result || {};
    if (status) status.textContent = `${result.status || "完成"} · 入账 ${result.credits_added ?? ""}`;
  } catch (err) {
    if (status) status.textContent = String(err?.message || err);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => alert(String(e?.message || e)));
});
