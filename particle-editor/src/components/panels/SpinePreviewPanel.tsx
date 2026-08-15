import { Panel } from '../ui/Panel'
import { Label, Select } from '../ui/controls'

export function SpinePreviewPanel({
  importedProject,
  importedAnim,
  setImportedAnim,
  importedPlaying,
  setImportedPlaying,
  exitPreview,
}: {
  importedProject: any
  importedAnim: string
  setImportedAnim: (v: string) => void
  importedPlaying: boolean
  setImportedPlaying: (v: boolean | ((p: boolean) => boolean)) => void
  exitPreview: () => void
}) {
  if (!importedProject) return null
  return (
    <Panel id="spine-preview" title="骨架预览" icon="film" defaultOpen={false}>
      <Label>动画</Label>
      <Select value={importedAnim} onChange={(e: any) => setImportedAnim(e.target.value)} style={{ marginBottom: 10 }}>
        {Object.keys(importedProject.animations || {}).map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </Select>
      <button onClick={() => setImportedPlaying((v) => !v)} style={{ width: '100%', padding: '10px 0', background: importedPlaying ? '#1ea672' : '#24282e', border: '1px solid transparent', borderRadius: 6, color: '#fff', cursor: 'pointer', fontWeight: 'bold', fontSize: 13, marginBottom: 10 }}>
        {importedPlaying ? '暂停' : '播放'}
      </button>
      <button onClick={exitPreview} style={{ width: '100%', padding: '10px 0', background: '#24282e', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>
        退出骨架预览
      </button>
    </Panel>
  )
}
