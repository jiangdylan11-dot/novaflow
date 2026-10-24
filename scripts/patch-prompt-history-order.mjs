// The maintained renderer contains the original frozen React components.
// Change only their history rows; keep their native state, persistence and actions.
export function patchPromptHistoryOrder(source) {
  if (source.includes('let nfHistoryCurrent=')) return source;
  function replaceOnce(text, before, after) {
    if (text.indexOf(before) < 0 || text.indexOf(before) !== text.lastIndexOf(before)) throw Error('History anchor missing or ambiguous: ' + before.slice(0, 100));
    return text.replace(before, after);
  }
  const start = source.indexOf('function(e){let{onPick:t,history:n}=e');
  const end = source.indexOf('},`r-${e.at}-${e.text}`)),l.length', start);
  if (start < 0 || end < 0) throw Error('History component not found');
  const tail = source.indexOf('children:`暂无`})]})})]})}', end) + 'children:`暂无`})]})})]})}'.length;
  let code = source.slice(start, tail);
  const first = code.indexOf('children:[d&&') + 'children:['.length;
  const saved = code.indexOf(',l.map(', first) + 1;
  const rest = code.indexOf(',f.map(', saved) + 1;
  if (first < 10 || saved < first || rest < saved) throw Error('History row order not found');
  code = code.slice(0, first) + code.slice(saved, rest - 1) + ',' + code.slice(first, saved - 1) + ',' + code.slice(rest);
  code = replaceOnce(code, 'return(0,X.jsxs)(`div`,{ref:o', 'let nfHistoryCurrent=String(e.value??``).replace(/\\s+/g,` `).trim(),nfHistoryMatch=item=>!!nfHistoryCurrent&&String(item?.text??``).replace(/\\s+/g,` `).trim()===nfHistoryCurrent,nfHistoryBadge=item=>nfHistoryMatch(item)?(0,X.jsx)(`span`,{"data-novaflow-history-current-badge":`1`,children:`当前`}):null;return(0,X.jsxs)(`div`,{ref:o');
  code = replaceOnce(code, 'let e=h();e&&m(e),a(!0)', 'n.addRecent(e.value);let t=h();t&&m(t),a(!0)');
  for (const [prefix, item, kind] of [['l.map(e=>(0,X.jsxs)', 'e', 'saved'], ['d&&(0,X.jsxs)', 'd', 'recent'], ['f.map(e=>(0,X.jsxs)', 'e', 'recent']]) {
    const marker = prefix + '(`div`,{style:';
    code = replaceOnce(code, marker, prefix + '(`div`,{"data-novaflow-history-kind":`' + kind + '`,"data-novaflow-history-current":nfHistoryMatch(' + item + ')?`1`:`0`,style:');
  }
  for (const item of ['d', 'e']) {
    const before = 'children:[(0,X.jsx)(`button`,{type:`button`,onClick:()=>{t(' + item + '.text),a(!1)}';
    const after = 'children:[nfHistoryBadge(' + item + '),(0,X.jsx)(`button`,{type:`button`,title:' + item + '.text,"aria-pressed":nfHistoryMatch(' + item + '),onClick:()=>{t(' + item + '.text),n.addRecent(' + item + '.text),a(!1)}';
    if (!code.includes(before)) throw Error('History text action not found');
    code = code.replaceAll(before, after);
  }
  code = replaceOnce(code, 'children:`记录${e.slot}`', 'children:`已保存 ${e.slot}`');
  code = replaceOnce(code, 'children:[(0,X.jsx)(`button`,{type:`button`,onClick:e=>{e.stopPropagation(),n.savePinned(d.text)}', 'children:[(0,X.jsx)(`span`,{"data-novaflow-history-latest-badge":`1`,children:`最近`}),(0,X.jsx)(`button`,{type:`button`,onClick:e=>{e.stopPropagation(),n.savePinned(d.text)}');
  source = source.slice(0, start) + code + source.slice(tail);
  // The older history popup is retained in the bundle as well.
  source = replaceOnce(source, 'u=i.pinned.slice(0,15),d=i.recent.slice(0,Math.max(0,15-u.length))', 'u=i.pinned.slice(0,15),d=[...i.recent].filter(e=>!u.some(t=>Jt(t.text)===Jt(e.text))).sort((e,t)=>Number(t.at||0)-Number(e.at||0)).slice(0,Math.max(0,15-u.length))');
  const legacyStart = source.indexOf('function(e){let{title:t,value:n,onPick:r,history:i}');
  const legacyEnd = source.indexOf('},`r-${e.at}-${e.text}`)})})]})]})]})}', legacyStart) + '},`r-${e.at}-${e.text}`)})})]})]})]})}'.length;
  let legacy = source.slice(legacyStart, legacyEnd);
  if (!legacyStart || legacyEnd < legacyStart) throw Error('Legacy history not found');
  legacy = legacy.replaceAll('`div`,{style:{display:`flex`,alignItems:`center`,gap:8,padding:`8px 10px`', '`div`,{"data-novaflow-history-current":l&&Jt(e.text)===Jt(c)?`1`:`0`,style:{display:`flex`,alignItems:`center`,gap:8,padding:`8px 10px`');
  legacy = legacy.replaceAll('children:[(0,X.jsx)(`button`,{type:`button`,onClick:()=>{r(e.text),o(!1)}', 'children:[l&&Jt(e.text)===Jt(c)&&(0,X.jsx)(`span`,{"data-novaflow-history-current-badge":`1`,children:`当前`}),(0,X.jsx)(`button`,{type:`button`,title:e.text,"aria-pressed":l&&Jt(e.text)===Jt(c),onClick:()=>{r(e.text),i.addRecent(e.text),o(!1)}');
  return source.slice(0, legacyStart) + legacy + source.slice(legacyEnd);
}
