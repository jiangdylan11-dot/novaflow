// Run with particle-editor-desktop/node_modules/electron/dist/electron.exe scripts/check-pen-source-split.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'novaflow-pen-split-')))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { backgroundThrottling: false } })
  try {
    if (process.argv.includes('--packaged')) {
      await window.loadFile(path.resolve(__dirname, '../particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html'), { query: { __novaflow_pen_source_split_smoke: '1' } })
    } else {
      await window.loadURL('http://127.0.0.1:4783/?__novaflow_pen_source_split_smoke=1')
    }
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      const result = await window.webContents.executeJavaScript("document.body.getAttribute('data-novaflow-pen-source-split-smoke')")
      if (result) {
        if (!result.startsWith('ok:')) throw new Error(result)
        console.log(`PASS ${result}`)
        app.exit(0)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('Timed out waiting for pen split UI and pixel verification')
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
