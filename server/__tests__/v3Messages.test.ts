/**
 * Schema round-trip tests for the v3 Living Studio message types (WS-C
 * stage 1 — KICKOFF-v3.1 §3). The generated bindings in core/src/messages.ts
 * are the contract both the server stores and any client build against;
 * these tests pin:
 *  - each new ServerMessage variant survives a JSON round-trip intact,
 *  - the `type` discriminator narrows each variant (the compile-time
 *    guarantee the webview's switch pattern depends on),
 *  - the one-tap-real fields the hard rules require (sourceTodo verbatim
 *    text, trait earnedFrom refs, feed sourceRef, failureRef excerpt,
 *    rivalry evidence) are REQUIRED at the type level — a missing ref is a
 *    compile error here, not a runtime surprise.
 */

import { describe, expect, it } from 'vitest';

import type {
  ContractsUpdated,
  DossierUpdated,
  MatchDayAxis,
  MatchDayEvent,
  ReworkBinUpdated,
  RivalryUpdated,
  ServerMessage,
} from '../../core/src/messages.js';

/** JSON round-trip through the exact wire representation. */
function roundTrip<T>(msg: T): T {
  return JSON.parse(JSON.stringify(msg)) as T;
}

describe('v3 Living Studio message schemas (round-trip)', () => {
  it('contractsUpdated survives a round-trip with the verbatim sourceTodo intact', () => {
    const msg: ContractsUpdated = {
      type: 'contractsUpdated',
      contract: {
        id: 'c-1',
        sourceTodo: {
          file: '/vault/_inbox/routines/todo/2026-07-10.md',
          line: 12,
          text: '- [ ] **Rotate** the [NEXUS](x) token `now`', // verbatim, markup untouched
        },
        status: 'accepted',
        progress: [{ ts: 1_000, sourceRef: 'dispatch:abc-123', summary: 'first real run landed' }],
        reward: 40,
        acceptedAt: 500,
        quietExpiryAt: 999_999,
      },
    };
    const back = roundTrip(msg);
    expect(back).toEqual(msg);
    // Verbatim rule: the source line is byte-identical after the trip.
    expect(back.contract.sourceTodo.text).toBe(msg.contract.sourceTodo.text);
  });

  it('dossierUpdated keeps trait earnedFrom event refs (one-tap-real)', () => {
    const msg: DossierUpdated = {
      type: 'dossierUpdated',
      dossier: {
        staffId: 'MACBOOK:war-room#1',
        displayName: 'Jordan Vega',
        traits: [
          {
            name: 'Night Owl',
            earnedFrom: ['turn:sess-9@2026-07-09T02:14', 'turn:sess-9@2026-07-10T01:03'],
            earnedAt: 2_000,
          },
        ],
        history: '212 turns across 3 projects since 2026-05.',
        portraitRef: 'portraits/jordan-vega.png',
      },
    };
    const back = roundTrip(msg);
    expect(back).toEqual(msg);
    expect(back.dossier.traits[0].earnedFrom.length).toBeGreaterThan(0);
  });

  it('matchDayEvent round-trips a result card with REAL and NO_DATA axes', () => {
    const realAxis: MatchDayAxis = { status: 'REAL', value: 42, sourceRef: 'chainStep:run-1/s2' };
    const noData: MatchDayAxis = { status: 'NO_DATA' }; // no value, no sourceRef — never guessed
    const msg: MatchDayEvent = {
      type: 'matchDayEvent',
      fixtureId: 'fx-1',
      chainRunId: 'run-1',
      phase: 'result',
      events: [
        {
          ts: 3_000,
          kind: 'step-exited',
          sourceRef: 'chainStep:run-1/s1',
          commentary: 'The build wing clears its first hurdle.',
        },
      ],
      result: { verdict: 'W', tests: realAxis, build: realAxis, scope: noData, burn: noData },
    };
    const back = roundTrip(msg);
    expect(back).toEqual(msg);
    expect(back.result?.scope.value).toBeUndefined();
    expect(back.result?.scope.sourceRef).toBeUndefined();
  });

  it('reworkBinUpdated round-trips a dismissed crate with its verbatim failure excerpt', () => {
    const msg: ReworkBinUpdated = {
      type: 'reworkBinUpdated',
      item: {
        id: 'crate-1',
        source: 'dispatch',
        failureRef: { id: 'dispatch-uuid-7', excerpt: 'Error: ENOENT open /tmp/x\n  exit 1' },
        status: 'dismissed',
        dismissedReason: 'stale worktree, superseded by v3 branch',
        createdAt: 4_000,
        resolvedAt: 5_000,
      },
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('rivalryUpdated round-trips a pair with overlap evidence and the collision warning', () => {
    const msg: RivalryUpdated = {
      type: 'rivalryUpdated',
      pair: {
        staffIds: ['MACBOOK:war-room', 'MACBOOK:war-room-wt-v3-server'],
        kind: 'rivalry',
        evidence: ['both live cwds resolve into /Users/greg/code/war-room (repo overlap)'],
        activeWarning: true,
      },
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('the type discriminator narrows every new variant off the ServerMessage union', () => {
    const messages: ServerMessage[] = [
      {
        type: 'contractsUpdated',
        contract: {
          id: 'c',
          sourceTodo: { file: 'f', line: 1, text: 't' },
          status: 'offered',
          progress: [],
          reward: 10,
          quietExpiryAt: 1,
        },
      },
      {
        type: 'dossierUpdated',
        dossier: { staffId: 's', displayName: 'd', traits: [], history: 'h' },
      },
      { type: 'matchDayEvent', fixtureId: 'f', chainRunId: 'r', phase: 'pre', events: [] },
      {
        type: 'reworkBinUpdated',
        item: {
          id: 'i',
          source: 'crisis',
          failureRef: { id: 'k', excerpt: 'e' },
          status: 'piled',
          createdAt: 1,
        },
      },
      {
        type: 'rivalryUpdated',
        pair: { staffIds: ['a', 'b'], kind: 'bond', evidence: ['x'], activeWarning: false },
      },
    ];

    const seen: string[] = [];
    for (const msg of messages) {
      switch (msg.type) {
        case 'contractsUpdated':
          seen.push(msg.contract.status); // narrowed: .contract exists
          break;
        case 'dossierUpdated':
          seen.push(msg.dossier.staffId);
          break;
        case 'matchDayEvent':
          seen.push(msg.phase);
          break;
        case 'reworkBinUpdated':
          seen.push(msg.item.status);
          break;
        case 'rivalryUpdated':
          seen.push(msg.pair.kind);
          break;
        default:
          break;
      }
    }
    expect(seen).toEqual(['offered', 's', 'pre', 'piled', 'bond']);
  });
});
