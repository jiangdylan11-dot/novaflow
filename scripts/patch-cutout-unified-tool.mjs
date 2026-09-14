import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('../particle-editor-desktop/node_modules/typescript');

export function patchUnifiedCutoutTool(source){
  if(source.includes('nfUnifiedVideoCutoutV1'))return source;
  const ast=ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let dock;
  for(const st of ast.statements)if(ts.isVariableStatement(st))dock ||= st.declarationList.declarations.find(d=>d.name.getText(ast)==='zt');
  if(!dock)throw Error('Cutout Dock missing');
  let code=dock.getText(ast);
  function replace(a,b){if(!code.includes(a)||code.indexOf(a)!==code.lastIndexOf(a))throw Error('Unified cutout anchor missing: '+a.slice(0,90));code=code.replace(a,b)}
  replace('let R=nfCutoutMode===`key`&&nfGreenScreen?`ai`:nfCutoutMode;', 'let nfUnifiedVideoCutoutV1=!0,R=`ai`;');
  replace('parse:e=>String(e||``).trim()===`key`?`key`:`ai`,serialize:e=>e===`key`?`key`:`ai`', 'parse:()=>`ai`,serialize:()=>`ai`');
  const start=code.indexOf('style:{margin:`12px 14px`,display:`grid`,gridTemplateColumns:`1fr 1fr`,gap:10}');
  const end=code.indexOf(',N&&(0,X.jsxs)',start);
  if(start<0||end<0)throw Error('Cutout button group missing');
  const group="style:{margin:`12px 14px`,display:`grid`,gridTemplateColumns:`1fr`,gap:10},children:(0,X.jsx)(`div`,{role:`button`,\"data-novaflow-video-cutout\":`1`,onClick:()=>{Vn&&(async()=>{try{await ui()}catch(e){alert(String(e?.message||e||`抠图失败`))}})()},\"aria-disabled\":!Vn||or,tabIndex:Vn&&!or?0:-1,style:{margin:0,padding:`12px 14px`,display:`flex`,alignItems:`center`,justifyContent:`center`,borderRadius:14,background:N&&V?`rgba(239,68,68,0.16)`:`rgba(30,166,114,0.18)`,border:`1px solid rgba(30,166,114,0.35)`,cursor:Vn&&!or?`pointer`:`not-allowed`,opacity:Vn&&!or?1:.55,userSelect:`none`,fontWeight:900,fontSize:12},children:N&&V?`关闭视频抠图`:or?`处理中...`:`视频抠图`})})";
  code=code.slice(0,start)+group+code.slice(end);
  // Remove the unused second entry and key-only toggle inference branch.
  replace('ui=()=>nfOpenCutoutTool(`ai`),di=()=>nfOpenCutoutTool(`key`)', 'ui=()=>nfOpenCutoutTool(`ai`)');
  const toggle=code.indexOf('nfToggleCutoutLight=()=>{'),toggleEnd=code.indexOf(',ui=()=>',toggle);
  if(toggle<0||toggleEnd<0)throw Error('Cutout light toggle missing');
  code=code.slice(0,toggle)+'nfToggleCutoutLight=()=>{wi();nfSetGreenScreen(!nfGreenScreen);nfSetGreenScreenActive(!1);Xn(`dirty`)}'+code.slice(toggleEnd);
  replace('n.textContent=`正在 AI 抠图`', 'n.textContent=`视频抠图 · AI 主体识别`');
  const check=ts.createSourceFile('dock.js','const '+code+';',ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(check.parseDiagnostics.length)throw Error('Unified cutout parse: '+check.parseDiagnostics[0].messageText);
  return source.slice(0,dock.getStart(ast))+code+source.slice(dock.end);
}
