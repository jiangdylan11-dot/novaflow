export const CLOUD_PROVIDERS = [
  'kling',
  'runway',
  'pika',
  'luma',
  'haiper',
  'vidu',
  'hunyuan',
  'minimax',
  'pixverse',
  'jimeng'
] as const

export type CloudProvider = typeof CLOUD_PROVIDERS[number]

export function isValidProvider(v: unknown): v is CloudProvider {
  return CLOUD_PROVIDERS.includes(v as any)
}
