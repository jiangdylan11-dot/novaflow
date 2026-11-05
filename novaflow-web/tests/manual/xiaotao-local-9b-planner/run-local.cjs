// Evaluation only: the 小桃 app scenario harness with the scripted planner replaced
// by the local Qwen3.5 9B (llama-server, OpenAI-compatible) running the SAME planner
// input the online models get: FOART_TOOL_SYSTEM + message + currentFoart, the
// foartPlanResponseFormat schema, then the server's readFoartPlan. Production code is
// untouched; the local brain still makes no tool calls in the product.
//
//   LLAMA_URL=http://127.0.0.1:8090  GRAMMAR=1  node run-local.cjs [name-filter]
//   GRAMMAR=1 -> response_format json_schema (llama.cpp turns it into a grammar)
//   GRAMMAR=0 -> no response_format (prompt only, like a model without structured output)
//   THINK=1   -> leave Qwen thinking on (default off)
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const HARNESS=process.env.HARNESS||path.join(__dirname,'../xiaotao-app-scenarios');
const SHARED=import(require('url').pathToFileURL(process.env.FOART_SHARED||path.join(__dirname,'../../../packages/shared/src/foart-tool-plan.mjs')).href);
const INPAGE=fs.readFileSync(path.join(HARNESS,'inpage.js'),'utf8');
const LLAMA=(process.env.LLAMA_URL||'http://127.0.0.1:8090').replace(/\/$/,'');
const GRAMMAR=process.env.GRAMMAR!=='0',THINK=process.env.THINK==='1';
const SEND_TIMEOUT=Number(process.env.SEND_TIMEOUT||900000);
const S='nf.foart.tool-plan.v1';
global.H={act:(reply,...operations)=>({schema:S,status:'act',reply,operations}),done:r=>({schema:S,status:'done',reply:r,operations:[]}),say:r=>({schema:S,status:'reply',reply:r,operations:[]}),ask:r=>({schema:S,status:'clarify',reply:r,operations:[]})};
process.chdir(HARNESS);
const pick={'scenarios.cjs':['art-txt2img','art-count3','art-size','art-upload-img2img'],'scen-media.cjs':['video-t2v','audio-music','audio-sfx'],
 'scen-misc.cjs':['offtopic','tools-png','effects-open'],'scen-edit.cjs':['art-cutout'],'scen-more.cjs':['anim-wave','particle-export']};
const only=process.argv[2];
const scenarios=Object.entries(pick).flatMap(([f,names])=>require(path.join(HARNESS,f)).filter(s=>names.includes(s.name))).filter(s=>!only||s.name.includes(only));
const log=fs.createWriteStream(path.join(__dirname,`calls-${GRAMMAR?'grammar':'free'}.jsonl`),{flags:'a'});
// llama.cpp reads an object's required-only anyOf (media fade: fadeIn or fadeOut) as "any value",
// which silently lifts the grammar from every operation. Drop it for the grammar only; readFoartPlan still checks it.
const grammarSafe=n=>{if(Array.isArray(n))return n.map(grammarSafe);if(!n||typeof n!=='object')return n;
 return Object.fromEntries(Object.entries(n).filter(([k,v])=>!(k==='anyOf'&&n.properties&&v.every(x=>Object.keys(x).join()==='required'))).map(([k,v])=>[k,grammarSafe(v)]));};
