/* Spine event audio: portable resources and interval-based playback, independent of posing/scrubbing. */
;(function (root) {
  'use strict'
  const extensions = /\.(wav|ogg|mp3|m4a|aac|flac|webm)$/i
  function path(value) {
    const parts = String(value || '').replace(/\\/g, '/').split('/')
    if (/^(?:[a-z]+:|\/)/i.test(String(value || ''))) return ''
    const out = []
    for (const part of parts) { if (part === '..') { if (!out.length) return ''; out.pop() } else if (part && part !== '.') out.push(part) }
    return out.join('/')
  }
  function names(json, assets) {
    return [...new Set([...assets.keys(), ...Object.values(json.events || {}).map(e => path(e.audio)).filter(Boolean)])].sort((a, b) => a.localeCompare(b))
  }
  function source(assets, name) {
    const key = path(name).toLowerCase()
    return key ? [...assets].find(([p]) => p.toLowerCase() === key)?.[1] || null : null
  }
  // A start includes a key at its current time once. Later ticks exclude their left edge.
  // Repeated ranges keep end-of-loop and zero-time keys distinct, including slow render frames.
  function crossed(events, from, elapsed, duration, loop, initial) {
    const out = []
    if (elapsed < 0 || !Number.isFinite(elapsed) || !(duration > 0)) return out
    let start = from, left = elapsed, include = initial
    do {
      const end = Math.min(duration, start + left)
      for (const e of events || []) { const t = Number(e.time) || 0; if ((include ? t >= start : t > start) && t <= end) out.push(e) }
      left -= end - start
      if (!loop || end < duration) break
      if (left <= 0) { for (const e of events || []) if (!(Number(e.time) || 0)) out.push(e); break }
      start = 0; include = true
    } while (left > 0)
    return out
  }
  function player(report) {
    let context = null, generation = 0
    const active = new Set(), buffers = new Map()
    const audioContext = () => context || (context = new (root.AudioContext || root.webkitAudioContext)())
    function stop() { generation++; for (const s of active) { try { s.stop() } catch {} }; active.clear() }
    async function play(dataUrl, volume = 1, balance = 0) {
      const ownGeneration = generation
      try {
        const ctx = audioContext()
        await ctx.resume()
        let decoding = buffers.get(dataUrl)
        if (!decoding) { decoding = fetch(dataUrl).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)); buffers.set(dataUrl, decoding); decoding.catch(() => buffers.delete(dataUrl)) }
        const buffer = await decoding
        if (generation !== ownGeneration) return false
        const sound = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner()
        sound.buffer = buffer; gain.gain.value = Math.max(0, Number(volume) || 0); pan.pan.value = Math.max(-1, Math.min(1, Number(balance) || 0))
        sound.connect(gain); gain.connect(pan); pan.connect(ctx.destination)
        active.add(sound); sound.onended = () => { active.delete(sound); sound.disconnect(); gain.disconnect(); pan.disconnect() }
        sound.start(); return true
      } catch (error) { if (generation === ownGeneration && report) report(error); return false }
    }
    return { play, stop, unlock: () => { try { audioContext().resume().catch(() => {}) } catch {} }, active: () => active.size }
  }
  root.NovaFlowSpineAudio = { extensions, path, names, source, crossed, player }
})(typeof window === 'undefined' ? globalThis : window)
