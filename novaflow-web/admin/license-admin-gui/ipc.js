const fs = require("fs");
const path = require("path");
const { ipcMain, dialog, shell, app, BrowserWindow } = require("electron");
const licenseAdminCore = require("../license-admin-core");
const licenseAdminOnline = require("../license-admin-online");
const adminData = require("./admin-data");

function getDefaultPaths() {
  const bundledPub = path.join(__dirname, "..", "license-public-key.b64");
  const bundledPriv = path.join(__dirname, "..", ".secrets", "license-private-key.pem");
  const bundledOk = fs.existsSync(bundledPub) && fs.existsSync(bundledPriv);
  if (bundledOk) {
    return {
      mode: "bundled",
      baseDir: path.join(app.getPath("documents"), "NovaFlow-License"),
      publicKeyPath: bundledPub,
      privateKeyPath: bundledPriv,
      defaultLicenseOutPath: path.join(app.getPath("documents"), "NovaFlow-License", "licenses", "license.nfl")
    };
  }
  const base = path.join(app.getPath("documents"), "NovaFlow-License");
  return {
    mode: "documents",
    baseDir: base,
    publicKeyPath: path.join(base, "keys", "license-public-key.b64"),
    privateKeyPath: path.join(base, "keys", "license-private-key.pem"),
    defaultLicenseOutPath: path.join(base, "licenses", "license.nfl")
  };
}

