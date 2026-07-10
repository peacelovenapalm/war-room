/**
 * Refcounted tail-subscription manager over the server WS.
 *
 * Multiple surfaces can watch one stream (drawer + pin dock); the FIRST
 * acquire sends tailSubscribe, the LAST release sends tailUnsubscribe.
 * Server-side subscriptions are per-socket (clientMessageHandler.ts keeps
 * one Set per connection), so a reconnect must resubscribe every active
 * stream — handleStatus('live') does exactly that, and the server's ring
 * replay + tailStore's seq dedupe make the overlap harmless.
 */

import type { ClientMessage, OutputSourceValue } from '../../../core/src/messages.js';
import { tailKey } from '../state/tailStore';

export interface TailTransport {
  send(message: ClientMessage): void;
}

interface TailRef {
  source: OutputSourceValue;
  id: string;
  count: number;
}

export class TailManager {
  private readonly refs = new Map<string, TailRef>();
  private readonly transport: TailTransport;
  private readonly onDropped: ((key: string) => void) | undefined;

  /** `onDropped` fires when the LAST surface releases a stream — the owner
   *  evicts that stream's buffered client state (tailStore.dropStream).
   *  Without this hook the tail map grew one entry per agent id ever seen
   *  (panel finding, tailStore.ts:103); a later re-acquire repopulates from
   *  the server's ring replay, so dropping loses nothing durable. */
  constructor(transport: TailTransport, onDropped?: (key: string) => void) {
    this.transport = transport;
    this.onDropped = onDropped;
  }

  /** Returns the stream key. First acquire subscribes on the wire. */
  acquire(source: OutputSourceValue, id: string): string {
    const key = tailKey(source, id);
    const ref = this.refs.get(key);
    if (ref) {
      ref.count += 1;
      return key;
    }
    this.refs.set(key, { source, id, count: 1 });
    this.transport.send({ type: 'tailSubscribe', source, id });
    return key;
  }

  /** Last release unsubscribes on the wire (and reports the drop). Returns
   *  true when it did. */
  release(source: OutputSourceValue, id: string): boolean {
    const key = tailKey(source, id);
    const ref = this.refs.get(key);
    if (!ref) return false;
    ref.count -= 1;
    if (ref.count > 0) return false;
    this.refs.delete(key);
    this.transport.send({ type: 'tailUnsubscribe', source, id });
    this.onDropped?.(key);
    return true;
  }

  /** Reconnect hook: a fresh socket has no server-side subscriptions. */
  handleStatus(status: 'connecting' | 'live' | 'offline'): void {
    if (status !== 'live') return;
    for (const ref of this.refs.values()) {
      this.transport.send({ type: 'tailSubscribe', source: ref.source, id: ref.id });
    }
  }

  activeKeys(): string[] {
    return [...this.refs.keys()];
  }
}
