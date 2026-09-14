// Entry buttons select a tool; operations belong to its panel.
export function patchToolPanelActions(source) {
  if (source.includes('nfToolPanelActionsV1')) return source.replace(/,\(0,X.jsx\)\(`button`,\{type:`button`,"data-nf-color-correction-cancel":`1`,disabled:gi,onClick:\(\)=>\{if\(!gi\)nfSetColorCorrectionOpen\(!1\)\},style:\{justifySelf:`end`,border:0,background:`transparent`,color:`#999`,fontSize:11,cursor:gi\?`not-allowed`:`pointer`\},children:`取消校正`\}\)/, '').replaceAll('gap:6,borderTop:`1px solid rgba(255,255,255,.08)`,paddingTop:12,marginBottom:6','gap:6,paddingTop:12,marginBottom:6');
  const replace = (a,b) => {
    if (!source.includes(a) || source.indexOf(a)!==source.lastIndexOf(a)) throw Error('Panel actions anchor: '+a.slice(0,100));
    source=source.replace(a,b);
  };
  replace('const nfCutoutControlsV1=!0,','const nfToolPanelActionsV1=!0,nfCutoutControlsV1=!0,');
  replace('onClick:()=>{if(!gi){if(!nfColorCorrectionOpen)nfSetColorCorrectionOpen(!0);else if(Vn)xi();else alert(`请先上传或选择视频资源，再执行校正。`)}}','onClick:()=>{if(!gi&&!nfColorCorrectionOpen)nfSetColorCorrectionOpen(!0)}');
  replace('children:nfColorCorrectionOpen?`执行校正`:`颜色校正`','children:`颜色校正`');
  replace('background:nfColorCorrectionOpen?`#6f1f2a`:Ci.background','background:Ci.background');
  const style='style:{height:34,border:0,borderRadius:8,color:`#fff`,cursor:`pointer`,background:`#1ca578`}';
  const row=(content)=>'(0,X.jsxs)(`div`,{"data-nf-tool-panel-actions":`1`,style:{display:`grid`,gridTemplateColumns:`1fr 1fr`,gap:6,paddingTop:12,marginBottom:6},children:['+content+']})';
  const cancel='(0,X.jsx)(`button`,{type:`button`,"data-nf-color-correction-cancel":`1`,disabled:gi,onClick:()=>{if(!gi)nfSetColorCorrectionOpen(!1)},'+style.replace('#1ca578','#333')+',children:`取消`})';
  const confirm='(0,X.jsx)(`button`,{type:`button`,"data-nf-color-correction-confirm":`1`,disabled:gi,onClick:()=>{if(!gi){if(Vn)xi();else alert(`请先上传或选择视频资源，再执行校正。`)}},'+style+',children:gi?`处理中…`:`确定`})';
  const old='(0,X.jsx)(`button`,{type:`button`,"data-nf-color-correction-cancel":`1`,disabled:gi,onClick:()=>{if(!gi)nfSetColorCorrectionOpen(!1)},style:{justifySelf:`end`,border:0,background:`transparent`,color:`#999`,fontSize:11,cursor:gi?`not-allowed`:`pointer`},children:`取消校正`})';
  replace(','+old,'');
  replace('"data-nf-color-correction-panel":`1`,style:{padding:`0 14px 12px`,display:`grid`,gap:8},children:[','"data-nf-color-correction-panel":`1`,style:{padding:`0 14px 12px`,display:`grid`,gap:8},children:['+row(confirm+','+cancel)+',');
  const cutoutButton=(action,label)=>'(0,X.jsx)(`button`,{type:`button`,"data-nf-cutout-panel-action":`'+action+'`,disabled:or,onClick:()=>document.dispatchEvent(new CustomEvent(`novaflow:cutout-panel-action`,{detail:{action:`'+action+'`}})),'+(action==='cancel'?style.replace('#1ca578','#333'):style)+',children:`'+label+'`})';
  replace(',N&&(0,X.jsxs)(X.Fragment,{children:[(0,X.jsx)(`div`,{style:{height:1,background:`rgba(255,255,255,0.08)`}}),',',N&&(0,X.jsxs)(X.Fragment,{children:['+row(cutoutButton('save','保存')+','+cutoutButton('cancel','取消'))+',');
  replace('try{Ze(String(r.id||``))}catch{}return Oe({state:`done`,message:`Cutout result added to assets`}),await dn(r),r','if(t.activate!==!1){try{Ze(String(r.id||``))}catch{}await dn(r)}return Oe({state:`done`,message:`Cutout result added to assets`}),r');
  return source;
}
