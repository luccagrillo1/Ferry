# Ferry

A small macOS menu bar app that moves files, one by one, from a departure folder to an arrival folder.

## Features

- Pick a departure folder and an arrival folder
- Moves files one at a time with a live progress bar and activity log
- **Stop After This Transfer** — finishes the current file, then halts before the next
- **Cancel** — aborts immediately, cleaning up any partial copy
- Always-visible menu bar icon showing live transfer progress
- Automatic rename on filename collisions in the arrival folder
- Remembers your last-used folders

## Development

```bash
npm install
npm start
```

## Build

```bash
npm run build      # produces .dmg / .zip in dist/
npm run ship       # build, install to /Applications, and open it
```

## Release

```bash
npm run release              # public release
bash scripts/release.sh --prerelease   # beta release
```