function registerLicenseAdminIpc() {
  ipcMain.handle("admin-default-paths", async () => {
    return getDefaultPaths();
  });

  // On Windows a native alert()/confirm() leaves the page without keyboard
  // focus once it closes: the window is in front, clicks still work, but
  // nothing typed reaches an input until the app is restarted. Blurring and
  // re-focusing the window hands keyboard focus back to the page.
  ipcMain.on("admin-window-refocus", (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win || win.isDestroyed()) return;
    win.blur();
    win.focus();
  });

  const registerAdminDataList = (channel, loader) => {
    ipcMain.handle(channel, async () => {
      try {
        const result = await loader();
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    });
  };

  registerAdminDataList("admin:data:users:list", adminData.getAdminUsers);
  registerAdminDataList("admin:data:credits:list", adminData.getAdminCredits);
  registerAdminDataList("admin:data:credit_logs:list", adminData.getAdminCreditLogs);
  registerAdminDataList("admin:data:ai_providers:list", adminData.getAdminAiProviders);
  registerAdminDataList("admin:data:ai_models:list", adminData.getAdminAiModels);
  registerAdminDataList("admin:data:ai_tasks:list", adminData.getAdminAiTasks);
  registerAdminDataList("admin:data:system_settings:list", adminData.getAdminSystemSettings);
  registerAdminDataList("admin:data:gpu_workers:list", adminData.getAdminGpuWorkers);
  registerAdminDataList("admin:data:web_task_usage:list", adminData.getAdminWebTaskUsage);
  registerAdminDataList("admin:data:worker_codes:list", adminData.getAdminWorkerRegistrationCodes);
  registerAdminDataList("admin:data:provider_quotas:grok:list", () => adminData.getAdminProviderCallQuotas({ providerKey: "grok" }));
  ipcMain.handle("admin:data:worker_codes:create", async (_evt, payload) => {
    try {
      return { ok: true, result: await adminData.createAdminWorkerRegistrationCode(payload) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin:data:worker_codes:revoke", async (_evt, payload) => {
    try {
      return { ok: true, result: await adminData.revokeAdminWorkerRegistrationCode(payload) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin:data:gpu_workers:set-status", async (_evt, payload) => {
    try {
      return { ok: true, result: await adminData.setAdminGpuWorkerStatus(payload) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  const registerAdminDataWrite = (channel, writer) => {
    ipcMain.handle(channel, async (_evt, payload) => {
      try {
        return { ok: true, result: await writer(payload) };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    });
  };
  registerAdminDataWrite("admin:data:gpu_workers:set-tier", adminData.setAdminGpuWorkerTier);
  registerAdminDataWrite("admin:data:gpu_workers:delete", adminData.deleteAdminGpuWorker);
  registerAdminDataWrite("admin:data:worker_codes:delete", adminData.deleteAdminWorkerRegistrationCode);
  registerAdminDataWrite("admin:data:worker_codes:purge", adminData.purgeAdminWorkerRegistrationCodes);
  registerAdminDataWrite("admin:data:web_tasks:purge", adminData.purgeAdminWebTasks);

  ipcMain.handle("admin:data:provider_quotas:list", async (_evt, payload) => {
    try {
      const result = await adminData.getAdminProviderCallQuotas({ providerKey: payload?.providerKey || payload?.provider_key || "grok" });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
  registerAdminDataList("admin:provider:comfyui:status", adminData.getAdminComfyUiProviderStatus);
  registerAdminDataList("admin:provider:grok:status", adminData.getAdminGrokProviderStatus);
  registerAdminDataList("admin:provider:runninghub:status", adminData.getAdminRunningHubProviderStatus);
  registerAdminDataList("admin:provider:runninghub:check", () => adminData.getAdminRunningHubProviderStatus({ checkAccount: true }));

  ipcMain.handle("admin:data:users:create", async (_evt, payload) => {
    try {
      const result = await adminData.createAdminUser(payload);
      return { ok: result?.ok !== false && result?.status !== "error", result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin:data:users:update", async (_evt, payload) => {
    try {
      const result = await adminData.updateAdminUser(payload);
      return { ok: result?.ok !== false && result?.status !== "error", result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin:data:users:delete", async (_evt, payload) => {
    try {
      const result = await adminData.deleteAdminUser(payload);
      return { ok: result?.ok !== false && result?.status !== "error", result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin:data:users:password:reset", async (_evt, payload) => {
    try {
      const result = await adminData.resetAdminUserPassword(payload);
      return { ok: result?.ok !== false && result?.status !== "error", result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin:data:credits:adjust", async (_evt, payload) => {
    try {
      const result = await adminData.adjustAdminUserCredits(payload);
      return { ok: result?.ok !== false && result?.status !== "error", result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin:data:provider_budget:set", async (_evt, payload) => {
    try {
      const result = await adminData.setAdminProviderBudget(payload);
      return { ok: result?.ok !== false && result?.status !== "error", result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin:provider:runtime-config:set", async (_evt, payload) => {
    try {
      const result = await adminData.setAdminProviderRuntimeConfig(payload);
      return { ok: result?.ok !== false && result?.status !== "error", result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-read-public-key", async (_evt, payload) => {
    const def = getDefaultPaths();
    const pub = payload?.publicKeyPath || def.publicKeyPath;
    try {
      if (!fs.existsSync(pub)) return { ok: false, error: "公钥文件不存在" };
      const text = fs.readFileSync(pub, "utf8");
      return { ok: true, text: String(text || "").trim() };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-read-private-key", async (_evt, payload) => {
    const def = getDefaultPaths();
    const priv = payload?.privateKeyPath || def.privateKeyPath;
    try {
      if (!fs.existsSync(priv)) return { ok: false, error: "私钥文件不存在" };
      const text = fs.readFileSync(priv, "utf8");
      return { ok: true, text: String(text || "").trim() };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-pick-public-path", async (_evt, payload) => {
    const def = payload?.defaultPath;
    const pick = await dialog.showSaveDialog({
      defaultPath: typeof def === "string" && def.trim() ? def : getDefaultPaths().publicKeyPath,
      filters: [{ name: "Public Key", extensions: ["b64"] }]
    });
    if (pick.canceled || !pick.filePath) return { canceled: true };
    return { canceled: false, filePath: pick.filePath };
  });

  ipcMain.handle("admin-pick-private-path", async (_evt, payload) => {
    const def = payload?.defaultPath;
    const pick = await dialog.showSaveDialog({
      defaultPath: typeof def === "string" && def.trim() ? def : getDefaultPaths().privateKeyPath,
      filters: [{ name: "Private Key", extensions: ["pem"] }]
    });
    if (pick.canceled || !pick.filePath) return { canceled: true };
    return { canceled: false, filePath: pick.filePath };
  });

  ipcMain.handle("admin-pick-license-out", async (_evt, payload) => {
    const def = payload?.defaultPath;
    const pick = await dialog.showSaveDialog({
      defaultPath: typeof def === "string" && def.trim() ? def : getDefaultPaths().defaultLicenseOutPath,
      filters: [{ name: "NovaFlow License", extensions: ["nfl", "json"] }]
    });
    if (pick.canceled || !pick.filePath) return { canceled: true };
    return { canceled: false, filePath: pick.filePath };
  });

  ipcMain.handle("admin-pick-license-in", async () => {
    const pick = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "NovaFlow License", extensions: ["nfl", "json"] }]
    });
    if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
    return { canceled: false, filePath: pick.filePaths[0] };
  });

  ipcMain.handle("admin-open-folder", async (_evt, payload) => {
    const p = payload?.path;
    if (typeof p !== "string" || !p.trim()) return { ok: false };
    const target = fs.existsSync(p) && fs.lstatSync(p).isDirectory() ? p : path.dirname(p);
    await shell.openPath(target);
    return { ok: true };
  });

  ipcMain.handle("admin-status", async (_evt, payload) => {
    const def = getDefaultPaths();
    const pub = payload?.publicKeyPath || def.publicKeyPath;
    const priv = payload?.privateKeyPath || def.privateKeyPath;
    try {
      const st = licenseAdminCore.readKeyStatus(pub, priv);
      return { ok: true, status: st };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin:data:provider_quotas:grok:set", async (_evt, payload) => {
    try {
      const result = await adminData.setAdminProviderCallQuota({ ...payload, providerKey: "grok" });
      return { ok: result?.ok !== false && result?.status !== "error", result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin:data:provider_quotas:set", async (_evt, payload) => {
    try {
      const result = await adminData.setAdminProviderCallQuota(payload);
      return { ok: result?.ok !== false && result?.status !== "error", result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-online-config", async () => {
    try {
      return { ok: true, config: licenseAdminOnline.getPublicConfig(app.getPath("userData")) };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-online-save-config", async (_evt, payload) => {
    try {
      const config = licenseAdminOnline.saveConfig(app.getPath("userData"), {
        supabaseUrl: payload?.supabaseUrl,
        secretKey: payload?.secretKey
      });
      return { ok: true, config };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-online-test", async () => {
    try {
      const result = await licenseAdminOnline.testConnection(app.getPath("userData"));
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-online-query", async (_evt, payload) => {
    try {
      const result = await licenseAdminOnline.queryLicenses(app.getPath("userData"), {
        licenseKey: payload?.licenseKey,
        machineId: payload?.machineId,
        limit: payload?.limit
      });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-online-upsert", async (_evt, payload) => {
    try {
      const result = await licenseAdminOnline.upsertLicense(app.getPath("userData"), {
        licenseKey: payload?.licenseKey,
        machineId: payload?.machineId,
        status: payload?.status,
        expireAt: payload?.expireAt,
        permissionsText: payload?.permissionsText
      });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-online-set-status", async (_evt, payload) => {
    try {
      const result = await licenseAdminOnline.setLicenseStatus(app.getPath("userData"), {
        licenseKey: payload?.licenseKey,
        status: payload?.status
      });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-online-delete", async (_evt, payload) => {
    try {
      const result = await licenseAdminOnline.deleteLicense(app.getPath("userData"), {
        id: payload?.id,
        licenseKey: payload?.licenseKey
      });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-generate", async (_evt, payload) => {
    const def = getDefaultPaths();
    const pub = payload?.publicKeyPath || def.publicKeyPath;
    const priv = payload?.privateKeyPath || def.privateKeyPath;
    try {
      const res = licenseAdminCore.generateKeyPair(pub, priv);
      return { ok: true, result: res };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-delete", async (_evt, payload) => {
    const def = getDefaultPaths();
    const pub = payload?.publicKeyPath || def.publicKeyPath;
    const priv = payload?.privateKeyPath || def.privateKeyPath;
    try {
      const res = licenseAdminCore.deleteKeyFiles(pub, priv);
      return { ok: true, result: res };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  // Re-sign a licence code for an existing record, without saving a file.
  //
  // The code is not stored anywhere: it is produced when a licence is issued
  // and then only lives in that tab and in the .nfl. Reading it back off a
  // record meant re-issuing from the 新建授权码 tab and retyping the machine
  // id, so the list now signs one on demand from what the record already
  // holds. The payload carries issuedAt, so this is a fresh code rather than
  // the original string - equally valid, since verification checks the
  // product, the machine and the expiry, not when it was signed.
  ipcMain.handle("admin-license-code", async (_evt, payload) => {
    const def = getDefaultPaths();
    try {
      const res = licenseAdminCore.issueLicenseFile({
        machineId: payload?.machineId,
        licenseKey: payload?.licenseKey,
        privateKeyPath: payload?.privateKeyPath || def.privateKeyPath,
        expiresAt: payload?.expiresAt,
        featuresText: payload?.featuresText
      });
      return { ok: true, result: { licenseText: String(res.licenseCode || "") } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-issue-license", async (_evt, payload) => {
    const def = getDefaultPaths();
    const priv = payload?.privateKeyPath || def.privateKeyPath;
    const outPath = payload?.outPath || def.defaultLicenseOutPath;
    try {
      const res = licenseAdminCore.issueLicenseFile({
        machineId: payload?.machineId,
        licenseKey: payload?.licenseKey,
        privateKeyPath: priv,
        outPath,
        expiresAt: payload?.expiresAt,
        featuresText: payload?.featuresText
      });
      let online = null;
      if (payload?.syncOnline) {
        try {
          online = await licenseAdminOnline.upsertLicense(app.getPath("userData"), {
            licenseKey: res.licenseObj?.payload?.licenseKey,
            machineId: res.licenseObj?.payload?.machineId,
            status: "active",
            expireAt: payload?.remoteExpireAt || payload?.expiresAt,
            permissionsText: payload?.featuresText
          });
        } catch (onlineErr) {
          online = { ok: false, error: String(onlineErr?.message || onlineErr) };
        }
      }
      return { ok: true, result: { outPath: res.outPath, payload: res.licenseObj?.payload, licenseText: String(res.licenseCode || ""), online } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("admin-verify-license", async (_evt, payload) => {
    const def = getDefaultPaths();
    const pub = payload?.publicKeyPath || def.publicKeyPath;
    try {
      const res = licenseAdminCore.verifyLicenseFile({
        licensePath: payload?.licensePath,
        publicKeyPath: pub,
        machineId: payload?.machineId
      });
      return { ok: true, result: res };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

module.exports = { getDefaultPaths, registerLicenseAdminIpc };
