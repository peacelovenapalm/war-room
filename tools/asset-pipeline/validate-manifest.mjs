#!/usr/bin/env node
// validate-manifest.mjs — schema gate for the KICKOFF-v3.1 manifest contract.
//
// Checks every manifest under webview-v3-assets/ against the schema
// agreed in tools/asset-pipeline/README.md ("Manifest schema (agreed in
// KICKOFF-v3.1)"). This is a SECOND, independent gate on top of
// pack.py's pixel-level validation (overlap/empty-frame/budget) —
// pack.py runs in Python against the Blender output at generation
// time; this runs in Node with zero dependencies so WS-A (the actual
// consumer) can run it in CI without a Python/Pillow toolchain, and so
// drift between the staged JSON and the staged PNGs (e.g. a hand-edit,
// a stale sheet) gets caught independently.
//
// Usage: node validate-manifest.mjs   (or: npm run validate)
// Exit 0 = every manifest passes. Exit 1 = at least one FAIL line printed.
//
// Colorblind-safe output: PASS/FAIL/WARN are TEXT labels, never color-only
// (repo-root CLAUDE.md hard rule).

import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGE = path.resolve(HERE, "../../webview-v3-assets");

const ROTATIONS = new Set(["N", "E", "S", "W"]);

let failCount = 0;
let warnCount = 0;
const lines = [];

