#!/usr/bin/env node
// screenshot-viewer.mjs — serve the repo root over plain HTTP (so
// viewer.html's relative fetch()/Image src to ../../webview-v3-assets/
// resolve), load viewer.html in Chromium at DPR 1 and DPR 3, assert it
// rendered with zero console/page errors and zero self-reported QA
// failures, then save full-page screenshots.
//
// Usage: node screenshot-viewer.mjs [outDir]
//   outDir defaults to ../../.planning/v3/screenshots/assets

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../.."); // tools/asset-pipeline -> tools -> repo root
const OUT_DIR = path.resolve(
  HERE,
  process.argv[2] || "../../.planning/v3/screenshots/assets"
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
};

function serveStatic(root) {
  return createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const filePath = path.join(root, urlPath);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    } catch (e) {
      res.writeHead(404);
      res.end(String(e));
    }
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function captureAt(browser, url, dpr, outFile) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__viewerDone === true, { timeout: 15000 });

  const failCount = await page.evaluate(() => window.__viewerFailCount);
  const dprSeen = await page.evaluate(() => window.devicePixelRatio);

  await page.screenshot({ path: outFile, fullPage: true });
  await context.close();

  return { consoleErrors, failCount, dprSeen };
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const server = serveStatic(REPO_ROOT);
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}/tools/asset-pipeline/viewer.html`;

  const browser = await chromium.launch();
  let exitCode = 0;
  try {
    for (const dpr of [1, 3]) {
      const outFile = path.join(OUT_DIR, `viewer-dpr${dpr}.png`);
      process.stdout.write(`[screenshot] DPR ${dpr} -> ${outFile} ... `);
      const { consoleErrors, failCount, dprSeen } = await captureAt(browser, url, dpr, outFile);
      console.log("done");
      if (dprSeen !== dpr) {
        console.error(`[screenshot] FAIL: expected devicePixelRatio ${dpr}, page saw ${dprSeen}`);
        exitCode = 1;
      }
      if (consoleErrors.length) {
        console.error(`[screenshot] FAIL: ${consoleErrors.length} console/page error(s) at DPR ${dpr}:`);
        consoleErrors.forEach((e) => console.error(`  ${e}`));
        exitCode = 1;
      }
      if (failCount !== 0) {
        console.error(`[screenshot] FAIL: viewer self-reported ${failCount} QA issue(s) at DPR ${dpr}`);
        exitCode = 1;
      }
      if (!consoleErrors.length && failCount === 0 && dprSeen === dpr) {
        console.log(`[screenshot] OK DPR ${dpr}: 0 console errors, 0 QA issues`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
