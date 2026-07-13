/**
 * PWA app badge (V6-2 NEEDS-YOU count, "app badge if the PWA supports it").
 * Honest degradation: `navigator.setAppBadge`/`clearAppBadge` are called
 * ONLY where they exist (Badging API support varies by browser/install
 * state) — never a fake badge, never a thrown error when unsupported.
 *
 * Injectable navigator-like surface so this is unit-testable without a
 * real browser (mirrors soundscape.ts's KeyValueStorage injection).
 */

export interface BadgeableNavigator {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

export function badgeSupported(nav: BadgeableNavigator | undefined): boolean {
  return typeof nav?.setAppBadge === 'function';
}

/** Sets the badge to `count` (0 clears it — same Badging API semantics).
 *  Never throws: a rejected promise from the browser API is swallowed,
 *  same "best-effort, silently absent" posture as the rest of this
 *  feature. */
export function setAppBadgeCount(nav: BadgeableNavigator | undefined, count: number): void {
  if (!badgeSupported(nav)) return;
  try {
    if (count > 0) {
      void nav?.setAppBadge?.(count)?.catch(() => undefined);
    } else {
      void nav?.clearAppBadge?.()?.catch(() => undefined);
    }
  } catch {
    /* Badging API absent/throwing synchronously in some embedders -- never crash the view */
  }
}

export function clearAppBadge(nav: BadgeableNavigator | undefined): void {
  if (!badgeSupported(nav) || typeof nav?.clearAppBadge !== 'function') return;
  try {
    void nav.clearAppBadge().catch(() => undefined);
  } catch {
    /* see setAppBadgeCount */
  }
}