function fail(scope, msg) {
  failCount += 1;
  lines.push(`[FAIL] ${scope}: ${msg}`);
}
function warn(scope, msg) {
  warnCount += 1;
  lines.push(`[WARN] ${scope}: ${msg}`);
}
function pass(scope, msg) {
  lines.push(`[PASS] ${scope}: ${msg}`);
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

// ---- minimal PNG dimension reader (IHDR chunk, no deps) -------------------
function pngDims(filePath) {
  const fd = readFileSync(filePath);
  // 8-byte signature, then first chunk is always IHDR: 4 len + 4 type + data
  if (fd.length < 24 || fd.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`${filePath}: not a recognizable PNG (bad IHDR)`);
  }
  const width = fd.readUInt32BE(16);
  const height = fd.readUInt32BE(20);
  return [width, height];
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isPair(v) {
  return Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
}

// ---- sprite manifest (props.manifest.json / characters.manifest.json) ----
function validateSpriteManifest(name, manifestPath) {
  const scope = name;
  if (!existsSync(manifestPath)) {
    fail(scope, `manifest not found at ${manifestPath}`);
    return;
  }
  let m;
  try {
    m = readJson(manifestPath);
  } catch (e) {
    fail(scope, `not valid JSON: ${e.message}`);
    return;
  }

  if (m.version !== 1) fail(scope, `version must be 1, got ${JSON.stringify(m.version)}`);
  if (!Array.isArray(m.sheets) || m.sheets.length === 0) {
    fail(scope, "sheets must be a non-empty array");
    return;
  }
  if (!Array.isArray(m.sheetSizes) || m.sheetSizes.length !== m.sheets.length) {
    fail(scope, "sheetSizes must be an array matching sheets length");
    return;
  }
  if (!isNum(m.tilePx)) fail(scope, "tilePx must be a number");
  if (!isNum(m.renderScale)) fail(scope, "renderScale must be a number");
  if (!Array.isArray(m.sprites) || m.sprites.length === 0) {
    fail(scope, "sprites must be a non-empty array");
    return;
  }

  // sheet dims: declared vs actual PNG file
  const sheetDims = [];
  m.sheets.forEach((sheetFile, i) => {
    const decl = m.sheetSizes[i];
    if (!isPair(decl)) {
      fail(`${scope}/sheets[${i}]`, `sheetSizes[${i}] must be [w, h] numbers`);
      sheetDims.push(null);
      return;
    }
    const sheetPath = path.join(STAGE, sheetFile);
    if (!existsSync(sheetPath)) {
      fail(`${scope}/sheets[${i}]`, `${sheetFile} referenced but not found on disk`);
      sheetDims.push(null);
      return;
    }
    const kb = statSync(sheetPath).size / 1024;
    if (kb > 1024) fail(`${scope}/${sheetFile}`, `${kb.toFixed(0)} KB exceeds ~1MB budget`);
    let dims;
    try {
      dims = pngDims(sheetPath);
    } catch (e) {
      fail(`${scope}/${sheetFile}`, e.message);
      sheetDims.push(null);
      return;
    }
    if (dims[0] !== decl[0] || dims[1] !== decl[1]) {
      fail(
        `${scope}/${sheetFile}`,
        `sheetSizes declares ${decl[0]}x${decl[1]} but PNG IHDR is ${dims[0]}x${dims[1]}`
      );
    }
    sheetDims.push(dims);
  });

  const seenNames = new Set();
  const rectsBySheet = new Map(); // for overlap check, per sheet index
  for (const s of m.sprites) {
    const sc = `${scope}/${s.name ?? "<unnamed>"}`;
    if (typeof s.name !== "string" || !s.name) {
      fail(scope, "sprite missing string name");
      continue;
    }
    if (seenNames.has(s.name)) fail(sc, "duplicate sprite name");
    seenNames.add(s.name);

    if (!isPair(s.size)) fail(sc, "size must be [w, h]");
    if (!isPair(s.anchor)) fail(sc, "anchor must be [x, y]");
    if (isPair(s.size) && isPair(s.anchor)) {
      const [w, h] = s.size;
      const [ax, ay] = s.anchor;
      if (!(ax >= 0 && ax <= w && ay >= 0 && ay <= h)) {
        fail(sc, `anchor [${ax}, ${ay}] falls outside frame size [${w}, ${h}]`);
      }
    }
    if (!Array.isArray(s.rotations) || s.rotations.length === 0) {
      fail(sc, "rotations must be a non-empty array");
    } else {
      for (const r of s.rotations) {
        if (!ROTATIONS.has(r)) fail(sc, `rotation "${r}" is not one of N/E/S/W`);
      }
    }
    if (!isPair(s.footprint) || s.footprint[0] <= 0 || s.footprint[1] <= 0) {
      fail(sc, "footprint must be [w, h] positive tile counts");
    }
    if (!Number.isInteger(s.sheet) || s.sheet < 0 || s.sheet >= m.sheets.length) {
      fail(sc, `sheet index ${JSON.stringify(s.sheet)} out of range`);
    }
    if (s.fps !== undefined && !(isNum(s.fps) && s.fps >= 0)) {
      fail(sc, `fps must be a non-negative number if present, got ${JSON.stringify(s.fps)}`);
    }

    if (typeof s.frames !== "object" || s.frames === null) {
      fail(sc, "frames must be an object keyed by rotation");
      continue;
    }
    const rotSet = new Set(Array.isArray(s.rotations) ? s.rotations : []);
    const frameKeys = new Set(Object.keys(s.frames));
    if (rotSet.size && (rotSet.size !== frameKeys.size || [...rotSet].some((r) => !frameKeys.has(r)))) {
      fail(sc, `rotations ${[...rotSet]} and frames keys ${[...frameKeys]} must match exactly`);
    }

    for (const [rot, val] of Object.entries(s.frames)) {
      const frList = Array.isArray(val) ? val : [val];
      if (Array.isArray(val) && val.length === 0) {
        fail(`${sc}/${rot}`, "animated frame list is empty");
      }
      frList.forEach((f, fi) => {
        const tag = Array.isArray(val) ? `${sc}/${rot}.${fi}` : `${sc}/${rot}`;
        if (!f || !isNum(f.x) || !isNum(f.y) || !isPair(f.anchor)) {
          fail(tag, "frame must be {x, y, anchor:[x,y]}");
          return;
        }
        const si = s.sheet;
        const dims = sheetDims[si];
        if (dims && isPair(s.size)) {
          const [w, h] = s.size;
          if (f.x < 0 || f.y < 0 || f.x + w > dims[0] || f.y + h > dims[1]) {
            fail(tag, `frame rect [${f.x},${f.y},${w},${h}] exceeds sheet ${dims[0]}x${dims[1]}`);
          } else if (Number.isInteger(si)) {
            if (!rectsBySheet.has(si)) rectsBySheet.set(si, []);
            rectsBySheet.get(si).push({ tag, x: f.x, y: f.y, w, h });
          }
        }
        // absolute anchor should equal frame origin + relative anchor
        if (isPair(s.anchor)) {
          const [ax, ay] = s.anchor;
          const [absX, absY] = f.anchor;
          const expX = f.x + ax;
          const expY = f.y + ay;
          if (Math.abs(absX - expX) > 0.6 || Math.abs(absY - expY) > 0.6) {
            fail(
              tag,
              `absolute anchor [${absX},${absY}] != frame origin + relative anchor [${expX.toFixed(1)},${expY.toFixed(1)}]`
            );
          }
        }
      });
    }

    if (s.attach) {
      for (const [attachName, perRot] of Object.entries(s.attach)) {
        for (const [rot, quad] of Object.entries(perRot)) {
          if (!Array.isArray(quad) || quad.length !== 4 || !quad.every(isPair)) {
            fail(sc, `attach.${attachName}.${rot} must be exactly 4 [x,y] points`);
          }
        }
      }
    }
  }

  // overlap check per sheet (redundant with pack.py's Python gate, run
  // independently here since this validator doesn't trust pack.py ran)
  for (const [si, rects] of rectsBySheet) {
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          fail(`${scope}/sheet[${si}]`, `overlap: ${a.tag} vs ${b.tag}`);
        }
      }
    }
  }

  if (failCount === 0) {
    const nFrames = m.sprites.reduce((acc, s) => {
      return (
        acc +
        Object.values(s.frames).reduce((a, v) => a + (Array.isArray(v) ? v.length : 1), 0)
      );
    }, 0);
    pass(scope, `${m.sprites.length} sprites, ${nFrames} frames, ${m.sheets.length} sheet(s) — schema OK`);
  }
}

