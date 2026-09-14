import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('../particle-editor-desktop/node_modules/typescript');

function markControlSurfaces(source) {
  if (source.includes('nfToolPanelActionsV1')) return source;
  return source
    .replace('onClick:()=>{if(Vn&&!gi){if(!nfColorCorrectionOpen)nfSetColorCorrectionOpen(!0);else xi()}}', 'onClick:()=>{if(!gi){if(!nfColorCorrectionOpen)nfSetColorCorrectionOpen(!0);else if(Vn)xi();else alert(`请先上传或选择视频资源，再执行校正。`)}}')
    .replace('"aria-disabled":!Vn||gi,tabIndex:Vn&&!gi?0:-1,style:{...Ci,background:nfColorCorrectionOpen?', '"aria-disabled":!!gi,tabIndex:gi?-1:0,style:{...Ci,opacity:gi?.55:1,pointerEvents:gi?`none`:`auto`,cursor:gi?`not-allowed`:`pointer`,background:nfColorCorrectionOpen?')
    .replace('nfRangeInputAt=(0,_.useRef)(-Infinity);let nfUnifiedVideoCutoutV1=', 'nfRangeInputAt=(0,_.useRef)(-Infinity);(0,_.useEffect)(()=>{if(N)nfSetColorCorrectionOpen(!1)},[N]);let nfUnifiedVideoCutoutV1=')
    .replace('nfRangeInputAt=(0,_.useRef)(-Infinity);', 'nfRangeInputAt=(0,_.useRef)(-Infinity),nfColorCorrectionWasBusy=(0,_.useRef)(!1);(0,_.useEffect)(()=>{const busy=!!e.colorStabilizeBusy;if(nfColorCorrectionWasBusy.current&&!busy)nfSetColorCorrectionOpen(!1);nfColorCorrectionWasBusy.current=busy},[e.colorStabilizeBusy]);')
    .replace('(0,_.useEffect)(()=>{if(N)nfSetColorCorrectionOpen(!1)},[N]);let nfUnifiedVideoCutoutV1=', '(0,_.useEffect)(()=>{if(N)nfSetColorCorrectionOpen(!1)},[N]);(0,_.useLayoutEffect)(()=>{document.dispatchEvent(new CustomEvent(`novaflow:color-correction-state`))},[nfColorCorrectionOpen,e.colorStabilizeBusy]);let nfUnifiedVideoCutoutV1=')
    .replace('"data-nf-color-correction-open":nfColorCorrectionOpen?`1`:`0`,"aria-expanded":', '"data-nf-color-correction-open":nfColorCorrectionOpen?`1`:`0`,"data-nf-color-correction-busy":gi?`1`:`0`,"aria-expanded":')
    .replace('children:`上传参照图片，校正视频整体色调，减轻帧间色彩偏差。`})]}),N&&', 'children:`上传参照图片，校正视频整体色调，减轻帧间色彩偏差。`}),(0,X.jsx)(`button`,{type:`button`,"data-nf-color-correction-cancel":`1`,disabled:gi,onClick:()=>{if(!gi)nfSetColorCorrectionOpen(!1)},style:{justifySelf:`end`,border:0,background:`transparent`,color:`#999`,fontSize:11,cursor:gi?`not-allowed`:`pointer`},children:`取消校正`})]}),N&&')
    .replace('onChangeCapture:wi,onInputCapture:wi,style:Et', 'onChangeCapture:wi,onInputCapture:wi,"data-nf-cutout-post-shell":`1`,"data-novaflow-ai-post-content-shell":`1`,style:Et')
    .replace('(0,X.jsxs)(`div`,{style:Dt,children:[(0,X.jsx)(`div`,{role:`button`,"data-novaflow-ai-post-primary-action"', '(0,X.jsxs)(`div`,{"data-nf-color-correction-actions":`1`,"data-novaflow-ai-post-clean-surface":`1`,style:Dt,children:[(0,X.jsx)(`div`,{role:`button`,"data-novaflow-ai-post-primary-action"');
}

