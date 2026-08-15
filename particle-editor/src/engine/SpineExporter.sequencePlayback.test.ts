import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { exportSpinePackage } from './SpinePackageExporter'

describe('SpineExporter sequence playback', () => {
  it('exports per-particle attachment timeline for spritePlayback=sequence', async () => {
    const templatePath = path.resolve(process.cwd(), '..', 'particle-editor-desktop', 'resources', 'initial-templates', 'NovaFlow项目_金币-点喷.json')
    const raw = await fs.readFile(templatePath, 'utf8')
    const system0 = JSON.parse(raw)
    const system = { ...system0, enabled: system0?.enabled !== false }
    const pkg = await exportSpinePackage([system] as any, '3.8', { forceFullRate: true, disablePooling: true })
    const parsed = JSON.parse(pkg.json)
    const slots = parsed?.animations?.animation?.slots || {}
    let hasMulti = false
    for (const s of Object.values<any>(slots)) {
      const list = s?.attachment
      if (!Array.isArray(list) || list.length < 2) continue
      const names = new Set(list.map((k: any) => k?.name).filter(Boolean))
      if (names.size >= 2) {
        hasMulti = true
        break
      }
    }
    expect(hasMulti).toBe(true)
  })
})

