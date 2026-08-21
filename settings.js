const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  departureFolder: null,
  departureMode: "folder", // "folder" | "files"
  departureFiles: [], // absolute paths, only used when departureMode === "files"
  arrivalFolder: null,
  windowBounds: null,
  ntfyEnabled: true,
  ntfyServer: "https://ntfy.sh",
  ntfyTopic: "ferry-crossing-f5e5ae",
};

function settingsPath(userDataDir) {
  return path.join(userDataDir, "ferry-settings.json");
}

function loadSettings(userDataDir) {
  const file = settingsPath(userDataDir);
  try {
    const raw = fs.readFileSync(file, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(userDataDir, settings) {
  const file = settingsPath(userDataDir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { loadSettings, saveSettings, DEFAULTS };