// Keep the first React paint identical to the runtime's settled parameter layout.
export function patchCutoutControls(source) {
  if (source.includes('nfCutoutControlsV1')) return markControlSurfaces(source);
  const ast = ts.createSourceFile('bundle.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let dock;
  for (const st of ast.statements) if (ts.isVariableStatement(st)) dock ||= st.declarationList.declarations.find(d => d.name.getText(ast) === 'zt');
  if (!dock) throw Error('Cutout controls: Dock missing');
  let code = dock.getText(ast);
  const replace = (a, b) => {
    if (!code.includes(a) || code.indexOf(a) !== code.lastIndexOf(a)) throw Error('Cutout controls anchor: ' + a.slice(0, 100));
    code = code.replace(a, b);
  };
  replace('let nfUnifiedVideoCutoutV1=', 'const nfCutoutControlsV1=!0,[nfColorCorrectionOpen,nfSetColorCorrectionOpen]=(0,_.useState)(!1),nfRangeInputAt=(0,_.useRef)(-Infinity);let nfUnifiedVideoCutoutV1=');
  replace('wi=()=>{try{b&&', 'wi=e=>{if(e?.target?.type===`range`)nfRangeInputAt.current=performance.now();try{b&&');
  // The value/rail update stays immediate; only expensive paused-frame rendering
  // waits for a short idle gap. Frame stepping and brush updates remain immediate.
  replace('let e=0;return e=window.requestAnimationFrame(()=>{(async()=>{try{if(V&&R===`ai`', 'let e=0;return e=window.setTimeout(()=>{(async()=>{try{if(V&&R===`ai`');
  replace('await Jr()}catch(e){console.error(e)}})()}),()=>{try{window.cancelAnimationFrame(e)}catch{}}}', 'await Jr()}catch(e){console.error(e)}})()},Math.max(0,80-(performance.now()-nfRangeInputAt.current))),()=>{try{window.clearTimeout(e)}catch{}}}');

  const uploadStart = code.indexOf('(0,X.jsxs)(`div`,{title:`自定义色彩参照`');
  const uploadEnd = code.indexOf(',(0,X.jsx)(`div`,{role:`button`,onClick:xi', uploadStart);
  if (uploadStart < 0 || uploadEnd < 0) throw Error('Color reference upload missing');
  const upload = code.slice(uploadStart, uploadEnd).replaceAll('自定义色彩参照', '上传色彩校正参照').replace('title:', '"data-novaflow-ai-post-reference-dropzone":`1`,title:');
  code = code.slice(0, uploadStart) + code.slice(uploadEnd + 1);
  replace('role:`button`,onClick:xi,"aria-disabled":!Vn||gi,tabIndex:Vn&&!gi?0:-1,style:Ci,children:(0,X.jsx)(`div`,{style:Ft,children:`视频色彩修复`})', 'role:`button`,"data-novaflow-ai-post-primary-action":`1`,"data-nf-color-correction-open":nfColorCorrectionOpen?`1`:`0`,"aria-expanded":nfColorCorrectionOpen,onClick:()=>{if(Vn&&!gi){if(!nfColorCorrectionOpen)nfSetColorCorrectionOpen(!0);else xi()}},onKeyDown:e=>{if(e.key===`Enter`||e.key===` `){e.preventDefault();e.currentTarget.click()}},"aria-disabled":!Vn||gi,tabIndex:Vn&&!gi?0:-1,style:{...Ci,background:nfColorCorrectionOpen?`#6f1f2a`:Ci.background},children:(0,X.jsx)(`div`,{style:Ft,children:nfColorCorrectionOpen?`执行校正`:`颜色校正`})');
  replace(',N&&(0,X.jsxs)(X.Fragment', ',nfColorCorrectionOpen&&(0,X.jsxs)(`div`,{"data-nf-color-correction-panel":`1`,style:{padding:`0 14px 12px`,display:`grid`,gap:8},children:[' + upload + ',(0,X.jsx)(`div`,{style:{fontSize:11,lineHeight:1.5,color:`#999`},children:`上传参照图片，校正视频整体色调，减轻帧间色彩偏差。`})]}),N&&(0,X.jsxs)(X.Fragment');

  const layout = 'style:{display:`grid`,gridTemplateColumns:`52px minmax(0, 1fr) 56px`,gap:8,alignItems:`center`}';
  const count = code.split(layout).length - 1;
  if (count < 9) throw Error('Cutout parameter rows missing: ' + count);
  code = code.replaceAll(layout, '"data-novaflow-ai-cutout-param-row":`1`,style:{display:`grid`,gridTemplateColumns:`26px minmax(0, 1fr) 50px`,gap:3,alignItems:`center`}');
  // Assign range/value markers only to direct children of parameter rows.
  const parsed = ts.createSourceFile('dock.js', 'const ' + code + ';', ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const inserts = [];
  const visit = node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(p => p.name?.getText(parsed) === '"data-novaflow-ai-cutout-param-row"')) {
      const children = node.properties.find(p => p.name?.getText(parsed) === 'children')?.initializer;
      if (children && ts.isArrayLiteralExpression(children)) for (const child of children.elements) {
        if (!ts.isCallExpression(child)) continue;
        const props = child.arguments[1];
        if (!props || !ts.isObjectLiteralExpression(props)) continue;
        const type = props.properties.find(p => p.name?.getText(parsed) === 'type')?.initializer?.getText(parsed);
        if (type === '`range`' || type === '`number`') inserts.push({at:props.getStart(parsed)+1-6,text:`"data-novaflow-ai-cutout-param-${type === '`range`' ? 'range' : 'value'}":\`1\`,`});
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (inserts.length < 18) throw Error('Cutout parameter inputs missing');
  for (const edit of inserts.sort((a,b) => b.at-a.at)) code = code.slice(0,edit.at)+edit.text+code.slice(edit.at);
  const check = ts.createSourceFile('dock.js', 'const '+code+';', ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (check.parseDiagnostics.length) throw Error('Cutout controls syntax: '+check.parseDiagnostics[0].messageText);
  return markControlSurfaces(source.slice(0,dock.getStart(ast))+code+source.slice(dock.end));
}
