const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const CHANNEL = "novaflow-test-ai-alpha-binary";
const WIDTH = 1080;
const HEIGHT = 1920;
const FRAMES = 81;
const EXPECTED_BYTES = WIDTH * HEIGHT * FRAMES;
let tempDir = null;

ipcMain.handle(CHANNEL, () => {
  const backing = new Uint8Array(EXPECTED_BYTES + 17);
  const alphaBytes = new Uint8Array(backing.buffer, 9, EXPECTED_BYTES);
  alphaBytes[0] = 17;
  alphaBytes[Math.floor(EXPECTED_BYTES / 2)] = 127;
  alphaBytes[EXPECTED_BYTES - 1] = 255;
  return {
    alphaEncoding: "u8-mask-v1",
    alphaByteLength: alphaBytes.byteLength,
    alphaBytes
  };
});

app.whenReady().then(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-alpha-ipc-"));
  const preloadPath = path.join(tempDir, "preload.js");
  fs.writeFileSync(
    preloadPath,
    `const { contextBridge, ipcRenderer } = require("electron");\n` +
      `contextBridge.exposeInMainWorld("novaFlowAlphaTest", { read: () => ipcRenderer.invoke(${JSON.stringify(CHANNEL)}) });\n`,
    "utf8"
  );
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: false
    }
  });
  await window.loadURL("data:text/html,<html><body>NovaFlow alpha IPC smoke</body></html>");
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const payload = await window.novaFlowAlphaTest.read();
      const bytes = payload.alphaBytes;
      return {
        alphaEncoding: payload.alphaEncoding,
        alphaByteLength: payload.alphaByteLength,
        isView: ArrayBuffer.isView(bytes),
        constructorName: bytes?.constructor?.name || "",
        byteLength: Number(bytes?.byteLength) || 0,
        first: bytes?.[0],
        middle: bytes?.[Math.floor((Number(bytes?.byteLength) || 0) / 2)],
        last: bytes?.[(Number(bytes?.byteLength) || 0) - 1]
      };
    })()
  `);

  assert.equal(result.alphaEncoding, "u8-mask-v1");
  assert.equal(result.alphaByteLength, EXPECTED_BYTES);
  assert.equal(result.isView, true);
  assert.equal(result.constructorName, "Uint8Array");
  assert.equal(result.byteLength, EXPECTED_BYTES);
  assert.equal(result.first, 17);
  assert.equal(result.middle, 127);
  assert.equal(result.last, 255);
  console.log(`PASS Electron binary alpha IPC smoke (${EXPECTED_BYTES} bytes)`);
  window.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });
  app.quit();
}).catch((error) => {
  console.error(error);
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  app.exit(1);
});
