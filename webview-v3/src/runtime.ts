/**
 * Runtime flags. Mirrors webview-ui/src/runtime.ts's e2e detection: the
 * Playwright harness sets `__PIXEL_AGENTS_E2E` via addInitScript before any
 * app code runs. Gates test-only observability (window.__warRoomV3TestHooks)
 * so it never runs in a real session.
 */

export const isE2E: boolean =
  typeof window !== 'undefined' &&
  (window as unknown as { __PIXEL_AGENTS_E2E?: boolean }).__PIXEL_AGENTS_E2E === true;
