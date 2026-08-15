"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderLicenseLockScreenHtml = renderLicenseLockScreenHtml;
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function safeJsonForInline(value) {
    return JSON.stringify(value || {})
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026");
}
function getTitle(state) {
    if (state?.status === "unlicensed")
        return "需要授权";
    if (state?.reason === "remote_banned")
        return "授权已封禁";
    if (state?.status === "expired" || state?.reason?.includes("expired"))
        return "授权已到期";
    return "授权失效";
}
function getMessage(state) {
    if (state?.status === "unlicensed")
        return "请导入 license.nfl 后进行首次联网验证。";
    if (state?.reason === "first_online_verify_required")
        return "首次使用必须联网验证，请连接网络后重试。";
    if (state?.reason === "offline_grace_expired")
        return "离线运行已超过 7 天，请联网验证后继续使用。";
    if (state?.reason === "remote_banned")
        return "授权已被远程封禁，请联系管理员。";
    if (state?.reason === "remote_machine_mismatch")
        return "远程授权机器码与当前设备不一致。";
    if (state?.reason === "license_key_missing")
        return "当前授权文件缺少 licenseKey，请使用新版授权管理工具重新签发。";
    return "授权状态无效，请联系管理员或重新导入授权文件。";
}
function renderLicenseLockScreenHtml(state) {
    const initialState = state || {
        status: "locked",
        locked: true,
        machineId: "",
        reason: "unknown"
    };
    const title = getTitle(initialState);
    const message = getMessage(initialState);
    const data = safeJsonForInline(initialState);
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NovaFlow License Locked</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      background: #151515;
      color: #f4f4f5;
      display: grid;
      place-items: center;
      user-select: none;
    }
    .shell {
      width: min(620px, calc(100vw - 48px));
      background: #1d1d1d;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      padding: 22px;
      box-shadow: 0 18px 50px rgba(0,0,0,0.32);
    }
    .brand { font-size: 13px; font-weight: 900; color: rgba(255,255,255,0.58); letter-spacing: 0; }
    h1 { margin: 10px 0 8px; font-size: 22px; line-height: 1.2; letter-spacing: 0; }
    .message { margin: 0 0 18px; color: rgba(255,255,255,0.72); font-size: 13px; line-height: 1.55; }
    .grid { display: grid; grid-template-columns: 118px minmax(0, 1fr); gap: 10px 14px; padding: 14px; background: #151515; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); }
    .label { color: rgba(255,255,255,0.56); font-size: 12px; font-weight: 800; }
    .value { color: rgba(255,255,255,0.92); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; word-break: break-all; user-select: text; }
    textarea {
      width: 100%;
      min-height: 112px;
      margin-top: 16px;
      resize: vertical;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 8px;
      background: #101010;
      color: #fff;
      padding: 11px;
      line-height: 1.45;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      user-select: text;
    }
    .actions { display: flex; gap: 10px; justify-content: center; align-items: center; margin-top: 16px; flex-wrap: wrap; }
    button {
      height: 38px;
      min-width: 124px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.12);
      background: #303030;
      color: #fff;
      cursor: pointer;
      font-size: 12px;
      font-weight: 900;
    }
    button.primary { background: #1ea672; border-color: rgba(30,166,114,0.42); }
    button:disabled { cursor: not-allowed; opacity: .55; }
    .status { min-height: 18px; margin-top: 12px; color: rgba(255,255,255,0.62); font-size: 12px; line-height: 1.5; text-align: center; }
    .status.error { color: rgba(239, 68, 68, 0.96); }
    .status.ok { color: rgba(30, 166, 114, 0.96); }
  </style>
</head>
<body>
  <main class="shell">
    <div class="brand">NovaFlow</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="message">${escapeHtml(message)}</p>
    <section class="grid">
      <div class="label">授权状态</div><div id="licenseStatus" class="value">${escapeHtml(initialState.status)}</div>
      <div class="label">到期时间</div><div id="licenseExpire" class="value">${escapeHtml(initialState.expireAt || "-")}</div>
      <div class="label">license_key</div><div id="licenseKey" class="value">${escapeHtml(initialState.licenseKey || "-")}</div>
      <div class="label">machine_id</div><div id="machineId" class="value">${escapeHtml(initialState.machineId || "-")}</div>
    </section>
    <textarea id="licenseText" spellcheck="false" placeholder="粘贴授权码或 license.nfl JSON 内容"></textarea>
    <div class="actions">
      <button id="refreshButton" type="button">重新验证</button>
      <button id="importFileButton" type="button">导入 license.nfl</button>
      <button id="importTextButton" type="button" class="primary">粘贴导入</button>
    </div>
    <div id="statusLine" class="status"></div>
  </main>
  <script>
    const initialState = ${data};
    const api = window.electronAPI || {};
    const $ = (id) => document.getElementById(id);
    function setStatus(message, tone) {
      const el = $("statusLine");
      el.textContent = String(message || "");
      el.className = "status" + (tone ? " " + tone : "");
    }
    function renderState(state) {
      const s = state || {};
      $("licenseStatus").textContent = String(s.status || "-");
      $("licenseExpire").textContent = String(s.expireAt || s.online?.remoteExpireAt || "-");
      $("licenseKey").textContent = String(s.licenseKey || s.online?.licenseKey || "-");
      $("machineId").textContent = String(s.machineId || "-");
    }
    async function openMainIfLicensed(state) {
      if (!state || state.status !== "licensed") return false;
      const res = await api.licenseOpenMain?.();
      if (res && res.ok) return true;
      renderState(res && (res.state || res));
      setStatus("授权仍未通过：" + String((res && (res.error || res.reason)) || "unknown"), "error");
      return false;
    }
    async function refreshState() {
      setStatus("正在验证授权...", "");
      const res = await api.licenseGetState?.();
      const state = res && (res.state || res);
      renderState(state);
      if (await openMainIfLicensed(state)) return;
      setStatus("授权未通过：" + String((state && (state.reason || state.error || state.status)) || "unknown"), "error");
    }
    async function importFile() {
      setStatus("请选择 license.nfl...", "");
      const res = await api.licenseImportFile?.();
      if (!res || res.canceled) {
        setStatus("", "");
        return;
      }
      const state = res.state || res;
      renderState(state);
      if (res.ok && await openMainIfLicensed(state)) return;
      setStatus("导入失败：" + String(res.error || state.reason || "unknown"), "error");
    }
    async function importText() {
      const text = String($("licenseText").value || "").trim();
      if (!text) {
        setStatus("请先粘贴授权内容。", "error");
        return;
      }
      setStatus("正在导入并联网验证...", "");
      const res = await api.licenseImportText?.({ text });
      const state = res && (res.state || res);
      renderState(state);
      if (res && res.ok && await openMainIfLicensed(state)) return;
      setStatus("导入失败：" + String((res && res.error) || (state && state.reason) || "unknown"), "error");
    }
    $("refreshButton").addEventListener("click", refreshState);
    $("importFileButton").addEventListener("click", importFile);
    $("importTextButton").addEventListener("click", importText);
    renderState(initialState);
    api.licenseGetMachineId?.().then((res) => {
      if (res && res.machineId) $("machineId").textContent = String(res.machineId);
    }).catch(() => {});
  </script>
</body>
</html>`;
}
