import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { SpineProject } from '../engine/SpineMiniPlayer'
import { SpineRuntimeLayer } from '../runtime/spine/SpineRuntimeLayer'
import type { SpineSource } from '../runtime/spine/SpineRuntimeTypes'

export type SpinePreviewHandle = {
  setAnimation: (name: string) => void
  setSkin: (name: string | null) => void
  setPlaying: (playing: boolean) => void
  seek: (timeSec: number) => void
  getTimeSec: () => number
  getDurationSec: () => number
  beginInteraction: () => void
  endInteraction: (delayMs?: number) => void
  setDebugOverlays: (overlays: { bones?: boolean; mesh?: boolean }) => void
  setSelectedBoneName: (name: string | null) => void
  setSelectedBoneNames: (names: string[] | null) => void
  setVisibleBoneNames: (names: string[] | null) => void
  pause: () => void
}

type SpinePreviewProps = {
  project: SpineProject | null
  source?: SpineSource | null
  animationName: string
  skinName?: string | null
  playing: boolean
  timeSec?: number | null
  showHud?: boolean
  showBoneOverlay?: boolean
  showMeshOverlay?: boolean
  selectedBoneName?: string | null
  selectedBoneNames?: string[] | null
  visibleBoneNames?: string[] | null
  onBonePick?: (boneName: string | null, options?: { additive?: boolean; clear?: boolean }) => void
  renderScale?: number
}

