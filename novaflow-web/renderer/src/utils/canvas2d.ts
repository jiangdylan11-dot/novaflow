export function getCanvas2DContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D
export function getCanvas2DContext(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D
export function getCanvas2DContext(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D不可用')
  return ctx
}
