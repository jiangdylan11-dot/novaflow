// Prompt input performance for the AI sequence panel.
//
// 1. `vn` (the shared nf-input textarea used by the positive/negative prompt fields) keeps the typed text in
//    local state and commits it to the panel state after a short pause (140ms), on blur, on Ctrl/Cmd+Enter and
//    on unmount. Before this, every keystroke re-rendered the whole AI sequence panel; React then re-set
//    name/type on every input and remounted the reference dropzone, and each of those DOM mutations woke
//    every runtime MutationObserver (layout scans, forced reflows, localStorage writes) per keystroke.
//    The blur callback (prompt history) still observes the committed value: when a commit happens on blur,
//    the latest onBlur is invoked after the panel has re-rendered with that value.
// 2. The reference/first-frame dropzone component was declared inline inside the panel render, so React saw
//    a new component type on every render and unmounted/remounted the dropzone DOM each time. It is hoisted
//    to a module-level component (`nfAiSeqRefDropzone`) with identical markup and behavior.
export function patchPromptInputPerf(source) {
  const VN_BEFORE = ',vn=e=>(0,X.jsx)(`textarea`,{...e,className:`nf-input ${e.className||``}`.trim(),style:{width:`100%`,boxSizing:`border-box`,padding:`8px 10px`,fontSize:12,resize:`vertical`,minHeight:80,...e.style}}),yn=';
  const VN_AFTER = ',vn=e=>{let{value:t,onChange:n,onBlur:r,onKeyDown:i,...a}=e,o=t==null?``:String(t),[s,c]=(0,_.useState)(o),l=(0,_.useRef)(o),u=(0,_.useRef)(0),d=(0,_.useRef)(null),f=(0,_.useRef)(!1),p=(0,_.useRef)(n),m=(0,_.useRef)(r),h=(0,_.useRef)(o);p.current=n,m.current=r;let g=(0,_.useCallback)(()=>{u.current&&(clearTimeout(u.current),u.current=0)},[]),v=(0,_.useCallback)(e=>{g();let t=d.current,n=t?t.value:h.current;if(n===l.current)return!1;l.current=n;let r=t||{value:n};try{p.current?.({target:r,currentTarget:r,type:`change`,nativeEvent:e||null})}catch{}return!0},[g]);return(0,_.useEffect)(()=>{o!==l.current&&(l.current=o,h.current=o,g(),c(o))},[o,g]),(0,_.useEffect)(()=>{if(f.current&&!u.current&&o===l.current){f.current=!1;let e=d.current||{value:o};try{m.current?.({target:e,currentTarget:e,type:`blur`})}catch{}}}),(0,_.useEffect)(()=>()=>{u.current&&v(null)},[v]),(0,X.jsx)(`textarea`,{...a,ref:d,value:s,onChange:e=>{let t=e.target.value;h.current=t,c(t),g(),u.current=window.setTimeout(()=>{u.current=0,v(null)},140)},onBlur:e=>{if(u.current&&v(e.nativeEvent)){f.current=!0;return}m.current?.(e)},onKeyDown:e=>{e.key===`Enter`&&(e.ctrlKey||e.metaKey)&&u.current&&v(e.nativeEvent),i?.(e)},className:`nf-input ${e.className||``}`.trim(),style:{width:`100%`,boxSizing:`border-box`,padding:`8px 10px`,fontSize:12,resize:`vertical`,minHeight:80,...e.style}})},yn=';
  const VN_MARKER = 'u.current=window.setTimeout(()=>{u.current=0,v(null)},140)';

  if (!source.includes(VN_MARKER)) {
    const index = source.indexOf(VN_BEFORE);
    if (index < 0 || index !== source.lastIndexOf(VN_BEFORE)) {
      throw new Error('Prompt input perf: nf-input textarea anchor missing or ambiguous');
    }
    source = source.slice(0, index) + VN_AFTER + source.slice(index + VN_BEFORE.length);
  }

  const DZ_START = 'children:(()=>{let e=({dataUrl:e,title:t,size:n,grow:r,onPick:i,onClear:a,onDropImport:o,mediaName:s})=>{';
  const DZ_END = ';let t=ze===`minimax_h3_local`&&Ve===`multi_reference`,nfStrictAiSeqFirstFrame=';
  const DZ_HOIST_ANCHOR = ',yn=e=>(0,X.jsx)(`select`,';
  const DZ_MARKER = 'let e=nfAiSeqRefDropzone;let t=ze===';

  if (!source.includes(DZ_MARKER)) {
    const startIndex = source.indexOf(DZ_START);
    if (startIndex < 0 || startIndex !== source.lastIndexOf(DZ_START)) {
      throw new Error('Prompt input perf: reference dropzone start anchor missing or ambiguous');
    }
    const fnStart = startIndex + 'children:(()=>{let e='.length;
    const fnEnd = source.indexOf(DZ_END, fnStart);
    if (fnEnd < 0 || fnEnd - fnStart > 8000) {
      throw new Error('Prompt input perf: reference dropzone end anchor missing');
    }
    const componentSource = source.slice(fnStart, fnEnd);
    if (!componentSource.startsWith('({dataUrl:e,') || !componentSource.trimEnd().endsWith('}')) {
      throw new Error('Prompt input perf: reference dropzone component shape unexpected');
    }
    if (!/X\.jsxs?\b/.test(componentSource) || /\b(?:ze|Ve|ot|un|gn|Sn|Un|Gn|Kn|Sr|dn|bn|Cn)\b/.test(componentSource.replace(/`[^`]*`/g, ''))) {
      throw new Error('Prompt input perf: reference dropzone component is not self-contained');
    }
    source = source.slice(0, fnStart) + 'nfAiSeqRefDropzone' + source.slice(fnEnd);
    const hoistIndex = source.indexOf(DZ_HOIST_ANCHOR);
    if (hoistIndex < 0 || hoistIndex !== source.lastIndexOf(DZ_HOIST_ANCHOR)) {
      throw new Error('Prompt input perf: hoist anchor missing or ambiguous');
    }
    source = source.slice(0, hoistIndex) + ',nfAiSeqRefDropzone=' + componentSource + source.slice(hoistIndex);
  }

  return source;
}
