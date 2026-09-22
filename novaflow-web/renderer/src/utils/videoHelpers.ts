export async function waitForSeek(
  v: HTMLVideoElement,
  t: number,
  opts?: { ensureReadyTimeoutMs?: number; seekTimeoutMs?: number }
) {
  const ensureReadyTimeoutMs = Math.max(0, Number(opts?.ensureReadyTimeoutMs) || 3000)
  const seekTimeoutMs = Math.max(0, Number(opts?.seekTimeoutMs) || 1500)

  const target = Math.max(0, Math.min(Number(v.duration) || t, t))

  if (v.readyState < 2) {
    await new Promise<void>((resolve) => {
      let done = false
      const deadline = window.setTimeout(() => {
        if (done) return
        done = true
        cleanup()
        resolve()
      }, ensureReadyTimeoutMs)
      const onData = () => {
        if (done) return
        done = true
        window.clearTimeout(deadline)
        cleanup()
        resolve()
      }
      const onErr = () => {
        if (done) return
        done = true
        window.clearTimeout(deadline)
        cleanup()
        resolve()
      }
      const cleanup = () => {
        v.removeEventListener('loadeddata', onData)
        v.removeEventListener('canplay', onData)
        v.removeEventListener('error', onErr)
      }
      v.addEventListener('loadeddata', onData, { once: true })
      v.addEventListener('canplay', onData, { once: true })
      v.addEventListener('error', onErr, { once: true })
    })
  }

  if (Math.abs((Number(v.currentTime) || 0) - target) < 1e-3) return

  await new Promise<void>((resolve, reject) => {
    let done = false
    const timer = window.setTimeout(() => {
      if (done) return
      done = true
      cleanup()
      resolve()
    }, seekTimeoutMs)

    const onSeeked = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      cleanup()
      resolve()
    }
    const onErr = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      cleanup()
      reject(new Error('seek 失败'))
    }
    const cleanup = () => {
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('error', onErr)
    }

    v.addEventListener('seeked', onSeeked, { once: true })
    v.addEventListener('error', onErr, { once: true })
    try { v.currentTime = target } catch (e) { window.clearTimeout(timer); cleanup(); reject(e as any) }
  })
}
