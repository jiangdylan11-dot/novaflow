const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
// 小桃 drives the real Foart page; only the backend (planner, optimizer, compute) is faked. See README.md.
const zlib=require('zlib');
if(!fs.existsSync(path.join(__dirname,'cat.png'))){const w=512,h=512,raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)raw.set([200,120,40],y*(w*3+1)+1+x*3);
 const crc=b=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}c=0xffffffff;for(const v of b)c=t[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr.set([8,2,0,0,0],8);
 fs.writeFileSync(path.join(__dirname,'cat.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
if(!fs.existsSync(path.join(__dirname,'cfg.json')))throw Error('run: node mkcfg.mjs > cfg.json');
const BASE=process.env.FOART_URL||'http://localhost:4892/index.html';
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
 fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});const b=await chromium.launch();const results=[];
 for(const sc of scenarios){
  const p=await b.newPage({viewport:{width:1600,height:950}});
  const logs=[];p.on('console',m=>{const t=m.text();if(/Foart tools|小桃|xiaotao|Error|error/i.test(t)&&!/particle-fit|Failed to load resource|GL Driver/.test(t))logs.push(m.type()+': '+t.slice(0,300));});
  p.on('pageerror',e=>logs.push('PAGEERR '+e.message.slice(0,300)));
  await p.route(/cdnjs|127\.0\.0\.1:(4761|8189)/,r=>r.abort());
  const rounds=[];
  await p.exposeFunction('__nodePlan',async raw=>{const info=JSON.parse(raw);rounds.push(info);let plan;try{plan=await sc.plan(info,rounds.length-1,rounds);}catch(e){plan={__error:{ok:false,error:String(e)}};}info.plan=plan;return JSON.stringify(plan);});
  await p.exposeFunction('__nodeChat',async raw=>{const info=JSON.parse(raw);rounds.push({chat:info});return sc.chat?sc.chat(info,rounds):'好的';});
  await p.goto(BASE,{waitUntil:'load'});await p.waitForTimeout(3500);
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
  await p.screenshot({path:path.join(__dirname,'out','shot-'+sc.name+'.png')}).catch(()=>{});
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
