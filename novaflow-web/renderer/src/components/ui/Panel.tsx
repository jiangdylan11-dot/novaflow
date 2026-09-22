import { useState } from 'react'
import { loadPanelOpen, savePanelOpen } from '../../utils/panelOpenStorage'

const PANEL_BODY_PADDING = 14

export const Panel = ({ id, title, icon, children, defaultOpen = true, collapsible = true }: any) => {
  const key = String(id || title || '')
  const [open, setOpen] = useState<boolean>(() => (collapsible ? loadPanelOpen(key, !!defaultOpen) : true))
  const toggle = () => {
    if (!collapsible) return
    setOpen((prev) => {
      const next = !prev
      savePanelOpen(key, next)
      return next
    })
  }
  return (
    <div className="nf-panel" data-panel-id={key} data-open={open ? '1' : '0'} style={{ marginBottom: 0, overflow: 'hidden' }}>
      <div
        onClick={toggle}
        className="nf-panel-header"
        style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 'none', cursor: collapsible ? 'pointer' : 'default', userSelect: 'none' }}
      >
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <i className={`fas fa-${icon}`} style={{ width: 18, textAlign: 'center', marginRight: 8, fontSize: 14 }}></i> {title}
        </span>
        {collapsible && <i className={`fas fa-chevron-${open ? 'down' : 'right'}`} style={{ fontSize: 12, opacity: 0.7 }} />}
      </div>
      {open && <div className="nf-panel-body" style={{ padding: PANEL_BODY_PADDING }}>{children}</div>}
    </div>
  )
}
