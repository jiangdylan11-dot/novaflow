export function ensureCanvasContext(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null
export function ensureCanvasContext(canvas: HTMLCanvasElement, settings: CanvasRenderingContext2DSettings | undefined, opts: { throwOnFail: true; errorMessage?: string }): CanvasRenderingContext2D
export function ensureCanvasContext(
  canvas: HTMLCanvasElement,
  settings?: CanvasRenderingContext2DSettings,
  opts?: { throwOnFail?: boolean; errorMessage?: string }
) {
  const ctx = canvas.getContext('2d', settings) as CanvasRenderingContext2D | null
  if (!ctx) {
    if (opts?.throwOnFail) throw new Error(opts?.errorMessage || '无法创建画布')
    return null
  }
  return ctx
}
