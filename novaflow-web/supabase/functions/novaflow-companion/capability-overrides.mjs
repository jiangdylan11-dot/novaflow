// Review candidate only. Call with exactly the three allowed non-secret
// values, never a client-controlled object. This module makes no env reads.
import {parseV3Capabilities} from './capabilities.mjs';

export const OPT_IN_KEYS=Object.freeze({
  audioRewrite:'NOVAFLOW_XIAOTAO_AUDIO_REWRITE_V1',
  videoRewrite:'NOVAFLOW_XIAOTAO_VIDEO_REWRITE_V1',
  uiDraft:'NOVAFLOW_XIAOTAO_UI_DRAFT_V1',
  foartGeneral:'NOVAFLOW_XIAOTAO_FOART_GENERAL_V1'
});
const invalid=()=>{throw Object.assign(new Error('invalid operation capability configuration'),{code:'operation-capability-config-invalid',statusCode:503});};

export function mergeCapabilityOverrides(raw, overrides={}) {
  // Validate the existing value using the *real* parser first. In particular,
  // malformed JSON, unknown keys and duplicate/escaped duplicate keys fail.
  const original=parseV3Capabilities(raw);
  if(!overrides || typeof overrides!=='object' || Array.isArray(overrides)||Object.keys(overrides).some(key=>!Object.values(OPT_IN_KEYS).includes(key)))invalid();
  const explicit=raw===undefined ? {} : JSON.parse(raw);
  const result={...original};
  for(const [field,key] of Object.entries(OPT_IN_KEYS)){
    const value=Object.hasOwn(overrides,key) ? overrides[key] : undefined;
    // Reject malformed opt-ins even if the corresponding original field is
    // present, rather than hiding a configuration error behind precedence.
    if(value!==undefined && value!=='true' && value!=='false')invalid();
    if(!Object.hasOwn(explicit,field) && value!==undefined)result[field]=value==='true';
  }
  // Existing parser has already checked original dependencies; check again
  // after adding each permitted capability. Vision remains unchanged and
  // must separately gate each request which contains an image.
  if((result.audioRewrite||result.videoRewrite||result.uiDraft) && (!result.operation||!result.recovery))invalid();
  return Object.freeze(result);
}
