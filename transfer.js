const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

async function listTopLevelFiles(folder) {
  const entries = await fsp.readdir(folder, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveCollisionFreeName(destFolder, fileName) {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  let candidate = fileName;
  let n = 1;
  while (await pathExists(path.join(destFolder, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

async function moveOneFile(srcPath, destPath, signal) {
  try {
    await fsp.rename(srcPath, destPath);
    return;
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }

  // Cross-device: copy then delete, with cleanup on cancellation.
  try {
    await fsp.copyFile(srcPath, destPath);
  } catch (err) {
    await fsp.unlink(destPath).catch(() => {});
    throw err;
  }
  if (signal && signal.cancelled) {
    await fsp.unlink(destPath).catch(() => {});
    const abortErr = new Error("Cancelled");
    abortErr.code = "CANCELLED";
    throw abortErr;
  }
  await fsp.unlink(srcPath);
}

/**
 * Moves files found (at call time) directly inside departureFolder into arrivalFolder,
 * one at a time, in name order.
 *
 * @param {string} departureFolder
 * @param {string} arrivalFolder
 * @param {object} control - { cancelled: bool, stopAfterCurrent: bool }, mutated externally to signal state
 * @param {(event: object) => void} onProgress
 * @returns {Promise<{moved: string[], skipped: string[], failed: {name: string, error: string}[]}>}
 */
async function runTransfer(departureFolder, arrivalFolder, control, onProgress) {
  const files = await listTopLevelFiles(departureFolder);
  const total = files.length;
  const result = { moved: [], skipped: [], failed: [] };

  for (let i = 0; i < total; i += 1) {
    if (control.cancelled) {
      onProgress({ type: "cancelled", index: i, total });
      break;
    }

    const name = files[i];
    const srcPath = path.join(departureFolder, name);
    onProgress({ type: "start", index: i, total, fileName: name });

    try {
      const destName = await resolveCollisionFreeName(arrivalFolder, name);
      const destPath = path.join(arrivalFolder, destName);
      await moveOneFile(srcPath, destPath, control);
      result.moved.push(destName);
      onProgress({ type: "done", index: i, total, fileName: name, destName });
    } catch (err) {
      if (err.code === "CANCELLED") {
        onProgress({ type: "cancelled", index: i, total, fileName: name });
        break;
      }
      result.failed.push({ name, error: err.message });
      onProgress({ type: "error", index: i, total, fileName: name, error: err.message });
    }

    if (control.stopAfterCurrent) {
      onProgress({ type: "stopped", index: i, total });
      break;
    }
  }

  onProgress({ type: "summary", ...result, total });
  return result;
}

module.exports = { runTransfer, listTopLevelFiles, resolveCollisionFreeName };
