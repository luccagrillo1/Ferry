const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ferry", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setNotificationSettings: (opts) => ipcRenderer.invoke("settings:set-notifications", opts),
  selectDeparture: () => ipcRenderer.invoke("folder:select-departure"),
  selectArrival: () => ipcRenderer.invoke("folder:select-arrival"),
  revealFolder: (folderPath) => ipcRenderer.invoke("folder:reveal", folderPath),
  getQueue: () => ipcRenderer.invoke("queue:get"),
  setSortMode: (sortMode) => ipcRenderer.invoke("settings:set-sort", sortMode),
  openUpdateUrl: (url) => ipcRenderer.invoke("update:open", url),

  startTransfer: () => ipcRenderer.invoke("transfer:start"),
  pauseAfterCurrent: () => ipcRenderer.invoke("transfer:pause-after-current"),
  cancelTransfer: () => ipcRenderer.invoke("transfer:cancel"),

  onProgress: (callback) => {
    const listener = (_evt, event) => callback(event);
    ipcRenderer.on("transfer:progress", listener);
    return () => ipcRenderer.removeListener("transfer:progress", listener);
  },
  onPauseAfterRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("transfer:pause-after-requested", listener);
    return () => ipcRenderer.removeListener("transfer:pause-after-requested", listener);
  },
  onCancelRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("transfer:cancel-requested", listener);
    return () => ipcRenderer.removeListener("transfer:cancel-requested", listener);
  },
  onShowChangelog: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("changelog:show", listener);
    return () => ipcRenderer.removeListener("changelog:show", listener);
  },
  onQueueUpdate: (callback) => {
    const listener = (_evt, entries) => callback(entries);
    ipcRenderer.on("queue:update", listener);
    return () => ipcRenderer.removeListener("queue:update", listener);
  },
  onUpdateAvailable: (callback) => {
    const listener = (_evt, info) => callback(info);
    ipcRenderer.on("update:available", listener);
    return () => ipcRenderer.removeListener("update:available", listener);
  },
  onUpdateNone: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("update:none", listener);
    return () => ipcRenderer.removeListener("update:none", listener);
  },
});
