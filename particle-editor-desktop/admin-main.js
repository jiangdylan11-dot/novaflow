const { app, BrowserWindow } = require("electron");
const path = require("path");
const { registerLicenseAdminIpc } = require("./license-admin-gui/ipc");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    title: "NovaFlow 后台管理",
    backgroundColor: "#090b0f",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "license-admin-gui", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "license-admin-gui", "index.html"));
}

app.whenReady().then(() => {
  registerLicenseAdminIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
