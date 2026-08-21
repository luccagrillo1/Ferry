const APP_VERSION = "0.1.0";

const CHANGELOG = [
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
  arrivalPath: document.getElementById("arrivalPath"),
  selectDeparture: document.getElementById("selectDeparture"),
  selectArrival: document.getElementById("selectArrival"),
  startBtn: document.getElementById("startBtn"),
  stopAfterBtn: document.getElementById("stopAfterBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  progressSection: document.getElementById("progressSection"),
  progressFileName: document.getElementById("progressFileName"),
  progressCount: document.getElementById("progressCount"),
  progressBarFill: document.getElementById("progressBarFill"),
  statusLine: document.getElementById("statusLine"),
  logList: document.getElementById("logList"),
  changelogBtn: document.getElementById("changelogBtn"),
  changelogModal: document.getElementById("changelogModal"),
  changelogBody: document.getElementById("changelogBody"),
  closeChangelog: document.getElementById("closeChangelog"),
};

let running = false;

function setFolderLabel(target, folderPath) {
  target.textContent = folderPath || "No folder selected";
  target.title = folderPath || "";
}

function setRunningState(isRunning) {
  running = isRunning;
  el.startBtn.disabled = isRunning;
  el.stopAfterBtn.disabled = !isRunning;
  el.cancelBtn.disabled = !isRunning;
  el.selectDeparture.disabled = isRunning;
  el.selectArrival.disabled = isRunning;
  el.progressSection.hidden = !isRunning && el.logList.children.length === 0;
}

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
  const pct = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
  el.progressBarFill.style.width = `${pct}%`;
}

async function refreshFolders() {
  const settings = await window.ferry.getSettings();
  setFolderLabel(el.departurePath, settings.departureFolder);
  setFolderLabel(el.arrivalPath, settings.arrivalFolder);
}

el.selectDeparture.addEventListener("click", async () => {
  const folder = await window.ferry.selectDeparture();
  setFolderLabel(el.departurePath, folder);
});

el.selectArrival.addEventListener("click", async () => {
  const folder = await window.ferry.selectArrival();
  setFolderLabel(el.arrivalPath, folder);
});

el.startBtn.addEventListener("click", async () => {
  el.logList.innerHTML = "";
  el.statusLine.textContent = "";
  setRunningState(true);
  const res = await window.ferry.startTransfer();
  if (res && res.error) {
    el.statusLine.textContent = res.error;
    setRunningState(false);
    return;
  }
  setRunningState(false);
  if (res && res.result) {
    const { moved, skipped, failed } = res.result;
    el.statusLine.textContent = `Done — ${moved.length} moved, ${failed.length} failed.`;
  }
});

el.stopAfterBtn.addEventListener("click", () => {
  window.ferry.stopAfterCurrent();
  el.stopAfterBtn.disabled = true;
  el.statusLine.textContent = "Will stop after the current file finishes…";
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
      break;
    case "done":
      updateProgress(event.index, event.total, event.fileName);
      addLogEntry("ok", event.fileName, event.destName !== event.fileName ? `→ ${event.destName}` : "moved");
      break;
    case "error":
      addLogEntry("error", event.fileName, event.error);
      break;
    case "cancelled":
      el.statusLine.textContent = "Cancelled.";
      break;
    case "stopped":
      el.statusLine.textContent = "Stopped after current transfer.";
      break;
    case "summary":
      if (event.total === 0) {
        el.statusLine.textContent = "No files found in the departure folder.";
      }
      break;
  }
});

window.ferry.onStopAfterRequested(() => {
  el.stopAfterBtn.disabled = true;
  el.statusLine.textContent = "Will stop after the current file finishes…";
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

refreshFolders();
