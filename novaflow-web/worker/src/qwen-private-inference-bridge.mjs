// Private child-process frames only. No endpoint, bearer token or caller-owned
// URL crosses this boundary; the verified Qwen session owns actual transport.
export function createPrivateInferenceBridge({session, expectedIdentity, isCurrent, write}) {
  if(typeof expectedIdentity!=='string' || !expectedIdentity || session?.identity?.id!==expectedIdentity || typeof session.inferConversation!=='function'
      || typeof isCurrent!=='function' || typeof write!=='function') throw Error('Qwen bridge session unavailable');
  const seen=new Set(); let busy=false;
  return async function handle(frame) {
    const requestId=frame?.requestId,callId=frame?.callId, body=frame?.body;
    if(frame?.type!=='qwen-infer-v1' || !Number.isSafeInteger(requestId) || requestId<1
       || typeof callId!=='string' || !/^[a-f0-9]{32}$/.test(callId) || seen.has(callId) || seen.size>=128
       || !isCurrent(requestId) || busy) throw Error('Invalid or stale private inference frame');
    seen.add(callId);busy=true;
    try {
      if(!body || typeof body!=='object' || Array.isArray(body)
         || Object.keys(body).some(k=>!['model','messages','stream','max_tokens','temperature','top_p','reasoning_effort','reasoning_budget_tokens','seed'].includes(k))
         || body.model!==session.identity.id || body.stream!==false || !Array.isArray(body.messages)
         || !(body.messages.length===1 && body.messages[0]?.role==='user'
           || body.messages.length===2 && body.messages[0]?.role==='system' && body.messages[1]?.role==='user')
         || !Number.isInteger(body.max_tokens) || body.max_tokens<1 || body.max_tokens>4096
         || !Number.isFinite(body.temperature) || body.temperature<0 || body.temperature>2
         || !Number.isFinite(body.top_p) || body.top_p<=0 || body.top_p>1
         || (body.seed!==undefined && !Number.isSafeInteger(body.seed))) throw Error('Invalid private inference request');
      const messages=body.messages.length===1?[{role:'system',content:''},...body.messages]:body.messages;
      const result=await session.inferConversation({messages,maxTokens:body.max_tokens,
        temperature:body.temperature,topP:body.top_p,...(body.seed===undefined?{}:{seed:body.seed}),
        reasoningEffort:'none',reasoningBudgetTokens:0,stage:'qwen-python-business'});
      if(result?.model!==session.identity.id || !result.requestId || result.finishReason!=='stop'
         || typeof result.message?.content!=='string' || result.message.tool_calls?.length) throw Error('Invalid local inference response');
      if(!isCurrent(requestId))return;
      write({type:'qwen-infer-result-v1',requestId,callId,ok:true,response:{id:result.requestId,model:result.model,
        choices:[{finish_reason:'stop',message:{role:'assistant',content:result.message.content}}],...(result.usage?{usage:result.usage}:{})}});
    } catch {
      if(isCurrent(requestId))write({type:'qwen-infer-result-v1',requestId,callId,ok:false});
    } finally {busy=false;}
  };
}

// Only this binding is used by the production-local prototype. Other model
// adapters must explicitly bind their own identity, billing and capability.
export function createQwenPrivateInferenceBridge(options) {
  return createPrivateInferenceBridge({...options,expectedIdentity:'qwen35-heretic'});
}
