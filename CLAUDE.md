# Ferry — Claude Code Briefing

## What We're Building
A small macOS Electron menu bar app that moves files, one at a time, from a user-picked "departure" (a whole folder, or specific files) to a user-picked "arrival" folder — with a progress UI, a live "N files ready" count for folder mode, a persistent menu bar (Tray) icon showing live progress, a "Pause After This Transfer" / "Resume Transfer" flow, a "Cancel" control, an optional ntfy push notification on completion, and a GitHub-releases update check.

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
- **Live count**: folder-mode departure watches the folder with `fs.watch` (debounced 150ms), pushing a fresh top-level-file count to the renderer, rendered as a non-truncating badge (`#departureCount`) next to the (still-truncating) path text — files mode doesn't get a live count, just the fixed selection size
- **Update check**: on `did-finish-load` and via "Check for Updates…" in the app menu, fetches `https://api.github.com/repos/luccagrillo1/Ferry/releases/latest` and compares `tag_name` against `package.json.version`; shows a dismissible in-app banner (or a transient "you're up to date" banner for manual checks only)
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
**v1.0.0 was cut as a real GitHub Release** (`gh release create`, tagged, "latest"): github.com/luccagrillo1/Ferry/releases/tag/v1.0.0. **v1.1.0 is built and installed** to `/Applications/Ferry.app` (launches correctly, changelog confirms v1.1.0) and pushed to `main`, but **not yet cut as a new GitHub Release** — ask before assuming it's public.

Verified this session: folder selection, sequential move, auto-rename on collision, Pause/Resume, Cancel, settings persistence across relaunch, changelog modal, specific-file departure selection (single AND multi-file — cmd-click failed in automation but shift+Down arrow-key selection worked and proved the same code path; only the chosen files move, rest of the folder untouched — confirmed on disk both times), ntfy notification end-to-end (real POST received via `curl .../json?poll=1`), live departure file count (added/removed a file on disk, watched the badge update from 2→3→2 with no UI interaction), update-check banner (both the "up to date" transient banner via manual check, and confirmed hidden when no update — never got to click-test the "update available" banner live since local was always ahead of the last cut release; logic unit-tested separately). Pause/Resume's control-flow logic verified via an isolated `transfer.js` test (same-volume `fs.rename` is too fast to reliably interrupt mid-batch by clicking through screenshots) rather than a live UI click-through.

Found and fixed **the same CSS bug twice**: `.modal-overlay` and later `.update-banner` both set `display: flex` at the class level with no `[hidden]` override, so the `hidden` attribute lost the specificity tie and the element showed on load. Fixed both with an explicit `.foo[hidden] { display: none; }` rule — **check for this pattern before adding any new `hidden`-toggled element that also sets its own `display` in CSS.**

**Gatekeeper** (checked on the v0.1.0 build, same unsigned/ad-hoc setup still true at v1.1.0): `spctl` rejects it (same as your existing DeckPro.app) — anyone downloading the DMG needs the right-click-Open (or System Settings → Privacy & Security → Open Anyway) workaround. User explicitly decided not to pursue code signing/notarization (would need their own Apple Developer Program enrollment).

**Known issue**: the Tray (menu bar) icon does not visibly appear on the dev machine, even with a plain text title and no image, and even in the packaged `/Applications/Ferry.app` build (not just dev `electron .`) — `Tray()` constructs without error and the icon loads correctly (`nativeImage` reports non-empty, correct 22x22 size), so this isn't a code-level bug. Most likely cause: the menu bar is full of other apps' status items and macOS silently drops new ones when there's no room. Not yet confirmed on a machine with a less crowded menu bar.
