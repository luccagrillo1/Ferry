const APP_VERSION = "1.4.0";

const CHANGELOG = [
  {
    version: "1.4.0",
    date: "2026-08-24",
    changes: [
      "Added a Move/Copy toggle — Copy leaves the originals in Departure untouched instead of deleting them after they arrive.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-08-24",
    changes: [
      "Real byte-level progress bar and transfer speed for large cross-volume copies, instead of only updating once a whole file finishes.",
      "Cancel now actually stops a copy mid-file instead of waiting for it to finish first.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-08-21",
    changes: [
      "Added a Queue section showing exactly which files will move next, in order.",
      "Added a sort control — by name, size (largest/smallest first), or date modified (newest/oldest first).",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-08-21",
    changes: [
      "Departure folder shows a live \"N files ready\" count as files appear or leave.",
      "Checks GitHub for new releases on launch and shows a banner when one's available; \"Check for Updates…\" added to the app menu.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-08-21",
    changes: [
      "First stable release.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-08-21",
    changes: [
      "Departure can now be a specific set of files instead of a whole folder — pick individual files in the same picker, or pick a folder to use everything in it.",
      "Renamed Stop to Pause After This Transfer — Start Transfer becomes Resume Transfer afterward and continues where you left off.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-08-21",
    changes: [
      "Optional ntfy push notification when a transfer finishes (moved/failed count).",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-08-21",
    changes: [
      "Initial release: select a departure and arrival folder and move files one by one.",
      "Live progress bar, current file name, and activity log.",
      "Stop After This Transfer and Cancel controls.",
      "Always-visible menu bar icon with live progress and quick controls.",
      "Automatic rename on filename collisions in the arrival folder.",
    ],
  },
];

function applyColorScheme() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.body.classList.toggle("dark", dark);
}
applyColorScheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyColorScheme);

const el = {
  departurePath: document.getElementById("departurePath"),
  departurePathText: document.getElementById("departurePathText"),
  departureCount: document.getElementById("departureCount"),
  arrivalPath: document.getElementById("arrivalPath"),
  selectDeparture: document.getElementById("selectDeparture"),
  selectArrival: document.getElementById("selectArrival"),
  startBtn: document.getElementById("startBtn"),
  pauseAfterBtn: document.getElementById("pauseAfterBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  progressSection: document.getElementById("progressSection"),
  progressFileName: document.getElementById("progressFileName"),
  progressCount: document.getElementById("progressCount"),
  progressBarFill: document.getElementById("progressBarFill"),
  progressDetail: document.getElementById("progressDetail"),
  statusLine: document.getElementById("statusLine"),
  logList: document.getElementById("logList"),
  changelogBtn: document.getElementById("changelogBtn"),
  changelogModal: document.getElementById("changelogModal"),
  changelogBody: document.getElementById("changelogBody"),
  ntfyEnabled: document.getElementById("ntfyEnabled"),
  ntfyTopic: document.getElementById("ntfyTopic"),
  ntfyServer: document.getElementById("ntfyServer"),
  closeChangelog: document.getElementById("closeChangelog"),
  updateBanner: document.getElementById("updateBanner"),
  updateBannerText: document.getElementById("updateBannerText"),
  updateBannerBtn: document.getElementById("updateBannerBtn"),
  queueList: document.getElementById("queueList"),
  queueHeaderLabel: document.getElementById("queueHeaderLabel"),
  sortSelect: document.getElementById("sortSelect"),
  modeMoveBtn: document.getElementById("modeMoveBtn"),
  modeCopyBtn: document.getElementById("modeCopyBtn"),
};

let transferMode = "move";

let running = false;
let wasPaused = false;

function setFolderLabel(target, folderPath) {
  target.textContent = folderPath || "No folder selected";
  target.title = folderPath || "";
}

function setDepartureLabel(departure, count) {
  el.departureCount.textContent = "";
  if (!departure || (departure.mode === "folder" && !departure.folder)) {
    el.departurePathText.textContent = "No folder or files selected";
    el.departurePath.title = "";
    return;
  }
  if (departure.mode === "files") {
    const n = departure.files.length;
    el.departurePathText.textContent = `${n} file${n === 1 ? "" : "s"} selected`;
    el.departurePath.title = departure.files.join("\n");
  } else {
    el.departurePathText.textContent = departure.folder;
    el.departurePath.title = departure.folder;
    if (typeof count === "number") {
      el.departureCount.textContent = ` (${count} file${count === 1 ? "" : "s"} ready)`;
    }
  }
}

function setRunningState(isRunning) {
  running = isRunning;
  el.startBtn.disabled = isRunning;
  el.pauseAfterBtn.disabled = !isRunning;
  el.cancelBtn.disabled = !isRunning;
  el.selectDeparture.disabled = isRunning;
  el.selectArrival.disabled = isRunning;
  el.modeMoveBtn.disabled = isRunning;
  el.modeCopyBtn.disabled = isRunning;
  el.progressSection.hidden = !isRunning && el.logList.children.length === 0;
}

function setTransferModeUI(mode) {
  transferMode = mode;
  el.modeMoveBtn.classList.toggle("active", mode === "move");
  el.modeCopyBtn.classList.toggle("active", mode === "copy");
}

el.modeMoveBtn.addEventListener("click", () => {
  setTransferModeUI("move");
  window.ferry.setTransferMode("move");
});

el.modeCopyBtn.addEventListener("click", () => {
  setTransferModeUI("copy");
  window.ferry.setTransferMode("copy");
});

function addLogEntry(kind, name, detail) {
  const li = document.createElement("li");
  li.className = kind;
  const icon = kind === "ok" ? "✓" : kind === "error" ? "✕" : "•";
  li.innerHTML = `<span class="log-icon">${icon}</span><span class="log-name"></span><span class="log-detail"></span>`;
  li.querySelector(".log-name").textContent = name;
  li.querySelector(".log-detail").textContent = detail || "";
  el.logList.appendChild(li);
  el.logList.scrollTop = el.logList.scrollHeight;
}

function updateProgress(index, total, fileName) {
  el.progressSection.hidden = false;
  el.progressFileName.textContent = fileName || "—";
  el.progressCount.textContent = `${Math.min(index + 1, total)} / ${total}`;
}

function setBarFraction(fraction) {
  const pct = Math.max(0, Math.min(100, fraction * 100));
  el.progressBarFill.style.width = `${pct}%`;
}

function formatRate(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "";
  return `${formatSize(bytesPerSecond)}/s`;
}

function updateFileProgress(index, total, bytesCopied, bytesTotal, bytesPerSecond) {
  setBarFraction((index + (bytesTotal > 0 ? bytesCopied / bytesTotal : 0)) / total);
  el.progressDetail.hidden = false;
  const rate = formatRate(bytesPerSecond);
  el.progressDetail.textContent = `${formatSize(bytesCopied)} of ${formatSize(bytesTotal)}${rate ? ` — ${rate}` : ""}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`;
}

function formatDate(mtimeMs) {
  return new Date(mtimeMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderQueue(entries) {
  el.queueHeaderLabel.textContent = `Queue (${entries.length})`;
  el.queueList.innerHTML = "";
  if (entries.length === 0) {
    const li = document.createElement("li");
    li.className = "queue-empty";
    li.textContent = "Nothing queued.";
    el.queueList.appendChild(li);
    return;
  }
  entries.forEach((entry, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="queue-index"></span><span class="queue-name"></span><span class="queue-meta"></span>`;
    li.querySelector(".queue-index").textContent = `${i + 1}.`;
    li.querySelector(".queue-name").textContent = entry.name;
    li.querySelector(".queue-name").title = entry.name;
    li.querySelector(".queue-meta").textContent = `${formatSize(entry.size)} · ${formatDate(entry.mtime)}`;
    el.queueList.appendChild(li);
  });
}

let currentDeparture = null;

async function refreshFolders() {
  const settings = await window.ferry.getSettings();
  currentDeparture = settings.departure;
  el.sortSelect.value = settings.sortMode || "name-asc";
  setTransferModeUI(settings.transferMode || "move");
  const queue = await window.ferry.getQueue();
  setDepartureLabel(currentDeparture, queue.length);
  renderQueue(queue);
  setFolderLabel(el.arrivalPath, settings.arrivalFolder);
  el.ntfyEnabled.checked = !!settings.ntfyEnabled;
  el.ntfyTopic.value = settings.ntfyTopic || "";
  el.ntfyServer.value = settings.ntfyServer || "https://ntfy.sh";
}

function saveNotificationSettings() {
  window.ferry.setNotificationSettings({
    enabled: el.ntfyEnabled.checked,
    topic: el.ntfyTopic.value.trim(),
    server: el.ntfyServer.value.trim() || "https://ntfy.sh",
  });
}

el.ntfyEnabled.addEventListener("change", saveNotificationSettings);
el.ntfyTopic.addEventListener("change", saveNotificationSettings);
el.ntfyServer.addEventListener("change", saveNotificationSettings);

el.selectDeparture.addEventListener("click", async () => {
  const departure = await window.ferry.selectDeparture();
  currentDeparture = departure;
  const queue = await window.ferry.getQueue();
  setDepartureLabel(departure, queue.length);
  renderQueue(queue);
  wasPaused = false;
  el.startBtn.textContent = "Start Transfer";
});

el.sortSelect.addEventListener("change", () => {
  window.ferry.setSortMode(el.sortSelect.value);
});

el.selectArrival.addEventListener("click", async () => {
  const folder = await window.ferry.selectArrival();
  setFolderLabel(el.arrivalPath, folder);
});

el.startBtn.addEventListener("click", async () => {
  if (!wasPaused) el.logList.innerHTML = "";
  el.statusLine.textContent = "";
  let pausedThisRun = false;
  const stopListening = window.ferry.onProgress((event) => {
    if (event.type === "stopped") pausedThisRun = true;
  });
  setRunningState(true);
  const res = await window.ferry.startTransfer();
  stopListening();
  setRunningState(false);
  if (res && res.error) {
    el.statusLine.textContent = res.error;
    return;
  }
  wasPaused = pausedThisRun;
  el.startBtn.textContent = wasPaused ? "Resume Transfer" : "Start Transfer";
  if (res && res.result) {
    const { moved, failed } = res.result;
    if (!pausedThisRun) {
      const verb = transferMode === "copy" ? "copied" : "moved";
      el.statusLine.textContent = `Done — ${moved.length} ${verb}, ${failed.length} failed.`;
    }
  }
});

el.pauseAfterBtn.addEventListener("click", () => {
  window.ferry.pauseAfterCurrent();
  el.pauseAfterBtn.disabled = true;
  el.statusLine.textContent = "Will pause after the current file finishes…";
});

el.cancelBtn.addEventListener("click", () => {
  window.ferry.cancelTransfer();
  el.cancelBtn.disabled = true;
  el.statusLine.textContent = "Cancelling…";
});

window.ferry.onProgress((event) => {
  switch (event.type) {
    case "start":
      updateProgress(event.index, event.total, event.fileName);
      setBarFraction(event.index / event.total);
      el.progressDetail.hidden = true;
      el.progressDetail.textContent = "";
      break;
    case "file-progress":
      updateFileProgress(event.index, event.total, event.bytesCopied, event.bytesTotal, event.bytesPerSecond);
      break;
    case "done":
      updateProgress(event.index, event.total, event.fileName);
      setBarFraction((event.index + 1) / event.total);
      el.progressDetail.hidden = true;
      addLogEntry(
        "ok",
        event.fileName,
        event.destName !== event.fileName ? `→ ${event.destName}` : transferMode === "copy" ? "copied" : "moved"
      );
      break;
    case "error":
      el.progressDetail.hidden = true;
      addLogEntry("error", event.fileName, event.error);
      break;
    case "cancelled":
      el.progressDetail.hidden = true;
      el.statusLine.textContent = "Cancelled.";
      break;
    case "stopped":
      el.statusLine.textContent = "Paused after current file.";
      break;
    case "summary":
      if (event.total === 0) {
        el.statusLine.textContent = "No files to move.";
      }
      break;
  }
});

window.ferry.onPauseAfterRequested(() => {
  el.pauseAfterBtn.disabled = true;
  el.statusLine.textContent = "Will pause after the current file finishes…";
});

window.ferry.onCancelRequested(() => {
  el.cancelBtn.disabled = true;
  el.statusLine.textContent = "Cancelling…";
});

function renderChangelog() {
  el.changelogBody.innerHTML = CHANGELOG.map(
    (entry) => `
      <div class="changelog-entry">
        <span class="changelog-version">v${entry.version}</span>
        <span class="changelog-date">${entry.date}</span>
        <ul>${entry.changes.map((c) => `<li>${c}</li>`).join("")}</ul>
      </div>`
  ).join("");
}

function showChangelog() {
  renderChangelog();
  el.changelogModal.hidden = false;
}

el.changelogBtn.addEventListener("click", showChangelog);
el.closeChangelog.addEventListener("click", () => {
  el.changelogModal.hidden = true;
});
el.changelogModal.addEventListener("click", (e) => {
  if (e.target === el.changelogModal) el.changelogModal.hidden = true;
});
window.ferry.onShowChangelog(showChangelog);

window.ferry.onQueueUpdate((entries) => {
  renderQueue(entries);
  setDepartureLabel(currentDeparture, entries.length);
});

window.ferry.onUpdateAvailable(({ version, url }) => {
  el.updateBannerText.textContent = `Ferry ${version} is available (you have v${APP_VERSION}).`;
  el.updateBannerBtn.onclick = () => window.ferry.openUpdateUrl(url);
  el.updateBanner.hidden = false;
});

window.ferry.onUpdateNone(() => {
  el.updateBannerText.textContent = "You're on the latest version.";
  el.updateBannerBtn.style.display = "none";
  el.updateBanner.hidden = false;
  setTimeout(() => {
    el.updateBanner.hidden = true;
    el.updateBannerBtn.style.display = "";
  }, 3000);
});

refreshFolders();
