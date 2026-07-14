import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(SCRIPT_DIR, '../../dist/webview-v3');
const COMPRESSIBLE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
]);
const MIN_BYTES = 1024;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

if (!fs.existsSync(OUT_DIR)) {
  throw new Error(`[precompress] build output missing: ${OUT_DIR}`);
}

let files = 0;
let sourceBytes = 0;
let brotliBytes = 0;
let gzipBytes = 0;

for (const file of walk(OUT_DIR)) {
  if (file.endsWith('.br') || file.endsWith('.gz')) continue;
  if (!COMPRESSIBLE_EXTENSIONS.has(path.extname(file))) continue;
  const source = fs.readFileSync(file);
  if (source.byteLength < MIN_BYTES) continue;

  const brotli = brotliCompressSync(source, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const gzip = gzipSync(source, { level: 9 });
  fs.writeFileSync(`${file}.br`, brotli);
  fs.writeFileSync(`${file}.gz`, gzip);
  files += 1;
  sourceBytes += source.byteLength;
  brotliBytes += brotli.byteLength;
  gzipBytes += gzip.byteLength;
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
console.log(
  `[precompress] ${String(files)} files: ${kib(sourceBytes)} raw -> ${kib(brotliBytes)} br / ${kib(gzipBytes)} gzip`,
);
