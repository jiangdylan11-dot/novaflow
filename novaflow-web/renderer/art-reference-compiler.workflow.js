(function () {
  if (window.NovaFlowArtReferenceCompiler) return;

  const VERSION = "20260721-reference-compiler-1";
  const CACHE = new Map();
  const IMAGE_ROLES = new Set(["subject", "pose", "background", "composition", "ui_layout"]);
  const TEXT_ONLY_ROLES = new Set(["style", "color", "material"]);

  const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
  const runtimeBaseUrl = () => normalizeBaseUrl(localStorage.getItem("comfyui_last_connected_url") || localStorage.getItem("bone_comfyui_last_connected_url") || "http://127.0.0.1:8188");
  const api = () => window.electronAPI || {};

  async function requestJson(path, init = {}) {
    const baseUrl = runtimeBaseUrl();
    if (api().comfyRequestJson) return api().comfyRequestJson({ baseUrl, path, init });
    const response = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, init);
    const data = await response.json();
    return { ok: response.ok, status: response.status, data: typeof data === "string" ? JSON.parse(data) : data };
  }

  async function upload(dataUrl, fileName) {
    const baseUrl = runtimeBaseUrl();
    const comma = String(dataUrl || "").indexOf("base64,");
    const dataBase64 = comma >= 0 ? String(dataUrl).slice(comma + 7) : "";
    if (!dataBase64) throw new Error("鍙傝€冨浘鏁版嵁鏃犳晥");
    if (api().comfyUploadImage) {
      const result = await api().comfyUploadImage({ baseUrl, fileName, dataBase64, type: "input", subfolder: "" });
      if (!result?.ok) throw new Error(result?.error || "鍙傝€冨浘涓婁紶澶辫触");
      return String(result?.data?.name || result?.name || fileName);
    }
    const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("image", new Blob([bytes], { type: "image/png" }), fileName);
    form.append("type", "input");
    const response = await fetch(`${baseUrl}/upload/image`, { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error("鍙傝€冨浘涓婁紶澶辫触");
    return String(result?.name || fileName);
  }

  function outputFiles(value) {
    const files = [];
    const visit = (entry) => {
      if (!entry) return;
      if (Array.isArray(entry)) return entry.forEach(visit);
      if (typeof entry !== "object") return;
      if (entry.filename) files.push({ filename: entry.filename, subfolder: entry.subfolder || "", type: entry.type || "output" });
      Object.values(entry).forEach(visit);
    };
    visit(value?.outputs || value);
    return files;
  }

  async function fetchOutput(file) {
    const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || "", type: file.type || "output" });
    const baseUrl = runtimeBaseUrl();
    if (api().comfyRequestBinary) {
      const result = await api().comfyRequestBinary({ baseUrl, path: `/view?${query}`, init: { method: "GET" } });
      if (!result?.ok || !result.dataBase64) throw new Error("Failed to read the compiled reference image");
      return `data:${result.contentType || "image/png"};base64,${result.dataBase64}`;
    }
    const response = await fetch(`${baseUrl}/view?${query}`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
  }

  async function runWorkflow(workflow, timeoutMs = 180000) {
    const clientId = `nf_ref_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const queued = await requestJson("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: clientId }) });
    const promptId = String(queued?.data?.prompt_id || queued?.prompt_id || "");
    if (!queued?.ok || !promptId) throw new Error(queued?.error || "Failed to submit the reference compiler workflow");
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 650));
      const history = await requestJson(`/history/${encodeURIComponent(promptId)}`, { method: "GET" });
      const root = history?.data && typeof history.data === "object" ? history.data : history;
      const item = root?.[promptId] || root;
      const files = outputFiles(item);
      if (files.length) return fetchOutput(files[files.length - 1]);
      const messages = item?.status?.messages || [];
      if (messages.some((entry) => Array.isArray(entry) && entry[0] === "execution_error")) throw new Error("Reference compiler workflow failed");
    }
    throw new Error("Reference compiler workflow timed out");
  }

  async function runtimeInfo() {
    const result = await requestJson("/object_info", { method: "GET" });
    let value = result?.data ?? result;
    if (typeof value === "string") value = JSON.parse(value);
    return value && typeof value === "object" ? value : {};
  }

  function workflowFor(role, inputName, info) {
    const prefix = `NovaFlow_Reference_${role}_${Date.now()}`;
    const base = { "1": { class_type: "LoadImage", inputs: { image: inputName } } };
    if (role === "background" && info.BiRefNetRMBG) {
      return { ...base, "2": { class_type: "BiRefNetRMBG", inputs: { image: ["1", 0], model: "BiRefNet-general", mask_blur: 2, mask_offset: 2, invert_output: true, refine_foreground: false, background: "Color", background_color: "#808080" } }, "3": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: prefix } } };
    }
    if (role === "composition" && info.Canny) {
      return { ...base, "2": { class_type: "Canny", inputs: { image: ["1", 0], low_threshold: 0.3, high_threshold: 0.72 } }, "3": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: prefix } } };
    }
    if (role === "pose" && info.SDPoseKeypointExtractor && info.SDPoseDrawKeypoints && info.CheckpointLoaderSimple) {
      const names = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
      const poseCheckpoint = Array.isArray(names) ? names.find((name) => /sdpose/i.test(String(name))) : "";
      if (poseCheckpoint) {
        return { ...base,
          "2": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: poseCheckpoint } },
          "3": { class_type: "SDPoseKeypointExtractor", inputs: { model: ["2", 0], vae: ["2", 2], image: ["1", 0], batch_size: 1 } },
          "4": { class_type: "SDPoseDrawKeypoints", inputs: { keypoints: ["3", 0], draw_body: true, draw_hands: true, draw_face: true, draw_feet: true, ...(info.SDPoseDrawKeypoints?.input?.required?.draw_head || info.SDPoseDrawKeypoints?.input?.optional?.draw_head ? { draw_head: true } : {}), stick_width: 4, face_point_size: 3, score_threshold: 0.3 } },
          "5": { class_type: "SaveImage", inputs: { images: ["4", 0], filename_prefix: prefix } }
        };
      }
    }
    if ((role === "ui_layout" || role === "pose") && info.Canny) {
      return { ...base, "2": { class_type: "Canny", inputs: { image: ["1", 0], low_threshold: role === "ui_layout" ? 0.25 : 0.35, high_threshold: role === "ui_layout" ? 0.65 : 0.78 } }, "3": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: prefix } } };
    }
    return null;
  }

  async function hashImage(dataUrl) {
    const bytes = new TextEncoder().encode(String(dataUrl || ""));
    if (crypto?.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("");
    }
    return `${bytes.length}_${String(dataUrl || "").slice(-32)}`;
  }

  async function compileReference(item, role, index, info) {
    const sourceUrl = String(item?.imageUrl || item?.dataUrl || "");
    const hash = await hashImage(sourceUrl);
    const key = `${VERSION}:${role}:${hash}`;
    if (CACHE.has(key)) return CACHE.get(key);
    const base = { index, role, hash, sourceUrl, mode: TEXT_ONLY_ROLES.has(role) ? "text" : "image", status: "ready", compiledUrl: role === "subject" ? sourceUrl : "", strongControl: false };
    if (role === "subject" || TEXT_ONLY_ROLES.has(role)) { CACHE.set(key, base); return base; }
    const workflow = workflowFor(role, await upload(sourceUrl, `nf_reference_${hash}.png`), info);
    if (!workflow) {
      const fallback = { ...base, mode: "text", status: "fallback", compiledUrl: "", reason: "Required reference compiler node is unavailable" };
      CACHE.set(key, fallback);
      return fallback;
    }
    try {
      const compiled = { ...base, compiledUrl: await runWorkflow(workflow), mode: "compiled-image", processor: role === "background" ? "BiRefNet" : role === "pose" && workflow["3"]?.class_type === "SDPoseKeypointExtractor" ? "SDPose" : "Canny" };
      CACHE.set(key, compiled);
      return compiled;
    } catch (error) {
      const fallback = { ...base, mode: "text", status: "fallback", compiledUrl: "", reason: String(error?.message || error) };
      CACHE.set(key, fallback);
      return fallback;
    }
  }

  async function compile(items, roles, onProgress) {
    const info = await runtimeInfo().catch(() => ({}));
    const results = [];
    for (let index = 0; index < items.length; index += 1) {
      onProgress?.({ index, total: items.length, role: roles[index] || "subject" });
      results.push(await compileReference(items[index], roles[index] || "subject", index, info));
    }
    const controlNames = info?.ControlNetLoader?.input?.required?.control_net_name?.[0];
    return { version: VERSION, results, capabilities: { controlNet: Array.isArray(controlNames) && controlNames.length > 0, controlNetNames: Array.isArray(controlNames) ? controlNames.slice() : [], poseNode: Boolean(info.SDPoseKeypointExtractor && info.SDPoseDrawKeypoints), depthNode: Boolean(info["MiDaS Depth Approximation"]), backgroundNode: Boolean(info.BiRefNetRMBG) } };
  }

  window.NovaFlowArtReferenceCompiler = { version: VERSION, compile, clearCache: () => CACHE.clear(), imageRoles: IMAGE_ROLES };
})();

