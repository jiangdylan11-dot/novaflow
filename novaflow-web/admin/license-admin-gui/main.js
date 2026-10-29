const { app, BrowserWindow } = require("electron");
const path = require("path");
const { registerLicenseAdminIpc } = require("./ipc");
const adminData = require("./admin-data");

// Keep the installed admin's account configuration across the repository move.
app.setPath("userData", path.join(app.getPath("appData"), "novaflow-license-manager"));

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    title: "Foart 后台管理",
    backgroundColor: "#090b0f",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  registerLicenseAdminIpc();
  adminData.startDomesticBalanceRefresh();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
