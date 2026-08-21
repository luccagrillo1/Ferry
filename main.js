const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const { loadSettings, saveSettings } = require("./settings");
const { runTransfer } = require("./transfer");

let mainWindow = null;
let tray = null;
let settings = null;
const control = { cancelled: false, stopAfterCurrent: false, running: false };

function getSettings() {
  return settings;
}

function persistSettings() {
  saveSettings(app.getPath("userData"), settings);
}

function createWindow() {
  const bounds = settings.windowBounds || { width: 480, height: 620 };
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 420,
    minHeight: 520,
    title: "Ferry",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));

  mainWindow.on("close", () => {
    if (mainWindow) {
      settings.windowBounds = mainWindow.getBounds();
      persistSettings();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Show Ferry", click: showWindow },
    { type: "separator" },
    {
      label: "Stop After This Transfer",
      enabled: control.running && !control.stopAfterCurrent,
      click: () => {
        control.stopAfterCurrent = true;
        mainWindow?.webContents.send("transfer:stop-after-requested");
      },
    },
    {
      label: "Cancel Transfer",
      enabled: control.running,
      click: () => {
        control.cancelled = true;
        mainWindow?.webContents.send("transfer:cancel-requested");
      },
    },
    { type: "separator" },
    { label: "Quit Ferry", role: "quit" },
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const iconPath = path.join(__dirname, "build", "trayIconTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Ferry");
  tray.on("click", showWindow);
  refreshTrayMenu();
}

function setTrayProgress(fraction) {
  if (!tray) return;
  if (fraction === null) {
    tray.setTitle("");
  } else {
    tray.setTitle(` ${Math.round(fraction * 100)}%`);
  }
}

function buildAppMenu() {
  const template = [
    {
      label: "Ferry",
      submenu: [
        {
          label: "What's New",
          click: () => mainWindow?.webContents.send("changelog:show"),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  settings = loadSettings(app.getPath("userData"));
  buildAppMenu();
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on("window-all-closed", () => {
  // Ferry lives in the menu bar; don't quit when the window closes.
});

// --- IPC handlers ---

ipcMain.handle("settings:get", () => getSettings());

ipcMain.handle("folder:select-departure", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (res.canceled || res.filePaths.length === 0) return settings.departureFolder;
  settings.departureFolder = res.filePaths[0];
  persistSettings();
  return settings.departureFolder;
});

ipcMain.handle("folder:select-arrival", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (res.canceled || res.filePaths.length === 0) return settings.arrivalFolder;
  settings.arrivalFolder = res.filePaths[0];
  persistSettings();
  return settings.arrivalFolder;
});

ipcMain.handle("folder:reveal", async (_evt, folderPath) => {
  if (folderPath) shell.openPath(folderPath);
});

ipcMain.handle("transfer:start", async (evt) => {
  if (control.running) return { error: "A transfer is already running." };
  if (!settings.departureFolder || !settings.arrivalFolder) {
    return { error: "Select both a departure and arrival folder first." };
  }
  if (settings.departureFolder === settings.arrivalFolder) {
    return { error: "Departure and arrival folders must be different." };
  }

  control.cancelled = false;
  control.stopAfterCurrent = false;
  control.running = true;
  refreshTrayMenu();

  const sender = evt.sender;
  const onProgress = (event) => {
    if (event.type === "start" || event.type === "done" || event.type === "error") {
      setTrayProgress((event.index + (event.type === "start" ? 0 : 1)) / event.total);
    }
    sender.send("transfer:progress", event);
  };

  try {
    const result = await runTransfer(
      settings.departureFolder,
      settings.arrivalFolder,
      control,
      onProgress
    );
    return { result };
  } finally {
    control.running = false;
    control.cancelled = false;
    control.stopAfterCurrent = false;
    setTrayProgress(null);
    refreshTrayMenu();
  }
});

ipcMain.handle("transfer:stop-after-current", () => {
  control.stopAfterCurrent = true;
  refreshTrayMenu();
});

ipcMain.handle("transfer:cancel", () => {
  control.cancelled = true;
  refreshTrayMenu();
});
