export function getSystemSpriteDataUrls(system: { spritePlayback?: string; spriteSequenceRandom?: boolean; sprites?: any[] } | null | undefined) {
  const sprites = Array.isArray(system?.sprites) ? system.sprites : []
  if (system?.spritePlayback === 'sequence') {
    const seqSprites = sprites.filter((sp: any) => sp?.mode === 'sequence' && Array.isArray(sp?.frames) && sp.frames.length > 0)
    if (seqSprites.length > 0) {
      if (!system?.spriteSequenceRandom) {
        return seqSprites[0].frames.map((f: any) => String(f?.dataUrl || '')).filter(Boolean)
      }
      return sprites
        .flatMap((sp: any) => (
          sp?.mode === 'sequence' && Array.isArray(sp?.frames) && sp.frames.length > 0
            ? sp.frames.map((f: any) => String(f?.dataUrl || ''))
            : [String(sp?.dataUrl || '')]
        ))
        .filter(Boolean)
    }
  }
  return sprites.map((sp: any) => String(sp?.dataUrl || '')).filter(Boolean)
}
