// Preview wheel zoom coalescing for the AI sequence / particle preview stage.
//
// The preview zoom (`q`, setter `oe`) lives in the top-level editor panel state, so every wheel notch
// re-rendered the entire panel (about 115 DOM mutations per notch, each waking the runtime observers).
// Both wheel handlers now go through `nfAiSeqQueuePreviewZoom`: the first notch commits immediately,
// notches that arrive within the next 100ms are queued and committed together. The queued factors are
// applied sequentially with the original per-notch rounding, so the resulting zoom is identical to the
// un-throttled behaviour; only the number of panel re-renders during a fast wheel burst drops.
export function patchPreviewWheelZoom(source) {
  const HELPER_ANCHOR = ',yn=e=>(0,X.jsx)(`select`,';
  const HELPER = ',nfAiSeqPreviewZoomQueue=new WeakMap,nfAiSeqQueuePreviewZoom=(e,t)=>{let n=nfAiSeqPreviewZoomQueue.get(e);n||(n={factors:[],timer:0,last:0},nfAiSeqPreviewZoomQueue.set(e,n)),n.factors.push(t);let r=()=>{n.timer=0,n.last=performance.now();let t=n.factors.splice(0);t.length&&e(e=>t.reduce((e,t)=>Math.round(Math.max(.1,Math.min(8,e*t))*1e3)/1e3,e))},i=performance.now()-n.last;i>=100&&!n.timer?r():n.timer||(n.timer=window.setTimeout(r,Math.max(16,100-i)))}';
  const CALL_BEFORE = 'oe(e=>Math.round(Math.max(.1,Math.min(8,e*n))*1e3)/1e3)';
  const CALL_AFTER = 'nfAiSeqQueuePreviewZoom(oe,n)';

  if (!source.includes('nfAiSeqQueuePreviewZoom=(e,t)=>{')) {
    const anchorIndex = source.indexOf(HELPER_ANCHOR);
    if (anchorIndex < 0 || anchorIndex !== source.lastIndexOf(HELPER_ANCHOR)) {
      throw new Error('Preview wheel zoom: helper anchor missing or ambiguous');
    }
    source = source.slice(0, anchorIndex) + HELPER + source.slice(anchorIndex);
  }

  if (source.includes(CALL_BEFORE)) {
    const occurrences = source.split(CALL_BEFORE).length - 1;
    if (occurrences !== 2) {
      throw new Error(`Preview wheel zoom: expected 2 zoom setter calls, found ${occurrences}`);
    }
    source = source.split(CALL_BEFORE).join(CALL_AFTER);
  }

  if (source.split(CALL_AFTER).length - 1 !== 2) {
    throw new Error('Preview wheel zoom: coalesced zoom calls missing');
  }
  return source;
}
