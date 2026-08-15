function $(id) {
  return document.getElementById(id);
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
let creditAdjustState = {
  users: [],
  credits: [],
  writable: false
};
let grokQuotaState = {
  providerKey: "grok",
  users: [],
  quotas: [],
  writable: false
};
let userManagementState = {
  usersResult: null,
  creditsResult: null,
  grokQuotasResult: null,
  providerQuotaResultsByKey: {},
  users: [],
  credits: [],
  grokQuotas: [],
  writable: false,
  createWritable: false,
  deleteWritable: false
};
let passwordEditState = {
  userId: "",
  accountLabel: ""
};

const PROVIDER_QUOTA_OPTIONS = [
  { key: "grok", label: "提示词服务", shortLabel: "提示词服务" }
];

const USER_STATUS_OPTIONS = [
  ["active", "active"],
  ["disabled", "disabled"]
];

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
  document.querySelectorAll(".tab").forEach((el) => {
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
  if (["dashboard", "ai-services"].includes(name)) {
    void loadAdminData();
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
    el.textContent = result.source === "disabled" ? "暂无日志" : "mock 数据";
    el.classList.add(result.source === "disabled" ? "sourceMock" : "sourceMock");
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
    setGlobalStatus("● Mock", "sourceMock", { force: true });
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

function creditBalanceByUserId(credits, userId) {
  const record = (credits || []).find((item) => String(item.user_id || "") === String(userId || ""));
  const n = Number(record?.balance || 0);
  return Number.isFinite(n) ? n : 0;
}

function grokQuotaTextByUserId(quotas, userId) {
  const record = (quotas || []).find((item) => String(item.user_id || "") === String(userId || ""));
  if (!record) return "0 / 0";
  return `${formatNumber(record.remaining_count || 0)} / ${formatNumber(record.allocated_count || 0)}`;
}

function normalizeProviderQuotaKey(value) {
  const key = String(value || "grok").trim().toLowerCase();
  return PROVIDER_QUOTA_OPTIONS.some((item) => item.key === key) ? key : "grok";
}

function providerQuotaLabel(providerKey) {
  const key = normalizeProviderQuotaKey(providerKey);
  return PROVIDER_QUOTA_OPTIONS.find((item) => item.key === key)?.label || key;
}

function normalizeUserStatusValue(value) {
  const s = String(value || "active").trim().toLowerCase();
  return USER_STATUS_OPTIONS.some(([key]) => key === s) ? s : "active";
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
    select.appendChild(option);
  });
  select.value = value;
  return select;
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

function findUserBySearch(users, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  const list = Array.isArray(users) ? users : [];
  return list.find((user) => searchableUserText(user).some((value) => value === q)) ||
    list.find((user) => searchableUserText(user).some((value) => value.includes(q)));
}

function selectUserFromSearch(inputId, selectId, users, onSelected) {
  const input = $(inputId);
  const select = $(selectId);
  const query = String(input?.value || "").trim();
  if (!input || !select) return;
  if (!query) {
    alert("请输入用户名");
    input.focus();
    return;
  }
  const user = findUserBySearch(users, query);
  if (!user?.id) {
    alert("未找到匹配用户");
    input.select();
    return;
  }
  const userId = String(user.id);
  const hasOption = Array.from(select.options || []).some((option) => String(option.value) === userId);
  if (!hasOption) {
    alert("当前下拉列表中没有该用户");
    return;
  }
  select.value = userId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  input.value = userAccountLabel(user) || user.display_name || userId;
  if (typeof onSelected === "function") onSelected();
  toast("已选中用户");
}

function selectCreditAdjustUserFromSearch() {
  selectUserFromSearch(
    "creditUserSearchInput",
    "creditAdjustUser",
    creditAdjustState.users,
    updateCreditAdjustCurrentBalance
  );
}

function selectGrokQuotaUserFromSearch() {
  selectUserFromSearch(
    "grokQuotaUserSearchInput",
    "grokQuotaUser",
    grokQuotaState.users,
    updateGrokQuotaCurrent
  );
}

function updateCreditAdjustCurrentBalance() {
  const select = $("creditAdjustUser");
  const label = $("creditAdjustCurrentBalance");
  if (!select || !label) return;
  const userId = select.value;
  if (!userId) {
    label.textContent = "当前积分：-";
    return;
  }
  label.textContent = `当前积分：${formatCreditAmount(creditBalanceByUserId(creditAdjustState.credits, userId))}`;
}

function updateGrokQuotaCurrent() {
  const providerSelect = $("providerQuotaKey");
  const select = $("grokQuotaUser");
  const input = $("grokQuotaAllocated");
  const label = $("grokQuotaCurrent");
  const note = $("grokQuotaNote");
  const saveButton = $("saveGrokQuota");
  if (!select || !input || !label) return;
  const providerKey = normalizeProviderQuotaKey(providerSelect?.value || grokQuotaState.providerKey);
  if (providerSelect && providerSelect.value !== providerKey) providerSelect.value = providerKey;
  if (saveButton) saveButton.textContent = `保存 ${providerQuotaLabel(providerKey)} 次数`;
  const userId = select.value;
  const quota = (grokQuotaState.quotas || []).find((item) => String(item.user_id || "") === String(userId || ""));
  if (!userId || !quota) {
    label.textContent = "当前：-";
    input.value = "";
    if (note) note.value = "";
    return;
  }
  input.value = String(Number(quota.allocated_count || 0));
  if (note) note.value = String(quota.note || "");
  label.textContent = `已用 ${formatNumber(quota.used_count || 0)} / 剩余 ${formatNumber(quota.remaining_count || 0)}`;
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

async function loadAdminProviderQuotaDataset(providerKey) {
  const key = normalizeProviderQuotaKey(providerKey);
  const api = window.adminAPI?.getAdminProviderQuotas;
  const legacyApi = window.adminAPI?.getAdminGrokProviderQuotas;
  const res = typeof api === "function"
    ? await api(key)
    : key === "grok" && typeof legacyApi === "function" ? await legacyApi() : null;
  if (!res?.ok) {
    return {
      providerKey: key,
      source: "supabase",
      status: "error",
      configured: true,
      records: [],
      error: `Supabase Error: ${String(res?.error || "admin_provider_quota_api_missing")}`,
      durationMs: 0
    };
  }
  return {
    providerKey: key,
    ...(res.result || { source: "mock", records: [] })
  };
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
      error: `ComfyUI Error: ${String(res?.error || "unknown")}`
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

function providerBudgetBalanceFromSettings(settingsResult, providerKey = "comfyui") {
  const setting = findSettingRecord(settingsResult, `provider_budget_${String(providerKey || "").toLowerCase()}`);
  const value = setting?.value && typeof setting.value === "object" ? setting.value : {};
  const balance = Number(value.balance ?? value.value);
  return Number.isFinite(balance) ? balance : null;
}

function renderUsers(usersResult, creditsResult, grokQuotasResult) {
  const updateWritable = userManagementWritable(usersResult);
  const createWritable = updateWritable && userManagementWritable(creditsResult);
  const providerQuotaResultsByKey = grokQuotasResult?.records
    ? { grok: grokQuotasResult }
    : (grokQuotasResult || {});
  userManagementState = {
    usersResult,
    creditsResult,
    grokQuotasResult: providerQuotaResultsByKey.grok || { records: [] },
    providerQuotaResultsByKey,
    users: usersResult?.records || [],
    credits: creditsResult?.records || [],
    grokQuotas: providerQuotaResultsByKey.grok?.records || [],
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
      : usersResult?.status === "error" ? "Supabase Error" : "mock 只读";
  }

  if (isErrorResult(usersResult)) {
    replaceRows("usersTableBody", [], 7, resultErrorText(usersResult));
    return;
  }
  const creditMap = new Map((creditsResult?.records || []).map((item) => [String(item.user_id || ""), item]));
  const providerQuotaMaps = Object.fromEntries(PROVIDER_QUOTA_OPTIONS.map((provider) => [
    provider.key,
    new Map(((providerQuotaResultsByKey[provider.key]?.records) || []).map((item) => [String(item.user_id || ""), item]))
  ]));
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
  const rows = sourceRows.map((user) => {
    const credit = creditMap.get(String(user.id || ""));
    const tr = document.createElement("tr");
    const accountLabel = userAccountLabel(user);
    tr.appendChild(textCell(userDisplayName(user), "monoCell"));
    tr.appendChild(textCell(accountLabel || "-"));
    tr.appendChild(textCell(formatDateTime(user.created_at)));

    tr.appendChild(textCell(formatCreditAmount(user.current_credits ?? credit?.balance ?? 0)));
    const providerQuotaText = PROVIDER_QUOTA_OPTIONS.map((provider) => {
      const quota = providerQuotaMaps[provider.key].get(String(user.id || ""));
      return `${provider.shortLabel} ${grokQuotaTextByUserId([quota].filter(Boolean), user.id)}`;
    }).join(" / ");
    const providerQuotaTitle = PROVIDER_QUOTA_OPTIONS.map((provider) => {
      const quota = providerQuotaMaps[provider.key].get(String(user.id || ""));
      return `${provider.label} 已用：${formatNumber(quota?.used_count || 0)}`;
    }).join("\n");
    const providerQuotaCell = textCell(providerQuotaText);
    providerQuotaCell.title = providerQuotaTitle || "未分配提示词服务次数";
    tr.appendChild(providerQuotaCell);

    const statusSelect = createTableSelect(
      USER_STATUS_OPTIONS,
      normalizeUserStatusValue(user.status),
      !userManagementState.writable,
      "status"
    );
    tr.appendChild(nodeCell(statusSelect));

    const actionWrap = document.createElement("div");
    actionWrap.className = "tableActions";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "btn secondary";
    saveButton.textContent = "保存";
    saveButton.disabled = !userManagementState.writable;
    saveButton.dataset.userId = String(user.id || "");
    saveButton.addEventListener("click", async () => {
      await saveUserRow(saveButton);
    });
    actionWrap.appendChild(saveButton);

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
    actionWrap.appendChild(deleteButton);

    tr.appendChild(nodeCell(actionWrap));
    return tr;
  });
  replaceRows("usersTableBody", rows, 7, filter ? "没有匹配的用户" : "暂无用户数据");
}

function renderCredits(creditsResult, userMap) {
  if (isErrorResult(creditsResult)) {
    replaceRows("creditsTableBody", [], 3, resultErrorText(creditsResult));
  } else {
    const creditByUserId = new Map((creditsResult.records || []).map((item) => [String(item.user_id || ""), item]));
    const rowsFromUsers = Array.from(userMap.values()).map((user) => {
      return creditByUserId.get(String(user.id || "")) || { user_id: user.id, email: user.email, balance: 0 };
    });
    const userIds = new Set(rowsFromUsers.map((item) => String(item.user_id || "")));
    const extraRows = (creditsResult.records || []).filter((item) => !userIds.has(String(item.user_id || "")));
    const displayRows = rowsFromUsers.length ? [...rowsFromUsers, ...extraRows] : (creditsResult.records || []);
    const creditRows = displayRows.map((item) => {
      const tr = document.createElement("tr");
      const balance = Number(item.balance || 0);
      tr.appendChild(textCell(displayNameByUserId(userMap, item.user_id, accountNameFromEmail(item.email))));
      tr.appendChild(textCell(formatCreditAmount(balance)));
      tr.appendChild(nodeCell(statusBadge(balance > 0 ? "normal" : "low")));
      return tr;
    });
    replaceRows("creditsTableBody", creditRows, 3, "暂无积分数据");
  }
}

function renderCreditAdjustControls(usersResult, creditsResult) {
  const select = $("creditAdjustUser");
  const button = $("applyCreditAdjust");
  const status = $("creditAdjustStatus");
  if (!select || !button || !status) return;

  const users = usersResult.records || [];
  const credits = creditsResult.records || [];
  const writable = usersResult.source === "supabase" &&
    usersResult.status !== "error" &&
    creditsResult.source === "supabase" &&
    creditsResult.status !== "error";
  const currentUserId = select.value;

  creditAdjustState = { users, credits, writable };
  select.replaceChildren();
  if (!users.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = writable ? "暂无用户，请先接入用户数据" : "mock 数据不可写入";
    select.appendChild(option);
  } else {
    users.forEach((user) => {
      const option = document.createElement("option");
      option.value = String(user.id || "");
      option.textContent = `${userAccountLabel(user) || user.display_name || user.id} · ${formatCreditAmount(creditBalanceByUserId(credits, user.id))}`;
      select.appendChild(option);
    });
    if (currentUserId && users.some((user) => String(user.id || "") === currentUserId)) {
      select.value = currentUserId;
    }
  }
  select.disabled = !writable || !users.length;
  button.disabled = !writable || !users.length;
  status.textContent = writable
    ? users.length ? "可写入 Supabase" : "暂无可分配用户"
    : usersResult.source === "mock" || creditsResult.source === "mock" ? "mock 数据不可写入" : "数据异常，暂停写入";
  updateCreditAdjustCurrentBalance();
}

function renderGrokQuotaControls(usersResult, quotaResult) {
  const providerSelect = $("providerQuotaKey");
  const select = $("grokQuotaUser");
  const button = $("saveGrokQuota");
  const status = $("grokQuotaStatus");
  if (!select || !button || !status) return;

  const providerKey = normalizeProviderQuotaKey(providerSelect?.value || quotaResult?.providerKey || "grok");
  if (providerSelect) {
    providerSelect.replaceChildren(...PROVIDER_QUOTA_OPTIONS.map((provider) => {
      const option = document.createElement("option");
      option.value = provider.key;
      option.textContent = provider.label;
      return option;
    }));
    providerSelect.value = providerKey;
  }
  const users = usersResult.records || [];
  const quotas = quotaResult.records || [];
  const writable = usersResult.source === "supabase" &&
    usersResult.status !== "error" &&
    quotaResult.source === "supabase" &&
    quotaResult.status !== "error";
  const currentUserId = select.value;
  grokQuotaState = { providerKey, users, quotas, writable };

  if (isErrorResult(quotaResult)) {
    replaceRows("grokQuotaTableBody", [], 5, resultErrorText(quotaResult));
  } else {
    const rows = quotas.map((quota) => {
      const tr = document.createElement("tr");
      tr.appendChild(textCell(displayNameByUserId(new Map(users.map((user) => [String(user.id || ""), user])), quota.user_id, accountNameFromEmail(quota.email))));
      tr.appendChild(textCell(formatNumber(quota.allocated_count || 0)));
      tr.appendChild(textCell(formatNumber(quota.used_count || 0)));
      tr.appendChild(textCell(formatNumber(quota.remaining_count || 0)));
      tr.appendChild(nodeCell(statusBadge(Number(quota.remaining_count || 0) > 0 ? "normal" : "low")));
      return tr;
    });
    replaceRows("grokQuotaTableBody", rows, 5, `暂无 ${providerQuotaLabel(providerKey)}次数数据`);
  }

  select.replaceChildren();
  if (!users.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = writable ? "暂无用户" : "mock 数据不可写入";
    select.appendChild(option);
  } else {
    users.forEach((user) => {
      const quota = quotas.find((item) => String(item.user_id || "") === String(user.id || ""));
      const option = document.createElement("option");
      option.value = String(user.id || "");
      option.textContent = `${userAccountLabel(user) || user.display_name || user.id} · 剩余 ${formatNumber(quota?.remaining_count || 0)}`;
      select.appendChild(option);
    });
    if (currentUserId && users.some((user) => String(user.id || "") === currentUserId)) {
      select.value = currentUserId;
    }
  }
  select.disabled = !writable || !users.length;
  button.disabled = !writable || !users.length;
  button.textContent = `保存 ${providerQuotaLabel(providerKey)}次数`;
  status.textContent = writable
    ? users.length ? `可写入 ${providerQuotaLabel(providerKey)}次数` : "暂无可分配用户"
    : quotaResult.source === "mock" || usersResult.source === "mock" ? "mock 数据不可写入" : "数据异常，暂停写入";
  updateGrokQuotaCurrent();
}

function isComfyUiProvider(provider) {
  const key = String(provider?.provider_key || provider?.name || "").trim().toLowerCase();
  return key === "comfyui" || key === "comfy" || key.includes("comfyui");
}

function isGrokProvider(provider) {
  const key = String(provider?.provider_key || provider?.name || "").trim().toLowerCase();
  return key === "grok" || key === "xai" || key.includes("grok");
}

function ensureCoreAiProviders(providers) {
  const list = Array.isArray(providers) ? [...providers] : [];
  if (!list.some(isGrokProvider)) {
    list.push({
      id: "provider-grok-ui",
      name: "Grok",
      provider_key: "grok",
      status: "disabled",
      billing_multiplier: 0.1,
      api_key_secret_ref: ""
    });
  }
  if (!list.some(isComfyUiProvider)) {
    list.push({
      id: "provider-comfyui-ui",
      name: "ComfyUI",
      provider_key: "comfyui",
      status: "disabled",
      billing_multiplier: 1.25,
      api_key_secret_ref: ""
    });
  }
  return list;
}

function providerStatusValue(provider, grokStatus) {
  if (isGrokProvider(provider)) {
    return provider.status === "enabled" || grokStatus?.configured ? "enabled" : provider.status || "disabled";
  }
  return provider.status || "disabled";
}

function providerConnectionBadge(comfyStatus) {
  if (!comfyStatus?.configured) {
    const badge = statusBadge("Not Configured");
    badge.title = "未配置 NOVAFLOW_COMFYUI_API_KEY";
    return badge;
  }
  if (comfyStatus.status === "connected") {
    const badge = statusBadge("Connected");
    badge.title = `GET /api/user · ${durationText(comfyStatus.durationMs)}`;
    return badge;
  }
  const badge = statusBadge("Error");
  badge.title = comfyStatus?.error || "ComfyUI 连接检测失败";
  return badge;
}

function grokConnectionBadge(grokStatus) {
  if (grokStatus?.configured) {
    const badge = statusBadge("Configured");
    badge.title = `POST /chat/completions · ${grokStatus.model || "grok-4.3"}`;
    return badge;
  }
  const badge = statusBadge("Not Configured");
  badge.title = "未配置 NOVAFLOW_GROK_API_KEY";
  return badge;
}

function providerKeyPlaceholder(provider, comfyStatus, grokStatus) {
  if (isComfyUiProvider(provider) && comfyStatus?.configured) return "已从后台管理环境变量读取";
  if (isGrokProvider(provider) && grokStatus?.configured) return "已从后台服务环境变量读取";
  if (provider.api_key_secret_ref) return "已配置服务端密钥引用";
  return "由后台服务保存，前端不写真实 Key";
}

function providerConnectionCell(provider, comfyStatus, grokStatus) {
  if (isComfyUiProvider(provider)) return nodeCell(providerConnectionBadge(comfyStatus));
  if (isGrokProvider(provider)) return nodeCell(grokConnectionBadge(grokStatus));
  return textCell("-");
}

function providerAccountCellText(provider, comfyStatus, grokStatus) {
  if (isComfyUiProvider(provider)) return providerAccountText(comfyStatus);
  if (isGrokProvider(provider)) return grokStatus?.configured ? `model: ${grokStatus.model || "grok-4.3"}` : "未配置";
  return "-";
}

function providerBalanceCellText(provider, comfyStatus) {
  if (isComfyUiProvider(provider)) return providerBalanceText(comfyStatus);
  if (isGrokProvider(provider)) return "按用户分配提示词服务次数";
  return "-";
}

function renderProviderRuntimeConfigControls(comfyStatus, grokStatus) {
  const comfyBase = $("comfyRuntimeBaseUrl");
  const comfyKey = $("comfyRuntimeApiKey");
  const comfyClear = $("comfyRuntimeClearKey");
  const comfyHint = $("comfyRuntimeConfigHint");
  const grokBase = $("grokRuntimeBaseUrl");
  const grokModel = $("grokRuntimeModel");
  const grokKey = $("grokRuntimeApiKey");
  const grokClear = $("grokRuntimeClearKey");
  const grokHint = $("grokRuntimeConfigHint");
  const status = $("providerRuntimeConfigStatus");

  if (comfyBase) comfyBase.value = comfyStatus?.baseUrl || "https://cloud.comfy.org";
  if (comfyKey) comfyKey.value = "";
  if (comfyClear) comfyClear.checked = false;
  if (comfyHint) comfyHint.textContent = comfyStatus?.configured ? "当前 Key 已配置" : "当前 Key 未配置";

  if (grokBase) grokBase.value = grokStatus?.baseUrl || "https://api.x.ai/v1";
  if (grokModel) grokModel.value = grokStatus?.model || "grok-4.3";
  if (grokKey) grokKey.value = "";
  if (grokClear) grokClear.checked = false;
  if (grokHint) grokHint.textContent = grokStatus?.configured ? "当前 Key 已配置" : "当前 Key 未配置";

  if (status) status.textContent = "写入本机后台环境变量";
}

function providerAccountText(comfyStatus) {
  if (!comfyStatus?.configured) return "未配置";
  if (comfyStatus.status === "connected") return comfyStatus.accountStatus || "unknown";
  return "unknown";
}

function providerBalanceText(comfyStatus) {
  if (!comfyStatus?.configured) return "未配置";
  const balance = comfyStatus.balance || {};
  return balance.text || (comfyStatus.status === "connected" ? "官方余额 API 未开放" : "读取失败");
}

function renderProviderBudgetControls(settingsResult) {
  const input = $("comfyProviderBudgetBalance");
  const note = $("comfyProviderBudgetNote");
  const button = $("saveComfyProviderBudget");
  const status = $("providerBudgetStatus");
  const display = $("comfyProviderBudgetDisplay");
  if (!input || !note || !button || !status || !display) return;

  const writable = settingsResult?.source === "supabase" && settingsResult?.status !== "error";
  const setting = findSettingRecord(settingsResult, "provider_budget_comfyui");
  const value = setting?.value && typeof setting.value === "object" ? setting.value : {};
  const balance = Number(value.balance ?? value.value);
  const hasBalance = Number.isFinite(balance);
  input.disabled = !writable;
  note.disabled = !writable;
  button.disabled = !writable;
  input.value = hasBalance ? formatProviderBalanceInput(balance) : "";
  note.value = String(value.note || "");
  status.textContent = writable
    ? hasBalance ? "已保存，生成成功后自动扣减" : "可写入 Supabase"
    : settingsResult?.source === "mock" ? "mock 数据不可写入" : "数据异常，暂停写入";
  const updatedAt = value.updated_at || setting?.updated_at || "";
  display.textContent = hasBalance
    ? `${formatProviderBalance(balance)} ${value.unit || "credits"}${updatedAt ? " · " + formatDateTime(updatedAt) : ""}`
    : "未保存";
}

function providerHealthStatusText(comfyStatus, hasSecretRef) {
  if (!comfyStatus?.configured) {
    return comfyStatus?.secretConfigured || hasSecretRef ? "已配置密钥引用，等待后台 secret resolver" : "未配置";
  }
  if (comfyStatus.status === "connected") return "连接正常";
  if (comfyStatus.status === "error") return "连接失败";
  return comfyStatus.status || "未知";
}

function providerManagedBalanceText(settingsResult) {
  const setting = findSettingRecord(settingsResult, "provider_budget_comfyui");
  const value = setting?.value && typeof setting.value === "object" ? setting.value : {};
  const balance = Number(value.balance ?? value.value);
  if (!Number.isFinite(balance)) return "未保存";
  const updatedAt = value.updated_at || setting?.updated_at || "";
  return `${formatProviderBalance(balance)} ${value.unit || "credits"}${updatedAt ? " · " + formatDateTime(updatedAt) : ""}`;
}

function renderComfyProviderHealth(comfyStatus, settingsResult, providers) {
  const comfyProvider = (providers || []).find(isComfyUiProvider);
  const hasSecretRef = Boolean(String(comfyProvider?.api_key_secret_ref || "").trim() || comfyStatus?.hasApiKeySecretRef);
  const officialBalance = providerBalanceText(comfyStatus);
  const entries = [
    { label: "Base URL", value: comfyStatus?.baseUrl || "https://cloud.comfy.org" },
    { label: "API Key", value: comfyStatus?.configured ? "环境变量已配置" : hasSecretRef ? "仅配置 secret ref" : "未配置" },
    { label: "连接状态", value: providerHealthStatusText(comfyStatus, hasSecretRef) },
    { label: "官方余额", value: officialBalance },
    { label: "手动总余额", value: providerManagedBalanceText(settingsResult) },
    { label: "检测耗时", value: durationText(comfyStatus?.durationMs) },
    { label: "错误提示", value: comfyStatus?.error || "-" }
  ];
  renderSettingRows("comfyProviderHealthRows", entries, "暂无 ComfyUI 检测数据");
}

function renderAiServices(providersResult, settingsResult, comfyStatus, grokStatus) {
  const providers = ensureCoreAiProviders(providersResult.records || []);
  if (isErrorResult(providersResult)) {
    replaceRows("aiProvidersTableBody", [], 7, resultErrorText(providersResult));
  } else {
    const providerRows = providers.map((provider) => {
      const isComfyUi = isComfyUiProvider(provider);
      const tr = document.createElement("tr");
      const input = document.createElement("input");
      input.className = "mockKey";
      input.type = "password";
      input.value = "";
      input.placeholder = isComfyUi && comfyStatus?.configured
        ? "已从后台管理环境变量读取"
        : provider.api_key_secret_ref ? "已配置服务端密钥引用" : "由后台服务保存，前端不写真实 Key";
      if (isGrokProvider(provider)) input.placeholder = providerKeyPlaceholder(provider, comfyStatus, grokStatus);
      input.disabled = true;
      tr.appendChild(textCell(provider.name || provider.provider_key || "-"));
      tr.appendChild(nodeCell(input));
      tr.appendChild(nodeCell(statusBadge(providerStatusValue(provider, grokStatus), "disabled")));
      tr.appendChild(textCell(`${provider.billing_multiplier ?? 1}x`));
      tr.appendChild(isComfyUi ? nodeCell(providerConnectionBadge(comfyStatus)) : providerConnectionCell(provider, comfyStatus, grokStatus));
      tr.appendChild(textCell(isComfyUi ? providerAccountText(comfyStatus) : providerAccountCellText(provider, comfyStatus, grokStatus)));
      tr.appendChild(textCell(isComfyUi ? providerBalanceText(comfyStatus) : providerBalanceCellText(provider, comfyStatus)));
      return tr;
    });
    replaceRows("aiProvidersTableBody", providerRows, 7, "暂无 Provider 数据");
  }

  if (isErrorResult(settingsResult)) {
    renderProviderBudgetControls(settingsResult);
    renderComfyProviderHealth(comfyStatus, settingsResult, providers);
    return;
  }

  renderProviderBudgetControls(settingsResult);
  renderComfyProviderHealth(comfyStatus, settingsResult, providers);
}

function renderSettings(settingsResult) {
  if (isErrorResult(settingsResult)) {
    renderSettingRows("systemSettingsRows", [], resultErrorText(settingsResult));
    return;
  }
  const settings = (settingsResult.records || []).map(systemSettingEntry);
  const rows = [
    { key: "default_billing_multiplier", label: "默认积分倍率", value: "1.00x" },
    { key: "new_user_initial_credits", label: "新用户初始积分", value: 0 },
    { key: "provider_budget_comfyui", label: "ComfyUI 手动总余额", value: "生成成功后自动扣减" },
    { key: "provider_quota_grok_<user_id>", label: "提示词服务次数", value: "管理员按用户手动分配" }
  ].map((fallback) => settings.find((item) => item.key === fallback.key) || fallback);
  renderSettingRows("systemSettingsRows", rows, "暂无系统设置");
}

function renderDashboardRecentActivity(logsResult) {
  const container = $("dashboardRecentActivity");
  if (!container) return;
  container.replaceChildren();

  const empty = (title, hint) => {
    const wrap = document.createElement("div");
    wrap.className = "emptyState";
    const titleEl = document.createElement("div");
    titleEl.className = "emptyTitle";
    titleEl.textContent = title || "暂无数据";
    const hintEl = document.createElement("div");
    hintEl.className = "emptyText";
    hintEl.textContent = hint || "点击左侧创建或者刷新列表";
    wrap.appendChild(titleEl);
    wrap.appendChild(hintEl);
    container.appendChild(wrap);
  };

  if (isErrorResult(logsResult)) {
    empty(resultErrorText(logsResult), "请检查 Supabase 配置或刷新列表");
    return;
  }

  const records = Array.isArray(logsResult?.records) ? logsResult.records : [];
  if (!records.length) {
    empty("暂无数据", logsResult?.message || "点击左侧创建或者刷新列表");
    return;
  }

  records.slice(0, 6).forEach((record) => {
    const row = document.createElement("div");
    row.className = "activityItem";

    const main = document.createElement("div");
    const title = document.createElement("div");
    title.className = "activityTitle";
    title.textContent = String(record.feature || record.source || record.mode || "后台记录");
    const meta = document.createElement("div");
    meta.className = "activityMeta";
    const account = record.email || record.user_id || record.userId || "-";
    const amount = record.amount ?? record.balance ?? record.delta ?? "-";
    meta.textContent = `${account} · ${formatCreditAmount(amount)}`;
    main.appendChild(title);
    main.appendChild(meta);

    const time = document.createElement("div");
    time.className = "activityTime";
    time.textContent = formatDateTime(record.created_at || record.updated_at || record.at);

    row.appendChild(main);
    row.appendChild(time);
    container.appendChild(row);
  });
}

function renderDashboard(data) {
  const results = [data.users, data.credits, data.providers, data.settings];
  const users = data.users.records || [];
  const providers = data.providers.records || [];
  const credits = data.credits.records || [];
  const totalCredits = credits.reduce((sum, item) => sum + (Number(item.balance || 0) || 0), 0);
  const comfyBudgetBalance = providerBudgetBalanceFromSettings(data.settings, "comfyui");
  const sourceLabel = hasErrorResult(results) ? "Supabase Error" : hasSupabaseResult(results) ? "Supabase" : "Mock";

  $("dashboardUsersCount").textContent = formatNumber(users.length);
  $("dashboardAiStatusValue").textContent = formatNumber(providers.length);
  $("dashboardAiStatusMeta").textContent = `Provider 数量：${formatNumber(providers.length)} · ${sourceLabel}`;
  $("dashboardCreditCost").textContent = formatCreditAmount(totalCredits);
  const comfyBudgetEl = $("dashboardComfyBudgetBalance");
  if (comfyBudgetEl) comfyBudgetEl.textContent = comfyBudgetBalance == null ? "-" : formatProviderBalance(comfyBudgetBalance);
  const comfyBudgetMeta = $("dashboardComfyBudgetMeta");
  if (comfyBudgetMeta) {
    comfyBudgetMeta.textContent = comfyBudgetBalance == null
      ? "未保存 ComfyUI 手动总余额"
      : `生成成功后自动扣减 · ${sourceLabel}`;
  }
  setDataBadge("dashboardDataBadge", hasErrorResult(results) ? { status: "error" } : hasSupabaseResult(results) ? { source: "supabase" } : { source: "mock" });
  renderDashboardRecentActivity(data.creditLogs);
}

async function loadAdminData() {
  try {
    const users = await loadAdminDataset("getAdminUsers", "usersDataBadge");
    const credits = await loadAdminDataset("getAdminCredits", "creditsDataBadge");
    const creditLogs = await loadAdminDataset("getAdminCreditLogs");
    const providers = await loadAdminDataset("getAdminAiProviders", "aiServicesDataBadge");
    const settings = await loadAdminDataset("getAdminSystemSettings", "settingsDataBadge");
    const quotaEntries = await Promise.all(PROVIDER_QUOTA_OPTIONS.map(async (provider) => {
      const result = await loadAdminProviderQuotaDataset(provider.key);
      return [provider.key, result];
    }));
    const providerQuotasByKey = Object.fromEntries(quotaEntries);
    const selectedQuotaKey = normalizeProviderQuotaKey($("providerQuotaKey")?.value || "grok");
    const selectedQuota = providerQuotasByKey[selectedQuotaKey] || {
      providerKey: selectedQuotaKey,
      source: "mock",
      records: []
    };
    const comfyStatus = await loadAdminProviderStatus("getAdminComfyUiProviderStatus");
    const grokStatus = await loadAdminProviderStatus("getAdminGrokProviderStatus");
    const userMap = new Map((users.records || []).map((user) => [String(user.id || ""), user]));
    const quotaResults = Object.values(providerQuotasByKey);
    const results = [users, credits, providers, settings, ...quotaResults];

    setAdminDataSourceStatus(results);
    setDataBadge("creditsDataBadge", hasErrorResult([credits, ...quotaResults]) ? { status: "error" } : hasSupabaseResult([credits, ...quotaResults]) ? { source: "supabase" } : { source: "mock" });
    setDataBadge("aiServicesDataBadge", hasErrorResult([providers, settings]) ? { status: "error" } : hasSupabaseResult([providers, settings]) ? { source: "supabase" } : { source: "mock" });

    renderUsers(users, credits, providerQuotasByKey);
    renderCredits(credits, userMap);
    renderCreditAdjustControls(users, credits);
    renderGrokQuotaControls(users, selectedQuota);
    renderAiServices(providers, settings, comfyStatus, grokStatus);
    renderProviderRuntimeConfigControls(comfyStatus, grokStatus);
    renderSettings(settings);
    renderDashboard({ users, credits, creditLogs, providers, settings, userMap });
  } catch (err) {
    const message = `Supabase Error: ${String(err?.message || err)}`;
    setAdminDataSourceStatus([{ status: "error" }]);
    ["dashboardDataBadge", "usersDataBadge", "creditsDataBadge", "aiServicesDataBadge", "tasksDataBadge", "consumptionDataBadge", "settingsDataBadge"].forEach((id) => setDataBadge(id, "Supabase Error"));
    replaceRows("usersTableBody", [], 7, message);
    replaceRows("creditsTableBody", [], 3, message);
    replaceRows("grokQuotaTableBody", [], 5, message);
    replaceRows("creditLogsPreviewBody", [], 4, message);
    renderCreditAdjustControls({ source: "supabase", status: "error", records: [] }, { source: "supabase", status: "error", records: [] });
    renderGrokQuotaControls(
      { source: "supabase", status: "error", records: [] },
      { providerKey: normalizeProviderQuotaKey($("providerQuotaKey")?.value || "grok"), source: "supabase", status: "error", records: [] }
    );
    replaceRows("aiProvidersTableBody", [], 7, message);
    replaceRows("aiModelsTableBody", [], 5, message);
    replaceRows("tasksTableBody", [], 6, message);
    replaceRows("consumptionTableBody", [], 5, message);
    renderSettingRows("systemSettingsRows", [], message);
    renderDashboardRecentActivity({ source: "supabase", status: "error", records: [], error: message });
    renderProviderBudgetControls({ source: "supabase", status: "error", records: [] });
  }
}

function createAdminUserPayload() {
  return {
    accountName: $("newUserAccount")?.value.trim() || "",
    password: $("newUserPassword")?.value || "",
    displayName: $("newUserDisplayName")?.value.trim() || "",
    plan: "trial",
    status: $("newUserStatus")?.value || "active",
    initialCredits: Number($("newUserInitialCredits")?.value || 0),
    note: $("newUserNote")?.value.trim() || ""
  };
}

function clearCreateAdminUserForm() {
  if ($("newUserAccount")) $("newUserAccount").value = "";
  if ($("newUserPassword")) $("newUserPassword").value = "";
  if ($("newUserDisplayName")) $("newUserDisplayName").value = "";
  if ($("newUserStatus")) $("newUserStatus").value = "active";
  if ($("newUserInitialCredits")) $("newUserInitialCredits").value = "0";
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

  const confirmed = confirm(`确定创建登录账号 ${accountName}？\n初始积分：${formatNumber(payload.initialCredits)}\n用户将使用此账号和初始密码登录 NovaFlow。`);
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
  const user = userManagementState.users.find((item) => String(item.id || "") === String(userId));
  const oldStatus = normalizeUserStatusValue(user?.status);
  if (status === oldStatus) {
    toast("用户信息没有变化");
    return;
  }
  const confirmed = confirm(`确定更新 ${userAccountLabel(user) || userId}？\n状态：${oldStatus} -> ${status}`);
  if (!confirmed) return;

  try {
    button.disabled = true;
    button.textContent = "保存中...";
    const res = await window.adminAPI.updateAdminUser({ userId, status });
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

  const confirmed = confirm(`确定删除用户 ${accountLabel}？\n\n此操作会删除后台用户资料、积分余额、提示词服务次数和可匹配的 Auth 登录身份。此操作不可恢复。`);
  if (!confirmed) return;

  const typedAccount = prompt(`请输入用户账号确认删除：\n${accountLabel}`, "");
  if (typedAccount === null) return;
  if (String(typedAccount).trim().toLowerCase() !== String(accountLabel).toLowerCase()) {
    alert("输入的账号不匹配，已取消删除。");
    return;
  }

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

function creditAdjustPayload() {
  return {
    userId: $("creditAdjustUser")?.value || "",
    mode: $("creditAdjustMode")?.value || "add",
    amount: Number($("creditAdjustAmount")?.value || 0),
    feature: $("creditAdjustFeature")?.value.trim() || "后台积分分配",
    note: $("creditAdjustNote")?.value.trim() || ""
  };
}

async function applyCreditAdjustment() {
  const status = $("creditAdjustStatus");
  const payload = creditAdjustPayload();
  if (!creditAdjustState.writable) {
    alert("当前不是 Supabase 可写数据，不能写入积分。");
    return;
  }
  if (!payload.userId) {
    alert("请先选择用户");
    return;
  }
  if (!Number.isInteger(payload.amount)) {
    alert("积分数量必须是整数");
    return;
  }
  if (payload.mode === "set" ? payload.amount < 0 : payload.amount <= 0) {
    alert(payload.mode === "set" ? "设置余额不能小于 0" : "充值或扣减积分必须大于 0");
    return;
  }
  const user = creditAdjustState.users.find((item) => String(item.id || "") === String(payload.userId));
  const beforeBalance = creditBalanceByUserId(creditAdjustState.credits, payload.userId);
  const afterBalance = payload.mode === "set"
    ? payload.amount
    : payload.mode === "deduct" ? beforeBalance - payload.amount : beforeBalance + payload.amount;
  if (afterBalance < 0) {
    alert("扣减后积分不能小于 0");
    return;
  }
  const actionText = payload.mode === "set" ? "设置余额" : payload.mode === "deduct" ? "扣减积分" : "增加积分";
  const confirmed = confirm(`确定为 ${userAccountLabel(user) || payload.userId} ${actionText}？\n当前积分：${formatCreditAmount(beforeBalance)}\n写入后：${formatCreditAmount(afterBalance)}`);
  if (!confirmed) return;

  try {
    status.textContent = "写入中...";
    const res = await window.adminAPI.adjustAdminUserCredits(payload);
    const result = res?.result || {};
    if (!res?.ok || result.status === "error" || result.ok === false) {
      status.textContent = "写入失败";
      alert(result.error || res?.error || "积分写入失败");
      return;
    }
    const adjustment = result.adjustment || {};
    status.textContent = `已写入：${formatCreditAmount(adjustment.beforeBalance)} -> ${formatCreditAmount(adjustment.afterBalance)}`;
    $("creditAdjustAmount").value = "";
    $("creditAdjustNote").value = "";
    toast("积分已更新");
    await loadAdminData();
  } catch (err) {
    status.textContent = "写入失败";
    alert(`积分写入失败：${String(err?.message || err)}`);
  }
}

function grokQuotaPayload() {
  return {
    providerKey: normalizeProviderQuotaKey($("providerQuotaKey")?.value || grokQuotaState.providerKey),
    userId: $("grokQuotaUser")?.value || "",
    allocatedCount: Number($("grokQuotaAllocated")?.value || 0),
    note: $("grokQuotaNote")?.value.trim() || ""
  };
}

async function saveGrokQuota() {
  const status = $("grokQuotaStatus");
  const payload = grokQuotaPayload();
  const providerLabel = providerQuotaLabel(payload.providerKey);
  if (!grokQuotaState.writable) {
    alert(`当前不是 Supabase 可写数据，不能写入 ${providerLabel}次数。`);
    return;
  }
  if (!payload.userId) {
    alert("请选择用户");
    return;
  }
  if (!Number.isInteger(payload.allocatedCount) || payload.allocatedCount < 0) {
    alert(`${providerLabel} 分配次数必须是大于等于 0 的整数`);
    return;
  }
  const user = grokQuotaState.users.find((item) => String(item.id || "") === String(payload.userId));
  const quota = grokQuotaState.quotas.find((item) => String(item.user_id || "") === String(payload.userId));
  const confirmed = confirm(`确定设置 ${userAccountLabel(user) || payload.userId} 的 ${providerLabel}次数？\n当前已用：${formatNumber(quota?.used_count || 0)}\n新的分配次数：${formatNumber(payload.allocatedCount)}`);
  if (!confirmed) return;

  try {
    if (status) status.textContent = "保存中...";
    const api = window.adminAPI?.setAdminProviderQuota || window.adminAPI?.setAdminGrokProviderQuota;
    const res = await api(payload);
    const result = res?.result || {};
    if (!res?.ok || result.status === "error" || result.ok === false) {
      if (status) status.textContent = "保存失败";
      alert(result.error || res?.error || `保存 ${providerLabel}次数失败`);
      return;
    }
    if (status) status.textContent = "已保存";
    toast(`${providerLabel}次数已保存`);
    await loadAdminData();
  } catch (err) {
    if (status) status.textContent = "保存失败";
    alert(`保存 ${providerLabel}次数失败：${String(err?.message || err)}`);
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

function providerBudgetPayload() {
  return {
    providerKey: "comfyui",
    balance: Number($("comfyProviderBudgetBalance")?.value || 0),
    unit: "credits",
    note: $("comfyProviderBudgetNote")?.value.trim() || ""
  };
}

function providerRuntimeConfigPayload(providerKey) {
  const key = String(providerKey || "").toLowerCase();
  if (key === "comfyui") {
    const apiKey = $("comfyRuntimeApiKey")?.value.trim() || "";
    const clearApiKey = Boolean($("comfyRuntimeClearKey")?.checked);
    return {
      providerKey: "comfyui",
      baseUrl: $("comfyRuntimeBaseUrl")?.value.trim() || "https://cloud.comfy.org",
      apiKey,
      updateApiKey: Boolean(apiKey),
      clearApiKey
    };
  }
  const apiKey = $("grokRuntimeApiKey")?.value.trim() || "";
  const clearApiKey = Boolean($("grokRuntimeClearKey")?.checked);
  return {
    providerKey: "grok",
    baseUrl: $("grokRuntimeBaseUrl")?.value.trim() || "https://api.x.ai/v1",
    model: $("grokRuntimeModel")?.value.trim() || "grok-4.3",
    apiKey,
    updateApiKey: Boolean(apiKey),
    clearApiKey
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
  const providerName = key === "grok" ? "Grok" : "ComfyUI";
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
    if (key === "grok") {
      if ($("grokRuntimeApiKey")) $("grokRuntimeApiKey").value = "";
      if ($("grokRuntimeClearKey")) $("grokRuntimeClearKey").checked = false;
    } else {
      if ($("comfyRuntimeApiKey")) $("comfyRuntimeApiKey").value = "";
      if ($("comfyRuntimeClearKey")) $("comfyRuntimeClearKey").checked = false;
    }
    if (status) status.textContent = "已保存";
    toast(`${providerName} 配置已保存`);
    await loadAdminData();
  } catch (err) {
    if (status) status.textContent = "保存失败";
    alert(`保存 ${providerName} 配置失败：${String(err?.message || err)}`);
  }
}

async function saveComfyProviderBudget() {
  const status = $("providerBudgetStatus");
  const payload = providerBudgetPayload();
  if (!Number.isFinite(payload.balance) || payload.balance < 0) {
    alert("ComfyUI 手动总余额必须是大于或等于 0 的数字。");
    return;
  }
  const confirmed = confirm(`确定保存 ComfyUI 手动总余额？\n余额：${formatProviderBalance(payload.balance)} credits\n这不是官方实时读取值；用户 ComfyUI 生成成功后会自动扣减。`);
  if (!confirmed) return;
  try {
    status.textContent = "保存中...";
    const res = await window.adminAPI.setAdminProviderBudget(payload);
    const result = res?.result || {};
    if (!res?.ok || result.status === "error" || result.ok === false) {
      status.textContent = "保存失败";
      alert(result.error || res?.error || "保存 ComfyUI 手动总余额失败");
      return;
    }
    status.textContent = "已保存";
    toast("ComfyUI 手动总余额已保存");
    await loadAdminData();
  } catch (err) {
    status.textContent = "保存失败";
    alert(`保存 ComfyUI 手动总余额失败：${String(err?.message || err)}`);
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
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "listStatus";
    empty.textContent = "没有可显示的授权记录";
    container.appendChild(empty);
    return;
  }
  const current = String(selectedLicenseKey || $("onlineLicenseKey")?.value || "").trim();
  list.forEach((record) => {
    const item = document.createElement("div");
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.className = "recordItem";
    if (record.license_key && record.license_key === current) item.classList.add("active");

    const top = document.createElement("div");
    top.className = "recordTop";
    const key = document.createElement("div");
    key.className = "recordKey";
    key.textContent = record.license_key || "(空 license_key)";
    const badge = document.createElement("div");
    badge.className = `badge ${String(record.status || "").toLowerCase()}`;
    badge.textContent = record.status || "-";
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
    actions.appendChild(badge);
    actions.appendChild(deleteButton);
    top.appendChild(key);
    top.appendChild(actions);

    const meta = document.createElement("div");
    meta.className = "recordMeta";
    const machine = document.createElement("div");
    machine.textContent = `machine_id: ${record.machine_id || "-"}`;
    const expire = document.createElement("div");
    expire.textContent = `expire_at: ${formatShortDate(record.expire_at)}`;
    const created = document.createElement("div");
    created.textContent = `created_at: ${formatShortDate(record.created_at)}`;
    meta.appendChild(machine);
    meta.appendChild(expire);
    meta.appendChild(created);

    item.appendChild(top);
    item.appendChild(meta);
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
  setOnlineStatus("写入中...");
  const res = await window.adminAPI.upsertOnlineLicense(payload);
  if (!res?.ok) {
    setOnlineStatus("写入失败");
    alert(`创建/更新失败：${String(res?.error || "unknown")}`);
    return;
  }
  const record = res?.result?.record;
  $("onlineResult").textContent = formatOnlineRecord(record);
  fillOnlineFormFromRecord(record);
  await refreshOnlineList({ silent: true });
  setOnlineStatus(res?.result?.mode === "inserted" ? "已创建" : "已更新");
  toast("线上授权已同步");
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
  const confirmed = confirm(`确定删除授权码 ${licenseKey}？\n${scopeText}\n\n此操作不可恢复。`);
  if (!confirmed) return;

  const typedKey = prompt(`请输入授权码确认删除：\n${licenseKey}`, "");
  if (typedKey === null) return;
  if (String(typedKey).trim() !== licenseKey) {
    alert("输入的授权码不匹配，已取消删除。");
    return;
  }

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
    $("statusText").textContent = "状态读取失败";
    $("fingerprint").textContent = "-";
    $("pubPreview").textContent = "-";
    return;
  }
  const st = res.status;
  const ok = st.pubExists && st.privExists;
  $("statusText").textContent = ok ? "密钥已存在" : st.pubExists || st.privExists ? "密钥不完整" : "未生成密钥";
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
  await loadAdminData();
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
      userManagementState.creditsResult || { records: [] },
      userManagementState.providerQuotaResultsByKey || {}
    );
  });
  $("createAdminUser").addEventListener("click", async () => {
    await createAdminUser();
  });
  $("creditUserSearchButton").addEventListener("click", selectCreditAdjustUserFromSearch);
  $("creditUserSearchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      selectCreditAdjustUserFromSearch();
    }
  });
  $("creditAdjustUser").addEventListener("change", updateCreditAdjustCurrentBalance);
  $("applyCreditAdjust").addEventListener("click", async () => {
    await applyCreditAdjustment();
  });
  $("grokQuotaUserSearchButton").addEventListener("click", selectGrokQuotaUserFromSearch);
  $("grokQuotaUserSearchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      selectGrokQuotaUserFromSearch();
    }
  });
  $("grokQuotaUser").addEventListener("change", updateGrokQuotaCurrent);
  $("providerQuotaKey").addEventListener("change", () => {
    const providerKey = normalizeProviderQuotaKey($("providerQuotaKey")?.value || "grok");
    const quotaResult = userManagementState.providerQuotaResultsByKey?.[providerKey] || {
      providerKey,
      source: "mock",
      records: []
    };
    renderGrokQuotaControls(userManagementState.usersResult || { records: [] }, quotaResult);
  });
  $("saveGrokQuota").addEventListener("click", async () => {
    await saveGrokQuota();
  });
  $("saveComfyProviderBudget").addEventListener("click", async () => {
    await saveComfyProviderBudget();
  });
  $("saveComfyRuntimeConfig").addEventListener("click", async () => {
    await saveProviderRuntimeConfig("comfyui");
  });
  $("saveGrokRuntimeConfig").addEventListener("click", async () => {
    await saveProviderRuntimeConfig("grok");
  });

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
    if (event.key === "Escape" && !$("passwordEditDialog").hidden) closePasswordEditDialog();
  });

  document.querySelectorAll(".tab").forEach((el) => {
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
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => alert(String(e?.message || e)));
});
