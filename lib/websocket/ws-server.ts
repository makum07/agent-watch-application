import { WebSocketServer, WebSocket } from 'ws';
import type { SessionEvent, ClientMessage } from '@/types/events';

let instance: WsServer | null = null;

export type ClientMessageHandler = (msg: ClientMessage) => void;

export class WsServer {
  private wsServer: WebSocketServer;
  private clients = new Set<WebSocket>();
  private messageHandlers = new Set<ClientMessageHandler>();

  constructor(wsServer: WebSocketServer) {
    this.wsServer = wsServer;

    this.wsServer.on('connection', (ws) => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'ping' }));

      ws.on('message', (raw) => {
        try {
          const msg: ClientMessage = JSON.parse(raw.toString());
          for (const handler of this.messageHandlers) handler(msg);
        } catch { /* ignore malformed messages */ }
      });

      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
      ws.on('pong', () => { /* keepalive */ });
    });

    setInterval(() => {
      this.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      });
    }, 30_000);
  }

  broadcast(event: SessionEvent) {
    const data = JSON.stringify(event);
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  onClientMessage(handler: ClientMessageHandler) {
    this.messageHandlers.add(handler);
    return () => { this.messageHandlers.delete(handler); };
  }

  get clientCount() {
    return this.clients.size;
  }
}

export function initWsServer(wsServer: WebSocketServer): WsServer {
  if (!instance) {
    instance = new WsServer(wsServer);
  }
  return instance;
}

export function getWsServer(): WsServer | null {
  if (instance) return instance;
  const g = (globalThis as Record<string, unknown>).__wss;
  // Duck-type check: instanceof fails across Turbopack module boundaries
  if (g && typeof (g as WsServer).broadcast === 'function') return g as WsServer;
  return null;
}
