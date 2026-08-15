const fs = require('fs')
const path = require('path')

function safeRm(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
  } catch {
    void 0
  }
}

module.exports = async (context) => {
  const appOutDir = context.appOutDir
  if (!appOutDir) return

  const templatesDir = path.join(appOutDir, 'resources', 'initial-templates')
  const legacyBundledList = path.join(appOutDir, 'resources', 'initial-templates.json')
  const projectDir = context?.packager?.projectDir
  const sourceTemplatesDir = projectDir ? path.join(projectDir, 'resources', 'initial-templates') : null
  const sourceSeeThroughRepairScript = projectDir ? path.join(projectDir, '..', 'scripts', 'repair-seethrough-env.ps1') : null
  const packagedSeeThroughRepairScript = path.join(appOutDir, 'resources', 'repair-seethrough-env.ps1')

  try {
    if (fs.existsSync(templatesDir)) {
      const entries = fs.readdirSync(templatesDir)
      for (const name of entries) {
        if (String(name).toLowerCase().startsWith('builtin_tpl_') && String(name).toLowerCase().endsWith('.json')) {
          safeRm(path.join(templatesDir, name))
        }
      }
    }
  } catch {
    void 0
  }

  try {
    if (sourceTemplatesDir && fs.existsSync(sourceTemplatesDir) && fs.existsSync(templatesDir)) {
      const allow = new Set(
        fs.readdirSync(sourceTemplatesDir, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => e.name)
          .filter((n) => String(n).toLowerCase().endsWith('.json'))
      )
      const actual = fs.readdirSync(templatesDir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
      for (const name of actual) {
        if (!String(name).toLowerCase().endsWith('.json')) continue
        if (!allow.has(name)) safeRm(path.join(templatesDir, name))
      }
    }
  } catch {
    void 0
  }

  try {
    if (sourceSeeThroughRepairScript && fs.existsSync(sourceSeeThroughRepairScript)) {
      fs.mkdirSync(path.dirname(packagedSeeThroughRepairScript), { recursive: true })
      fs.copyFileSync(sourceSeeThroughRepairScript, packagedSeeThroughRepairScript)
    }
  } catch {
    void 0
  }

  safeRm(legacyBundledList)
}
