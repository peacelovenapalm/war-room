/**
 * Bark push emitter (v2 mechanic G4 — GAME-DESIGN.md §6.5) — War Room joins
 * Greg's existing notification fabric via a thin POST to the NEXUS Bark
 * wrapper (same transport scripts/nexus-notifier already uses). URL from
 * `WAR_ROOM_BARK_URL`; absent = silently disabled, never a crash path.
 *
 * Two classes, mirroring shiftPush.ts's fire-and-forget/masked-logging
 * posture:
 *   1. Morning digest — at most 1/day (local-date deduped); a second call
 *      the same local day is a silent no-op, never a second push.
 *   2. Big-moment event pushes — a fixed, runtime-enforced class allowlist
 *      (contract completed, employee quit, budget auto-pause, STOP ALL,
 *      chain run failed). Never per-turn, never per-world-event: an
 *      unrecognized class is rejected at runtime, not just by the TS type,
 *      so a stray call site can never silently widen the push surface.
 */

const PUSH_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 2;

export const BIG_MOMENT_CLASSES = [
  'contract-completed',
  'employee-quit',
  'budget-paused',
  'stop-all',
  'chain-failed',
] as const;
export type BigMomentClass = (typeof BIG_MOMENT_CLASSES)[number];

/** KICKOFF v1.1 item 7: the NEXUS Bark wrapper (a FastAPI app) requires JSON
 *  `{task, status, message}` — every push here used to POST raw text/plain,
 *  which the wrapper 422s on (tested live 2026-07-09, TUNING.md). `status`
 *  is mapped per push class; the wrapper turns it into an emoji/level/sound
 *  on the phone side. */
export type BarkStatus = 'info' | 'warning' | 'failure';

const BIG_MOMENT_STATUS: Record<BigMomentClass, BarkStatus> = {
  'contract-completed': 'info',
  'employee-quit': 'warning',
  'budget-paused': 'warning',
  'stop-all': 'warning',
  'chain-failed': 'failure',
};

/** Short, stable source label every push carries as `task` — distinguishes
 *  War Room's pushes from other apps sharing the same Bark wrapper. */
const TASK_LABEL = 'War Room';

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Host-only, for logging — never print a full URL (may carry a token/key). */
export function maskUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return '<invalid-url>';
  }
}

export function getBarkUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.WAR_ROOM_BARK_URL;
  return raw && raw.trim() !== '' ? raw.trim() : undefined;
}

interface BarkPayload {
  task: string;
  status: BarkStatus;
  message: string;
}

async function postOnce(url: string, payload: BarkPayload, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

async function pushWithRetry(url: string, payload: BarkPayload, timeoutMs: number): Promise<void> {
  let lastError: unknown = new Error('unknown error');
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await postOnce(url, payload, timeoutMs);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export interface NotifyBarkOptions {
  /** Override the env-sourced URL (tests). */
  url?: string;
  timeoutMs?: number;
  log?: (line: string) => void;
  now?: number;
}

function push(text: string, status: BarkStatus, options: NotifyBarkOptions): void {
  const url = options.url ?? getBarkUrl();
  if (!url) return; // feature off — zero noise
  const log = options.log ?? ((line: string) => console.log(line));
  const payload: BarkPayload = { task: TASK_LABEL, status, message: text };
  void pushWithRetry(url, payload, options.timeoutMs ?? PUSH_TIMEOUT_MS)
    .then(() => log(`[Pixel Agents] Bark push delivered to ${maskUrlForLog(url)}`))
    .catch((err: unknown) => {
      log(`⚠ [Pixel Agents] Bark push failed for ${maskUrlForLog(url)}: ${String(err)}`);
    });
}

/** Module-level, process-lifetime dedupe (not persisted — a restart resets
 *  it, which is acceptable: worst case is one extra morning digest push
 *  after a rare mid-morning restart, never a crash, never a storm). */
let lastMorningDigestDate: string | null = null;

/** Morning digest — the §2 check-in summary (net Cash/Rep, top events,
 *  warnings). At most 1/day; a second call the same local day is a no-op. */
export function notifyMorningDigest(text: string, options: NotifyBarkOptions = {}): void {
  const now = options.now ?? Date.now();
  const today = localDate(now);
  if (lastMorningDigestDate === today) return;
  lastMorningDigestDate = today;
  push(text, 'info', options);
}

/** Big-moment event push. Rejects (silent no-op, never throws) anything
 *  outside BIG_MOMENT_CLASSES — the runtime class filter, not just a TS
 *  union — so a stray call site can never widen the push surface to
 *  per-turn/per-world-event noise. */
export function notifyBigMoment(
  kind: BigMomentClass,
  text: string,
  options: NotifyBarkOptions = {},
): void {
  if (!(BIG_MOMENT_CLASSES as readonly string[]).includes(kind)) return;
  push(text, BIG_MOMENT_STATUS[kind], options);
}

/** Test-only: reset the morning-digest dedupe state between test cases. */
export function resetNotifyBarkStateForTests(): void {
  lastMorningDigestDate = null;
}

// ── Edge-triggered big-moment notifiers (KICKOFF-v2.0 0.6) ─────────────────
// The last two BIG_MOMENT_CLASSES gain real call sites. Both are factories
// returning stateful handlers so the edge tracking is unit-testable with a
// fake notify fn; httpServer.ts wires them once at process startup, same
// discipline as the contract/chain subscriptions.

/** Human phone-push wording per pause reason (server-side sibling of
 *  webview budget.ts's reason→word map; raw reason as fallback). */
const PAUSE_REASON_WORD: Record<string, string> = {
  'stale-snapshot': 'stale telemetry',
  '5h-threshold': '5h budget threshold',
  '7d-threshold': '7d budget threshold',
  'codex-cap-reached': 'codex cap',
};

/** employee-quit: pushes once per employee's active→quit transition — never
 *  on every snapshot of an already-quit employee (onChange fires for ANY
 *  mutation). A rehire (quit→active, employeeStore.rehire) re-arms the edge.
 *  Reliable only since 5e26214 (v1.1 item 6) made the quit path broadcast. */
export function createEmployeeQuitNotifier(
  notify: typeof notifyBigMoment = notifyBigMoment,
): (emp: { id: string; name: string; status: string }) => void {
  const notified = new Set<string>();
  return (emp) => {
    if (emp.status === 'quit') {
      if (notified.has(emp.id)) return;
      notified.add(emp.id);
      notify('employee-quit', `${emp.name} quit — mood hit bottom.`);
    } else {
      notified.delete(emp.id);
    }
  };
}

/** budget-paused: wraps an isAutomationPaused-shaped gate with an edge —
 *  pushes on the not-paused→paused transition only, i.e. the first time a
 *  pause actually blocks automation (the gate is only consulted when a
 *  chain step or standing-order tick wants to run). Un-pausing re-arms it.
 *  Every paused tick after the first is silent. */
export function createBudgetPauseNotifier<
  Gate extends (...args: never[]) => { paused: boolean; reason?: string },
>(gate: Gate, notify: typeof notifyBigMoment = notifyBigMoment): Gate {
  let wasPaused = false;
  return ((...args: Parameters<Gate>) => {
    const result = gate(...args);
    if (result.paused && !wasPaused) {
      notify(
        'budget-paused',
        `Automation paused — ${PAUSE_REASON_WORD[result.reason ?? ''] ?? result.reason ?? 'budget'}.`,
      );
    }
    wasPaused = result.paused;
    return result;
  }) as Gate;
}