// ---- imagegen manifest (flat, rectangular assets) --------------------
function validateImagegenManifest(manifestPath) {
  const scope = "imagegen";
  if (!existsSync(manifestPath)) {
    fail(scope, `manifest not found at ${manifestPath}`);
    return;
  }
  let m;
  try {
    m = readJson(manifestPath);
  } catch (e) {
    fail(scope, `not valid JSON: ${e.message}`);
    return;
  }
  if (m.version !== 1) fail(scope, `version must be 1, got ${JSON.stringify(m.version)}`);
  if (typeof m.generator !== "string" || !m.generator) fail(scope, "generator must be a non-empty string");
  if (!Array.isArray(m.images) || m.images.length === 0) {
    fail(scope, "images must be a non-empty array");
    return;
  }
  const seen = new Set();
  for (const img of m.images) {
    const sc = `${scope}/${img.name ?? "<unnamed>"}`;
    if (typeof img.name !== "string" || !img.name) {
      fail(scope, "image missing string name");
      continue;
    }
    if (seen.has(img.name)) fail(sc, "duplicate image name");
    seen.add(img.name);
    if (typeof img.path !== "string" || !img.path) fail(sc, "path must be a non-empty string");
    if (typeof img.purpose !== "string" || !img.purpose) fail(sc, "purpose must be a non-empty string");
    if (!isPair(img.size)) {
      fail(sc, "size must be [w, h]");
      continue;
    }
    const filePath = path.join(STAGE, img.path);
    if (!existsSync(filePath)) {
      fail(sc, `path "${img.path}" not found on disk`);
      continue;
    }
    const kb = statSync(filePath).size / 1024;
    if (kb > 1126) warn(sc, `${kb.toFixed(0)} KB is close to/over the ~1.1MB per-file budget`);
    let dims;
    try {
      dims = pngDims(filePath);
    } catch (e) {
      fail(sc, e.message);
      continue;
    }
    if (dims[0] !== img.size[0] || dims[1] !== img.size[1]) {
      fail(sc, `size declares ${img.size[0]}x${img.size[1]} but PNG IHDR is ${dims[0]}x${dims[1]}`);
    }
  }
  if (failCount === 0) pass(scope, `${m.images.length} images — schema OK`);
}

validateSpriteManifest("props", path.join(STAGE, "props.manifest.json"));
validateSpriteManifest("characters", path.join(STAGE, "characters.manifest.json"));
validateImagegenManifest(path.join(STAGE, "imagegen", "manifest.json"));

console.log(lines.join("\n"));
console.log("");
console.log(`${failCount} FAIL, ${warnCount} WARN`);
if (failCount > 0) {
  console.log("RESULT: FAIL ✗");
  process.exit(1);
} else {
  console.log("RESULT: PASS ✓");
  process.exit(0);
}
