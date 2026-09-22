export function PreviewZoomBar({
  containerRef,
  zoom,
  onAutoFit
}: {
  containerRef: any
  zoom: number
  onAutoFit: () => void
}) {
  return (
    <div ref={containerRef} data-preview-ui="1" style={{ position: 'absolute', right: 16, top: 12, zIndex: 46, display: 'flex', gap: 10, alignItems: 'center', background: 'rgba(15, 19, 25, 0.96)', padding: '8px 10px', borderRadius: 999, backdropFilter: 'none', border: '1px solid rgba(255,255,255,0.10)' }}>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', minWidth: 48, textAlign: 'right' }}>{Math.round(zoom * 100)}%</div>
      <button onClick={onAutoFit} style={{ background: '#24282e', border: '1px solid transparent', color: '#fff', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>自动适配</button>
    </div>
  )
}
