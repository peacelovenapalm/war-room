import { describe, expect, it } from 'vitest';

import type { ClientMessage } from '../../core/src/messages.js';
import { TailManager } from '../src/net/tailManager';

function harness() {
  const sent: ClientMessage[] = [];
  const manager = new TailManager({
    send: (message) => {
      sent.push(message);
    },
  });
  return { sent, manager };
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
