import { describe, expect, it } from 'vitest';

import { retainStaticShellPrecacheEntries } from '../pwaPrecache';

describe('PWA precache manifest', () => {
  it('keeps the static shell but defers dynamic-import JavaScript', () => {
    const indexHtml = `
      <script type="module" src="./assets/index-HASH.js"></script>
      <link rel="modulepreload" href="./assets/jsx-runtime-HASH.js">
      <link rel="stylesheet" href="./assets/index-HASH.css">
      <script src="./registerSW.js"></script>
    `;
    const entries = [
      { url: 'index.html', revision: 'html' },
      { url: 'assets/index-HASH.js', revision: null },
      { url: 'assets/jsx-runtime-HASH.js', revision: null },
      { url: 'registerSW.js', revision: 'register' },
      { url: 'assets/index-HASH.css', revision: null },
      { url: 'assets/AgentDrawer-HASH.js', revision: null },
      { url: 'assets/opsProposals-HASH.js', revision: null },
      { url: 'icons/icon-192.png', revision: 'icon' },
    ];

    expect(retainStaticShellPrecacheEntries(entries, indexHtml)).toEqual(
      entries.slice(0, 5).concat(entries[7]),
    );
  });
});
