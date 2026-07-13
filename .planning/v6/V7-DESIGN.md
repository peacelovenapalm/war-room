# V7 DESIGN — the estate starts remembering (MEMORY rung 1)

Drafted 2026-07-12/13 during the v5R→v7 run (RUN-MAP-v5-v7 §4).
Register-locked scope Q8-14; vault write authorization is §0.1 STAGED
FLIP — nothing broader.

## Pre-verified this session

- Vault dual-push: `origin` pushes to BOTH github.com/peacelovenapalm/
  brain2-vault AND ssh://…nexus…:222/gregory/brain2-vault (Gitea).
  Nexus clone 0-behind @ feebbbf. ⚠ nightly-backup artifact freshness
  NOT yet confirmed (visible snapshots dated 2026-03) — MUST re-verify
  before the first staged write (V7-2 hard precondition).
  [RESOLVED 2026-07-13: re-verified SATISFIED — the 2026-03 artifacts
  were the dead DISPATCH-era script; its v2 replacement runs nightly,
  unbroken series through 2026-07-13. Writes ARMED same day; evidence
  in SPRINT-STATE.md deploy-#3 row.]

## V7-1 Post-session distillation

- Trigger: war-room-visible session end (the server already sees
  sessionEnd via hooks / manifest sweep). A distiller job runs per
  ended session: reads the transcript JSONL, produces a small
  structured note (decisions made, facts established, open threads),
  following the `graphify` skill's conventions for note shape/links.
- Skip-tag opt-out (Q9): a session carrying the skip marker (tag in the
  session's first prompt or a `#wr-skip-distill` line anywhere Greg
  types it) is skipped, receipted as skipped.
- HARD DENYLIST ENFORCED IN CODE at the write path (Q14): finances/
  accounts, health/struggles, named private people. Implementation: a
  deny filter module with pattern classes + an LLM-side instruction,
  BUT the code-level filter is authoritative — a note failing the
  filter is quarantined (receipted, not written), never "cleaned up"
  silently. Filter lives at the single write chokepoint so no caller
  can bypass it.

## V7-2 Staged write path (§0.1)

- All writes land in `vault/_inbox/war-room-distill/<date>-<session>.md`
  with frontmatter audit: who (model), when, which session, receipt id.
  Append-only audit ledger beside them.
- Auto-promote to direct in-place vault writes ONLY after 7 consecutive
  days with zero bad writes (bad = denylist violation, malformed
  frontmatter, contradiction-flagged-then-confirmed-wrong, Greg
  revert). Clean-day counter persisted + board-visible; promotion is
  receipted + Bark-announced + instantly revocable back to staged (a
  single flag).
- Push channel: `claude/*` branch per the vault's recorded routines
  boundary (inert `_inbox` reports auto-merge policy) — reuse, not a
  new write mechanism.

## V7-3 Decision receipts + recall

- Distilled decisions carry citable receipts: session id, date,
  verbatim line. Stored in the note frontmatter + a decisions index.
- SEARCH prop answers "what did we decide about X": ANSWER FIRST,
  receipts on tap (Q8) — extend `/api/graph/search` result rendering
  with a decisions lane.
- Staleness decay ◷ (Q11): decisions older than N days without
  reconfirmation render with ◷; contradiction flags when a newer
  distilled decision conflicts (same topic key, different verdict) —
  both surfaced, human arbitrates. Wrong knowledge dies by decay/flag,
  never silent deletion.

## V7-4 Act I exit instrumentation

- Counters (start at zero, existence is the point):
  - surfaces-opened-per-morning (from V6-6 streak data)
  - graph-answered vs re-derived incidents: a tiny `/api/memory/tally`
    endpoint + one-tap attribution on the SEARCH prop ("this answered
    it" / "had to re-derive")
- Rendered in the morning surface footer, honest zeros.
