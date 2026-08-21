# Ferry — Claude Code Briefing

## What We're Building
A small macOS Electron menu bar app that moves files, one at a time, from a user-picked "departure" (a whole folder, or specific files) to a user-picked "arrival" folder — with a progress UI, a persistent menu bar (Tray) icon showing live progress, a "Pause After This Transfer" / "Resume Transfer" flow, a "Cancel" control, and an optional ntfy push notification on completion.

## Tech Stack
- Electron (main process: `main.js`, preload: `preload.js`) + `electron-builder` for packaging
- Plain HTML/CSS/JS renderer under `public/` — no framework, no local Express server (unlike DeckPro/Camera Scheduler — Ferry has no persisted browser state that needs a stable HTTP origin, so `BrowserWindow.loadFile()` loads `public/index.html` directly)
- IPC (`ipcMain`/`ipcRenderer` via `contextBridge` in `preload.js`) is the renderer↔main API, exposed to the page as `window.ferry`
- `transfer.js` is a pure-Node transfer engine (no Electron deps) — takes an explicit list of absolute source-file paths (not a folder), testable in isolation
- `settings.js` persists last-used departure/arrival selection, window bounds, and ntfy config to `<userData>/ferry-settings.json` via atomic write (same pattern as Camera Scheduler's `db.js`)
- `notify.js` — POSTs a completion summary to an ntfy topic (`fetch`, no dependency needed — Electron's Node runtime has it built in)

## Key Behavior
- **Departure modes**: the same "Select…" picker (`dialog.showOpenDialog` with `openFile`+`openDirectory`+`multiSelections`) yields either a **folder** (`departureMode: "folder"` — every top-level file in it, re-scanned fresh on every run) or **specific files** (`departureMode: "files"` — only those exact files, re-filtered by `fs.existsSync` on every run so already-moved ones drop out automatically). `main.js`'s `resolveSourceFiles()` is the single place that turns either mode into the absolute-path array `transfer.js` expects.
- **Scan**: folder mode is top-level only (no recursion into subfolders, no live watching)
- **Move**: `fs.rename` first (same-volume, atomic); falls back to `fs.copyFile` + `fs.unlink` on `EXDEV` (cross-device)
- **Collisions**: auto-renamed at the destination as `name (1).ext`, `name (2).ext`, ...
- **Pause After This Transfer**: sets `control.pauseAfterCurrent`, checked *between* files — current move always finishes, then the loop exits. Because `resolveSourceFiles()` re-derives the list fresh every run, clicking **Resume Transfer** (the renderer swaps the Start button's label after a pause, tracked via a `wasPaused` flag set when a `'stopped'` progress event is observed) just continues with whatever's left, no separate queue state needed.
- **Cancel**: aborts ASAP; cleans up any partial destination file from an in-progress copy fallback; source file is never touched until the move fully succeeds. Unlike Pause, Cancel does not flip the button to "Resume" — it resets to "Start Transfer" framing (still functionally re-picks up remaining files if you click it, just labeled differently).
- **ntfy**: on transfer completion (only if any file was moved or failed), POSTs `{title, message, tags}` to `${ntfyServer}/${ntfyTopic}` if `ntfyEnabled` is on. Configured via the Notifications section in the UI, persisted like everything else. Default topic `ferry-crossing-f5e5ae` on public ntfy.sh.
- **Tray**: always visible, template icon (adapts to light/dark menu bar), title shows live `NN%` during a transfer, context menu offers Show Ferry / Pause After This Transfer / Cancel Transfer / Quit
- Closing the main window does **not** quit the app (`window-all-closed` is a no-op) — Ferry lives in the menu bar; Quit via the Tray menu or app menu

## Versioning
`APP_VERSION` and `CHANGELOG` live at the top of `public/app.js`, rendered in the "What's New" modal (Help menu + Tray-adjacent app menu). Bump both, plus `package.json.version`, on every change — `scripts/release-preflight.js` enforces they stay in sync before a release.

## Key Files
- `main.js` — app lifecycle, `BrowserWindow`, `Tray`, `resolveSourceFiles()`, all `ipcMain` handlers
- `preload.js` — `contextBridge` API surface (`window.ferry`)
- `transfer.js` — `runTransfer(sourceFiles, arrivalFolder, control, onProgress)`, the core move loop
- `settings.js` — atomic JSON settings read/write
- `notify.js` — ntfy POST helper
- `public/app.js` — `APP_VERSION`/`CHANGELOG`, UI wiring, progress rendering, Pause/Resume label logic
- `build/icon.icns` — app icon; `build/trayIconTemplate.png` (+`@2x`) — menu bar icon (both placeholder-generated, swap anytime)
- `scripts/release.sh` / `scripts/release-preflight.js` — adapted from DeckPro's release flow, retargeted to Ferry's artifact names

## Repo
Public GitHub repo: `luccagrillo1/Ferry` (github.com/luccagrillo1/Ferry).

## Status
v0.3.0. Verified: folder selection, sequential move, auto-rename on collision, Pause/Resume, Cancel, settings persistence across relaunch, changelog modal, specific-file departure selection (only the chosen file(s) move, rest of the folder untouched — confirmed on disk), ntfy notification end-to-end (real POST received via `curl .../json?poll=1`). Pause/Resume's control-flow logic verified via an isolated `transfer.js` test (same-volume `fs.rename` is too fast to reliably interrupt mid-batch by clicking through screenshots) rather than a live UI click-through — worth a quick manual click-test with a large batch next time you're driving it yourself.

v0.1.0 (`npm run build` → `dist/Ferry-0.1.0-*.dmg`/`.zip`) was built and installed to `/Applications/Ferry.app` and confirmed to launch correctly as a real packaged app (not just `electron .` dev mode). **Gatekeeper**: unsigned/ad-hoc, `spctl` rejects it (same as your existing DeckPro.app) — anyone downloading the DMG needs the right-click-Open (or System Settings → Privacy & Security → Open Anyway) workaround. Not re-built since v0.1.0; rebuild before shipping v0.3.0.

**Known issue**: the Tray (menu bar) icon does not visibly appear on the dev machine, even with a plain text title and no image, and even in the packaged `/Applications/Ferry.app` build (not just dev `electron .`) — `Tray()` constructs without error and the icon loads correctly (`nativeImage` reports non-empty, correct 22x22 size), so this isn't a code-level bug. Most likely cause: the menu bar is full of other apps' status items and macOS silently drops new ones when there's no room. Not yet confirmed on a machine with a less crowded menu bar.
