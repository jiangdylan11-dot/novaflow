const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const noopUnsubscribe = () => void 0;

const safeBlocked = (code, message) => ({
  type: "TOOLS_BRIDGE_RESULT",
  ok: false,
  mode: "packaged_smoke",
  code,
  error: { code, message },
  realWriteCount: 0
});

const electronAPI = {
  saveSpinePackage: () => safeBlocked("SMOKE_API_BLOCKED", "saveSpinePackage is blocked in tools smoke mode."),
  saveSplitPackage: () => safeBlocked("SMOKE_API_BLOCKED", "saveSplitPackage is blocked in tools smoke mode."),
  saveSplitTempPackage: () => safeBlocked("SMOKE_API_BLOCKED", "saveSplitTempPackage is blocked in tools smoke mode."),
  saveSplitDebugImages: () => safeBlocked("SMOKE_API_BLOCKED", "saveSplitDebugImages is blocked in tools smoke mode."),
  saveSplitPsd: () => safeBlocked("SMOKE_API_BLOCKED", "saveSplitPsd is blocked in tools smoke mode."),
  openSpineProject: () => ({ canceled: true }),
  openSpineJson: () => ({ canceled: true }),
  openSpineAtlas: () => ({ canceled: true }),
  openSpineImage: () => ({ canceled: true }),
  openSequenceFolder: () => ({ canceled: true }),
  pickDirectory: () => invoke("tools:pick-directory-blocked"),
  exportPickSaveFile: () => safeBlocked("SMOKE_API_BLOCKED", "exportPickSaveFile is blocked in tools smoke mode."),
  exportCreateTempDir: () => safeBlocked("SMOKE_API_BLOCKED", "exportCreateTempDir is blocked in tools smoke mode."),
  exportCleanupDir: () => safeBlocked("SMOKE_API_BLOCKED", "exportCleanupDir is blocked in tools smoke mode."),
  exportEncodeFramesToVideo: () => safeBlocked("SMOKE_API_BLOCKED", "exportEncodeFramesToVideo is blocked in tools smoke mode."),
  exportEncodeVideoToVideo: () => safeBlocked("SMOKE_API_BLOCKED", "exportEncodeVideoToVideo is blocked in tools smoke mode."),
  writeBinaryFile: (payload) => invoke("tools:legacy-write-blocked", payload),
  compressPngLossless: (payload) => invoke("tools:smoke-compress-png-lossless", payload),
  compressPngStrong: () => safeBlocked("SMOKE_API_BLOCKED", "compressPngStrong is blocked in tools smoke mode."),
  compressSpineAtlasSafe: () => safeBlocked("SMOKE_API_BLOCKED", "compressSpineAtlasSafe is blocked in tools smoke mode."),
  getPathForFile: () => "",
  saveTextFile: () => safeBlocked("SMOKE_API_BLOCKED", "saveTextFile is blocked in tools smoke mode."),
  windowMinimize: () => ({ ok: true, smoke: true }),
  windowToggleMaximize: () => ({ ok: true, smoke: true }),
  windowClose: () => ({ ok: true, smoke: true }),
  windowSetMinSize: () => ({ ok: true, smoke: true }),
  windowEnsureMinSize: () => ({ ok: true, smoke: true }),
  windowGetPosition: () => ({ ok: true, x: 0, y: 0 }),
  windowSetPosition: () => ({ ok: true, smoke: true }),
  getSystemMousePosition: () => ({ ok: true, x: 0, y: 0, source: "tools-smoke-preload" }),
  loadUserData: () => null,
  saveUserData: () => ({ ok: true, smoke: true, blocked: true }),
  licenseGetState: () => invoke("tools:inspect-entitlement"),
  licenseGetMachineId: () => ({ ok: true, machineId: "smoke-profile" }),
  licenseImportFile: () => safeBlocked("SMOKE_API_BLOCKED", "licenseImportFile is blocked in tools smoke mode."),
  licenseImportText: () => safeBlocked("SMOKE_API_BLOCKED", "licenseImportText is blocked in tools smoke mode."),
  licenseRemove: () => safeBlocked("SMOKE_API_BLOCKED", "licenseRemove is blocked in tools smoke mode."),
  getUserDataPath: () => invoke("tools:get-smoke-user-data-path"),
  openUserDataFolder: () => safeBlocked("SMOKE_API_BLOCKED", "openUserDataFolder is blocked in tools smoke mode."),
  templatesResetToBundled: () => safeBlocked("SMOKE_API_BLOCKED", "templatesResetToBundled is blocked in tools smoke mode."),
  getAppVersion: () => "tools-smoke",
  getAppInfo: () => ({ ok: true, smoke: true, version: "tools-smoke" }),
  runtimeGetSystemStats: () => safeBlocked("SMOKE_API_BLOCKED", "Runtime APIs are blocked in tools smoke mode."),
  runtimeRequestJson: () => safeBlocked("SMOKE_API_BLOCKED", "Runtime APIs are blocked in tools smoke mode."),
  runtimeRequestBinary: () => safeBlocked("SMOKE_API_BLOCKED", "Runtime APIs are blocked in tools smoke mode."),
  runtimeUploadImage: () => safeBlocked("SMOKE_API_BLOCKED", "Runtime APIs are blocked in tools smoke mode."),
  aiSeqFixHeadTailColor: () => safeBlocked("SMOKE_API_BLOCKED", "AI sequence APIs are blocked in tools smoke mode."),
  aiSeqTrimVideoTailFrame: () => safeBlocked("SMOKE_API_BLOCKED", "AI sequence APIs are blocked in tools smoke mode."),
  aiSeqProbeVideoMeta: () => safeBlocked("SMOKE_API_BLOCKED", "AI sequence APIs are blocked in tools smoke mode."),
  aiSeqCacheTempFile: () => safeBlocked("SMOKE_API_BLOCKED", "AI sequence APIs are blocked in tools smoke mode."),
  aiSeqCacheCopyFromPath: () => safeBlocked("SMOKE_API_BLOCKED", "AI sequence APIs are blocked in tools smoke mode."),
  aiSeqReadTempFile: () => safeBlocked("SMOKE_API_BLOCKED", "AI sequence APIs are blocked in tools smoke mode."),
  aiSeqRembgBatch: () => safeBlocked("SMOKE_API_BLOCKED", "AI sequence APIs are blocked in tools smoke mode."),
  onAiSeqFixHeadTailColorProgress: () => noopUnsubscribe,
  onAiSeqRembgBatchProgress: () => noopUnsubscribe,
  onFilesDropped: () => noopUnsubscribe,
  openExternal: () => safeBlocked("SMOKE_API_BLOCKED", "openExternal is blocked in tools smoke mode."),
  isElevated: () => ({ ok: true, elevated: false, smoke: true }),
  logClientError: (payload) => invoke("tools:client-error", payload)
};

const novaflowToolsBridge = {
  getCapabilities: () => invoke("tools:get-capabilities"),
  validateExport: (payload) => invoke("tools:validate-export", payload),
  getTempSession: () => invoke("tools:get-temp-session"),
  getOperationReceipt: (payload) => invoke("tools:get-operation-receipt", payload),
  dryRun: (payload) => invoke("tools:dry-run", payload),
  tempExport: (payload) => invoke("tools:temp-export", payload),
  getTelemetry: () => invoke("tools:get-telemetry"),
  resetTelemetry: () => invoke("tools:reset-smoke-telemetry"),
  inspectNative: () => invoke("tools:inspect-native"),
  inspectEntitlement: () => invoke("tools:inspect-entitlement")
};

contextBridge.exposeInMainWorld("appInfo", {
  platform: process.platform,
  smoke: true
});

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
contextBridge.exposeInMainWorld("novaflowToolsBridge", novaflowToolsBridge);
contextBridge.exposeInMainWorld("__NOVAFLOW_TOOLS_SMOKE__", {
  enabled: true,
  legacyWritePolicy: "block",
  pickDirectoryPolicy: "block"
});
