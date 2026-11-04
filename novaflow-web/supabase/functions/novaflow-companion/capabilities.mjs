// Server-only, strict opt-in. Never read these flags from a client or pricing data.
const names=['operation','recovery','art','vision','audioRewrite','videoRewrite','uiDraft','foartOpen','foartRotation','foartIdleDraft','foartAudioMusic','foartGeneral'];
const invalid=()=>{throw Object.assign(new Error('invalid operation capability configuration'),{code:'operation-capability-config-invalid',statusCode:503});};

export function parseV3Capabilities(raw){
  const result=Object.fromEntries(names.map(name=>[name,false]));
  if(raw===undefined)return Object.freeze(result);
  if(typeof raw!=='string'||raw.length>1024)invalid();
  let object;try{object=JSON.parse(raw);}catch{invalid();}
  if(!object||typeof object!=='object'||Array.isArray(object))invalid();
  for(const [name,value] of Object.entries(object)){
    if(!names.includes(name)||typeof value!=='boolean')invalid();
    result[name]=value;
  }
  // JSON.parse normally accepts duplicate keys and silently keeps the last.
  // Reject ambiguity, including distinct spellings of the same escaped key.
  const seen=new Set();let pos=raw.indexOf('{')+1;const keyPattern=/"(?:\\.|[^"\\])*"/y;
  const skip=()=>{while(/\s/.test(raw[pos]||'')&&pos<raw.length)pos++;};
  skip();
  while(raw[pos]!=='}'){
    keyPattern.lastIndex=pos;const match=keyPattern.exec(raw);if(!match)invalid();
    let name;try{name=JSON.parse(match[0]);}catch{invalid();}
    if(seen.has(name))invalid();seen.add(name);pos=keyPattern.lastIndex;skip();
    if(raw[pos++]!==':')invalid();skip();
    if(raw.startsWith('true',pos))pos+=4;else if(raw.startsWith('false',pos))pos+=5;else invalid();
    skip();if(raw[pos]===','){pos++;skip();}else if(raw[pos]!=='}')invalid();
  }
  if(result.operation&&!result.recovery)invalid();
  if(!result.operation&&['art','vision','audioRewrite','videoRewrite','uiDraft','foartOpen','foartRotation','foartIdleDraft','foartAudioMusic','foartGeneral'].some(name=>result[name]))invalid();
  if(result.foartRotation&&!result.foartOpen)invalid();
  if(result.foartIdleDraft&&!result.foartOpen)invalid();
  if(result.foartGeneral&&!result.foartOpen)invalid();
  return Object.freeze(result);
}
