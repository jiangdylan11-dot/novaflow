const { pathToFileURL } = require("node:url");

const VIDEO_RESOURCE_MEDIA_SCHEME = "novaflow-media";
const VIDEO_RESOURCE_MEDIA_HOST = "resource";
const VIDEO_RESOURCE_MEDIA_IPC = Object.freeze({
  register: "video-resource-media-register",
  release: "video-resource-media-release"
});
const SUPPORTED_EXTENSIONS = new Set([".mp4", ".webm"]);

function mimeTypeForPath(filePath, pathApi) {
  return String(pathApi.extname(filePath || "")).toLowerCase() === ".webm" ? "video/webm" : "video/mp4";
}

function registerVideoResourceMediaScheme(protocolApi) {
  if (!protocolApi || typeof protocolApi.registerSchemesAsPrivileged !== "function") {
    throw new TypeError("video resource media protocol unavailable");
  }
  protocolApi.registerSchemesAsPrivileged([{
    scheme: VIDEO_RESOURCE_MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }]);
}

function createVideoResourceMediaService(options = {}) {
  const fsApi = options.fs;
  const pathApi = options.path;
  const cryptoApi = options.crypto;
  const protocolApi = options.protocol;
  const electronNet = options.electronNet;
  const ResponseCtor = options.Response || globalThis.Response;
  const HeadersCtor = options.Headers || globalThis.Headers;
  if (!fsApi || !pathApi || !cryptoApi || !protocolApi || !electronNet) {
    throw new TypeError("video resource media dependencies missing");
  }

  const resources = new Map();
  const ownerTokens = new Map();
  let protocolRegistered = false;

  function errorResponse(status, message) {
    return new ResponseCtor(String(message || "Not Found"), {
      status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }

  function tokenFromRequestUrl(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== `${VIDEO_RESOURCE_MEDIA_SCHEME}:` || url.hostname !== VIDEO_RESOURCE_MEDIA_HOST) return "";
      return decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
    } catch {
      return "";
    }
  }

  async function handleRequest(request) {
    const token = tokenFromRequestUrl(request?.url);
    const resource = token ? resources.get(token) : null;
    if (!resource) return errorResponse(404, "video resource not found");
    try {
      const stat = fsApi.statSync(resource.filePath);
      if (!stat.isFile()) return errorResponse(404, "video resource not found");
      const headers = new HeadersCtor();
      const range = request?.headers?.get?.("range");
      if (range) headers.set("range", String(range));
      return electronNet.fetch(pathToFileURL(resource.filePath).toString(), { headers });
    } catch (error) {
      return errorResponse(404, error?.message || "video resource unavailable");
    }
  }

  function registerProtocol() {
    if (protocolRegistered) return true;
    if (typeof protocolApi.handle !== "function") throw new TypeError("video resource media handler unavailable");
    protocolApi.handle(VIDEO_RESOURCE_MEDIA_SCHEME, handleRequest);
    protocolRegistered = true;
    return true;
  }

  function register(ownerId, payload = {}) {
    const normalizedOwnerId = Number(ownerId);
    if (!Number.isInteger(normalizedOwnerId) || normalizedOwnerId <= 0) {
      return { ok: false, error: "video_resource_owner_invalid" };
    }
    const requestedPath = String(payload.filePath || payload.path || "").trim();
    if (!requestedPath) return { ok: false, error: "video_resource_path_missing" };
    const filePath = pathApi.resolve(requestedPath);
    const extension = String(pathApi.extname(filePath)).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) return { ok: false, error: "video_resource_format_unsupported" };
    let stat;
    try {
      stat = fsApi.statSync(filePath);
    } catch (error) {
      return { ok: false, error: String(error?.message || "video_resource_file_missing") };
    }
    if (!stat.isFile()) return { ok: false, error: "video_resource_file_missing" };

    const token = cryptoApi.randomBytes(24).toString("hex");
    const fileName = pathApi.basename(filePath);
    const resource = Object.freeze({
      token,
      ownerId: normalizedOwnerId,
      filePath,
      fileName,
      mimeType: mimeTypeForPath(filePath, pathApi),
      createdAt: Date.now()
    });
    resources.set(token, resource);
    if (!ownerTokens.has(normalizedOwnerId)) ownerTokens.set(normalizedOwnerId, new Set());
    ownerTokens.get(normalizedOwnerId).add(token);
    return {
      ok: true,
      token,
      url: `${VIDEO_RESOURCE_MEDIA_SCHEME}://${VIDEO_RESOURCE_MEDIA_HOST}/${encodeURIComponent(token)}/${encodeURIComponent(fileName)}`,
      filePath,
      fileName,
      mimeType: resource.mimeType
    };
  }

  function release(ownerId, payload = {}) {
    const token = String(payload.token || "").trim();
    const resource = token ? resources.get(token) : null;
    if (!resource) return { ok: true, released: false };
    if (Number(ownerId) !== resource.ownerId) return { ok: false, error: "video_resource_owner_mismatch" };
    resources.delete(token);
    const tokens = ownerTokens.get(resource.ownerId);
    tokens?.delete(token);
    if (tokens && tokens.size === 0) ownerTokens.delete(resource.ownerId);
    return { ok: true, released: true };
  }

  function closeOwner(ownerId) {
    const normalizedOwnerId = Number(ownerId);
    const tokens = ownerTokens.get(normalizedOwnerId);
    if (!tokens) return { ok: true, released: 0 };
    let released = 0;
    for (const token of Array.from(tokens)) {
      if (resources.delete(token)) released += 1;
    }
    ownerTokens.delete(normalizedOwnerId);
    return { ok: true, released };
  }

  function closeAll() {
    const released = resources.size;
    resources.clear();
    ownerTokens.clear();
    return { ok: true, released };
  }

  function debugSnapshot() {
    return Object.freeze({ protocolRegistered, resourceCount: resources.size, ownerCount: ownerTokens.size });
  }

  return Object.freeze({ registerProtocol, register, release, closeOwner, closeAll, debugSnapshot, handleRequest });
}

function registerVideoResourceMediaIpc(options = {}) {
  const service = options.service;
  const handleIpc = options.handleIpc;
  if (!service || typeof handleIpc !== "function") throw new TypeError("video resource media IPC dependencies missing");
  const cleanupBoundSenders = new WeakSet();
  handleIpc(VIDEO_RESOURCE_MEDIA_IPC.register, async (event, payload) => {
    const sender = event?.sender;
    const ownerId = sender?.id;
    if (sender && (typeof sender === "object" || typeof sender === "function") && !cleanupBoundSenders.has(sender)) {
      cleanupBoundSenders.add(sender);
      sender.once?.("destroyed", () => { service.closeOwner(ownerId); });
    }
    return service.register(ownerId, payload || {});
  });
  handleIpc(VIDEO_RESOURCE_MEDIA_IPC.release, async (event, payload) => service.release(event?.sender?.id, payload || {}));
}

module.exports = {
  VIDEO_RESOURCE_MEDIA_SCHEME,
  VIDEO_RESOURCE_MEDIA_HOST,
  VIDEO_RESOURCE_MEDIA_IPC,
  registerVideoResourceMediaScheme,
  createVideoResourceMediaService,
  registerVideoResourceMediaIpc
};
