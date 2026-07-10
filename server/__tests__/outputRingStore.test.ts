/**
 * Unit tests for the output ring buffer store (KICKOFF-v2.0 Phase 2 slice
 * 2.2 — streaming plane). Pure in-memory store: every test constructs its
 * own instance (often with a tiny byte budget) — no filesystem, no timers,
 * no singleton state shared between tests.
 */

import { describe, expect, it, vi } from 'vitest';

import { OUTPUT_STREAM_BYTE_BUDGET, OutputRingStore } from '../src/outputRingStore.js';

describe('OutputRingStore', () => {
  // ── seq monotonicity ─────────────────────────────────────────────

  it('assigns monotonically increasing seq per (source, id, stream)', () => {
    const store = new OutputRingStore();
    const seqs = ['a', 'b', 'c'].map((c) => store.append('dispatch', 'run-1', 'stdout', c).seq);
    expect(seqs).toEqual([0, 1, 2]);
  });

  it('keeps independent seq counters per stream of the same (source, id)', () => {
    const store = new OutputRingStore();
    expect(store.append('dispatch', 'run-1', 'stdout', 'out-0').seq).toBe(0);
    expect(store.append('dispatch', 'run-1', 'stderr', 'err-0').seq).toBe(0);
    expect(store.append('dispatch', 'run-1', 'stdout', 'out-1').seq).toBe(1);
    expect(store.append('dispatch', 'run-1', 'stderr', 'err-1').seq).toBe(1);
  });

  it('seq keeps increasing across byte-budget eviction (counts appends, not retained chunks)', () => {
    const store = new OutputRingStore(8); // tiny budget: ~2 x 4-byte chunks
    for (let i = 0; i < 5; i++) store.append('dispatch', 'run-1', 'stdout', `c-${i}`);
    const next = store.append('dispatch', 'run-1', 'stdout', 'c-5');
    expect(next.seq).toBe(5);
  });

  // ── byte-budget eviction + truncation flag ───────────────────────

  it('evicts oldest chunks once a stream exceeds its byte budget', () => {
    const store = new OutputRingStore(10);
    store.append('dispatch', 'run-1', 'stdout', 'aaaaa'); // 5 bytes
    store.append('dispatch', 'run-1', 'stdout', 'bbbbb'); // 10 bytes total — fits
    store.append('dispatch', 'run-1', 'stdout', 'ccccc'); // 15 — evicts 'aaaaa'
    const replay = store.replay('dispatch', 'run-1');
    expect(replay.map((c) => c.chunk)).toEqual(['bbbbb', 'ccccc']);
    expect(replay.map((c) => c.seq)).toEqual([1, 2]);
  });

  it('marks the first replayed chunk of a history-lost stream truncated:true', () => {
    const store = new OutputRingStore(10);
    store.append('dispatch', 'run-1', 'stdout', 'aaaaa');
    store.append('dispatch', 'run-1', 'stdout', 'bbbbb');
    expect(store.replay('dispatch', 'run-1').every((c) => !c.truncated)).toBe(true);
    store.append('dispatch', 'run-1', 'stdout', 'ccccc'); // evicts 'aaaaa'
    const replay = store.replay('dispatch', 'run-1');
    expect(replay.map((c) => c.truncated)).toEqual([true, false]);
    // A later subscriber sees the same honest mark (history is still lost).
    const again = store.replay('dispatch', 'run-1');
    expect(again.map((c) => c.truncated)).toEqual([true, false]);
  });

  it('never evicts the just-appended chunk, even when it alone exceeds the budget', () => {
    const store = new OutputRingStore(4);
    store.append('dispatch', 'run-1', 'stdout', 'aa');
    store.append('dispatch', 'run-1', 'stdout', 'oversized-chunk');
    const replay = store.replay('dispatch', 'run-1');
    expect(replay.map((c) => c.chunk)).toEqual(['oversized-chunk']);
    expect(replay[0].truncated).toBe(true);
  });

  it('accounts the budget in UTF-8 bytes, not string length', () => {
    const store = new OutputRingStore(8);
    store.append('dispatch', 'run-1', 'stdout', 'aaaa'); // 4 bytes
    store.append('dispatch', 'run-1', 'stdout', 'éé'); // 2 chars, 4 bytes — fits
    expect(store.replay('dispatch', 'run-1')).toHaveLength(2);
    store.append('dispatch', 'run-1', 'stdout', '€€'); // 2 chars, 6 bytes — evicts
    const replay = store.replay('dispatch', 'run-1');
    expect(replay.length).toBeLessThan(3);
    expect(replay[0].truncated).toBe(true);
  });

  it('live fan-out chunks are never marked truncated (the flag is replay-only)', () => {
    const store = new OutputRingStore(4);
    const seen: boolean[] = [];
    store.onChunk((c) => seen.push(c.truncated));
    store.append('dispatch', 'run-1', 'stdout', 'aaaa');
    store.append('dispatch', 'run-1', 'stdout', 'bbbb'); // evicts 'aaaa'
    expect(seen).toEqual([false, false]);
  });

  // ── replay order ─────────────────────────────────────────────────

  it('replays chunks in append order, interleaved across streams', () => {
    const store = new OutputRingStore();
    store.append('dispatch', 'run-1', 'stdout', 'out-0');
    store.append('dispatch', 'run-1', 'stderr', 'err-0');
    store.append('dispatch', 'run-1', 'stdout', 'out-1');
    expect(store.replay('dispatch', 'run-1').map((c) => c.chunk)).toEqual([
      'out-0',
      'err-0',
      'out-1',
    ]);
  });

  it('replays nothing for an unknown (source, id)', () => {
    const store = new OutputRingStore();
    expect(store.replay('agent', 'nope')).toEqual([]);
  });

  // ── evict on terminal status ─────────────────────────────────────

  it('evict() drops everything retained for that (source, id)', () => {
    const store = new OutputRingStore();
    store.append('dispatch', 'run-1', 'stdout', 'out');
    store.append('dispatch', 'run-1', 'stderr', 'err');
    store.evict('dispatch', 'run-1');
    expect(store.replay('dispatch', 'run-1')).toEqual([]);
  });

  it('evict() only touches its own (source, id) key', () => {
    const store = new OutputRingStore();
    store.append('dispatch', 'run-1', 'stdout', 'gone');
    store.append('dispatch', 'run-2', 'stdout', 'kept');
    store.append('agent', 'run-1', 'transcript', 'kept-too');
    store.evict('dispatch', 'run-1');
    expect(store.replay('dispatch', 'run-2').map((c) => c.chunk)).toEqual(['kept']);
    expect(store.replay('agent', 'run-1').map((c) => c.chunk)).toEqual(['kept-too']);
  });

  // ── independent streams / keys don't interact ────────────────────

  it('one stream blowing its budget never evicts a sibling stream of the same key', () => {
    const store = new OutputRingStore(6);
    store.append('dispatch', 'run-1', 'stderr', 'err-0'); // 5 bytes, under budget
    store.append('dispatch', 'run-1', 'stdout', 'out-00'); // 6 bytes, at budget
    store.append('dispatch', 'run-1', 'stdout', 'out-11'); // stdout over — evicts out-00 only
    const replay = store.replay('dispatch', 'run-1');
    expect(replay.map((c) => c.chunk)).toEqual(['err-0', 'out-11']);
    const stderrChunk = replay.find((c) => c.stream === 'stderr');
    expect(stderrChunk?.truncated).toBe(false); // stderr lost nothing
    expect(replay.find((c) => c.stream === 'stdout')?.truncated).toBe(true);
  });

  it("keys with the same id but different source don't interact", () => {
    const store = new OutputRingStore();
    store.append('dispatch', 'same-id', 'stdout', 'from-dispatch');
    store.append('agent', 'same-id', 'stdout', 'from-agent');
    expect(store.replay('dispatch', 'same-id').map((c) => c.chunk)).toEqual(['from-dispatch']);
    expect(store.replay('agent', 'same-id').map((c) => c.chunk)).toEqual(['from-agent']);
    // seq counters are independent too.
    expect(store.append('dispatch', 'same-id', 'stdout', 'x').seq).toBe(1);
    expect(store.append('agent', 'same-id', 'stdout', 'y').seq).toBe(1);
  });

  // ── fan-out + backpressure hard requirement ──────────────────────

  it('onChunk listeners receive appended chunks and unsubscribe cleanly', () => {
    const store = new OutputRingStore();
    const seen: string[] = [];
    const unsubscribe = store.onChunk((c) => seen.push(c.chunk));
    store.append('dispatch', 'run-1', 'stdout', 'one');
    unsubscribe();
    store.append('dispatch', 'run-1', 'stdout', 'two');
    expect(seen).toEqual(['one']);
  });

  it('a throwing listener never breaks the append path or starves other listeners', () => {
    const store = new OutputRingStore();
    const broken = vi.fn(() => {
      throw new Error('dead socket');
    });
    const healthy = vi.fn();
    store.onChunk(broken);
    store.onChunk(healthy);
    expect(() => store.append('dispatch', 'run-1', 'stdout', 'chunk')).not.toThrow();
    expect(broken).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    // The ring itself is intact — the producer's write really landed.
    expect(store.replay('dispatch', 'run-1').map((c) => c.chunk)).toEqual(['chunk']);
  });

  it('default byte budget is 128KB per stream', () => {
    expect(OUTPUT_STREAM_BYTE_BUDGET).toBe(128 * 1024);
  });
});
