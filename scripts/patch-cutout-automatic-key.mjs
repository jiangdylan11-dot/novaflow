import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('../particle-editor-desktop/node_modules/typescript');

// R selects the processing pipeline; nfCutoutMode owns the user's tool button.
// Automatic chroma needs exactly the same masks, decoded frames, and clip
// reference as AI cutout. Keeping one pipeline avoids preview/export drift.
function finalizeAutomaticKey(source) {
  return source.replace('tool:()=>R,hasResult:()=>!!V,', 'tool:()=>nfCutoutMode,hasResult:()=>!!V&&(R!==`ai`||!!G.current&&U.current.size>0),')
    .replace(/hasWebmResult:\(\)=>!e\.inputImageDataUrl&&!!N&&!!V&&(?:\(R!==`ai`\|\|!!G\.current&&U\.current\.size>0\)&&)*/, 'hasWebmResult:()=>!e.inputImageDataUrl&&!!N&&!!V&&(R!==`ai`||!!G.current&&U.current.size>0)&&')
    .replace('Jr=async(e,n)=>{if(!N||En.current)return;', 'Jr=async(e,n)=>{if(!N||En.current||V&&R===`ai`&&(!G.current||!U.current.size))return;')
    .replace('if(!N||!V||Rn||!n||R===`ai`&&ce?.base64&&!de.current)return null;', 'if(!N||!V||Rn||!n||R===`ai`&&(!G.current||!U.current.size||ce?.base64&&!de.current))return null;')
    .replace('if(V&&R===`ai`&&ce?.base64&&!de.current||ln.current?.running)return;', 'if(V&&R===`ai`&&(!G.current||!U.current.size||ce?.base64&&!de.current)||ln.current?.running)return;')
    .replace('[O,N,r,a,e.boards,o,s,c,l,u,d,f,k,A,w,T,E,_e,De,ke,je,Ne,Y,Be,Ie,Re,He,nfDespillRangeScale,j,ut,nfGreenScreen,nfPreserveShadow]', '[O,N,r,a,e.boards,o,s,c,l,u,d,f,k,A,w,T,E,_e,De,ke,je,Ne,Y,Be,Ie,Re,He,nfDespillRangeScale,j,ut,nfGreenScreen,nfPreserveShadow,R,nfCutoutMode,V,ie]');
}

export function patchAutomaticKeyCutout(source) {
  if (source.includes('nfOpenCutoutTool=')) return finalizeAutomaticKey(source);
  const ast = ts.createSourceFile('bundle.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let dock;
  for (const statement of ast.statements) {
    if (ts.isVariableStatement(statement)) {
      dock ||= statement.declarationList.declarations.find(d => d.name.getText(ast) === 'zt');
    }
  }
  if (!dock) throw new Error('Cutout Dock missing');
  let code = dock.getText(ast);
  const replace = (before, after) => {
    if (!code.includes(before) || code.indexOf(before) !== code.lastIndexOf(before)) {
      throw new Error('Automatic key anchor missing or ambiguous: ' + before.slice(0, 100));
    }
    code = code.replace(before, after);
  };
  replace('[R,z]=Tt(`nf_bg_remove_matte_mode`', '[nfCutoutMode,z]=Tt(`nf_bg_remove_matte_mode`');
  replace('[nfGreenScreenActive,nfSetGreenScreenActive]=(0,_.useState)(!1);',
    '[nfGreenScreenActive,nfSetGreenScreenActive]=(0,_.useState)(!1);let R=nfCutoutMode===`key`&&nfGreenScreen?`ai`:nfCutoutMode;');

  const start = code.indexOf('ui=async()=>{');
  const end = code.indexOf(',fi=e.onPickColorRef', start);
  if (start < 0 || end < 0) throw new Error('Cutout open handlers missing');
  const handlers = String.raw`nfStartCutoutSubject=cap=>{li();U.current.clear();W.current.clear();G.current=null;fe.current=null;se(null);le(null);oe({state:\`idle\`,message:\`\`});ae(e=>e+1);Xn(\`dirty\`);if(Rn&&!cap?.frame){oe({state:\`error\`,message:\`图片未就绪，无法识别主体\`});return}void pe(Rn?cap.frame:void 0)},nfOpenCutoutTool=async(mode)=>{if(!Vn||or||N&&V&&nfCutoutMode!==mode)return;if((mode===\`ai\`||nfGreenScreen)&&!zn&&!Rn)return;if(N&&!V&&nfCutoutMode===mode){H(!0);return}if(N&&V&&nfCutoutMode===mode){P(!1);H(!1);return}sr(!0);try{const {cap}=ci();P(!0);z(mode);H(!0);if(mode===\`ai\`||nfGreenScreen)nfStartCutoutSubject(cap);else{cap?.frame&&fr(dr(cap.frame));Xn(\`dirty\`)}}finally{sr(!1)}},nfToggleCutoutLight=()=>{wi();const enabled=!nfGreenScreen;nfSetGreenScreen(enabled);nfSetGreenScreenActive(!1);Xn(\`dirty\`);if(nfCutoutMode===\`key\`&&N){const {cap}=ci();if(enabled){if(!G.current||!U.current.size)nfStartCutoutSubject(cap)}else cap?.frame&&fr(dr(cap.frame))}},ui=()=>nfOpenCutoutTool(\`ai\`),di=()=>nfOpenCutoutTool(\`key\`)`.replaceAll('\\`', '`').replaceAll('\`', '`');
  code = code.slice(0, start) + handlers + code.slice(end);
  replace('onClick:()=>{wi(),nfSetGreenScreen(!nfGreenScreen),Xn(`dirty`)}', 'onClick:nfToggleCutoutLight');

  // Only presentation and asset provenance use the requested mode. All frame
  // indexing, inference, matting, caching, and export continue to use R.
  const buttonsStart = code.indexOf('style:{margin:`12px 14px`,display:`grid`,gridTemplateColumns:`1fr 1fr`,gap:10}');
  const buttonsEnd = code.indexOf('children:N&&V&&R===`key`?`关闭色键抠图`', buttonsStart);
  if (buttonsStart < 0 || buttonsEnd < 0) throw new Error('Cutout button identities missing');
  const stop = buttonsEnd + 'children:N&&V&&R===`key`?`关闭色键抠图`'.length;
  code = code.slice(0, buttonsStart) + code.slice(buttonsStart, stop).replaceAll('R===', 'nfCutoutMode===') + code.slice(stop);
  code = code.replaceAll('A.tool=R===`key`?', 'A.tool=nfCutoutMode===`key`?')
    .replaceAll('novaflowTrace:{tool:R===`key`?', 'novaflowTrace:{tool:nfCutoutMode===`key`?')
    .replaceAll('fileName:R===`key`?`chroma_key_cutout_', 'fileName:nfCutoutMode===`key`?`chroma_key_cutout_');
  const checked = ts.createSourceFile('dock.js', 'const '+code+';', ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (checked.parseDiagnostics.length) throw new Error('Invalid automatic cutout patch: '+checked.parseDiagnostics[0].messageText);
  return finalizeAutomaticKey(source.slice(0, dock.getStart(ast)) + code + source.slice(dock.end));
}