export const SpinePreview = forwardRef<SpinePreviewHandle, SpinePreviewProps>(function SpinePreview(
  {
    project,
    source,
    animationName,
    skinName,
    playing,
    timeSec,
    showHud,
    showBoneOverlay,
    showMeshOverlay,
    selectedBoneName,
    selectedBoneNames,
    visibleBoneNames,
    onBonePick,
    renderScale = 1
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeRef = useRef<SpineRuntimeLayer | null>(null)
  const visibleRef = useRef(true)
  const desiredPlayingRef = useRef(playing)
  const controlledTimeRef = useRef(timeSec != null)
  const projectRef = useRef<SpineProject | null>(project)
  const timeSecRef = useRef<number | null | undefined>(timeSec)
  const animationNameRef = useRef(animationName)
  const skinNameRef = useRef<string | null | undefined>(skinName)
  const showHudRef = useRef(showHud)
  const showBoneOverlayRef = useRef(showBoneOverlay)
  const showMeshOverlayRef = useRef(showMeshOverlay)
  const selectedBoneNameRef = useRef<string | null | undefined>(selectedBoneName)
  const selectedBoneNamesRef = useRef<string[] | null | undefined>(selectedBoneNames)
  const visibleBoneNamesRef = useRef<string[] | null | undefined>(visibleBoneNames)
  const renderScaleRef = useRef(renderScale)

  desiredPlayingRef.current = playing
  controlledTimeRef.current = timeSec != null
  projectRef.current = project
  timeSecRef.current = timeSec
  animationNameRef.current = animationName
  skinNameRef.current = skinName
  showHudRef.current = showHud
  showBoneOverlayRef.current = showBoneOverlay
  showMeshOverlayRef.current = showMeshOverlay
  selectedBoneNameRef.current = selectedBoneName
  selectedBoneNamesRef.current = selectedBoneNames
  visibleBoneNamesRef.current = visibleBoneNames
  renderScaleRef.current = renderScale

  const syncRuntimePlaying = () => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const shouldPlay = desiredPlayingRef.current && visibleRef.current && !controlledTimeRef.current
    runtime.setActive(visibleRef.current)
    runtime.setVisible(visibleRef.current)
    runtime.setPlaying(shouldPlay)
  }

  useImperativeHandle(ref, () => ({
    setAnimation: (name: string) => runtimeRef.current?.setAnimation(name),
    setSkin: (name: string | null) => runtimeRef.current?.setSkin(name),
    setPlaying: (nextPlaying: boolean) => {
      desiredPlayingRef.current = nextPlaying
      runtimeRef.current?.setPlaying(nextPlaying && visibleRef.current && !controlledTimeRef.current)
    },
    seek: (nextTimeSec: number) => runtimeRef.current?.seek(nextTimeSec),
    getTimeSec: () => runtimeRef.current?.getTimeSec() ?? 0,
    getDurationSec: () => runtimeRef.current?.getDurationSec() ?? 0,
    beginInteraction: () => runtimeRef.current?.beginInteraction(),
    endInteraction: (delayMs?: number) => runtimeRef.current?.endInteraction(delayMs),
    setDebugOverlays: (overlays: { bones?: boolean; mesh?: boolean }) => runtimeRef.current?.setDebugOverlays(overlays),
    setSelectedBoneName: (name: string | null) => runtimeRef.current?.setSelectedBoneName(name),
    setSelectedBoneNames: (names: string[] | null) => runtimeRef.current?.setSelectedBoneNames(names),
    setVisibleBoneNames: (names: string[] | null) => runtimeRef.current?.setVisibleBoneNames(names),
    pause: () => {
      desiredPlayingRef.current = false
      runtimeRef.current?.setPlaying(false)
    }
  }), [])

  useEffect(() => {
    if (!project && !source) return
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const parent = canvas.parentElement
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const scale = Math.max(1, Number(renderScaleRef.current) || 1)
      const w = Math.max(1, Math.floor((canvas.clientWidth || parent?.clientWidth || 1) * dpr * scale))
      const h = Math.max(1, Math.floor((canvas.clientHeight || parent?.clientHeight || 1) * dpr * scale))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }

    resize()
    const defaultAnim = animationNameRef.current || Object.keys(project?.animations || {})[0] || 'animation'
    const runtime = new SpineRuntimeLayer({
      canvas,
      defaultAnimation: defaultAnim,
      hud: showHudRef.current !== false,
      active: visibleRef.current,
      visible: visibleRef.current
    })
    if (source) {
      runtime.load(project ? { ...source, project } : source, {
        animationName: defaultAnim,
        skinName: skinNameRef.current ? String(skinNameRef.current) : null
      })
        .then(() => {
          if (runtimeRef.current !== runtime) return
          const latestProject = projectRef.current
          runtime.setProject(latestProject)
          runtime.setAnimation(animationNameRef.current || Object.keys(latestProject?.animations || {})[0] || defaultAnim)
          runtime.setSkin(skinNameRef.current ? String(skinNameRef.current) : null)
          runtime.setSelectedBoneNames(
            Array.isArray(selectedBoneNamesRef.current) && selectedBoneNamesRef.current.length > 0
              ? selectedBoneNamesRef.current
              : selectedBoneNameRef.current
                ? [String(selectedBoneNameRef.current)]
                : []
          )
          runtime.setVisibleBoneNames(visibleBoneNamesRef.current || null)
          if (timeSecRef.current != null) {
            runtime.seek(timeSecRef.current)
            runtime.setPlaying(false)
          } else {
            runtime.setPlaying(desiredPlayingRef.current && visibleRef.current && !controlledTimeRef.current)
          }
        })
        .catch((error) => {
          console.error('[spine-runtime] load failed', error)
        })
    } else if (project) {
      runtime.loadProject(project, {
        key: `preview:${defaultAnim}:${Object.keys(project.images || {}).length}`,
        animationName: defaultAnim,
        skinName: skinNameRef.current ? String(skinNameRef.current) : null
      })
    }
    runtime.setHud(showHudRef.current !== false)
    runtime.setDebugOverlays({
      bones: !!showBoneOverlayRef.current,
      mesh: !!showMeshOverlayRef.current
    })
    runtime.setSelectedBoneNames(
      Array.isArray(selectedBoneNamesRef.current) && selectedBoneNamesRef.current.length > 0
        ? selectedBoneNamesRef.current
        : selectedBoneNameRef.current
          ? [String(selectedBoneNameRef.current)]
          : []
    )
    runtime.setVisibleBoneNames(visibleBoneNamesRef.current || null)
    runtime.setSkin(skinNameRef.current ? String(skinNameRef.current) : null)
    runtimeRef.current = runtime
    runtime.setPlaying(desiredPlayingRef.current && visibleRef.current && !controlledTimeRef.current)

    window.addEventListener('resize', resize)
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    resizeObserver?.observe(canvas)
    if (canvas.parentElement) resizeObserver?.observe(canvas.parentElement)
    return () => {
      window.removeEventListener('resize', resize)
      resizeObserver?.disconnect()
      runtime.destroy()
      if (runtimeRef.current === runtime) runtimeRef.current = null
    }
  }, [source, source ? null : project])

  useEffect(() => {
    if (!source || !project) return
    runtimeRef.current?.setProject(project)
  }, [project, source])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const scale = Math.max(1, Number(renderScale) || 1)
    const w = Math.max(1, Math.floor((canvas.clientWidth || parent?.clientWidth || 1) * dpr * scale))
    const h = Math.max(1, Math.floor((canvas.clientHeight || parent?.clientHeight || 1) * dpr * scale))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      runtimeRef.current?.seek(runtimeRef.current.getTimeSec())
    }
  }, [renderScale])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.setAnimation(animationName || Object.keys(project?.animations || {})[0] || 'animation')
  }, [animationName, project])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.setSkin(skinName ? String(skinName) : null)
  }, [skinName])

  useEffect(() => {
    syncRuntimePlaying()
  }, [playing])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.setHud(showHud !== false)
  }, [showHud])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.setDebugOverlays({
      bones: !!showBoneOverlay,
      mesh: !!showMeshOverlay
    })
  }, [showBoneOverlay, showMeshOverlay])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const names = Array.isArray(selectedBoneNames) && selectedBoneNames.length > 0
      ? selectedBoneNames
      : selectedBoneName
        ? [String(selectedBoneName)]
        : []
    runtime.setSelectedBoneNames(names)
  }, [selectedBoneName, selectedBoneNames?.join('\0')])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    runtime.setVisibleBoneNames(visibleBoneNames || null)
  }, [visibleBoneNames?.join('\0')])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    if (timeSec != null) {
      runtime.setPlaying(false)
      return
    }
    syncRuntimePlaying()
  }, [timeSec])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    if (timeSec == null) return
    runtime.seek(timeSec)
  }, [timeSec])

  useEffect(() => {
    const canvas = canvasRef.current
    const onVisibilityChange = () => {
      visibleRef.current = document.visibilityState !== 'hidden'
      syncRuntimePlaying()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    let observer: IntersectionObserver | null = null
    if (canvas && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        const entry = entries[0]
        visibleRef.current = document.visibilityState !== 'hidden' && !!entry?.isIntersecting
        syncRuntimePlaying()
      })
      observer.observe(canvas)
    }

    onVisibilityChange()
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      observer?.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        if (!showBoneOverlay || !onBonePick) return
        const canvas = canvasRef.current
        const runtime = runtimeRef.current
        if (!canvas || !runtime) return
        const rect = canvas.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        const x = (event.clientX - rect.left) * (canvas.width / rect.width)
        const y = (event.clientY - rect.top) * (canvas.height / rect.height)
        const boneName = runtime.pickBoneAt(x, y)
        if (!boneName) {
          event.preventDefault()
          event.stopPropagation()
          onBonePick(null, { clear: true })
          return
        }
        event.preventDefault()
        event.stopPropagation()
        onBonePick(boneName, { additive: event.ctrlKey || event.metaKey || event.shiftKey })
      }}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        cursor: showBoneOverlay && onBonePick ? 'crosshair' : 'default'
      }}
    />
  )
})
