import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { COLOR_WORLD_BG } from './src/constants';

/** v3 chrome background — matches index.html's theme-color meta and the
 *  CRT base tone in index.css. */
const THEME_BG_COLOR = COLOR_WORLD_BG;

/**
 * webview-v3 — the V3 "Living Studio" isometric face (KICKOFF-v3.1 WS-A).
 *
 * Deliberately minimal compared to webview-ui/vite.config.ts:
 * - No mock-asset middleware: v3 assets arrive via the lazy manifest loader
 *   (src/assets/loader.ts) with procedural placeholders until then — never
 *   an eager full-catalog push (MOBILE-FORENSICS constraint 3).
 *
 * PWA (face-merge T1b, FACE-MERGE-PLAN.md): installable + add-to-home-screen,
 * ported from the old face so v3 can take over root. SW update strategy is
 * the DELIBERATE decision MOBILE-FORENSICS constraint 5 demanded (not an
 * inherited default): immediate activation (skipWaiting + clientsClaim).
 * Rationale: single-operator tailnet dashboard where a runbook deploy must
 * heal every client on its next reload — a prompt-to-reload flow would just
 * be one more tap for the same single user, and the stale-SW hijack class
 * (broke real Safari 2026-07-10) is exactly what immediate activation
 * closes. Icons are the same TEMP placeholders as the old face
 * (public/icons/*-TEMP.png) — swap paths when real art lands.
 *
 * Build output lands in dist/webview-v3 — a SIBLING of the frozen
 * webview-ui fallback build in dist/webview (never touched). The standalone
 * server serves it at /v3/ today; the SW + manifest use relative URLs
 * (base './'), so the same build works unchanged when v3 moves to root
 * (FACE-MERGE-PLAN Tier 3).
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon-TEMP.png'],
      manifest: {
        name: 'War Room',
        short_name: 'War Room',
        description: 'Living Studio dashboard for your Claude Code agents.',
        display: 'standalone',
        // Relative scope/start_url: correct at /v3/ now AND at / after the
        // Tier-3 cutover — the manifest is fetched from the face's own
        // directory, so '.' resolves to wherever this build is mounted.
        scope: '.',
        start_url: '.',
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
        // MOBILE-FORENSICS constraint 5: deliberate immediate activation.
        skipWaiting: true,
        clientsClaim: true,
        // Real state lives behind /api/* — a cached response would silently
        // violate the no-fake-real-numbers hard rule. NetworkOnly for both
        // verbs the server exposes (GET+POST). /ws needs no rule: SW fetch
        // events never see WebSocket upgrade traffic (same analysis as the
        // old face's config).
        runtimeCaching: [
          { urlPattern: /^\/api\//, method: 'GET', handler: 'NetworkOnly' },
          { urlPattern: /^\/api\//, method: 'POST', handler: 'NetworkOnly' },
        ],
        // Never serve this face's index.html for API paths, the old face's
        // grace-period mount (/v1/), OR old /v3 URLs. /v3 MUST be here (P6
        // codex review finding #2): once this SW controls root, Workbox's
        // navigation fallback would otherwise answer /v3/* CLIENT-SIDE with
        // the cached root index.html — the server's 301 never runs, and the
        // document's relative (base './') asset URLs resolve against /v3/
        // where nothing is served → hard app break for exactly the
        // installed-PWA users push deep links target. Denylisted, the
        // navigation passes through to the network, the server 301s home
        // with the query intact, and the SW serves the root normally.
        navigateFallbackDenylist: [/^\/api\//, /^\/v1\//, /^\/v3(?:\/|$|\?)/],
      },
    }),
  ],
  build: {
    outDir: '../dist/webview-v3',
    emptyOutDir: true,
  },
  base: './',
});
