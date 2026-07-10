#!/usr/bin/env node
/**
 * Mirrors ../webview-v3-assets/ (WS-B pipeline output, git source of truth)
 * into ./public/assets/ so Vite serves it at /assets/... in dev AND copies
 * it into dist/assets/... on build (Vite's public/ convention) — the same
 * static-file path works unmodified for e2e (which hits the built dist).
 *
 * Runs as predev/prebuild (npm lifecycle auto-invokes both). ./public/assets
 * is a generated mirror, not a second source of truth — gitignored, never
 * hand-edited; re-run `make all` in tools/asset-pipeline/ to regenerate the
 * real source, then this script re-syncs the copy.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..', 'webview-v3-assets');
const DEST = path.resolve(here, '..', 'public', 'assets');

function countFiles(dir) {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    count += statSync(full).isDirectory() ? countFiles(full) : 1;
  }
  return count;
}

if (!existsSync(SRC)) {
  console.error(`[sync-assets] source not found: ${SRC}`);
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, {
  recursive: true,
  filter: (src) => path.basename(src) !== 'README.md',
});

console.log(`[sync-assets] ${SRC} -> ${DEST} (${String(countFiles(DEST))} files)`);
