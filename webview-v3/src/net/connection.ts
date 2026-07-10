/**
 * WebSocket connection to the real war-room server, typed by the core/
 * generated bindings. Same wire protocol and same-origin `/ws` convention
 * as webview-ui's WebSocketTransport (reimplemented here because the
 * frozen fallback workspace is read-only for WS-A), plus a status channel
 * for the HUD chip.
 *
 * Skeleton-first: the caller renders the placeholder world regardless of
 * connection state — OFFLINE changes a labeled chip, never blanks the map.
 */

import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';

export type ConnectionStatus = 'connecting' | 'live' | 'offline';

export interface ServerConnection {
  send(message: ClientMessage): void;
  dispose(): void;
}

export interface ConnectOptions {
  /** Defaults to same-origin `/ws` (how the server hosts the SPA). */
  url?: string;
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
}

const MAX_BACKOFF_MS = 30_000;

export function connectToServer(options: ConnectOptions): ServerConnection {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = options.url ?? `${protocol}//${window.location.host}/ws`;

  let socket: WebSocket | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let pending: ClientMessage[] = [];

  function connect(): void {
    if (disposed) return;
    options.onStatus(reconnectAttempts === 0 ? 'connecting' : 'offline');
    socket = new WebSocket(url);

    socket.onopen = () => {
      if (disposed) return; // dispose() may race a still-CONNECTING socket's late 'open'
      reconnectAttempts = 0;
      options.onStatus('live');
      // The server replies to webviewReady with the full current state
      // (existingAgents et al.) — see server/src/clientMessageHandler.ts.
      const queue: ClientMessage[] = [{ type: 'webviewReady' }, ...pending];
      pending = [];
      for (const message of queue) socket?.send(JSON.stringify(message));
    };

    socket.onmessage = (event: MessageEvent) => {
      try {
        options.onMessage(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        // Malformed frame — ignore.
      }
    };

    socket.onclose = () => {
      if (disposed) return;
      options.onStatus('offline');
      const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_BACKOFF_MS);
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    socket.onerror = () => {
      // onclose fires next and owns the reconnect.
    };
  }

  connect();

  return {
    send(message) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      } else {
        pending.push(message);
      }
    },
    dispose() {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
      pending = [];
    },
  };
}
