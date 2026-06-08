import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { initServices } from './lib/services/index';
import { initWsServer } from './lib/websocket/ws-server';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3456', 10);

const app = next({ dev, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Use noServer mode so we control which upgrades we handle
  // This prevents the ws library from rejecting Next.js HMR upgrades (/_next/webpack-hmr)
  const rawWss = new WebSocketServer({ noServer: true });

  // Wrap the raw WSS with our WsServer which handles broadcast + client messages
  const appWss = initWsServer(rawWss);

  server.on('upgrade', (req, socket, head) => {
    const pathname = req.url?.split('?')[0] ?? '';

    if (pathname === '/ws') {
      rawWss.handleUpgrade(req, socket, head, (client) => {
        rawWss.emit('connection', client, req);
      });
    }
  });

  // Let Next.js register its own upgrade handler for HMR
  if ((app as unknown as { getUpgradeHandler?: () => Promise<(req: unknown, socket: unknown, head: unknown) => void> }).getUpgradeHandler) {
    const upgradeHandler = await (app as unknown as { getUpgradeHandler: () => Promise<(req: unknown, socket: unknown, head: unknown) => void> }).getUpgradeHandler();
    server.on('upgrade', (req, socket, head) => {
      const pathname = req.url?.split('?')[0] ?? '';
      if (pathname !== '/ws') {
        upgradeHandler(req, socket, head);
      }
    });
  }

  // Expose for globalThis access from API routes
  (globalThis as Record<string, unknown>).__wss = appWss;

  initServices();

  server.listen(port, () => {
    console.log(`> AgentWatch ready on http://localhost:${port}`);
    console.log(`> Mode: ${dev ? 'development' : 'production'}`);
  });
});
