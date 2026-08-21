#!/usr/bin/env node
'use strict';
// Release preflight: runs at the start of scripts/release.sh.
// Checks version sync, changelog coverage, clean git tree, and artifact presence.

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const root = path.join(__dirname, '..');
let failed = 0;

const fail = msg => { console.error('✗  ' + msg); failed++; };
const ok   = msg => console.log('✓  ' + msg);

// ── 1. Version sync: package.json ↔ APP_VERSION in app.js ────────────────────
const pkg     = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appSrc  = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const vMatch  = appSrc.match(/const APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
const appVer  = vMatch?.[1];

if (!appVer) {
  fail('Could not find APP_VERSION in public/app.js');
} else if (appVer !== pkg.version) {
  fail(`Version mismatch — package.json: ${pkg.version}  APP_VERSION: ${appVer}`);
} else {
  ok(`Version ${pkg.version} in sync (package.json + APP_VERSION)`);
}

// ── 2. CHANGELOG has an entry for this version ────────────────────────────────
const escaped = pkg.version.replace(/\./g, '\\.');
if (!new RegExp(`version:\\s*['"]${escaped}['"]`).test(appSrc)) {
  fail(`No CHANGELOG entry for v${pkg.version} in public/app.js — add one before releasing`);
} else {
  ok(`CHANGELOG entry present for v${pkg.version}`);
}

// ── 3. Clean git working tree ─────────────────────────────────────────────────
try {
  const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim();
  if (dirty) {
    fail(`Working tree is dirty — commit or stash changes first:\n${
      dirty.split('\n').map(l => '     ' + l).join('\n')}`);
  } else {
    ok('Git working tree is clean');
  }
} catch (e) {
  fail('Could not check git status: ' + e.message);
}

// ── 4. Build artifacts exist for this version ─────────────────────────────────
const V = pkg.version;
const artifacts = [
  `dist/Ferry-${V}-arm64.dmg`,
  `dist/Ferry-${V}-x64.dmg`,
  `dist/Ferry-${V}-arm64.zip`,
  `dist/Ferry-${V}-x64.zip`,
];
const missing = artifacts.filter(f => !fs.existsSync(path.join(root, f)));
if (missing.length) {
  fail(`Missing build artifacts — run npm run build first:\n${
    missing.map(f => '     ' + f).join('\n')}`);
} else {
  ok(`All 4 build artifacts found for v${V}`);
}

// ── Result ────────────────────────────────────────────────────────────────────
if (failed) {
  console.error(`\nRelease preflight failed: ${failed} check(s) did not pass.\n`);
  process.exit(1);
}
console.log(`\nRelease preflight OK — v${V} is ready to publish.\n`);
