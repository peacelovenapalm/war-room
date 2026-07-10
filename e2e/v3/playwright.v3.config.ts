import { defineConfig } from '@playwright/test';
import path from 'path';

/**
 * PERMANENT v3 regression config — KICKOFF-v3.1 hard rule 7 / MOBILE-
 * FORENSICS constraint 4. Runs the DPR-3 WebKit e2e against the BUILT
 * webview-v3 (npm run e2e:v3-dpr builds first). Deliberately separate from
 * e2e/playwright.config.ts: that suite's globalSetup downloads VS Code
 * Electron and its helpers force a 1280x800 viewport, which would clobber
 * the mobile device profile under test (the exact false-pass mechanism the
 * v1.1 fix slipped through on). Modeled on
 * .planning/v2/forensics/playwright.forensics.config.ts — but this one is
 * NOT throwaway: it is the permanent gate for the DPR family of bugs.
 */
export default defineConfig({
  testDir: __dirname,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: path.join(__dirname, '../../test-results/e2e-v3'),
  workers: 1,
  retries: 0,
  projects: [
    {
      // Contexts (viewport + deviceScaleFactor) are created inside the spec
      // so DSF 3 and DSF 1 can be compared against one served build.
      name: 'webkit-v3',
      use: { browserName: 'webkit' },
    },
  ],
});
