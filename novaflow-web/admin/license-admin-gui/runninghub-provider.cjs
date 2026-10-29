// Server/admin only. Never return this module's config (which contains apiKey) to a renderer.
const DEFAULT_BASE_URL = "https://www.runninghub.cn";
const DEFAULT_LLM_BASE_URL = "https://llm.runninghub.ai/v1";
const DEFAULT_LLM_MODEL = "xai/grok-4.7";
const LLM_HOSTS = ["llm.runninghub.ai", "llm.runninghub.cn"];
const ENV = Object.freeze({
  baseUrl: "NOVAFLOW_RUNNINGHUB_BASE_URL",
  apiKey: "NOVAFLOW_RUNNINGHUB_API_KEY",
  llmBaseUrl: "NOVAFLOW_RUNNINGHUB_LLM_BASE_URL",
  llmModel: "NOVAFLOW_RUNNINGHUB_LLM_MODEL",
  gptImageEndpoint: "NOVAFLOW_RUNNINGHUB_GPT_IMAGE_ENDPOINT"
});

function officialUrl(value, fallback, llm = false) {
  const raw = String(value || fallback).trim().replace(/\/+$/, "");
  let url;
  try { url = new URL(raw); } catch { throw new Error("RunningHub 地址格式不正确"); }
  const hosts = llm ? LLM_HOSTS : ["www.runninghub.cn", "runninghub.cn"];
  const path = llm ? "/v1" : "";
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.port ||
      url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, "") !== path) {
    throw new Error(llm ? "RunningHub LLM 地址须为 https://llm.runninghub.ai/v1 或 https://llm.runninghub.cn/v1" : "请使用国内站地址 https://www.runninghub.cn，不要附加接口路径");
  }
  return raw;
}

function endpoint(value) {
  const text = String(value || "").trim();
  if (text && !/^\/openapi\/v2\/[a-zA-Z0-9_./-]+$/.test(text)) {
    throw new Error("模型 API 路径须以 /openapi/v2/ 开头，请从 RunningHub 国内站模型文档复制");
  }
  if (text.split("/").includes("..")) throw new Error("模型 API 路径不能包含 ..");
  return text;
}

function readConfig(read) {
  return Object.fromEntries(Object.entries(ENV).map(([field, name]) => [field, String(read(name) || "").trim() ||
    (field === "baseUrl" ? DEFAULT_BASE_URL : field === "llmBaseUrl" ? DEFAULT_LLM_BASE_URL : field === "llmModel" ? DEFAULT_LLM_MODEL : "")]));
}

function parseConfig(payload) {
  const apiKey = String(payload?.apiKey ?? payload?.api_key ?? "").trim();
  const clearApiKey = Boolean(payload?.clearApiKey || payload?.clear_api_key);
  if (clearApiKey && apiKey) throw new Error("清空 Key 和填写新 Key 不能同时操作");
  if (!clearApiKey && !apiKey && (payload?.updateApiKey || payload?.update_api_key)) throw new Error("API Key 不能为空；留空表示不修改");
  if (/[\r\n\0]/.test(apiKey)) throw new Error("API Key 不能包含换行或空字符");
  const llmModel = String(payload?.llmModel || "").trim();
  if (llmModel.length > 200 || /[\r\n\0]/.test(llmModel)) throw new Error("LLM 模型 ID 格式不正确");
  return {
    baseUrl: officialUrl(payload?.baseUrl ?? payload?.base_url, DEFAULT_BASE_URL),
    llmBaseUrl: officialUrl(payload?.llmBaseUrl, DEFAULT_LLM_BASE_URL, true),
    llmModel,
    gptImageEndpoint: endpoint(payload?.gptImageEndpoint),
    apiKey, clearApiKey,
    updateApiKey: Boolean(apiKey || payload?.updateApiKey || payload?.update_api_key)
  };
}

function publicStatus(config) {
  return {
    source: "provider", provider_key: "runninghub", configured: Boolean(config.apiKey),
    hasApiKey: Boolean(config.apiKey), status: config.apiKey ? "configured" : "not_configured",
    connected: false, checked: false, baseUrl: config.baseUrl,
    llmBaseUrl: config.llmBaseUrl, llmModel: config.llmModel,
    gptImageEndpoint: config.gptImageEndpoint,
    accountStatus: "not_checked", integrationStatus: "configuration_only",
    endpoint: `POST ${config.baseUrl}/uc/openapi/accountStatus`,
    balance: { supported: false, text: "未检测" }
  };
}

async function checkAccount(config, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const result = publicStatus(config);
  if (!config.apiKey) return result;
  const startedAt = Date.now();
  try {
    const baseUrl = officialUrl(config.baseUrl, DEFAULT_BASE_URL);
    const response = await fetchImpl(`${baseUrl}/uc/openapi/accountStatus`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ apikey: config.apiKey })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body?.code === 806) {
      return { ...result, status: "error", checked: true, accountStatus: "invalid_key",
        error: "RunningHub：当前 Key 未找到对应账户（APIKEY_USER_NOT_FOUND），请在 AI 服务中更新有效的国内站 Key",
        durationMs: Date.now() - startedAt, checkedAt: new Date().toISOString() };
    }
    if (body?.code !== 0 || !body?.data || typeof body.data !== "object" || Array.isArray(body.data)) {
      // Do not echo provider messages: they may contain request credentials.
      throw new Error("账户检测未通过，请核对 Key、账户权限和余额页面");
    }
    const number = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    const data = body.data;
    const coins = number(data.remainCoins);
    const money = number(data.remainMoney);
    const currency = /^[A-Z]{3}$/.test(String(data.currency || "")) ? data.currency : "";
    return {
      ...result, status: "connected", connected: true, checked: true, accountStatus: "available",
      currentTaskCounts: number(data.currentTaskCounts),
      balance: { supported: money !== null || coins !== null, money, coins, currency,
        text: [money === null ? "" : `${money} ${currency || "余额"}`, coins === null ? "" : `${coins} RH币`].filter(Boolean).join(" · ") || "未返回余额" },
      durationMs: Date.now() - startedAt, checkedAt: new Date().toISOString()
    };
  } catch (err) {
    // Fixed messages also cover network errors with sensitive URLs/request dumps.
    const reason = /^HTTP \d+$/.test(err?.message || "") ? err.message : err?.name === "TimeoutError" ? "请求超时" : "连接或账户检测失败，请核对地址、Key 和账户权限";
    return { ...result, status: "error", checked: true, accountStatus: "unknown", error: `RunningHub：${reason}`, durationMs: Date.now() - startedAt, checkedAt: new Date().toISOString() };
  }
}

module.exports = { ENV, readConfig, parseConfig, publicStatus, checkAccount };
