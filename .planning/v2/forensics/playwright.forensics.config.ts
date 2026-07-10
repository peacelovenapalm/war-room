import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * THROWAWAY config for KICKOFF-v2.0 Phase 1.1 mobile forensics. Not part of
 * the product e2e suite (e2e/playwright.config.ts) — deliberately has no
 * globalSetup (that config downloads VS Code Electron, irrelevant here) and
 * defines its own device projects so we can run the SAME spec under
 * WebKit+iPhone (the real-device proxy), Chromium+iPhone-emulation (the
 * false-pass baseline Greg's original bug report slipped through), and
 * desktop WebKit (isolate device-emulation-specific issues from generic
 * WebKit issues). Delete this whole directory after Phase 1.1 closes.
 */
export default defineConfig({
  testDir: __dirname,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: path.join(__dirname, 'test-results'),
  workers: 1,
  retries: 0,
  projects: [
    {
      name: 'webkit-iphone14',
      use: { ...devices['iPhone 14'], browserName: 'webkit' },
    },
    {
      name: 'webkit-iphone15pro',
      use: { ...devices['iPhone 15 Pro'], browserName: 'webkit' },
    },
    {
      name: 'webkit-desktop',
      use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chromium-iphone14-emulation',
      use: { ...devices['iPhone 14'], browserName: 'chromium' },
    },
  ],
});
