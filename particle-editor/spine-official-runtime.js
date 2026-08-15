;(() => {
  const factoryName = '__NOVA_SPINE_CREATE_PLAYER'
  const debugName = '__NOVA_SPINE_DEBUG'
  const scriptByKind = {
    '3.8': './vendor/spine/spine-webgl-3.8.js',
    '4': './vendor/spine/spine-webgl-4.0.js',
  }
  const runtimeGlobals = new Map()
  const runtimePromises = new Map()
  const resourceCache = new Map()
  let scriptLoadChain = Promise.resolve()

  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

  class OfficialSpineProxy {
    constructor(canvas, rawSource, animationName, parsedProject) {
      this.__novaOfficial = true
      this.canvas = canvas
      this.source = normalizeSource(rawSource)
      this.animationName = String(animationName || firstAnimationName(parsedProject) || '').trim()
      this.skinName = null
      this.loop = true
      this.playing = true
      this.disposed = false
      this.debugOverlays = {}
      this.raf = 0
      this.lastTs = 0
      this.timeSec = 0
      this.player = null
      this.cacheKey = this.source.key
      this.loadVersion = 0
      this.selectedBoneNames = []
      this.visibleBoneNames = null
      this.project = parsedProject || null
      this.ready = this.load()
    }

    async load() {
      const version = ++this.loadVersion
      try {
        const entry = await retainResource(this.source)
        if (this.disposed || version !== this.loadVersion) {
          releaseResource(entry.key)
          return
        }
        this.cacheKey = entry.key
        this.player = new OfficialSpinePlayer(this.canvas, entry.resource, this.animationName, {
          loop: this.loop,
          skinName: this.skinName,
        })
        this.player.setDebugOverlays(this.debugOverlays)
        this.player.setSelectedBoneNames(this.selectedBoneNames)
        this.player.setVisibleBoneNames(this.visibleBoneNames)
        this.player.setProject(this.project)
        this.player.seek(this.timeSec)
        if (this.playing) this.start()
      } catch (error) {
        console.warn('[NovaFlow Spine] official runtime failed, fallback player may be used next mount', error)
      }
    }

    matchesSource(rawSource) {
      try { return normalizeSource(rawSource).key === this.source.key } catch { return false }
    }

    setProject(project) {
      this.project = project || null
      if (this.player) this.player.setProject(this.project)
    }

    setAnimation(name) {
      this.animationName = String(name || '').trim() || this.animationName
      if (this.player) this.player.setAnimation(this.animationName, this.loop)
    }

    setSkin(name) {
      this.skinName = String(name || '').trim() || null
      if (this.player) this.player.setSkin(this.skinName)
    }

    setPlaying(playing) {
      this.playing = !!playing
      if (this.playing) this.start()
      else this.cancelRaf()
    }

    setHud(enabled) {
      if (this.player) this.player.setHud(!!enabled)
    }

    setDebugOverlays(overlays) {
      this.debugOverlays = overlays || {}
      if (this.player) this.player.setDebugOverlays(this.debugOverlays)
    }
    setPremultipliedAlpha(enabled) {
      if (this.player) this.player.setPremultipliedAlpha(enabled)
    }
    setSelectedBoneName(name) {
      const next = String(name || '').trim()
      this.setSelectedBoneNames(next ? [next] : [])
    }
    setSelectedBoneNames(names) {
      this.selectedBoneNames = Array.isArray(names)
        ? names.map((name) => String(name || '').trim()).filter(Boolean)
        : []
      if (this.player) this.player.setSelectedBoneNames(this.selectedBoneNames)
    }
    setVisibleBoneNames(names) {
      this.visibleBoneNames = Array.isArray(names)
        ? names.map((name) => String(name || '').trim()).filter(Boolean)
        : null
      if (this.player) this.player.setVisibleBoneNames(this.visibleBoneNames)
    }
    pickBoneAt(x, y) { return this.player?.pickBoneAt?.(x, y) || null }

    renderAt(timeSec) {
      this.timeSec = Number.isFinite(Number(timeSec)) ? Math.max(0, Number(timeSec)) : 0
      if (this.player) this.player.seek(this.timeSec)
    }

    getDurationSec() {
      return this.player ? this.player.getDurationSec() : 0
    }

    getRecommendedFrameIntervalMs() {
      return 16
    }

    start() {
      if (this.disposed || this.raf) return
      this.playing = true
      this.lastTs = now()
      const tick = (ts) => {
        if (this.disposed || !this.playing) {
          this.raf = 0
          return
        }
        this.raf = requestAnimationFrame(tick)
        const nextTs = Number.isFinite(ts) ? ts : now()
        const dt = document.hidden ? 0 : Math.max(0, Math.min(0.2, (nextTs - this.lastTs) / 1000))
        this.lastTs = nextTs
        if (this.player && dt > 0) {
          this.player.update(dt)
          this.timeSec = this.player.getTimeSec()
        }
      }
      this.raf = requestAnimationFrame(tick)
    }

    stop() {
      this.playing = false
      this.cancelRaf()
    }

    dispose() {
      if (this.disposed) return
      this.disposed = true
      this.cancelRaf()
      if (this.player) {
        this.player.dispose()
        this.player = null
      }
      releaseResource(this.cacheKey)
    }

    cancelRaf() {
      if (!this.raf) return
      try { cancelAnimationFrame(this.raf) } catch {}
      this.raf = 0
    }
  }

  class OfficialSpinePlayer {
    constructor(canvas, resource, animationName, options) {
      this.canvas = canvas
      this.resource = resource
      this.spine = resource.spine
      this.webgl = resource.webgl
      this.loop = options.loop !== false
      this.hud = false
      this.disposed = false
      this.timeSec = 0
      this.durationSec = 0
      this.autoPremultipliedAlpha = resource.premultipliedAlpha
      this.premultipliedAlpha = resource.premultipliedAlpha
      this.debugOverlays = {}
      this.textures = []
      this.lastResizeWidth = 0
      this.lastResizeHeight = 0
      this.boundsOffset = new this.spine.Vector2()
      this.boundsSize = new this.spine.Vector2()
      this.stableBounds = resource.bounds || null
      this.selectedBoneNames = []
      this.visibleBoneNames = null
      this.meshDebugVertices = new Float32Array(0)
      this.regionDebugVertices = new Float32Array(8)
      this.animationName = ''
      this.skinName = options.skinName ? String(options.skinName) : null
      this.skeletonData = resource.skeletonData
      this.animationNames = resource.animationNames.slice()
      this.projectAnimationsKey = animationsSignatureFromJson(resource.jsonText)

      const contextOptions = {
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      }
      const gl = canvas.getContext('webgl2', contextOptions) || canvas.getContext('webgl', contextOptions)
      if (!gl) throw new Error('WebGL is required for Spine official preview')
      this.gl = gl
      const SceneRenderer = this.webgl.SceneRenderer || this.spine.SceneRenderer
      this.renderer = new SceneRenderer(canvas, gl, true)

      this.installTextures()
      this.skeleton = new this.spine.Skeleton(this.skeletonData)
      this.animationStateData = new this.spine.AnimationStateData(this.skeletonData)
      this.animationState = new this.spine.AnimationState(this.animationStateData)
      if (this.skinName) this.setSkin(this.skinName)
      this.setAnimation(animationName || this.animationNames[0] || '', this.loop)
    }

    setAnimation(name, loop = this.loop) {
      if (this.disposed) return
      const next = String(name || '').trim() || this.animationNames[0] || ''
      if (!next) return
      this.loop = loop !== false
      try {
        const entry = this.animationState.setAnimation(0, next, this.loop)
        this.durationSec = Math.max(0, Number(entry?.animation?.duration || 0))
        this.animationName = next
      } catch {
        const fallback = this.animationNames[0]
        if (!fallback || fallback === next) return
        const entry = this.animationState.setAnimation(0, fallback, this.loop)
        this.durationSec = Math.max(0, Number(entry?.animation?.duration || 0))
        this.animationName = fallback
      }
      this.timeSec = 0
      this.applyAt(0)
      this.captureStableBounds()
      this.applyCameraFit()
      this.renderCurrentPose()
    }

    setSkin(name) {
      if (this.disposed) return
      const skinName = String(name || '').trim()
      this.skinName = skinName || null
      if (skinName) this.skeleton.setSkinByName(skinName)
      else if (this.skeleton.setSkin) this.skeleton.setSkin(null)
      this.skeleton.setSlotsToSetupPose()
      this.animationState.apply(this.skeleton)
      this.skeleton.updateWorldTransform()
      this.renderCurrentPose()
    }

    setPremultipliedAlpha(enabled) {
      const next = enabled == null ? this.autoPremultipliedAlpha : !!enabled
      if (this.premultipliedAlpha === next) return
      this.premultipliedAlpha = next
      this.renderCurrentPose()
    }

    setProject(project) {
      if (this.disposed || !project || !project.animations) return
      const nextKey = animationsSignature(project.animations)
      if (!nextKey || nextKey === this.projectAnimationsKey) return
      try {
        const parsed = JSON.parse(this.resource.jsonText)
        parsed.animations = project.animations || parsed.animations || {}
        const loader = new this.spine.AtlasAttachmentLoader(this.resource.atlas)
        const json = new this.spine.SkeletonJson(loader)
        json.scale = 1
        const skeletonData = readSkeletonDataCompat(json, JSON.stringify(parsed))
        const animationNames = (skeletonData.animations || []).map((animation) => String(animation.name || '')).filter(Boolean)
        const prevAnimation = this.animationName
        const prevSkin = this.skinName
        const prevTime = this.timeSec
        this.skeletonData = skeletonData
        this.animationNames = animationNames
        this.skeleton = new this.spine.Skeleton(skeletonData)
        this.animationStateData = new this.spine.AnimationStateData(skeletonData)
        this.animationState = new this.spine.AnimationState(this.animationStateData)
        this.projectAnimationsKey = nextKey
        if (prevSkin) this.setSkin(prevSkin)
        this.setAnimation(animationNames.includes(prevAnimation) ? prevAnimation : animationNames[0] || '', this.loop)
        this.seek(prevTime)
      } catch (error) {
        console.warn('[NovaFlow Spine] failed to apply project animation override', error)
      }
    }

    setHud(enabled) {
      this.hud = !!enabled
    }

    setDebugOverlays(overlays) {
      this.debugOverlays = overlays || {}
      this.renderCurrentPose()
    }

    setSelectedBoneName(name) {
      const next = String(name || '').trim()
      this.setSelectedBoneNames(next ? [next] : [])
    }

    setSelectedBoneNames(names) {
      this.selectedBoneNames = Array.isArray(names)
        ? names.map((name) => String(name || '').trim()).filter(Boolean)
        : []
      this.renderCurrentPose()
    }

    setVisibleBoneNames(names) {
      this.visibleBoneNames = Array.isArray(names)
        ? names.map((name) => String(name || '').trim()).filter(Boolean)
        : null
      this.renderCurrentPose()
    }

    update(dtSec) {
      if (this.disposed) return
      const dt = Math.max(0, Number(dtSec) || 0)
      this.animationState.update(dt)
      this.animationState.apply(this.skeleton)
      this.skeleton.updateWorldTransform()
      const current = this.animationState.getCurrent(0)
      this.timeSec = current?.getAnimationTime?.() ?? normalizeTime(this.timeSec + dt, this.durationSec, this.loop)
      this.renderCurrentPose()
    }

    seek(timeSec) {
      if (this.disposed) return
      const next = normalizeTime(timeSec, this.durationSec, this.loop)
      this.timeSec = next
      this.applyAt(next)
      this.renderCurrentPose()
    }

    getTimeSec() {
      return this.timeSec
    }

    getDurationSec() {
      return this.durationSec
    }

    dispose() {
      if (this.disposed) return
      this.disposed = true
      for (const texture of this.textures) {
        try { texture.dispose?.() } catch {}
      }
      this.textures.length = 0
      try { this.renderer.dispose?.() } catch {}
    }

    applyAt(timeSec) {
      const current = this.animationState.getCurrent(0)
      if (current) {
        current.trackTime = timeSec
        current.trackLast = timeSec
        current.animationLast = timeSec
        current.nextTrackLast = timeSec
        current.nextAnimationLast = timeSec
        current.setAnimationLast?.(timeSec)
      }
      this.skeleton.setToSetupPose?.()
      this.animationState.apply(this.skeleton)
      this.skeleton.updateWorldTransform()
    }

    installTextures() {
      const pages = this.resource.atlas.pages || []
      const GLTexture = this.webgl.GLTexture || this.spine.GLTexture
      this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      if (this.gl.UNPACK_COLORSPACE_CONVERSION_WEBGL != null) {
        this.gl.pixelStorei(this.gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, this.gl.NONE)
      }
      for (const page of pages) {
        const loaded = this.resource.imagesByPage.get(normalizeName(page.name))
        if (!loaded) throw new Error(`Missing decoded Spine page: ${page.name}`)
        const texture = new GLTexture(this.gl, loaded.image, false)
        this.textures.push(texture)
        setAtlasPageTexture(page, texture, this.resource.atlas)
      }
    }

    installActiveTextures() {
      const pages = this.resource.atlas.pages || []
      for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i]
        const texture = this.textures[i]
        if (texture && page.texture !== texture) setAtlasPageTexture(page, texture, this.resource.atlas)
      }
    }

    renderCurrentPose() {
      if (this.disposed) return
      this.installActiveTextures()
      const resized = this.resizeRenderer()
      if (resized) this.applyCameraFit()
      this.gl.clearColor(0, 0, 0, 0)
      this.gl.clear(this.gl.COLOR_BUFFER_BIT)
      this.renderer.begin()
      this.renderer.drawSkeleton(this.skeleton, this.premultipliedAlpha)
      const hasBoneFilter = Array.isArray(this.visibleBoneNames) && this.visibleBoneNames.length > 0
      if (this.debugOverlays?.bones && !hasBoneFilter && this.renderer.drawSkeletonDebug) {
        this.renderer.drawSkeletonDebug(this.skeleton, this.premultipliedAlpha)
      }
      if (this.debugOverlays?.mesh) this.drawMeshOverlay()
      this.drawSelectedBoneOverlay()
      this.renderer.end()
    }

    drawMeshOverlay() {
      if (!this.skeleton || !this.renderer) return
      const canRectLine = typeof this.renderer.rectLine === 'function'
      const canLine = typeof this.renderer.line === 'function'
      if (!canRectLine && !canLine) return
      const MeshAttachment = this.spine.MeshAttachment || this.webgl.MeshAttachment
      const RegionAttachment = this.spine.RegionAttachment || this.webgl.RegionAttachment
      const triangleColor = { r: 0.12, g: 0.85, b: 1, a: 0.56 }
      const hullColor = { r: 0.22, g: 1, b: 0.86, a: 0.72 }
      const regionColor = { r: 0.2, g: 0.75, b: 1, a: 0.62 }
      const fitSize = Math.max(
        Number(this.boundsSize?.x) || 0,
        Number(this.boundsSize?.y) || 0,
        Number(this.stableBounds?.width) || 0,
        Number(this.stableBounds?.height) || 0
      )
      const gridLineWidth = Math.max(0.55, Math.min(1.35, fitSize / 1100 || 0.8))
      const hullLineWidth = Math.max(0.85, Math.min(1.8, gridLineWidth * 1.35))
      let edgeDrawCount = 0
      const drawEdge = (x1, y1, x2, y2, color, width = 1.8) => {
        if (![x1, y1, x2, y2].every(Number.isFinite)) return
        if (canRectLine) this.renderer.rectLine(true, x1, y1, x2, y2, width, color)
        else this.renderer.line(x1, y1, x2, y2, color)
        edgeDrawCount += 1
        if (edgeDrawCount % 200 === 0 && typeof this.renderer.end === 'function' && typeof this.renderer.begin === 'function') {
          this.renderer.end()
          this.renderer.begin()
        }
      }
      const slots = this.skeleton.drawOrder || this.skeleton.slots || []
      for (const slot of slots) {
        if (slot?.bone?.active === false) continue
        const attachment = typeof slot?.getAttachment === 'function' ? slot.getAttachment() : slot?.attachment
        if (!attachment) continue
        const isMesh = MeshAttachment && attachment instanceof MeshAttachment
        const isMeshLike = attachment && typeof attachment.computeWorldVertices === 'function' && attachment.triangles && typeof attachment.triangles.length === 'number'
        if (isMesh || isMeshLike) {
          const worldVerticesLength = Math.max(
            0,
            Math.floor(Number(attachment.worldVerticesLength) || Number(attachment.uvs?.length) || Number(attachment.regionUVs?.length) || 0)
          )
          const triangles = attachment.triangles || []
          if (worldVerticesLength <= 0 || triangles.length < 3) continue
          if (!this.meshDebugVertices || this.meshDebugVertices.length < worldVerticesLength) {
            this.meshDebugVertices = new Float32Array(Math.max(worldVerticesLength, 64))
          }
          const vertices = this.meshDebugVertices
          try {
            attachment.computeWorldVertices(slot, 0, worldVerticesLength, vertices, 0, 2)
          } catch {
            continue
          }
          const drawnEdges = new Set()
          const drawIndexedEdge = (a, b) => {
            const start = Math.min(a, b)
            const end = Math.max(a, b)
            const key = `${start}:${end}`
            if (drawnEdges.has(key)) return
            drawnEdges.add(key)
            const v1 = a * 2
            const v2 = b * 2
            drawEdge(vertices[v1], vertices[v1 + 1], vertices[v2], vertices[v2 + 1], triangleColor, gridLineWidth)
          }
          for (let i = 0; i + 2 < triangles.length; i += 3) {
            drawIndexedEdge(triangles[i], triangles[i + 1])
            drawIndexedEdge(triangles[i + 1], triangles[i + 2])
            drawIndexedEdge(triangles[i + 2], triangles[i])
          }
          const hullLength = Math.min(worldVerticesLength, (Math.max(0, Number(attachment.hullLength) || 0) >> 1) * 2)
          if (hullLength >= 4) {
            let lastX = vertices[hullLength - 2]
            let lastY = vertices[hullLength - 1]
            for (let i = 0; i < hullLength; i += 2) {
              const x = vertices[i]
              const y = vertices[i + 1]
              drawEdge(x, y, lastX, lastY, hullColor, hullLineWidth)
              lastX = x
              lastY = y
            }
          }
          continue
        }
        const isRegion = RegionAttachment && attachment instanceof RegionAttachment
        const isRegionLike = !attachment.triangles && typeof attachment.computeWorldVertices === 'function'
        if (!isRegion && !isRegionLike) continue
        const vertices = this.regionDebugVertices
        try {
          try { attachment.computeWorldVertices(slot.bone, vertices, 0, 2) }
          catch { attachment.computeWorldVertices(slot, vertices, 0, 2) }
        } catch {
          continue
        }
        drawEdge(vertices[0], vertices[1], vertices[2], vertices[3], regionColor, gridLineWidth)
        drawEdge(vertices[2], vertices[3], vertices[4], vertices[5], regionColor, gridLineWidth)
        drawEdge(vertices[4], vertices[5], vertices[6], vertices[7], regionColor, gridLineWidth)
        drawEdge(vertices[6], vertices[7], vertices[0], vertices[1], regionColor, gridLineWidth)
      }
    }

    drawSelectedBoneOverlay() {
      if (!this.debugOverlays?.bones || !this.skeleton || !this.renderer) return
      const selected = new Set((this.selectedBoneNames || []).map((name) => String(name || '').trim()).filter(Boolean))
      const visible = Array.isArray(this.visibleBoneNames) && this.visibleBoneNames.length > 0
        ? new Set(this.visibleBoneNames.map((name) => String(name || '').trim()).filter(Boolean))
        : null
      if (selected.size === 0 && !visible) return
      const selectedColor = { r: 0.15, g: 0.85, b: 1, a: 1 }
      const chainColor = { r: 1, g: 0.82, b: 0.18, a: 0.92 }
      const drawLine = typeof this.renderer.line === 'function'
      if (!drawLine) return
      for (const bone of this.skeleton.bones || []) {
        const name = String(bone?.data?.name || '').trim()
        if (!name || bone?.active === false) continue
        const isSelected = selected.has(name)
        const isVisibleChain = !!visible?.has(name)
        if (!isSelected && !isVisibleChain) continue
        const color = isSelected ? selectedColor : chainColor
        const length = Math.max(18, Number(bone?.data?.length) || 0)
        const x1 = Number(bone?.worldX) || 0
        const y1 = Number(bone?.worldY) || 0
        const x2 = x1 + (Number(bone?.a) || 0) * length
        const y2 = y1 + (Number(bone?.c) || 0) * length
        if (drawLine) {
          this.renderer.line(x1, y1, x2, y2, color)
          if (isSelected && length > 0) {
            this.renderer.line(x1 - 4, y1, x1 + 4, y1, color)
            this.renderer.line(x1, y1 - 4, x1, y1 + 4, color)
          }
        }
      }
    }

    resizeRenderer() {
      const width = this.canvas.width || 0
      const height = this.canvas.height || 0
      if (width <= 0 || height <= 0) return false
      if (width === this.lastResizeWidth && height === this.lastResizeHeight) {
        return false
      }
      this.lastResizeWidth = width
      this.lastResizeHeight = height
      this.gl.viewport(0, 0, width, height)
      this.renderer.camera?.setViewport?.(width, height)
      this.renderer.camera?.update?.()
      return true
    }

    captureStableBounds() {
      if (this.stableBounds && this.stableBounds.width > 0 && this.stableBounds.height > 0) {
        this.boundsOffset.x = this.stableBounds.x
        this.boundsOffset.y = this.stableBounds.y
        this.boundsSize.x = this.stableBounds.width
        this.boundsSize.y = this.stableBounds.height
        return
      }
      this.skeleton.getBounds(this.boundsOffset, this.boundsSize, [])
    }

    applyCameraFit() {
      this.resizeRenderer()
      const width = Math.max(1, this.canvas.width || this.canvas.clientWidth || 1)
      const height = Math.max(1, this.canvas.height || this.canvas.clientHeight || 1)
      const camera = this.renderer.camera
      camera.position.x = this.boundsOffset.x + this.boundsSize.x / 2
      camera.position.y = this.boundsOffset.y + this.boundsSize.y / 2
      const zoomX = this.boundsSize.x > 0 ? (this.boundsSize.x / width) * 2.4 : 1
      const zoomY = this.boundsSize.y > 0 ? (this.boundsSize.y / height) * 2.4 : 1
      camera.zoom = Math.max(0.001, Math.max(zoomX, zoomY))
      camera.update()
    }

    centerCamera() {
      this.applyCameraFit()
    }

    pickBoneAt(screenX, screenY) {
      if (this.disposed || !this.skeleton || !this.renderer?.camera) return null
      const Vector3 = this.spine.Vector3 || this.webgl.Vector3
      if (!Vector3 || !this.renderer.camera.screenToWorld) return null
      this.resizeRenderer()
      const width = Math.max(1, this.canvas.width || 1)
      const height = Math.max(1, this.canvas.height || 1)
      const world = this.renderer.camera.screenToWorld(new Vector3(screenX, screenY, 0), width, height)
      let threshold = 12
      try {
        const near = this.renderer.camera.screenToWorld(new Vector3(screenX + 12, screenY, 0), width, height)
        threshold = Math.max(4, Math.hypot((near.x || 0) - (world.x || 0), (near.y || 0) - (world.y || 0)))
      } catch {}
      const visibleFilter = Array.isArray(this.visibleBoneNames) && this.visibleBoneNames.length > 0
        ? new Set(this.visibleBoneNames.map((name) => String(name || '').trim()).filter(Boolean))
        : null
      let bestName = null
      let bestDistance = threshold
      for (const bone of this.skeleton.bones || []) {
        if (bone?.active === false || !bone?.data?.name) continue
        const name = String(bone.data.name)
        if (visibleFilter && !visibleFilter.has(name)) continue
        const length = Math.max(0, Number(bone.data.length) || 0)
        const x1 = Number(bone.worldX) || 0
        const y1 = Number(bone.worldY) || 0
        const x2 = x1 + (Number(bone.a) || 0) * length
        const y2 = y1 + (Number(bone.c) || 0) * length
        const distance = length > 0
          ? distanceToSegment(world.x || 0, world.y || 0, x1, y1, x2, y2)
          : Math.hypot((world.x || 0) - x1, (world.y || 0) - y1)
        if (distance <= bestDistance) {
          bestDistance = distance
          bestName = name
        }
      }
      return bestName
    }
  }

  async function retainResource(source) {
    let entry = resourceCache.get(source.key)
    if (!entry) {
      entry = {
        key: source.key,
        refCount: 0,
        releaseTimer: 0,
        resource: null,
        promise: loadResource(source),
      }
      resourceCache.set(source.key, entry)
      entry.promise.then((resource) => { entry.resource = resource }, () => resourceCache.delete(source.key))
    }
    entry.refCount += 1
    if (entry.releaseTimer) {
      clearTimeout(entry.releaseTimer)
      entry.releaseTimer = 0
    }
    await entry.promise
    return entry
  }

  function releaseResource(key) {
    const entry = resourceCache.get(key)
    if (!entry) return
    entry.refCount = Math.max(0, entry.refCount - 1)
    if (entry.refCount > 0 || entry.releaseTimer) return
    entry.releaseTimer = window.setTimeout(() => {
      if (entry.refCount > 0) return
      try { entry.resource?.dispose?.() } catch {}
      resourceCache.delete(key)
    }, 60000)
  }

  async function loadResource(source) {
    const runtime = await loadRuntime(source.kind)
    const spine = runtime.spine
    const webgl = runtime.webgl
    const loadedImages = new Map()
    for (const imageAsset of source.images) {
      loadedImages.set(normalizeName(imageAsset.fileName), await loadImageAsset(imageAsset))
    }
    const fakeTextureForPage = (pageName) => {
      const loaded = findLoadedPageImage(pageName, loadedImages)
      if (!loaded) throw new Error(`Missing Spine atlas texture: ${pageName}`)
      return new spine.FakeTexture(loaded.image)
    }
    const atlas = source.kind === '3.8'
      ? new spine.TextureAtlas(source.atlasText, fakeTextureForPage)
      : new spine.TextureAtlas(source.atlasText)
    const imagesByPage = new Map()
    for (const page of atlas.pages || []) {
      const loaded = findLoadedPageImage(page.name, loadedImages)
      if (!loaded) throw new Error(`Missing Spine atlas texture: ${page.name}`)
      imagesByPage.set(normalizeName(page.name), loaded)
      if (source.kind !== '3.8') setAtlasPageTexture(page, new spine.FakeTexture(loaded.image), atlas)
    }
    const loader = new spine.AtlasAttachmentLoader(atlas)
    const json = new spine.SkeletonJson(loader)
    json.scale = 1
    const skeletonData = readSkeletonDataCompat(json, source.jsonText)
    const animationNames = (skeletonData.animations || []).map((animation) => String(animation.name || '')).filter(Boolean)
    const skinNames = (skeletonData.skins || []).map((skin) => String(skin.name || '')).filter(Boolean)
    return {
      key: source.key,
      jsonText: source.jsonText,
      spine,
      webgl,
      atlas,
      skeletonData,
      bounds: readSkeletonBounds(source.jsonText),
      imagesByPage,
      animationNames,
      skinNames,
      premultipliedAlpha: (atlas.pages || []).some((page) => !!page.pma) || Array.from(imagesByPage.values()).some((image) => !!image.premultipliedAlphaLikely),
      dispose: () => {
        for (const image of imagesByPage.values()) {
          try { image.close?.() } catch {}
        }
        imagesByPage.clear()
      },
    }
  }

  function loadRuntime(kind) {
    const normalized = kind === '3.8' ? '3.8' : '4'
    if (runtimeGlobals.has(normalized)) return Promise.resolve(runtimeGlobals.get(normalized))
    if (runtimePromises.has(normalized)) return runtimePromises.get(normalized)
    const promise = scriptLoadChain.then(async () => {
      try {
        return await loadRuntimeIsolated(normalized, false)
      } catch (firstError) {
        try {
          return await loadRuntimeIsolated(normalized, true)
        } catch {
          throw firstError
        }
      }
    })
    scriptLoadChain = promise.catch(() => {})
    runtimePromises.set(normalized, promise)
    promise.catch(() => runtimePromises.delete(normalized))
    return promise
  }

  function loadRuntimeIsolated(kind, cacheBust) {
    return new Promise((resolve, reject) => {
      const previous = window.spine
      try { window.spine = undefined } catch {}
      const script = document.createElement('script')
      const scriptUrl = new URL(scriptByKind[kind], document.baseURI)
      if (cacheBust) scriptUrl.searchParams.set('retry', String(Date.now()))
      script.src = scriptUrl.toString()
      script.async = false
      script.onload = () => {
        const spine = window.spine
        try { window.spine = previous } catch {}
        const webgl = spine?.webgl || spine
        if (!spine?.SkeletonJson || !webgl?.SceneRenderer) {
          reject(new Error(`Spine ${kind} runtime did not expose the expected API`))
          return
        }
        const runtime = { spine, webgl }
        runtimeGlobals.set(kind, runtime)
        resolve(runtime)
      }
      script.onerror = () => {
        try { window.spine = previous } catch {}
        reject(new Error(`Failed to load Spine ${kind} runtime`))
      }
      document.head.appendChild(script)
    })
  }

  async function loadImageAsset(imageAsset) {
    const dataUrl = String(imageAsset?.dataUrl || '')
    if (!dataUrl) throw new Error(`Invalid Spine texture data: ${imageAsset?.fileName || 'unknown'}`)
    const blob = await (await fetch(dataUrl)).blob()
    if (typeof createImageBitmap === 'function') {
      let bitmap
      try {
        bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      } catch {
        bitmap = await createImageBitmap(blob)
      }
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        premultipliedAlphaLikely: detectPremultipliedImage(bitmap, bitmap.width, bitmap.height),
        close: () => bitmap.close(),
      }
    }
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Failed to decode Spine texture: ${imageAsset.fileName || 'unknown'}`))
      img.src = dataUrl
    })
    return {
      image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      premultipliedAlphaLikely: detectPremultipliedImage(image, image.naturalWidth || image.width, image.naturalHeight || image.height),
    }
  }

  function detectPremultipliedImage(image, width, height) {
    if (!image || !(width > 0) || !(height > 0) || typeof document === 'undefined') return false
    const maxSide = 128
    const scale = Math.min(1, maxSide / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    try {
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(image, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data
      let translucent = 0
      let premulLike = 0
      let straightLike = 0
      const stride = Math.max(4, Math.floor(data.length / 4096 / 4) * 4)
      for (let i = 0; i + 3 < data.length; i += stride) {
        const a = data[i + 3]
        if (a <= 4 || a >= 250) continue
        const maxRgb = Math.max(data[i], data[i + 1], data[i + 2])
        translucent += 1
        if (maxRgb <= a + 3) premulLike += 1
        if (maxRgb > a + 18) straightLike += 1
      }
      if (translucent < 24) return false
      return premulLike / translucent > 0.92 && straightLike / translucent < 0.04
    } catch {
      return false
    }
  }

  function normalizeSource(rawSource) {
    const skeleton = rawSource?.skeleton || {}
    const atlas = rawSource?.atlas || {}
    const images = Array.isArray(rawSource?.images) ? rawSource.images : []
    const jsonText = String(skeleton.text || rawSource?.jsonText || '').trim()
    const atlasText = String(atlas.text || rawSource?.atlasText || '').trim()
    if (!jsonText || !atlasText || images.length <= 0) throw new Error('Missing Spine source files')
    const version = detectVersion(jsonText)
    const parts = version.split('.').map((part) => Number(part || 0))
    const major = parts[0] || 0
    const minor = parts[1] || 0
    const kind = major >= 4 ? '4' : major === 3 && minor >= 8 ? '3.8' : ''
    if (!kind) throw new Error(`Unsupported Spine runtime version: ${version || 'unknown'}`)
    const key = [
      kind,
      hashString(jsonText),
      hashString(atlasText),
      images.map((image) => `${normalizeName(image.fileName)}:${String(image.dataUrl || '').length}:${hashString(String(image.dataUrl || '').slice(0, 256))}`).join('|'),
    ].join('::')
    return {
      key,
      kind,
      version,
      jsonText,
      atlasText,
      images: images.map((image) => ({
        fileName: String(image.fileName || ''),
        dataUrl: String(image.dataUrl || ''),
      })).filter((image) => image.fileName && image.dataUrl),
    }
  }

  function firstAnimationName(project) {
    return Object.keys(project?.animations || {})[0] || ''
  }

  function detectVersion(jsonText) {
    try { return String(JSON.parse(jsonText)?.skeleton?.spine || '').trim() } catch { return '' }
  }

  function readSkeletonDataCompat(jsonReader, jsonText) {
    const parsed = JSON.parse(jsonText)
    try {
      return jsonReader.readSkeletonData(parsed)
    } catch (error) {
      const version = String(parsed?.skeleton?.spine || '').trim()
      const message = String(error?.message || error || '')
      if (version === '3.8.75' && message.includes('Unsupported skeleton data')) {
        const compat = JSON.parse(jsonText)
        compat.skeleton = { ...(compat.skeleton || {}), spine: '3.8.99' }
        return jsonReader.readSkeletonData(compat)
      }
      throw error
    }
  }

  function animationsSignatureFromJson(jsonText) {
    try { return animationsSignature(JSON.parse(String(jsonText || '{}'))?.animations || {}) } catch { return '' }
  }

  function animationsSignature(animations) {
    try { return JSON.stringify(animations || {}) } catch { return '' }
  }

  function readSkeletonBounds(jsonText) {
    try {
      const skeleton = JSON.parse(jsonText)?.skeleton || {}
      const x = Number(skeleton.x)
      const y = Number(skeleton.y)
      const width = Number(skeleton.width)
      const height = Number(skeleton.height)
      if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
        return { x, y, width, height }
      }
    } catch {}
    return null
  }

  function findPageImage(pageName, images) {
    const page = normalizeName(pageName)
    return images.find((image) => normalizeName(image.fileName) === page) ||
      images.find((image) => normalizeName(image.fileName).endsWith(page))
  }

  function findLoadedPageImage(pageName, loadedImages) {
    const page = normalizeName(pageName)
    return loadedImages.get(page) ||
      Array.from(loadedImages.entries()).find(([name]) => name.endsWith(page))?.[1] ||
      null
  }

  function setAtlasPageTexture(page, texture, atlas) {
    if (page?.setTexture) page.setTexture(texture)
    else if (page) page.texture = texture
    for (const region of atlas?.regions || []) {
      if (region?.page === page) region.texture = texture
    }
  }

  function normalizeName(name) {
    return String(name || '').trim().replace(/\\/g, '/').split('/').pop().toLowerCase()
  }

  function normalizeTime(value, durationSec, loop) {
    const safe = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
    if (!(durationSec > 0)) return safe
    return loop ? safe % durationSec : Math.min(durationSec, safe)
  }

  function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1
    const dy = y2 - y1
    const lenSq = dx * dx + dy * dy
    if (lenSq <= 1e-8) return Math.hypot(px - x1, py - y1)
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t))
  }

  function hashString(value) {
    let hash = 2166136261
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
  }

  window[factoryName] = (canvas, rawSource, animationName, parsedProject) => {
    try {
      return new OfficialSpineProxy(canvas, rawSource, animationName, parsedProject)
    } catch (error) {
      console.warn('[NovaFlow Spine] official preview skipped', error)
      return null
    }
  }

  window[debugName] = {
    cacheStats: () => Array.from(resourceCache.values()).map((entry) => ({
      key: entry.key,
      refCount: entry.refCount,
      loaded: !!entry.resource,
      premultipliedAlpha: !!entry.resource?.premultipliedAlpha,
      pendingRelease: !!entry.releaseTimer,
    })),
  }
})()
