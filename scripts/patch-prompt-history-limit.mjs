// AI history storage and both shipped displays share a 15-row budget; the popover may grow to 15 rows (528px: 30px bordered rows, 4px gaps, padding and border) instead of 320px.
// Keep saved slots and native onPick behavior; full prompt text is preserved.
export function patchPromptHistoryLimit(source) {
  const patches = [
    ['Number(t?.recentCap??6)||6', 'Number(t?.recentCap??15)||15'],
    ['Ja(`ai_seq_prompt`,{recentCap:6})', 'Ja(`ai_seq_prompt`,{recentCap:15})'],
    ['Ja(`ai_seq_negative_prompt`,{recentCap:6})', 'Ja(`ai_seq_negative_prompt`,{recentCap:15})'],
    ['children:`历史（最多 10 条）`', 'children:`历史（列表最多 15 条，含已保存）`'],
    ['u=i.pinned,d=i.recent;', 'u=i.pinned.slice(0,15),d=i.recent.slice(0,Math.max(0,15-u.length));'],
    ['f=u().slice(1),[p,m]=', 'f=u().slice(1,Math.max(1,15-l.length)),[p,m]='],
    ['Math.min(320,20+i*28+Math.max(0,i-1)*4)', 'Math.min(528,22+i*30+Math.max(0,i-1)*4)'],
    ['at:e.at}:null).filter(Boolean),u=(0,_.useCallback)', 'at:e.at}:null).filter(Boolean).slice(0,c.length?14:15),u=(0,_.useCallback)'],
  ];
  for (const [before, after] of patches) {
    if (source.includes(after)) continue;
    if (source.indexOf(before) < 0 || source.indexOf(before) !== source.lastIndexOf(before)) {
      throw new Error('Prompt history limit anchor missing or ambiguous: ' + before);
    }
    source = source.replace(before, after);
  }
  return source;
}
