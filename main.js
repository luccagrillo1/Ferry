const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { loadSettings, saveSettings } = require("./settings");
const { runTransfer, listTopLevelEntries, statEntries, sortEntries } = require("./transfer");
const { sendNtfyNotification } = require("./notify");

let mainWindow = null;
let tray = null;
let settings = null;
let departureWatcher = null;
const control = { cancelled: false, pauseAfterCurrent: false, running: false };

const APP_VERSION = require("./package.json").version;
const UPDATE_REPO = "luccagrillo1/Ferry";

function getSettings() {
  return settings;
}

// Resolves the current departure selection (folder or explicit files) into a
// sorted, stat'd entry list — the single source of truth for both the Queue
// Viewer and the actual move order. Re-derived on every call so a rerun after
// a pause naturally skips files already moved (they no longer exist).
async function getQueueEntries() {
  let entries;
  if (settings.departureMode === "files") {
    entries = await statEntries(settings.departureFiles.filter((f) => fs.existsSync(f)));
  } else if (settings.departureFolder) {
    try {
      entries = await listTopLevelEntries(settings.departureFolder);
    } catch {
      entries = [];
    }
  } else {
    entries = [];
  }
  return sortEntries(entries, settings.sortMode);
}

function persistSettings() {
  saveSettings(app.getPath("userData"), settings);
}

async function broadcastQueue() {
  const entries = await getQueueEntries();
  mainWindow?.webContents.send(
    "queue:update",
    entries.map((e) => ({ name: e.name, size: e.size, mtime: e.mtime }))
  );
}

function stopDepartureWatcher() {
  if (departureWatcher) {
    departureWatcher.close();
    departureWatcher = null;
  }
}

function startDepartureWatcher() {
  stopDepartureWatcher();
  if (settings.departureMode !== "folder" || !settings.departureFolder) return;
  try {
    let debounce = null;
    departureWatcher = fs.watch(settings.departureFolder, () => {
      clearTimeout(debounce);
      debounce = setTimeout(broadcastQueue, 150);
    });
  } catch {
    // folder may not exist; nothing to watch
  }
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
  mainWindow.webContents.once("did-finish-load", () => checkForUpdates());

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
        {
          label: "Check for Updates…",
          click: () => checkForUpdates(true),
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

function isNewerVersion(remote, local) {
  const r = remote.replace(/^v/, "").split(".").map(Number);
  const l = local.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdates(manual = false) {
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const data = await res.json();
    if (isNewerVersion(data.tag_name, APP_VERSION)) {
      mainWindow?.webContents.send("update:available", {
        version: data.tag_name,
        url: data.html_url,
      });
    } else if (manual) {
      mainWindow?.webContents.send("update:none");
    }
  } catch (err) {
    if (manual) mainWindow?.webContents.send("update:none");
    console.error("[ferry] update check failed:", err.message);
  }
}

app.whenReady().then(() => {
  settings = loadSettings(app.getPath("userData"));
  buildAppMenu();
  createWindow();
  createTray();
  startDepartureWatcher();

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
  startDepartureWatcher();
  broadcastQueue();
  return getDepartureSelection();
});

ipcMain.handle("queue:get", async () => {
  const entries = await getQueueEntries();
  return entries.map((e) => ({ name: e.name, size: e.size, mtime: e.mtime }));
});

ipcMain.handle("settings:set-sort", (_evt, sortMode) => {
  settings.sortMode = sortMode;
  persistSettings();
  broadcastQueue();
});

ipcMain.handle("settings:set-transfer-mode", (_evt, transferMode) => {
  settings.transferMode = transferMode === "copy" ? "copy" : "move";
  persistSettings();
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

ipcMain.handle("update:open", async (_evt, url) => {
  if (url) shell.openExternal(url);
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

  const sourceEntries = await getQueueEntries();
  if (sourceEntries.length === 0) {
    return { result: { moved: [], skipped: [], failed: [] } };
  }

  control.cancelled = false;
  control.pauseAfterCurrent = false;
  control.running = true;
  refreshTrayMenu();

  const sender = evt.sender;
  const onProgress = (event) => {
    if (event.type === "file-progress") {
      setTrayProgress((event.index + event.bytesCopied / event.bytesTotal) / event.total);
    } else if (event.type === "start" || event.type === "done" || event.type === "error") {
      setTrayProgress((event.index + (event.type === "start" ? 0 : 1)) / event.total);
    }
    if (event.type === "done" || event.type === "error") broadcastQueue();
    sender.send("transfer:progress", event);
  };

  try {
    const result = await runTransfer(
      sourceEntries,
      settings.arrivalFolder,
      control,
      onProgress,
      settings.transferMode
    );
    if (result.moved.length + result.failed.length > 0) {
      const verb = settings.transferMode === "copy" ? "copied" : "moved";
      sendNtfyNotification(settings, {
        title: "Ferry transfer complete",
        message: `${result.moved.length} ${verb}, ${result.failed.length} failed`,
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
