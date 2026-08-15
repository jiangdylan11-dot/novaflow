import { describe, expect, it } from 'vitest'
import { getSystemSpriteDataUrls } from './spriteDataUrls'

describe('getSystemSpriteDataUrls', () => {
  it('uses only the first sequence sprite frames in non-random sequence mode', () => {
    const spriteUrls = getSystemSpriteDataUrls({
      spritePlayback: 'sequence',
      spriteSequenceRandom: false,
      sprites: [
        { id: 'single_1', mode: 'single', dataUrl: 'data:image/png;base64,single' },
        {
          id: 'seq_1',
          mode: 'sequence',
          dataUrl: 'data:image/png;base64,seq1_cover',
          frames: [
            { name: 'f0', dataUrl: 'data:image/png;base64,seq1_f0' },
            { name: 'f1', dataUrl: 'data:image/png;base64,seq1_f1' }
          ]
        },
        {
          id: 'seq_2',
          mode: 'sequence',
          dataUrl: 'data:image/png;base64,seq2_cover',
          frames: [{ name: 'f0', dataUrl: 'data:image/png;base64,seq2_f0' }]
        }
      ]
    })

    expect(spriteUrls).toEqual([
      'data:image/png;base64,seq1_f0',
      'data:image/png;base64,seq1_f1'
    ])
  })

  it('flattens sequence frames and single sprites in random sequence mode', () => {
    const spriteUrls = getSystemSpriteDataUrls({
      spritePlayback: 'sequence',
      spriteSequenceRandom: true,
      sprites: [
        {
          id: 'seq_1',
          mode: 'sequence',
          dataUrl: 'data:image/png;base64,seq_cover',
          frames: [
            { name: 'f0', dataUrl: 'data:image/png;base64,seq_f0' },
            { name: 'f1', dataUrl: 'data:image/png;base64,seq_f1' }
          ]
        },
        { id: 'single_1', mode: 'single', dataUrl: 'data:image/png;base64,single' }
      ]
    })

    expect(spriteUrls).toEqual([
      'data:image/png;base64,seq_f0',
      'data:image/png;base64,seq_f1',
      'data:image/png;base64,single'
    ])
  })

  it('falls back to plain sprite data urls outside sequence playback', () => {
    const spriteUrls = getSystemSpriteDataUrls({
      spritePlayback: 'single',
      sprites: [
        { id: 'single_1', mode: 'single', dataUrl: 'data:image/png;base64,single_1' },
        { id: 'single_2', mode: 'single', dataUrl: 'data:image/png;base64,single_2' }
      ]
    })

    expect(spriteUrls).toEqual([
      'data:image/png;base64,single_1',
      'data:image/png;base64,single_2'
    ])
  })
})
