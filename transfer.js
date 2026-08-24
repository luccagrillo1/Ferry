const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

async function listTopLevelEntries(folder) {
  const dirEntries = await fsp.readdir(folder, { withFileTypes: true });
  const files = dirEntries.filter((e) => e.isFile() && !e.name.startsWith("."));
  return statEntries(files.map((e) => path.join(folder, e.name)));
}

async function statEntries(filePaths) {
  const entries = await Promise.all(
    filePaths.map(async (p) => {
      try {
        const st = await fsp.stat(p);
        return { name: path.basename(p), path: p, size: st.size, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    })
  );
  return entries.filter(Boolean);
}

const SORTERS = {
  "name-asc": (a, b) => a.name.localeCompare(b.name),
  "name-desc": (a, b) => b.name.localeCompare(a.name),
  "size-desc": (a, b) => b.size - a.size,
  "size-asc": (a, b) => a.size - b.size,
  "date-desc": (a, b) => b.mtime - a.mtime,
  "date-asc": (a, b) => a.mtime - b.mtime,
};

function sortEntries(entries, sortMode) {
  const sorter = SORTERS[sortMode] || SORTERS["name-asc"];
  return [...entries].sort(sorter);
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

const PROGRESS_INTERVAL_MS = 200;

// Cross-device copy via streams, so we can report live byte progress/speed
// and actually stop mid-copy on cancel instead of only checking afterward.
function copyWithProgress(srcPath, destPath, size, signal, onFileProgress) {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(srcPath);
    const writeStream = fs.createWriteStream(destPath);
    let copied = 0;
    let lastEmitTime = Date.now();
    let lastEmitBytes = 0;
    let settled = false;

    const cleanupAndReject = (err) => {
      if (settled) return;
      settled = true;
      readStream.destroy();
      writeStream.destroy();
      reject(err);
    };

    readStream.on("data", (chunk) => {
      if (signal && signal.cancelled) {
        cleanupAndReject(Object.assign(new Error("Cancelled"), { code: "CANCELLED" }));
        return;
      }
      copied += chunk.length;
      const now = Date.now();
      const elapsed = now - lastEmitTime;
      if (onFileProgress && (elapsed >= PROGRESS_INTERVAL_MS || copied === size)) {
        const bytesPerSecond = elapsed > 0 ? ((copied - lastEmitBytes) / elapsed) * 1000 : 0;
        onFileProgress(copied, size, bytesPerSecond);
        lastEmitTime = now;
        lastEmitBytes = copied;
      }
    });
    readStream.on("error", cleanupAndReject);
    writeStream.on("error", cleanupAndReject);
    writeStream.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    readStream.pipe(writeStream);
  });
}

async function moveOneFile(srcPath, destPath, size, signal, onFileProgress, mode) {
  if (mode === "copy") {
    // Always stream-copy, never touch the source.
    try {
      await copyWithProgress(srcPath, destPath, size, signal, onFileProgress);
    } catch (err) {
      await fsp.unlink(destPath).catch(() => {});
      throw err;
    }
    return;
  }

  try {
    await fsp.rename(srcPath, destPath);
    return;
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }

  // Cross-device: stream-copy then delete, with cleanup on error/cancellation.
  try {
    await copyWithProgress(srcPath, destPath, size, signal, onFileProgress);
  } catch (err) {
    await fsp.unlink(destPath).catch(() => {});
    throw err;
  }
  // The copy already succeeded at this point — the transfer's goal is met.
  // If the source is already gone (ENOENT), something else beat us to
  // removing it (flaky network/external volume, or another process); that's
  // not a failed transfer, so don't report it as one. Any other error here
  // (permissions, busy, etc.) means the source is still sitting there and
  // genuinely needs attention, so that one still surfaces.
  try {
    await fsp.unlink(srcPath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

/**
 * Moves (or copies) the given source entries into arrivalFolder, one at a time, in order.
 *
 * @param {{path: string, size: number}[]} sourceEntries
 * @param {string} arrivalFolder
 * @param {object} control - { cancelled: bool, pauseAfterCurrent: bool }, mutated externally to signal state
 * @param {(event: object) => void} onProgress
 * @param {"move"|"copy"} mode - "move" (default) deletes the source after transfer; "copy" leaves it in place
 * @returns {Promise<{moved: string[], skipped: string[], failed: {name: string, error: string}[]}>}
 */
async function runTransfer(sourceEntries, arrivalFolder, control, onProgress, mode = "move") {
  const total = sourceEntries.length;
  const result = { moved: [], skipped: [], failed: [] };

  for (let i = 0; i < total; i += 1) {
    if (control.cancelled) {
      onProgress({ type: "cancelled", index: i, total });
      break;
    }

    const srcPath = sourceEntries[i].path;
    const size = sourceEntries[i].size;
    const name = path.basename(srcPath);
    onProgress({ type: "start", index: i, total, fileName: name, size });

    try {
      const destName = await resolveCollisionFreeName(arrivalFolder, name);
      const destPath = path.join(arrivalFolder, destName);
      await moveOneFile(
        srcPath,
        destPath,
        size,
        control,
        (bytesCopied, bytesTotal, bytesPerSecond) => {
          onProgress({
            type: "file-progress",
            index: i,
            total,
            fileName: name,
            bytesCopied,
            bytesTotal,
            bytesPerSecond,
          });
        },
        mode
      );
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

    if (control.pauseAfterCurrent) {
      onProgress({ type: "stopped", index: i, total });
      break;
    }
  }

  onProgress({ type: "summary", ...result, total });
  return result;
}

module.exports = {
  runTransfer,
  listTopLevelEntries,
  statEntries,
  sortEntries,
  resolveCollisionFreeName,
  copyWithProgress,
};
