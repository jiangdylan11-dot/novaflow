/*
 * NovaFlow — 自动蒙皮 / 自动架设 builders off the main thread.
 *
 * The same spine-auto-mesh.js / spine-auto-bones.js the page uses, loaded here with
 * importScripts. 生成网格 ran every layer's build on the main thread (~4 s with the whole UI
 * frozen on a 26-layer project) and 自动架设's medial-axis analysis froze it for ~0.75 s;
 * the panel now hands the pixels to a small pool of these workers.
 *
 * messages in:  {type: 'init', scripts: [coreUrl, meshUrl, bonesUrl]}
 *               {type: 'build', id, buffer (RGBA, transferred), width, height, options}
 *               {type: 'skeleton', id, layers: [{name, att, width, height, rgba, place}]}
 * messages out: {type: 'init', ok, error?} / {type: 'build' | 'skeleton', id, mesh | built | error}
 */
/* global importScripts */
let AutoMesh = null
self.onmessage = (event) => {
  const message = event.data || {}
  if (message.type === 'init') {
    try {
      importScripts(...message.scripts)
      AutoMesh = self.NovaFlowAutoMesh || null
      self.postMessage({ type: 'init', ok: !!AutoMesh })
    } catch (error) {
      self.postMessage({ type: 'init', ok: false, error: String((error && error.message) || error) })
    }
    return
  }
  if (message.type === 'build') {
    try {
      if (!AutoMesh) throw new Error('mesh builder not loaded')
      const mesh = AutoMesh.buildMesh(new Uint8ClampedArray(message.buffer), message.width, message.height, message.options || {})
      self.postMessage({ type: 'build', id: message.id, mesh })
    } catch (error) {
      self.postMessage({ type: 'build', id: message.id, error: String((error && error.message) || error) })
    }
    return
  }
  if (message.type === 'skeleton') {
    try {
      if (!self.NovaFlowAutoBones) throw new Error('bone builder not loaded')
      const built = self.NovaFlowAutoBones.buildSkeleton(message.layers || [])
      self.postMessage({ type: 'skeleton', id: message.id, built })
    } catch (error) {
      self.postMessage({ type: 'skeleton', id: message.id, error: String((error && error.message) || error) })
    }
  }
}
