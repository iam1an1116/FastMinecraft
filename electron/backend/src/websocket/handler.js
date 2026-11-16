import { WebSocketServer } from 'ws';
import { ServerManager } from '../modules/server/ServerManager.js';

let wss;
const subscribers = new Map(); // serverId -> Set<ws>

export function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.isAlive = true;

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'subscribe') {
          const serverId = msg.serverId;
          if (!subscribers.has(serverId)) {
            subscribers.set(serverId, new Set());
          }
          subscribers.get(serverId).add(ws);
          ws.subscriptions = ws.subscriptions || new Set();
          ws.subscriptions.add(serverId);
        } else if (msg.type === 'unsubscribe') {
          const serverId = msg.serverId;
          subscribers.get(serverId)?.delete(ws);
          ws.subscriptions?.delete(serverId);
        } else if (msg.type === 'command') {
          ServerManager.sendCommand(msg.serverId, msg.command);
        }
      } catch {}
    });

    ws.on('close', () => {
      if (ws.subscriptions) {
        for (const serverId of ws.subscriptions) {
          subscribers.get(serverId)?.delete(ws);
        }
      }
    });

    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  // Heartbeat
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
}

export function broadcast(serverId, event, data) {
  const subs = subscribers.get(serverId);
  if (!subs) return;

  const message = JSON.stringify({ event, serverId, data, timestamp: Date.now() });
  for (const ws of subs) {
    if (ws.readyState === 1) {
      ws.send(message);
    }
  }
}
