import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const projectRoot = path.resolve(__dirname, '..')
const winUnpacked = path.join(projectRoot, 'dist', 'win-unpacked')
const asarExtract = path.join(projectRoot, 'dist', 'asar_extract')

for (const p of [winUnpacked, asarExtract]) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
  } catch {
    void 0
  }
}

console.log('cleaned:', winUnpacked)
