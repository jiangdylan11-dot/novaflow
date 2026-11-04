// Authenticated read-only recovery projection. It never queries a provider,
// settles, refunds, resumes, or returns a private policy/usage snapshot.
import {isXiaotaoCreditAmount,hasXiaotaoDecimalV1} from './xiaotao-decimal-usage.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(['unknown','in-progress','pending-reconciliation','pending-settlement','settled']);
const fail=(code,statusCode=400)=>{throw Object.assign(new Error(code),{code,statusCode});};
export function createXiaotaoOperationV3Status({enabled=false,rpc}={}) {
  if(enabled===true&&typeof rpc!=='function')fail('invalid-server-config',503);
  return async function operationStatus({user,sessionId,payload,isCurrent}={}) {
    if(enabled!==true)fail('operation-billing-disabled',503);
    if(!UUID.test(user?.id||'')||typeof sessionId!=='string'||!sessionId||typeof isCurrent!=='function')fail('invalid-server-actor');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==1||!UUID.test(payload.operationId||''))fail('operation-invalid-request');
    const actor={userId:user.id.toLowerCase(),sessionId},id=payload.operationId.toLowerCase();
    const fresh=async()=>{try{return await isCurrent(actor)===true;}catch{return false;}};
    if(!await fresh())fail('selection-stale',401);
    let row;try{row=await rpc('get_xiaotao_operation_status_v3',{p_operation_id:id,p_user_id:actor.userId});}catch{fail('operation-status-unknown',503);}
    if(!await fresh())fail('selection-stale',401);
    if(!row||typeof row!=='object'||Array.isArray(row)||String(row.operationId||'').toLowerCase()!==id||!STATES.has(row.status))fail('operation-status-unknown',503);
    if(row.status==='settled'){
      // The status RPC returns these markers only from the operation's frozen
      // snapshot. Missing markers retain legacy integer validation; malformed
      // or partial markers must never be inferred from the current policy.
      const online={};
      for(const key of ['credit_amount_policy','credit_precision','credit_rounding','minimum_positive_credits'])
        if(Object.hasOwn(row,key))online[key]=row[key];
      const frozenConfig={xiaotao_online:online},options={allowZero:true,max:14000000};
      if(!['success','cancel'].includes(row.outcome)||!isXiaotaoCreditAmount(row.charged,frozenConfig,options)||
        !isXiaotaoCreditAmount(row.uncollected,frozenConfig,options))fail('operation-status-unknown',503);
      return {operationId:id,status:'settled',outcome:row.outcome,charged:Number(row.charged),uncollected:Number(row.uncollected),
        ...(hasXiaotaoDecimalV1(frozenConfig)?{credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0}:{})};
    }
    return {operationId:id,status:row.status};
  };
}
