const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const SHARED=import(require('url').pathToFileURL(process.env.FOART_SHARED||path.join(__dirname,'../../../packages/shared/src/foart-tool-plan.mjs')).href);
const INPAGE=fs.readFileSync(path.join(__dirname,'inpage.js'),'utf8');
const S='nf.foart.tool-plan.v1';
const act=(reply,...operations)=>({schema:S,status:'act',reply,operations});
const done=reply=>({schema:S,status:'done',reply,operations:[]});
const say=reply=>({schema:S,status:'reply',reply,operations:[]});
const ask=reply=>({schema:S,status:'clarify',reply,operations:[]});
global.H={act,done,say,ask};
const only=process.argv[2];
const scenarios=require(process.env.SC||'./scenarios.cjs').filter(s=>!only||s.name.includes(only));
(async()=>{
 const b=await chromium.launch();const results=[];
 for(const sc of scenarios){
  const p=await b.newPage({viewport:{width:1600,height:950}});
  const logs=[];p.on('console',m=>{const t=m.text();if(/Foart tools|小桃|xiaotao|Error|error/i.test(t)&&!/particle-fit|Failed to load resource|GL Driver/.test(t))logs.push(m.type()+': '+t.slice(0,300));});
  p.on('pageerror',e=>logs.push('PAGEERR '+e.message.slice(0,300)));
  await p.route(/cdnjs|127\.0\.0\.1:(4761|8189)/,r=>r.abort());
  const rounds=[];
  await p.exposeFunction('__nodePlan',async raw=>{const info=JSON.parse(raw);rounds.push(info);let plan;const index=rounds.filter(r=>!r.chat).length-1;
   try{plan=await sc.plan(info,index,rounds);}catch(e){plan={__error:{ok:false,error:String(e)}};}
   // The server reads the model's text with the shared readFoartPlan (normalizes, cuts at a boundary, validates) before the client sees it.
   if(plan&&!plan.__error){try{plan=(await SHARED).readFoartPlan(JSON.stringify(plan),info.context);}catch(e){plan={__error:{ok:false,errorCode:'operation-planner-incomplete',error:'操作未完成，请查看实际扣分。',planIssue:String(e.message||e)}};}}
   info.plan=plan;return JSON.stringify(plan);});
  await p.exposeFunction('__nodeChat',async raw=>{const info=JSON.parse(raw);rounds.push({chat:info});return sc.chat?sc.chat(info,rounds):'好的';});
  await p.goto(process.env.FOART_URL||'http://localhost:4893/editor.html',{waitUntil:'load'});await p.waitForTimeout(3500);
  await p.evaluate(c=>{window.__xtConfig=c;},JSON.parse(fs.readFileSync(path.join(__dirname,'cfg.json'),'utf8')));await p.evaluate(INPAGE);await p.evaluate(()=>window.__xt.make());
  let err=null,state=null,checks=[];
  try{
   if(sc.setup)await sc.setup(p);
   const msgs=Array.isArray(sc.message)?sc.message:[sc.message];
   for(const m of msgs){
     if(typeof m==='function'){await m(p);continue;}
     await Promise.race([p.evaluate(t=>window.__xt.send(t),m),new Promise((_,rj)=>setTimeout(()=>rj(Error('send timeout 60s')),60000))]);
   }
   state=await p.evaluate(()=>window.__xt.state());
   if(sc.check)checks=await sc.check(p,state,rounds)||[];
  }catch(e){err=String(e.stack||e).slice(0,800);try{state=await p.evaluate(()=>window.__xt.state());}catch{}}
  const calls=await p.evaluate(()=>window.__xt.calls.map(c=>c[0])).catch(()=>[]);
  await p.screenshot({path:path.join(__dirname,'shot-'+sc.name+'.png')}).catch(()=>{});
  const failed=err||checks.some(c=>!c.ok);
  results.push({name:sc.name,ok:!failed});
  console.log('\n######## '+sc.name+' => '+(failed?'FAIL':'PASS'));
  if(err)console.log('ERR',err);
  for(const c of checks)console.log((c.ok?'  ✓ ':'  ✗ ')+c.what+(c.ok?'':' :: '+String(c.detail||'').slice(0,400)));
  console.log('state',JSON.stringify(state).slice(0,1500));
  console.log('calls',calls.join(','));
  console.log('rounds',JSON.stringify(rounds.map(r=>r.chat?{chat:r.chat.message.slice(0,200)}:{round:r.round,msg:(r.message||'').slice(0,300),receipts:r.receipts?JSON.stringify(r.receipts).slice(0,500):undefined,keys:r.keys,plan:r.plan&&{status:r.plan.status,ops:r.plan.operations}})).slice(0,2500));
  if(logs.length)console.log('logs\n  '+logs.slice(0,25).join('\n  '));
  await p.close();
 }
 console.log('\nSUMMARY '+results.map(r=>(r.ok?'PASS ':'FAIL ')+r.name).join(' | '));
 await b.close();
})();
