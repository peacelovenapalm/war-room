import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * webview-v3 — the V3 "Living Studio" isometric face (KICKOFF-v3.1 WS-A).
 *
 * Deliberately minimal compared to webview-ui/vite.config.ts:
 * - No PWA plugin yet: the service-worker update strategy is a deliberate
 *   decision (MOBILE-FORENSICS constraint 5), not an inherited default.
 * - No mock-asset middleware: v3 assets arrive via the lazy manifest loader
 *   (src/assets/loader.ts) with procedural placeholders until then — never
 *   an eager full-catalog push (MOBILE-FORENSICS constraint 3).
 *
 * Build output stays inside the workspace (webview-v3/dist) so the frozen
 * webview-ui fallback build in dist/webview is never touched.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  base: './',
});
