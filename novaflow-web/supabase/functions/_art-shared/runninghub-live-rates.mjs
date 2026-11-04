// Online credit prices follow RunningHub's public price list. A price that cannot
// be read, or that moved past the limits, keeps the built-in one: a bad reading
// must never reach a user's bill. DeepSeek stays out on purpose: the list shows the
// price of the moment, and it is billed at its fixed peak price.
const PRICE_URL='https://www.runninghub.ai/llm/api/models';
const LOW=0.4,HIGH=3,TTL_MS=3600000,RETRY_MS=300000,TIMEOUT_MS=2500;
const perMillion=tier=>{const value=Number(tier?.discountUnitPrice??tier?.unitPrice);return Number.isFinite(value)&&value>0?Number((value*1000).toFixed(6)):null;};
const tiers=(row,key)=>(key==='cached'?row?.pricing?.dimensions?.cache_read:row?.pricing?.[key])?.tiers||[];
const READERS=Object.freeze({
  'bytedance/doubao-seed-2.1-lite':row=>({input:perMillion(tiers(row,'input')[0]),output:perMillion(tiers(row,'output')[0]),cached:perMillion(tiers(row,'cached')[0])}),
  'openai/gpt-6.1-sol-saver':row=>({input:perMillion(tiers(row,'input')[0]),output:perMillion(tiers(row,'output')[0]),cached:perMillion(tiers(row,'cached')[0]),
    highInput:perMillion(tiers(row,'input')[1]),highOutput:perMillion(tiers(row,'output')[1])})
});
const GROK='xai/grok-4.7';
const readGrok=row=>({input:perMillion(tiers(row,'input')[0]),output:perMillion(tiers(row,'output')[0]),cached_input:perMillion(tiers(row,'cached')[0]),
  high_input:perMillion(tiers(row,'input')[1]),high_output:perMillion(tiers(row,'output')[1]),high_cached_input:perMillion(tiers(row,'cached')[1])});
const GROK_BASE=Object.freeze({input:1.7,output:5.1,cached_input:0.425,high_input:3.4,high_output:10.2,high_cached_input:0.85});
const inRange=(next,base)=>Object.keys(next).every(key=>next[key]!==null&&Number(base?.[key])>0&&next[key]>=base[key]*LOW&&next[key]<=base[key]*HIGH);

export function parseRunningHubRates(payload,base) {
  const rows=Array.isArray(payload?.data)?payload.data:[],find=id=>rows.find(row=>row?.publicName===id);
  const modelRates={},rejected=[];
  for(const [id,read] of Object.entries(READERS)){
    const row=find(id);if(!row){rejected.push(id);continue;}
    const next=read(row);
    if(inRange(next,base?.[id]))modelRates[id]={...next,snapshot:'runninghub-live'};else rejected.push(id);
  }
  const grokRow=find(GROK),grok=grokRow?readGrok(grokRow):null;
  const grokOk=!!grok&&inRange(grok,GROK_BASE);
  if(!grokOk)rejected.push(GROK);
  return {model_rates:modelRates,...(grokOk?{grok_4_7_rates:grok}:{}),rejected};
}

export function createRunningHubLiveRates({base,fetchImpl=(...args)=>globalThis.fetch(...args),now=Date.now,log=()=>{}}={}) {
  let rates=null,updatedAt=0,nextAt=0,rejected=[],failed=false;
  async function refresh() {
    nextAt=now()+RETRY_MS;
    try {
      const response=await fetchImpl(PRICE_URL,{headers:{accept:'application/json'},signal:AbortSignal.timeout(TIMEOUT_MS)});
      if(!response.ok)throw Error('status '+response.status);
      const parsed=parseRunningHubRates(await response.json(),base);
      rejected=parsed.rejected;failed=false;
      if(rejected.length)log('runninghub-rates-rejected',rejected);
      if(JSON.stringify(parsed.model_rates)!==JSON.stringify(rates?.model_rates)||JSON.stringify(parsed.grok_4_7_rates)!==JSON.stringify(rates?.grok_4_7_rates))log('runninghub-rates-updated',parsed);
      rates={model_rates:parsed.model_rates,...(parsed.grok_4_7_rates?{grok_4_7_rates:parsed.grok_4_7_rates}:{})};
      updatedAt=now();nextAt=updatedAt+TTL_MS;
    } catch(error) {failed=true;log('runninghub-rates-unavailable',String(error?.message||error));}
  }
  return {
    async current(){if(now()>=nextAt)await refresh();return rates;},
    status(){return {source:rates?'runninghub-live':'built-in',updatedAt:updatedAt?new Date(updatedAt).toISOString():null,rejected,failed};}
  };
}

// The live prices lie over the stored ones; with no reading nothing changes.
export function withLiveRates(online,live) {
  if(!live)return online;
  return {...online,model_rates:{...online.model_rates,...live.model_rates},...(live.grok_4_7_rates?{grok_4_7_rates:{...online.grok_4_7_rates,...live.grok_4_7_rates}}:{})};
}
