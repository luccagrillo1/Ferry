const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { loadSettings, saveSettings } = require("./settings");
const { runTransfer, listTopLevelFiles } = require("./transfer");
const { sendNtfyNotification } = require("./notify");

let mainWindow = null;
let tray = null;
let settings = null;
const control = { cancelled: false, pauseAfterCurrent: false, running: false };

function getSettings() {
  return settings;
}

// Resolves the current departure selection (folder or explicit files) into an
// absolute-path list to move. Re-derived on every call so a rerun after a
// pause naturally skips files already moved (they no longer exist).
async function resolveSourceFiles() {
  if (settings.departureMode === "files") {
    return settings.departureFiles.filter((f) => fs.existsSync(f));
  }
  const names = await listTopLevelFiles(settings.departureFolder);
  return names.map((name) => path.join(settings.departureFolder, name));
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
      label: "Pause After This Transfer",
      enabled: control.running && !control.pauseAfterCurrent,
      click: () => {
        control.pauseAfterCurrent = true;
        mainWindow?.webContents.send("transfer:pause-after-requested");
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

ipcMain.handle("settings:get", () => ({ ...getSettings(), departure: getDepartureSelection() }));

function getDepartureSelection() {
  return {
    mode: settings.departureMode,
    folder: settings.departureFolder,
    files: settings.departureFiles,
  };
}

ipcMain.handle("folder:select-departure", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "openDirectory", "multiSelections"],
  });
  if (res.canceled || res.filePaths.length === 0) return getDepartureSelection();

  const dirs = res.filePaths.filter((p) => fs.statSync(p).isDirectory());
  const files = res.filePaths.filter((p) => fs.statSync(p).isFile());

  if (files.length === 0 && dirs.length === 1) {
    settings.departureMode = "folder";
    settings.departureFolder = dirs[0];
    settings.departureFiles = [];
  } else if (files.length > 0) {
    settings.departureMode = "files";
    settings.departureFiles = files;
    settings.departureFolder = path.dirname(files[0]);
  }
  persistSettings();
  return getDepartureSelection();
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
  const hasDeparture =
    settings.departureMode === "files" ? settings.departureFiles.length > 0 : !!settings.departureFolder;
  if (!hasDeparture || !settings.arrivalFolder) {
    return { error: "Select both a departure and arrival folder first." };
  }
  if (settings.departureMode === "folder" && settings.departureFolder === settings.arrivalFolder) {
    return { error: "Departure and arrival folders must be different." };
  }

  const sourceFiles = await resolveSourceFiles();
  if (sourceFiles.length === 0) {
    return { result: { moved: [], skipped: [], failed: [] } };
  }

  control.cancelled = false;
  control.pauseAfterCurrent = false;
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
    const result = await runTransfer(sourceFiles, settings.arrivalFolder, control, onProgress);
    if (result.moved.length + result.failed.length > 0) {
      sendNtfyNotification(settings, {
        title: "Ferry transfer complete",
        message: `${result.moved.length} moved, ${result.failed.length} failed`,
        tags: result.failed.length > 0 ? "warning" : "white_check_mark",
      }).catch((err) => console.error("[ferry] ntfy notification failed:", err.message));
    }
    return { result };
  } finally {
    control.running = false;
    control.cancelled = false;
    control.pauseAfterCurrent = false;
    setTrayProgress(null);
    refreshTrayMenu();
  }
});

ipcMain.handle("settings:set-notifications", (_evt, { enabled, server, topic }) => {
  settings.ntfyEnabled = !!enabled;
  settings.ntfyServer = server || "https://ntfy.sh";
  settings.ntfyTopic = topic || "";
  persistSettings();
  return settings;
});

ipcMain.handle("transfer:pause-after-current", () => {
  control.pauseAfterCurrent = true;
  refreshTrayMenu();
});

ipcMain.handle("transfer:cancel", () => {
  control.cancelled = true;
  refreshTrayMenu();
});
