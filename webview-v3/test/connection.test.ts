import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ConnectionStatus, connectToServer } from '../src/net/connection';

/** Minimal WebSocket double — real browser WebSockets CAN fire a late
 * `onopen` after `.close()` is called while still CONNECTING (some
 * environments don't suppress it), which is exactly the race this test
 * reproduces. `close()` deliberately does NOT auto-fire onclose/onopen —
 * the test drives the events explicitly to control ordering. */
class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }
}

describe('connectToServer — disposed guard', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    (globalThis as { window?: unknown }).window = {
      location: { protocol: 'https:', host: 'test.local' },
    };
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
  });

  it('ignores a late onopen firing after dispose() while the socket was still CONNECTING', () => {
    const statuses: ConnectionStatus[] = [];
    const conn = connectToServer({
      onMessage: () => {},
      onStatus: (status) => statuses.push(status),
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    expect(statuses).toEqual(['connecting']);

    // dispose() while still CONNECTING (mirrors a React effect cleanup /
    // unmount racing the handshake).
    conn.dispose();
    expect(socket.closed).toBe(true);

    // A real (or test-shim) socket implementation can still fire the
    // queued 'open' event after close() was requested. onopen must not
    // report 'live' or attempt to send webviewReady on a torn-down
    // connection.
    socket.onopen?.();

    expect(statuses).toEqual(['connecting']); // no late 'live'
    expect(socket.sent).toEqual([]); // no webviewReady sent post-dispose
  });

  it('still reports live and sends webviewReady on a normal, non-disposed open', () => {
    const statuses: ConnectionStatus[] = [];
    connectToServer({
      onMessage: () => {},
      onStatus: (status) => statuses.push(status),
    });
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    expect(statuses).toEqual(['connecting', 'live']);
    expect(socket.sent).toEqual([JSON.stringify({ type: 'webviewReady' })]);
  });
});
