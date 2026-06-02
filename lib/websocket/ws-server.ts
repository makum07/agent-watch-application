import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { SessionEvent } from '@/types/events';

let wss: WsServer | null = null;

export class WsServer {
  private wsServer: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(server: Server) {
    this.wsServer = new WebSocketServer({ server, path: '/ws' });

    this.wsServer.on('connection', (ws) => {
      this.clients.add(ws);
      ws.send(JSON.stringify({ type: 'ping' }));

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

  get clientCount() {
    return this.clients.size;
  }
}

export function initWsServer(server: Server): WsServer {
  if (!wss) {
    wss = new WsServer(server);
  }
  return wss;
}

export function getWsServer(): WsServer | null {
  return wss;
}
