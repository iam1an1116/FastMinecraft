type MessageHandler = (event: string, data: any) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: number | null = null;
  private connected = false;
  private pendingSubscribes: string[] = [];

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const isElectron = window.location.protocol === 'file:';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = isElectron ? 'localhost:3001' : window.location.host;
    const url = `${protocol}//${host}/ws`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connected = true;
      // Subscribe to all pending servers
      for (const serverId of this.pendingSubscribes) {
        this.ws!.send(JSON.stringify({ type: 'subscribe', serverId }));
      }
      this.pendingSubscribes = [];
      // Re-subscribe to all existing handlers
      for (const key of this.handlers.keys()) {
        const serverId = key.split(':')[1];
        if (serverId) {
          this.ws!.send(JSON.stringify({ type: 'subscribe', serverId }));
        }
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const key = `${msg.event}:${msg.serverId}`;
        const handlers = this.handlers.get(key);
        if (handlers) {
          for (const handler of handlers) {
            handler(msg.event, msg.data);
          }
        }
      } catch {}
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.reconnectTimer = window.setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  subscribe(serverId: string, event: string, handler: MessageHandler) {
    const key = `${event}:${serverId}`;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)!.add(handler);

    // Auto-connect if not connected
    if (!this.connected) {
      this.connect();
      if (!this.pendingSubscribes.includes(serverId)) {
        this.pendingSubscribes.push(serverId);
      }
    } else if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', serverId }));
    }
  }

  unsubscribe(serverId: string, event: string, handler: MessageHandler) {
    const key = `${event}:${serverId}`;
    this.handlers.get(key)?.delete(handler);
  }

  sendCommand(serverId: string, command: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'command', serverId, command }));
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
  }
}

export const wsClient = new WebSocketClient();
