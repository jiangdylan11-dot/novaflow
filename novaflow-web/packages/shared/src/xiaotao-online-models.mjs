// The one list of 小桃 online brains. Every online model runs the same 小桃
// framework, prompts and tools; only the model id sent to RunningHub changes.
// Server allowlists, the client menu (renderer/xiaotao-online-models.js is
// generated from this file) and pricing all read from here.
//
// flatRate: priced with model_rates {input, output, cached} and offered only
// through operation-level (v3) billing.
// thinkingOff: request fields that turn the provider's thinking mode off for
// ordinary low-effort calls, so thinking cannot eat the answer budget.
export const XIAOTAO_ONLINE_MODELS = Object.freeze([
  Object.freeze({id:'deepseek/deepseek-v4.1-flash', label:'DeepSeek V4.1 Flash', flatRate:true, vision:true,
    thinkingOff:Object.freeze({thinking:Object.freeze({type:'disabled'})})}),
  Object.freeze({id:'qwen/qwen3.8-flash-next', label:'千问 Qwen3.8 Flash', flatRate:true, vision:true,
    thinkingOff:Object.freeze({enable_thinking:false})}),
  Object.freeze({id:'glm/glm-5.3-flash', label:'智谱 GLM-5.3 Flash', flatRate:true, vision:true,
    thinkingOff:Object.freeze({thinking:Object.freeze({type:'disabled'})})}),
  Object.freeze({id:'xai/grok-4.7', label:'Grok 4.7', flatRate:false, vision:true, thinkingOff:null}),
  Object.freeze({id:'openai/gpt-6.1-sol-saver', label:'GPT-6.1 Sol Saver', flatRate:false, vision:true, thinkingOff:null})
]);

export const XIAOTAO_ONLINE_MODEL_IDS = Object.freeze(XIAOTAO_ONLINE_MODELS.map(model => model.id));
export const XIAOTAO_FLAT_RATE_MODEL_IDS = Object.freeze(XIAOTAO_ONLINE_MODELS.filter(model => model.flatRate).map(model => model.id));
export const XIAOTAO_VISION_MODEL_IDS = Object.freeze(XIAOTAO_ONLINE_MODELS.filter(model => model.vision).map(model => model.id));

export function xiaotaoOnlineModel(id) {
  return XIAOTAO_ONLINE_MODELS.find(model => model.id === id) || null;
}
export function isXiaotaoOnlineModel(id) { return XIAOTAO_ONLINE_MODEL_IDS.includes(id); }
export function isXiaotaoFlatRateModel(id) { return XIAOTAO_FLAT_RATE_MODEL_IDS.includes(id); }
export function isXiaotaoVisionModel(id) { return XIAOTAO_VISION_MODEL_IDS.includes(id); }
