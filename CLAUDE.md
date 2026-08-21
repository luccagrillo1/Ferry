# Ferry — Claude Code Briefing

## What We're Building
A small macOS Electron menu bar app that moves files, one at a time, from a user-picked "departure" folder to a user-picked "arrival" folder — with a progress UI, a persistent menu bar (Tray) icon showing live progress, a "Stop After This Transfer" control, and a "Cancel" control.

## Tech Stack
- Electron (main process: `main.js`, preload: `preload.js`) + `electron-builder` for packaging
- Plain HTML/CSS/JS renderer under `public/` — no framework, no local Express server (unlike DeckPro/Camera Scheduler — Ferry has no persisted browser state that needs a stable HTTP origin, so `BrowserWindow.loadFile()` loads `public/index.html` directly)
- IPC (`ipcMain`/`ipcRenderer` via `contextBridge` in `preload.js`) is the renderer↔main API, exposed to the page as `window.ferry`
- `transfer.js` is a pure-Node transfer engine (no Electron deps) — testable in isolation
- `settings.js` persists last-used folders + window bounds to `<userData>/ferry-settings.json` via atomic write (same pattern as Camera Scheduler's `db.js`)

## Key Behavior
- **Scan**: top-level files only in the departure folder at the moment Start is clicked (no recursion into subfolders, no live watching — re-click Start to pick up new files)
- **Move**: `fs.rename` first (same-volume, atomic); falls back to `fs.copyFile` + `fs.unlink` on `EXDEV` (cross-device)
- **Collisions**: auto-renamed at the destination as `name (1).ext`, `name (2).ext`, ...
- **Stop After This Transfer**: sets a flag checked *between* files — current move always finishes, then the loop exits
- **Cancel**: aborts ASAP; cleans up any partial destination file from an in-progress copy fallback; source file is never touched until the move fully succeeds
- **Tray**: always visible, template icon (adapts to light/dark menu bar), title shows live `NN%` during a transfer, context menu offers Show Ferry / Stop After This Transfer / Cancel Transfer / Quit
- Closing the main window does **not** quit the app (`window-all-closed` is a no-op) — Ferry lives in the menu bar; Quit via the Tray menu or app menu

## Versioning
`APP_VERSION` and `CHANGELOG` live at the top of `public/app.js`, rendered in the "What's New" modal (Help menu + Tray-adjacent app menu). Bump both, plus `package.json.version`, on every change — `scripts/release-preflight.js` enforces they stay in sync before a release.

## Key Files
- `main.js` — app lifecycle, `BrowserWindow`, `Tray`, all `ipcMain` handlers
- `preload.js` — `contextBridge` API surface (`window.ferry`)
- `transfer.js` — `runTransfer()`, the core move loop
- `settings.js` — atomic JSON settings read/write
- `public/app.js` — `APP_VERSION`/`CHANGELOG`, UI wiring, progress rendering
- `build/icon.icns` — app icon; `build/trayIconTemplate.png` (+`@2x`) — menu bar icon (both placeholder-generated, swap anytime)
- `scripts/release.sh` / `scripts/release-preflight.js` — adapted from DeckPro's release flow, retargeted to Ferry's artifact names

## Repo
Public GitHub repo: `luccagrillo1/Ferry` (not yet created — see release workflow).

## Status
Initial build complete (v0.1.0), not yet run/tested or pushed to GitHub.
