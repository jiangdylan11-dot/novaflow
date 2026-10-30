const { app, BrowserWindow } = require("electron");
const path = require("path");
const { registerLicenseAdminIpc } = require("./license-admin-gui/ipc");

app.setName("Foart 后台管理");
app.setAppUserModelId("com.novaflow.licenseadmin");

// Keep the installed admin's account configuration across the repository move.
app.setPath("userData", path.join(app.getPath("appData"), "novaflow-license-manager"));

function createWindow() {
  // Data tables and the side-by-side edit panels are laid out for a wide
  // window; the default used to be 1200x760, which pushed every list into a
  // horizontal scroll.
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 880,
    minWidth: 1080,
    minHeight: 680,
    title: "Foart 后台管理",
    icon: path.join(__dirname, "build", "foart-admin-brush.ico"),
    backgroundColor: "#101010",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "license-admin-gui", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "license-admin-gui", "index.html"));
}

app.whenReady().then(() => {
  registerLicenseAdminIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
