import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { Readable } from 'node:stream'

const runtimeDevProxy = (): Plugin => {
  return {
    name: 'runtime-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!req.url?.startsWith('/__runtime_proxy/')) return next()

          const base = String(req.headers['x-runtime-base'] || '').trim()
          if (!base) {
            res.statusCode = 400
            res.end('Missing x-runtime-base header')
            return
          }

          let baseUrl: URL
          try {
            baseUrl = new URL(base)
          } catch {
            res.statusCode = 400
            res.end('Invalid base url')
            return
          }

          const host = String(baseUrl.hostname || '')
          if (!host) {
            res.statusCode = 400
            res.end('Invalid base url')
            return
          }

          const forwardPath = req.url.substring('/__runtime_proxy'.length)
          const target = new URL(forwardPath, baseUrl)

          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) {
            if (!v) continue
            const key = String(k)
            if (key === 'host') continue
            if (key === 'connection') continue
            if (key === 'content-length') continue
            if (key === 'x-runtime-base') continue
            if (Array.isArray(v)) headers.set(key, v.join(','))
            else headers.set(key, String(v))
          }

          try {
            headers.set('origin', baseUrl.origin)
            headers.set('referer', `${baseUrl.origin}/`)
          } catch {
            void 0
          }

          const method = String(req.method || 'GET').toUpperCase()
          const init: any = { method, headers }
          if (method !== 'GET' && method !== 'HEAD') {
            init.body = req as any
            init.duplex = 'half'
          }

          const upstream = await fetch(target.toString(), init)
          res.statusCode = upstream.status
          upstream.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'transfer-encoding') return
            res.setHeader(key, value)
          })

          if (!upstream.body) {
            res.end()
            return
          }

          Readable.fromWeb(upstream.body as any).pipe(res)
        } catch {
          res.statusCode = 502
          res.end('Proxy error')
        }
      })
    }
  }
}

const shortAssetFileName = (assetInfo: { names?: string[]; name?: string }) => {
  const name = assetInfo.names?.[0] || assetInfo.name || ''
  if (/\.css$/i.test(name)) return 'assets/[name]-[hash][extname]'
  return 'assets/asset-[hash][extname]'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), runtimeDevProxy()],
  base: './',
  server: { proxy: {} },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: shortAssetFileName
      }
    }
  }
})
