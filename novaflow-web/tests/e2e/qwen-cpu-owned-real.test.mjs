// Explicitly opt-in isolated real-model test; it never changes node configuration.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir,freemem} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {deflateSync} from 'node:zlib';

const enabled=process.env.FOART_QWEN_ISOLATED_REAL_TEST==='1';
const evidence=new URL('../../../work/community-cpu-trial-qwen.json',import.meta.url);
const src=new URL('../../worker/src/',import.meta.url);
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);}
function image(){const w=64,h=64,raw=Buffer.alloc(h*(1+w*3));for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*(1+w*3)+1+x*3;raw[i]=y<h/2?255:0;raw[i+2]=y<h/2?0:255;}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;return 'data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');}
async function freePort(){return await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(error=>error?reject(error):resolve(port));});});}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('owned Qwen CPU: real local text, synthetic image and confirmed release',{skip:!enabled,timeout:360000},async()=>{
  assert.equal(process.platform,'win32');assert.ok(freemem()>24*1024**3,'insufficient free memory for isolated test');
  const config=JSON.parse(readFileSync(evidence,'utf8')),dir=mkdtempSync(join(tmpdir(),'foart-qwen-owned-test-'));
  const supervisor=join(dir,'supervisor.py'),ownership=join(dir,'local_cpu_ownership.py'),name=randomUUID();
  const source=readFileSync(new URL('gemma-cpu-supervisor.py',src),'utf8')
    .replace('Global\\FoartLocalCpuModelMutex-v1','Local\\FoartQwenTestMutex-'+name)
    .replace('Global\\FoartLocalCpuModelJob-v1','Local\\FoartQwenTestJob-'+name);
  assert.doesNotMatch(source,/Global\\FoartLocalCpuModel(?:Mutex|Job)-v1/);
  writeFileSync(supervisor,source);writeFileSync(ownership,readFileSync(new URL('local_cpu_ownership.py',src)));
  const port=await freePort(),key=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`;
  const child=spawn(config.pythonPath,['-B',supervisor],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot,PATH:join(process.env.SystemRoot,'System32'),TEMP:process.env.TEMP,TMP:process.env.TMP,PYTHONIOENCODING:'utf-8'}});
  let output='',done=false,exitResult;const exited=new Promise(resolve=>{child.on('error',error=>{done=true;exitResult={error};resolve();});child.on('close',(code,signal)=>{done=true;exitResult={code,signal};resolve();});});
  child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{output+=part;});child.stdin.on('error',()=>{});
  child.stdin.write(JSON.stringify({parentPid:process.pid,port,apiKey:key,exe:config.exe,model:config.model,projector:config.projector,modelId:'qwen3.5-9b-heretic'})+'\n');
  const start=Date.now();let released=false;
  try {
    while(!done && !output.includes('"event": "ready"') && Date.now()-start<240000)await pause(100);
    assert.ok(output.includes('"event": "ready"'),'owned supervisor did not become ready: '+output.slice(-400));
    const headers={authorization:`Bearer ${key}`,'content-type':'application/json'};
    // A listening port is not a loaded model. Match the production session's
    // authenticated /health gate before sending either inference request.
    let healthy=false,lastHealth='not-checked';
    while(!done && !healthy && Date.now()-start<240000) {
      try {const r=await fetch(base+'/health',{headers,signal:AbortSignal.timeout(2000)});lastHealth=String(r.status);if(r.ok)healthy=(await r.json())?.status==='ok';}
      catch {lastHealth='unavailable';}
      if(!healthy)await pause(250);
    }
    assert.ok(healthy,'owned model health did not become ready: '+lastHealth);
    const request=async(messages)=>{const started=Date.now();const r=await fetch(base+'/v1/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'qwen35-heretic',messages,max_tokens:32,temperature:0,chat_template_kwargs:{enable_thinking:false}}),signal:AbortSignal.timeout(180000)});if(!r.ok){let type='',message='';try{const data=await r.json();type=String(data?.error?.type||data?.error?.code||'').replace(/[^a-z0-9_-]/gi,'').slice(0,80);message=String(data?.error?.message||'').split(key).join('[redacted]').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,240);}catch{}throw Error('owned inference HTTP '+r.status+(type?' '+type:'')+(message?' '+message:''));}const data=await r.json();return {text:data.choices?.[0]?.message?.content,ms:Date.now()-started};};
    const text=await request([{role:'user',content:'你好，请只回复你好。'}]);assert.ok(typeof text.text==='string'&&text.text.trim());
    const vision=await request([{role:'user',content:[{type:'text',text:'这张图上半部分和下半部分分别是什么颜色？请简短回答。'},{type:'image_url',image_url:{url:image()}}]}]);
    assert.ok(typeof vision.text==='string'&&vision.text.trim());assert.match(vision.text,/红/);assert.match(vision.text,/蓝/);
    console.log(JSON.stringify({coldReadyMs:Date.now()-start-text.ms-vision.ms,text,vision}));
  } finally {
    child.stdin.end();let timeout;await Promise.race([exited,new Promise(resolve=>{timeout=setTimeout(resolve,30000);})]);clearTimeout(timeout);
    if(!done){child.kill();await exited;}
    released=output.includes('"event": "released"');
    unlinkSync(supervisor);unlinkSync(ownership);rmdirSync(dir);
    if(!released)throw new Error('owned Job release was not confirmed');
  }
  assert.equal(exitResult?.code,0);assert.equal(released,true,'owned Job release was not confirmed');
});
