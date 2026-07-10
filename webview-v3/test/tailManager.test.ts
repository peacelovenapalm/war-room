import { describe, expect, it } from 'vitest';

import type { ClientMessage } from '../../core/src/messages.js';
import { TailManager } from '../src/net/tailManager';

function harness() {
  const sent: ClientMessage[] = [];
  const dropped: string[] = [];
  const manager = new TailManager(
    {
      send: (message) => {
        sent.push(message);
      },
    },
    (key) => dropped.push(key),
  );
  return { sent, dropped, manager };
}

describe('TailManager (refcounted subscriptions)', () => {
  it('first acquire subscribes; further acquires are wire-silent', () => {
    const { sent, manager } = harness();
    manager.acquire('agent', '3');
    manager.acquire('agent', '3');
    expect(sent).toEqual([{ type: 'tailSubscribe', source: 'agent', id: '3' }]);
    expect(manager.activeKeys()).toEqual(['agent:3']);
  });

  it('only the LAST release unsubscribes', () => {
    const { sent, manager } = harness();
    manager.acquire('agent', '3');
    manager.acquire('agent', '3');
    expect(manager.release('agent', '3')).toBe(false);
    expect(manager.release('agent', '3')).toBe(true);
    expect(sent).toEqual([
      { type: 'tailSubscribe', source: 'agent', id: '3' },
      { type: 'tailUnsubscribe', source: 'agent', id: '3' },
    ]);
    expect(manager.activeKeys()).toEqual([]);
  });

  it('releasing an unknown stream is a no-op', () => {
    const { sent, manager } = harness();
    expect(manager.release('agent', '9')).toBe(false);
    expect(sent).toEqual([]);
  });

  it('EVICTION: onDropped fires exactly on the LAST release, never before', () => {
    // Regression (panel finding, tailStore.ts:103): dropStream existed but
    // nothing ever called it — the client tail map grew one entry per agent
    // id ever seen. The manager now reports the moment the last surface
    // lets go of a stream so the owner can evict its buffered chunks.
    const { dropped, manager } = harness();
    manager.acquire('agent', '3');
    manager.acquire('agent', '3');
    manager.release('agent', '3');
    expect(dropped).toEqual([]);
    manager.release('agent', '3');
    expect(dropped).toEqual(['agent:3']);
    // Unknown key: no wire message, no drop.
    manager.release('agent', '9');
    expect(dropped).toEqual(['agent:3']);
  });

  it('resubscribes every active stream when the socket comes back LIVE', () => {
    const { sent, manager } = harness();
    manager.acquire('agent', '3');
    manager.acquire('dispatch', 'd-1');
    sent.length = 0;
    manager.handleStatus('offline');
    expect(sent).toEqual([]);
    manager.handleStatus('live');
    expect(sent).toEqual([
      { type: 'tailSubscribe', source: 'agent', id: '3' },
      { type: 'tailSubscribe', source: 'dispatch', id: 'd-1' },
    ]);
  });
});
