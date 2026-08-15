(function registerNovaFlowExportProgressDialog(root) {
  "use strict";

  if (root.NovaFlowExportProgressDialog?.version === 1) return;

  const BLOCKING_ATTRIBUTE = "data-novaflow-export-blocking";
  const OWNED_ATTRIBUTE = "data-novaflow-export-progress-owned";
  let nextToken = 0;
  let active = null;

  function removeOwnedHost(host) {
    if (!(host instanceof HTMLElement)) return;
    if (host.getAttribute(OWNED_ATTRIBUTE) !== "1") return;
    try { host.remove(); } catch {}
  }

  function createHost(title, detail) {
    const host = document.createElement("div");
    host.setAttribute(BLOCKING_ATTRIBUTE, "1");
    host.setAttribute(OWNED_ATTRIBUTE, "1");
    host.setAttribute("data-novaflow-runtime-ignore", "1");
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");
    host.setAttribute("aria-label", String(title || "正在导出"));
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      background: "rgba(0,0,0,0.55)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      pointerEvents: "auto",
      boxSizing: "border-box"
    });

    const dialog = document.createElement("div");
    Object.assign(dialog.style, {
      width: "360px",
      maxWidth: "100%",
      background: "#1d1d1d",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "12px",
      padding: "16px",
      textAlign: "center",
      boxSizing: "border-box"
    });

    const titleNode = document.createElement("div");
    titleNode.setAttribute("data-novaflow-export-progress-title", "1");
    Object.assign(titleNode.style, {
      fontSize: "14px",
      fontWeight: "900",
      color: "rgba(255,255,255,0.92)"
    });

    const detailNode = document.createElement("div");
    detailNode.setAttribute("data-novaflow-export-progress-detail", "1");
    detailNode.setAttribute("aria-live", "polite");
    Object.assign(detailNode.style, {
      marginTop: "8px",
      fontSize: "12px",
      color: "rgba(255,255,255,0.72)",
      lineHeight: "1.5"
    });

    titleNode.textContent = String(title || "正在导出");
    detailNode.textContent = String(detail || "正在导出…");
    dialog.append(titleNode, detailNode);
    host.append(dialog);
    (document.body || document.documentElement).append(host);
    return { host, titleNode, detailNode };
  }

  function begin({ title = "正在导出", detail = "正在导出…" } = {}) {
    const token = ++nextToken;
    removeOwnedHost(active?.host);

    const existing = document.querySelector(`[${BLOCKING_ATTRIBUTE}="1"]`);
    if (existing instanceof HTMLElement && existing.getAttribute(OWNED_ATTRIBUTE) !== "1") {
      active = { token, host: null, titleNode: null, detailNode: null, external: true };
      return token;
    }

    const nodes = createHost(title, detail);
    active = { token, ...nodes, external: false };
    return token;
  }

  function update(token, { title, detail } = {}) {
    if (!active || active.token !== Number(token) || active.external) return false;
    if (title !== undefined) {
      active.titleNode.textContent = String(title);
      active.host.setAttribute("aria-label", String(title));
    }
    if (detail !== undefined) active.detailNode.textContent = String(detail);
    return true;
  }

  function end(token) {
    if (!active || active.token !== Number(token)) return false;
    removeOwnedHost(active.host);
    active = null;
    return true;
  }

  function snapshot() {
    return active
      ? { active: true, token: active.token, external: active.external }
      : { active: false, token: null, external: false };
  }

  root.NovaFlowExportProgressDialog = Object.freeze({
    version: 1,
    begin,
    update,
    end,
    snapshot
  });
})(typeof window !== "undefined" ? window : globalThis);
