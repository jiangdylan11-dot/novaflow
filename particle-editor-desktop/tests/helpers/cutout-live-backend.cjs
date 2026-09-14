// Execute the shipping IPC callback with the installed model and Python runtime.
// Only app lifecycle/log transport is isolated; inference, frame contracts,
// alpha packing and video encoders are the production implementation.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const cp=require('node:child_process'),crypto=require('node:crypto'),os=require('node:os');
const ts=require('typescript'),sharp=require('sharp');
exports.createLiveBackend=(output, options={})=>{
  const mainPath=path.resolve(options.mainPath||path.resolve(__dirname,'../../main.js')),source=fs.readFileSync(mainPath,'utf8');
  const ast=ts.createSourceFile(mainPath,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let callback;
  for(const node of ast.statements){const call=node.expression;
    if(call&&ts.isCallExpression(call)&&call.expression.getText(ast)==='handleNovaFlowTempIpc'&&call.arguments[0]?.text==='ai-seq-rembg-batch')callback=call.arguments[1].getText(ast);
  }
  if(!callback)throw Error('Production cutout IPC callback missing');
  const userData=path.join(process.env.APPDATA,'NovaFlow');
  const installed=JSON.parse(fs.readFileSync(path.join(userData,'birefnet-env/meta.json'),'utf8'));
  if(!installed.ready||!fs.existsSync(installed.pythonExe)||!fs.existsSync(installed.modelId))throw Error('Installed cutout runtime is not ready');
  const logDir=path.join(output,'backend');fs.mkdirSync(logDir,{recursive:true});
  const appendLogLine=(level,event,data)=>fs.appendFileSync(path.join(logDir,'trace.jsonl'),JSON.stringify({level,event,data})+'\n');
  const context={__dirname:path.dirname(mainPath),require:require("node:module").createRequire(mainPath),fs,path,crypto,os,Buffer,process,console,sharp,setTimeout,clearTimeout,setInterval,clearInterval,
    spawn:cp.spawn,trackNovaFlowCommandChild:c=>c,appendLogLine,logDir,
    app:{getPath:name=>{if(name!=='userData')throw Error('Unexpected app path '+name);return userData;}},
    aiCutoutReadyCache:{birefnet:{ok:true,...installed}},novaFlowAppShuttingDown:false,
    ffmpegPath:require('ffmpeg-static'),
    sanitizeFileName:n=>path.basename(n).replace(/[<>:"/\\|?*]/g,'_'),
    sanitizeFileStem:(n,fallback)=>path.parse(path.basename(n)).name.replace(/[<>:"/\\|?*]/g,'_')||fallback,
    createNovaFlowTempWorkDir:()=>fs.mkdtempSync(path.join(logDir,'job-')),
    cleanupNovaFlowTempWorkDir:async()=>{}, // Keep real masks and frames for audit.
    runCmd:(exe,args,options={})=>new Promise(resolve=>{let stdout='',stderr='';const p=cp.spawn(exe,args,{...options,windowsHide:true});p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',e=>resolve({ok:false,stderr:String(e)}));p.on('close',code=>resolve({ok:code===0,stdout,stderr,code}));})
  };
  const handler=vm.runInNewContext('('+callback+')',context,{filename:mainPath});
  fs.writeFileSync(path.join(logDir,'runtime.json'),JSON.stringify({mainSha256:crypto.createHash('sha256').update(source).digest('hex'),installed},null,2));
  return async(event,payload)=>{
    const result=await handler(event,payload);
    if(!result.ok)throw Error(result.error||'Production cutout failed');
    const {alphaBytes,alphaBase64,outVideoBase64,srcVideoBase64,...report}=result;
    fs.writeFileSync(path.join(logDir,'result.json'),JSON.stringify({...report,alphaBytes:alphaBytes?.byteLength,srcVideoBytes:srcVideoBase64?.length,outVideoBytes:outVideoBase64?.length},null,2));
    return result;
  };
};