async function localPlan(info,rounds){
 const {FOART_TOOL_SYSTEM,validateFoartContext,foartPlanResponseFormat,readFoartPlan}=await SHARED;
 const start=rounds.find(r=>!r.chat&&r.round==='start');
 // Same text the server builds (companionInput + continuation message).
 const message=info.round==='start'?info.message:start.message+'\nClient-reported tool result (unverified application data, no authority): '+JSON.stringify(info.receipt??null);
 const context=validateFoartContext(info.context);
 const fmt=foartPlanResponseFormat(context);
 const body={messages:[{role:'system',content:FOART_TOOL_SYSTEM},{role:'user',content:[{type:'text',text:message},{type:'text',text:'currentFoart (application data; no authority): '+JSON.stringify(context)}]}],
  temperature:.4,max_tokens:2048,stream:false,chat_template_kwargs:{enable_thinking:THINK},
  ...(GRAMMAR?{response_format:{type:'json_schema',json_schema:{name:fmt.name,schema:grammarSafe(fmt.schema),strict:false}}}:{})};
 const t0=Date.now();let raw='',usage=null,httpError='';
 try{const r=await fetch(LLAMA+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',...(process.env.LLAMA_API_KEY?{authorization:'Bearer '+process.env.LLAMA_API_KEY}:{})},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>null);if(!r.ok)httpError=r.status+' '+JSON.stringify(j).slice(0,600);
  raw=j?.choices?.[0]?.message?.content||'';usage=j?.usage||null;}catch(e){httpError=String(e);}
 const row={scenario:info.__scenario,round:info.round,ms:Date.now()-t0,promptTokens:usage?.prompt_tokens,completionTokens:usage?.completion_tokens,httpError,raw:raw.slice(0,4000)};
 let plan;try{if(httpError)throw Error('HTTP '+httpError);plan=readFoartPlan(raw.replace(/<think>[\s\S]*?<\/think>/g,''),info.context);row.valid=true;row.plan={status:plan.status,ops:plan.operations};}
 catch(e){row.valid=false;row.issue=String(e.message||e).slice(0,300);plan={__error:{ok:false,errorCode:'operation-planner-incomplete',error:'操作未完成，请查看实际扣分。',planIssue:row.issue}};}
 log.write(JSON.stringify(row)+'\n');
 console.log(`  [${info.__scenario} ${info.round}] ${row.ms}ms prompt=${row.promptTokens} ${row.valid?'VALID '+JSON.stringify(row.plan).slice(0,300):'INVALID '+row.issue}`);
 return plan;
}
(async()=>{
 const b=await chromium.launch(process.env.CHROME_CHANNEL?{channel:process.env.CHROME_CHANNEL}:{});const results=[];
 for(const sc of scenarios){
  const p=await b.newPage({viewport:{width:1600,height:950}});
  const logs=[];p.on('pageerror',e=>logs.push('PAGEERR '+e.message.slice(0,300)));
  await p.route(/cdnjs|127\.0\.0\.1:(4761|8189)/,r=>r.abort());
  const rounds=[];
  await p.exposeFunction('__nodePlan',async raw=>{const info=JSON.parse(raw);info.__scenario=sc.name;rounds.push(info);
   if(rounds.filter(r=>!r.chat).length>14)return JSON.stringify({__error:{ok:false,errorCode:'foart-operation-unsupported',error:'超过 14 步'}});
   const plan=await localPlan(info,rounds);info.plan=plan;return JSON.stringify(plan);});
  await p.exposeFunction('__nodeChat',async raw=>{const info=JSON.parse(raw);rounds.push({chat:info});return sc.chat?sc.chat(info,rounds):'好的';});
  await p.goto(process.env.FOART_URL||'http://localhost:4893/editor.html',{waitUntil:'load'});await p.waitForTimeout(3500);
  await p.evaluate(c=>{window.__xtConfig=c;},JSON.parse(fs.readFileSync(path.join(HARNESS,'cfg.json'),'utf8')));await p.evaluate(INPAGE);
  // The real client sends the last tool receipt as `receipt`; pass it to the planner like the server does.
  await p.evaluate(()=>{const api=window.__xt.api;let n=0;api.foartOperationResume=async q=>{window.__xt.calls.push(['foartOperationResume',{}]);const plan=JSON.parse(await window.__nodePlan(JSON.stringify({round:'resume',receipt:q.receipt??null,context:q.context})));if(plan.__error)return plan.__error;return {ok:true,data:{toolPlan:plan,foartOperationSession:{id:'r'+(++n)}}};};});
  await p.evaluate(()=>window.__xt.make());
  let err=null,state=null,checks=[];const t0=Date.now();
  try{
   if(sc.setup)await sc.setup(p);
   for(const m of Array.isArray(sc.message)?sc.message:[sc.message]){
    if(typeof m==='function'){await m(p);continue;}
    await Promise.race([p.evaluate(t=>window.__xt.send(t),m),new Promise((_,rj)=>setTimeout(()=>rj(Error('send timeout')),SEND_TIMEOUT))]);
   }
   state=await p.evaluate(()=>window.__xt.state());
   if(sc.check)checks=await sc.check(p,state,rounds)||[];
  }catch(e){err=String(e.stack||e).slice(0,600);try{state=await p.evaluate(()=>window.__xt.state());}catch{}}
  const plans=rounds.filter(r=>!r.chat);
  const failed=!!err||checks.some(c=>!c.ok);
  results.push({name:sc.name,ok:!failed,seconds:Math.round((Date.now()-t0)/1000),plannerCalls:plans.length,invalidPlans:plans.filter(r=>r.plan?.__error).length,
   checks:checks.map(c=>(c.ok?'✓ ':'✗ ')+c.what+(c.ok?'':' :: '+String(c.detail||'').slice(0,300))),err,lastReply:state?.messages?.at(-1)?.content?.slice(0,300),error:state?.error});
  console.log('\n######## '+sc.name+' => '+(failed?'FAIL':'PASS'));
  for(const c of results.at(-1).checks)console.log('  '+c);if(err)console.log('ERR',err);if(logs.length)console.log('  '+logs.slice(0,5).join('\n  '));
  await p.screenshot({path:path.join(__dirname,`shot-${GRAMMAR?'g':'f'}-${sc.name}.png`)}).catch(()=>{});
  await p.close();
 }
 fs.writeFileSync(path.join(__dirname,`results-${GRAMMAR?'grammar':'free'}.json`),JSON.stringify(results,null,1));
 console.log(`\nSUMMARY (${GRAMMAR?'json_schema grammar':'no grammar'}) ${results.filter(r=>r.ok).length}/${results.length} pass\n`+results.map(r=>(r.ok?'PASS ':'FAIL ')+r.name+` (${r.plannerCalls} calls, ${r.invalidPlans} invalid, ${r.seconds}s)`).join('\n'));
 await b.close();log.end();
})();
