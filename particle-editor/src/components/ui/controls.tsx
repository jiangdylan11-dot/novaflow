const getRangePct = (value: any, min: any, max: any) => {
  const minValue = Number(min)
  const maxValue = Number(max)
  const currentValue = Number(value)
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || !Number.isFinite(currentValue) || maxValue <= minValue) return '0%'
  const pct = Math.max(0, Math.min(100, ((currentValue - minValue) / (maxValue - minValue)) * 100))
  return `${pct}%`
}

const getSliderNumberDisplay = (value: any, step: any) => {
  const currentValue = Number(value)
  if (!Number.isFinite(currentValue)) return value
  const stepText = String(step ?? '')
  const decimalPart = stepText.includes('.') ? (stepText.split('.')[1] || '').replace(/0+$/, '') : ''
  const decimals = Math.min(6, Math.max(0, decimalPart.length))
  if (decimals <= 0) return String(Math.round(currentValue))
  return String(Number(currentValue.toFixed(decimals)))
}

export const SliderControl = ({ label, value, min, max, step = 1, onChange, suffix = '', right }: any) => (
  <div className="nf-slider" style={{ marginBottom: 0 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', height: 14, minHeight: 14, maxHeight: 14, lineHeight: '14px', marginBottom: 2, boxSizing: 'border-box' }}>
      <label className="nf-label" style={{ fontSize: 11, fontWeight: 500 }}>{label}</label>
      {right}
    </div>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 26, minHeight: 26, maxHeight: 26 }}>
      <input className="nf-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} style={{ flex: 1, accentColor: 'var(--nf-accent)', height: 26, minHeight: 26, maxHeight: 26, borderRadius: 999, appearance: 'none', cursor: 'pointer', '--nf-range-pct': getRangePct(value, min, max) } as any} />
      <div style={{ position: 'relative', width: 66 }}>
        <input className="nf-input nf-number" type="number" value={getSliderNumberDisplay(value, step)} onChange={(e) => onChange(+e.target.value)} style={{ width: '100%', height: 24, minHeight: 24, maxHeight: 24, padding: suffix ? '0 18px 0 8px' : '0 8px', fontSize: 11, lineHeight: '22px', borderRadius: 8, boxSizing: 'border-box' }} />
        {!!suffix && <span style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'rgba(255,255,255,0.55)', pointerEvents: 'none' }}>{suffix}</span>}
      </div>
    </div>
  </div>
)

export const ToggleCard = ({ title, enabled, onToggle, children, style, level = 1 }: any) => {
  const colors = level === 2
    ? (enabled
        ? {
            bg: 'rgba(20, 184, 166, 0.46)',
            border: '1px solid rgba(20, 184, 166, 0.78)',
            text: 'rgba(20, 184, 166, 0.95)'
          }
        : {
            bg: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid transparent',
            text: 'rgba(16, 185, 129, 0.58)'
          })
    : (enabled
        ? {
            bg: 'rgba(16, 185, 129, 0.10)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            text: 'rgba(16, 185, 129, 0.95)'
          }
        : {
            bg: '#24282e',
            border: '1px solid transparent',
            text: 'rgba(255,255,255,0.45)'
          })
  return (
    <div style={{ background: colors.bg, border: colors.border, borderRadius: 6, overflow: 'hidden', ...style }}>
      <button type="button" onClick={() => onToggle(!enabled)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff', background: 'transparent', border: 0, padding: '12px 14px' }}>
        <span>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: colors.text }}>{enabled ? '已开启' : '未开启'}</span>
      </button>
      {enabled && children}
    </div>
  )
}

export const Label = ({ children }: any) => <label className="nf-label" style={{ fontSize: 11, marginBottom: 6, display: 'block', fontWeight: 500 }}>{children}</label>
export const Input = (props: any) => <input {...props} className={`nf-input ${props.className || ''}`.trim()} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 12, ...props.style }} />
export const Textarea = (props: any) => <textarea {...props} className={`nf-input ${props.className || ''}`.trim()} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 12, resize: 'vertical', minHeight: 80, ...props.style }} />
export const Select = (props: any) => <select {...props} className={`nf-select ${props.className || ''}`.trim()} style={{ width: '100%', padding: '8px 10px', fontSize: 12, cursor: 'pointer', ...props.style }} />
export const Col = ({ children }: any) => <div style={{ flex: 1 }}>{children}</div>
