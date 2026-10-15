// 从网页的 React 包里取出粒子特效的 13 个内置模板（模板库默认的那批），写成 renderer/src/engine/particleTemplates.ts。
// 粒子页的模板库存在 localStorage particle-editor-templates-v1；骨骼动画「粒子特效」弹框读同一份，没有时用这里的内置模板。
// 内置贴图（圆形 / 四角星…）在模板里只记 key（builtin），运行时用 getBuiltinSprites 换成图。
// node novaflow-web/tools/extract-particle-templates.mjs [bundle.js]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const assets = path.join(here, '../renderer/assets')
const html = readFileSync(path.join(here, '../renderer/index.html'), 'utf8')
const live = (html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1]
const bundle = process.argv[2] || path.join(assets, live || readdirSync(assets).find((f) => /^index-.*\.js$/.test(f)))
const s = readFileSync(bundle, 'utf8')

const first = s.indexOf('{name:`基础·点爆发`')
const start = s.lastIndexOf('t=()=>{let t=(t,n)=>{let r=e(n)', first)
const endMark = 'createdAt:u-(t+1)}))}'
const end = s.indexOf(endMark, first) + endMark.length
if (first < 0 || start < 0 || end < endMark.length) throw new Error('bundle layout changed: template factory not found')
const factory = s.slice(start + 2, end)   // "()=>{...}"

const faStart = s.indexOf('fa=e=>{')
let depth = 0, faEnd = -1
for (let i = s.indexOf('{', faStart); i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}') { depth--; if (depth === 0) { faEnd = i + 1; break } } }
const fa = s.slice(faStart + 3, faEnd)

// defaultConfig (the bundle's `v`) = src/types.ts defaultConfig
const types = readFileSync(path.join(here, '../renderer/src/types.ts'), 'utf8')
const dc = types.slice(types.indexOf('export const defaultConfig'))
const dcObj = dc.slice(dc.indexOf('{'), dc.lastIndexOf('};') + 1)

const ctx = { out: null }
vm.createContext(ctx)
vm.runInContext(`
  const v = ${dcObj};
  const fa = ${fa};
  const e = (key) => ({ builtin: key });
  out = (${factory})();
`, ctx)
const list = ctx.out.map((x) => ({ name: x.name, config: { ...x.config, id: undefined } }))
const banner = `// 由 tools/extract-particle-templates.mjs 从 ${path.basename(bundle)} 取出（粒子特效页的 13 个内置模板）。不要手改。\n`
writeFileSync(path.join(here, '../renderer/src/engine/particleTemplates.ts'),
  banner + `export const BUILTIN_PARTICLE_TEMPLATES: { name: string; config: any }[] = ${JSON.stringify(list, null, 1)}\n`)
console.log(list.length, 'templates:', list.map((x) => x.name).join(' '))
