// Keep preview pixels transparent so the DOM backplate can change instantly.
// The export renderer is deliberately outside these two preview-only anchors.
export function patchCutoutPreviewBackground(source) {
  const replacements = [
    [
      'r&&(r.clearRect(0,0,t,n),r.fillStyle=j===`white`?`#ffffff`:j===`gray`?`#9ca3af`:`#000000`,r.fillRect(0,0,t,n))',
      'r&&r.clearRect(0,0,t,n)'
    ],
    [
      'let x=j===`white`?`#ffffff`:j===`gray`?`#9ca3af`:`#000000`;if(V)',
      '/* nfPreviewTransparentBackplateV1 */if(V)'
    ],
    [
      'v.drawImage(w.canvas,T.dx,T.dy,T.dw,T.dh),v.globalCompositeOperation=`destination-over`,v.fillStyle=x,v.fillRect(0,0,f,h),v.restore()',
      'v.drawImage(w.canvas,T.dx,T.dy,T.dw,T.dh),v.restore()'
    ]
  ];
  if (source.includes('nfPreviewTransparentBackplateV1')) return source;
  for (const [before, after] of replacements) {
    if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
      throw new Error('Cutout preview background anchor must exist exactly once: ' + before.slice(0, 80));
    }
    source = source.replace(before, after);
  }
  return source;
}
