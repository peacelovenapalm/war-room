import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import * as fs from 'fs';
import * as path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { buildAssetIndex, buildFurnitureCatalog } from '../core/src/assets/build.ts';
import {
  decodeAllCharacters,
  decodeAllFloors,
  decodeAllFurniture,
  decodeAllWalls,
} from '../core/src/assets/loader.ts';
import { THEME_BG_COLOR } from './src/constants.ts';

// ── Decoded asset cache (invalidated on file change) ─────────────────────────

interface DecodedCache {
  characters: ReturnType<typeof decodeAllCharacters> | null;
  floors: ReturnType<typeof decodeAllFloors> | null;
  walls: ReturnType<typeof decodeAllWalls> | null;
  furniture: ReturnType<typeof decodeAllFurniture> | null;
}

// ── Vite plugin ───────────────────────────────────────────────────────────────

function browserMockAssetsPlugin(): Plugin {
  const assetsDir = path.resolve(__dirname, 'public/assets');
  // Default for production builds; configResolved below rewrites this to
  // track the actual build.outDir, so vite build calls that override outDir
  // (e.g. the build-subpath integration test) still receive the JSON sidecars.
  let distAssetsDir = path.resolve(__dirname, '../dist/webview/assets');

  const cache: DecodedCache = { characters: null, floors: null, walls: null, furniture: null };

  function clearCache(): void {
    cache.characters = null;
    cache.floors = null;
    cache.walls = null;
    cache.furniture = null;
  }

  return {
    name: 'browser-mock-assets',
    configResolved(config) {
      distAssetsDir = path.resolve(config.root, config.build.outDir, 'assets');
    },
    configureServer(server) {
      // Strip trailing slash: '/' → '', '/sub/' → '/sub'
      const base = server.config.base.replace(/\/$/, '');

      // Catalog & index (existing)
      server.middlewares.use(`${base}/assets/furniture-catalog.json`, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildFurnitureCatalog(assetsDir)));
      });
      server.middlewares.use(`${base}/assets/asset-index.json`, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildAssetIndex(assetsDir)));
      });

      // Pre-decoded sprites (new — eliminates browser-side PNG decoding)
      server.middlewares.use(`${base}/assets/decoded/characters.json`, (_req, res) => {
        cache.characters ??= decodeAllCharacters(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.characters));
      });
      server.middlewares.use(`${base}/assets/decoded/floors.json`, (_req, res) => {
        cache.floors ??= decodeAllFloors(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.floors));
      });
      server.middlewares.use(`${base}/assets/decoded/walls.json`, (_req, res) => {
        cache.walls ??= decodeAllWalls(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.walls));
      });
      server.middlewares.use(`${base}/assets/decoded/furniture.json`, (_req, res) => {
        cache.furniture ??= decodeAllFurniture(assetsDir, buildFurnitureCatalog(assetsDir));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.furniture));
      });

      // Hot-reload on asset file changes (PNGs, manifests, layouts)
      server.watcher.add(assetsDir);
      server.watcher.on('change', (file) => {
        if (file.startsWith(assetsDir)) {
          console.log(`[browser-mock-assets] Asset changed: ${path.relative(assetsDir, file)}`);
          clearCache();
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
    // Build output includes lightweight metadata consumed by browser runtime.
    closeBundle() {
      fs.mkdirSync(distAssetsDir, { recursive: true });

      const catalog = buildFurnitureCatalog(assetsDir);
      fs.writeFileSync(path.join(distAssetsDir, 'furniture-catalog.json'), JSON.stringify(catalog));
      fs.writeFileSync(
        path.join(distAssetsDir, 'asset-index.json'),
        JSON.stringify(buildAssetIndex(assetsDir)),
      );
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    browserMockAssetsPlugin(),
    // PWA (G6, BUILD-PLAN §G6 task 1): installable, add-to-home-screen on
    // iOS Safari. Icons are TEMP placeholders (public/icons/*-TEMP.png) —
    // G5 Track 2 art generation was deferred (see TUNING.md); swap the
    // manifest icon paths when real art lands, no other change needed.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon-TEMP.png'],
      manifest: {
        name: 'War Room',
        short_name: 'War Room',
        description: 'Pixel-art office dashboard for your Claude Code agents.',
        display: 'standalone',
        background_color: THEME_BG_COLOR,
        theme_color: THEME_BG_COLOR,
        icons: [
          { src: 'icons/icon-192-TEMP.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512-TEMP.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-TEMP.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Real game state lives behind /api/* and the /ws upgrade — a cached
        // response would silently violate the no-fake-real-numbers hard
        // rule (BUILD-PLAN §G6). Explicit NetworkOnly, matched before any
        // broader runtime route, so this can never be shadowed later.
        //
        // /ws needs no rule: the Fetch API (and therefore a service worker's
        // `fetch` event, which is workbox's only interception point) never
        // sees WebSocket upgrade traffic — it is a different wire protocol,
        // not a cacheable HTTP request/response. There is nothing a workbox
        // rule could "leak" through even if misconfigured.
        // workbox's registerRoute defaults to GET only — the server's /api/*
        // surface is GET+POST (verified: `grep -oE "\.(get|post)\('/api"
        // server/src/httpServer.ts` returns no other verbs), so both are
        // listed explicitly rather than relying on the GET default.
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            method: 'GET',
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^\/api\//,
            method: 'POST',
            handler: 'NetworkOnly',
          },
        ],
        // The v3 face lives at /v3/ on the same origin as this (old) face.
        // Without this denylist, generateSW's default navigateFallback
        // serves THIS face's precached index.html for every /v3/
        // navigation on any client this SW already controls — broke real
        // Safari on iPhone + MacBook 2026-07-10 (Chrome was unaffected
        // only because no SW was installed there yet). /api/ is denylisted
        // too so a stale fallback never masks a real backend error.
        // registerType: 'autoUpdate' means one redeploy + reload heals
        // existing clients — no manual unregister needed.
        navigateFallbackDenylist: [/^\/v3/, /^\/api\//],
      },
    }),
  ],
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
  },
  base: './',
});
