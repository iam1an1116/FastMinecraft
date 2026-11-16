import dgram from 'dgram';
import net from 'net';
import os from 'os';
import crypto from 'crypto';

const STUN_SERVERS = [
  { host: 'stun.miwifi.com', port: 3478 },
  { host: 'stun.qq.com', port: 3478 },
  { host: 'stun.chat.bilibili.com', port: 3478 },
];

const MQTT_BROKERS = [
  { host: 'broker.emqx.io', port: 1883 },
  { host: 'broker.hivemq.com', port: 1883 },
];

const PKT_PUNCH = 0x71;
const PKT_PUNCH_ACK = 0x72;
const PKT_PING = 0x73;
const PKT_PONG = 0x74;
const PKT_OPEN = 0x75;
const PKT_DATA = 0x76;
const PKT_CLOSE = 0x77;
const PKT_ACK = 0x78;

function getLocalLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const lower = name.toLowerCase();
    if (lower.includes('virtual') || lower.includes('docker') || lower.includes('tailscale') || lower.includes('utun')) continue;
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function stunQuery(socket, stunHost, stunPort, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const txId = crypto.randomBytes(12);
    const req = Buffer.alloc(20);
    req.writeUInt16BE(0x0001, 0); // Binding Request
    req.writeUInt16BE(0x0000, 2); // Length
    req.writeUInt32BE(0x2112a442, 4); // Magic Cookie
    txId.copy(req, 8);

    let done = false;
    const onMsg = (msg) => {
      if (msg.length < 20) return;
      if (msg.readUInt16BE(0) !== 0x0101) return; // Binding Success Response
      if (!msg.subarray(8, 20).equals(txId)) return;

      let offset = 20;
      while (offset + 4 <= msg.length) {
        const attrType = msg.readUInt16BE(offset);
        const attrLen = msg.readUInt16BE(offset + 2);
        offset += 4;
        if (offset + attrLen > msg.length) break;

        if (attrType === 0x0020 && attrLen >= 8 && msg[offset + 1] === 0x01) {
          // XOR-MAPPED-ADDRESS IPv4
          const port = msg.readUInt16BE(offset + 2) ^ 0x2112;
          const ipBuf = Buffer.alloc(4);
          const cookie = Buffer.from([0x21, 0x12, 0xa4, 0x42]);
          for (let i = 0; i < 4; i++) ipBuf[i] = msg[offset + 4 + i] ^ cookie[i];
          cleanup({ ip: `${ipBuf[0]}.${ipBuf[1]}.${ipBuf[2]}.${ipBuf[3]}`, port });
          return;
        } else if (attrType === 0x0001 && attrLen >= 8 && msg[offset + 1] === 0x01) {
          // MAPPED-ADDRESS IPv4
          const port = msg.readUInt16BE(offset + 2);
          const ip = `${msg[offset + 4]}.${msg[offset + 5]}.${msg[offset + 6]}.${msg[offset + 7]}`;
          cleanup({ ip, port });
          return;
        }
        offset += attrLen + ((4 - (attrLen % 4)) % 4);
      }
    };

    const timer = setTimeout(() => cleanup(null), timeoutMs);
    function cleanup(res) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.removeListener('message', onMsg);
      resolve(res);
    }

    socket.on('message', onMsg);
    socket.send(req, stunPort, stunHost, (err) => {
      if (err) cleanup(null);
    });
  });
}

async function discoverPublicEndpoint(socket) {
  const results = (await Promise.all(
    STUN_SERVERS.map(s => stunQuery(socket, s.host, s.port, 1500))
  )).filter(Boolean);

  if (results.length === 0) return { endpoint: null, natType: 'unknown' };
  const first = results[0];
  let natType = 'cone';
  if (results.length >= 2) {
    natType = results.every(r => r.port === first.port && r.ip === first.ip) ? 'cone' : 'symmetric';
  }
  return { endpoint: first, natType };
}

// Zero-dependency HTTPS pub/sub signaling client via ntfy.sh (works across all firewalls)
class SimpleMqttClient {
  constructor() {
    this.connected = false;
    this.onMessage = null;
    this.pollTimers = [];
    this.seenIds = new Set();
  }

  _safeTopic(topic) {
    return topic.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  async connect() {
    try {
      const resp = await fetch('https://ntfy.sh/v1/health');
      this.connected = resp.ok;
      return resp.ok;
    } catch (_) {
      // Fallback: assume reachable and let publish/subscribe test it
      this.connected = true;
      return true;
    }
  }

  subscribe(topic) {
    const safe = this._safeTopic(topic);
    const poll = async () => {
      if (!this.connected) return;
      try {
        const resp = await fetch(`https://ntfy.sh/${safe}/json?poll=1&since=90s`);
        if (!resp.ok) return;
        const text = await resp.text();
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.event === 'message' && obj.id && !this.seenIds.has(obj.id)) {
              this.seenIds.add(obj.id);
              if (this.onMessage && obj.message) {
                this.onMessage(topic, obj.message);
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    };
    poll();
    const t = setInterval(poll, 900);
    this.pollTimers.push(t);
  }

  async publish(topic, message, _retain = false) {
    if (!this.connected || !message) return;
    const safe = this._safeTopic(topic);
    try {
      await fetch(`https://ntfy.sh/${safe}`, {
        method: 'POST',
        body: message,
      });
    } catch (_) {}
  }

  close() {
    this.connected = false;
    for (const t of this.pollTimers) clearInterval(t);
    this.pollTimers = [];
    this.seenIds.clear();
  }
}

// Reliable framed stream over punched UDP peer
class ReliableUdpBridge {
  constructor(socket, remoteIp, remotePort) {
    this.socket = socket;
    this.remoteIp = remoteIp;
    this.remotePort = remotePort;
    this.streams = new Map(); // connId -> { tcpSocket, nextTxSeq, nextRxSeq, rxBuf: Map, closed }
    this.unacked = new Map(); // key `${connId}:${seq}` -> { pkt, retries, sentAt }
    this.retryTimer = setInterval(() => this._retransmit(), 80);
  }

  _sendRaw(buf) {
    if (!this.socket) return;
    try {
      this.socket.send(buf, this.remotePort, this.remoteIp);
    } catch (_) {}
  }

  _sendControl(type, connId, seq = 0, payload = Buffer.alloc(0)) {
    const hdr = Buffer.alloc(9);
    hdr[0] = type;
    hdr.writeUInt32BE(connId >>> 0, 1);
    hdr.writeUInt32BE(seq >>> 0, 5);
    const pkt = payload.length > 0 ? Buffer.concat([hdr, payload]) : hdr;
    if (type !== PKT_ACK) {
      const key = `${type}:${connId}:${seq}`;
      this.unacked.set(key, { pkt, retries: 0, sentAt: Date.now() });
    }
    this._sendRaw(pkt);
  }

  _retransmit() {
    const now = Date.now();
    for (const [key, item] of this.unacked.entries()) {
      if (now - item.sentAt >= 90) {
        if (item.retries >= 20) {
          this.unacked.delete(key);
          continue;
        }
        item.retries++;
        item.sentAt = now;
        this._sendRaw(item.pkt);
      }
    }
  }

  attachLocalTcp(connId, tcpSocket, sendOpenPacket = false) {
    const state = {
      tcpSocket,
      nextTxSeq: 1,
      nextRxSeq: 1,
      rxBuffer: new Map(),
      closed: false,
    };
    this.streams.set(connId, state);

    if (sendOpenPacket) {
      this._sendControl(PKT_OPEN, connId, 0);
    }

    tcpSocket.on('data', (chunk) => {
      // Split into <= 1150 byte UDP-safe chunks
      let offset = 0;
      while (offset < chunk.length) {
        const slice = chunk.subarray(offset, offset + 1150);
        offset += slice.length;
        const seq = state.nextTxSeq++;
        this._sendControl(PKT_DATA, connId, seq, slice);
      }
    });

    tcpSocket.on('close', () => {
      if (!state.closed) {
        state.closed = true;
        this._sendControl(PKT_CLOSE, connId, 0);
        this.streams.delete(connId);
      }
    });

    tcpSocket.on('error', () => {
      tcpSocket.destroy();
    });
  }

  handlePacket(msg, onOpenRequest) {
    if (msg.length < 9) return;
    const type = msg[0];
    const connId = msg.readUInt32BE(1);
    const seq = msg.readUInt32BE(5);
    const payload = msg.subarray(9);

    if (type === PKT_ACK) {
      const ackedType = payload.length >= 1 ? payload[0] : PKT_DATA;
      this.unacked.delete(`${ackedType}:${connId}:${seq}`);
      return;
    }

    if (type === PKT_OPEN) {
      this._sendControl(PKT_ACK, connId, seq, Buffer.from([PKT_OPEN]));
      if (!this.streams.has(connId) && onOpenRequest) {
        onOpenRequest(connId);
      }
      return;
    }

    if (type === PKT_CLOSE) {
      this._sendControl(PKT_ACK, connId, seq, Buffer.from([PKT_CLOSE]));
      const st = this.streams.get(connId);
      if (st && !st.closed) {
        st.closed = true;
        st.tcpSocket.end();
        this.streams.delete(connId);
      }
      return;
    }

    if (type === PKT_DATA) {
      this._sendControl(PKT_ACK, connId, seq, Buffer.from([PKT_DATA]));
      const st = this.streams.get(connId);
      if (!st || st.closed) return;

      if (seq === st.nextRxSeq) {
        st.tcpSocket.write(payload);
        st.nextRxSeq++;
        while (st.rxBuffer.has(st.nextRxSeq)) {
          const buffered = st.rxBuffer.get(st.nextRxSeq);
          st.rxBuffer.delete(st.nextRxSeq);
          st.tcpSocket.write(buffered);
          st.nextRxSeq++;
        }
      } else if (seq > st.nextRxSeq && !st.rxBuffer.has(seq)) {
        st.rxBuffer.set(seq, payload);
      }
    }
  }

  destroy() {
    clearInterval(this.retryTimer);
    this.unacked.clear();
    for (const st of this.streams.values()) {
      try { st.tcpSocket.destroy(); } catch (_) {}
    }
    this.streams.clear();
  }
}

class P2PManagerClass {
  constructor() {
    this.hostSessions = new Map(); // serverId -> session
    this.playerSession = null;
  }

  _genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return `FM-${s}`;
  }

  async startHost(serverId, gamePort = 25565) {
    this.stopHost(serverId);

    const roomCode = this._genCode();
    const socket = dgram.createSocket('udp4');
    await new Promise((res) => socket.bind(0, '0.0.0.0', res));
    const localUdpPort = socket.address().port;
    const lanIp = getLocalLanIp();

    const session = {
      serverId,
      roomCode,
      gamePort: Number(gamePort) || 25565,
      socket,
      mqtt: new SimpleMqttClient(),
      status: 'stun', // stun -> waiting_peer -> punching -> connected -> error
      natType: 'unknown',
      pubIp: null,
      pubPort: null,
      lanIp,
      localUdpPort,
      peers: new Map(), // `${ip}:${port}` -> { bridge, punchTimer, lastSeen, pingMs }
      error: null,
    };
    this.hostSessions.set(serverId, session);

    socket.on('message', (msg, rinfo) => {
      if (msg.length < 1) return;
      const type = msg[0];
      const peerKey = `${rinfo.address}:${rinfo.port}`;

      if (type === PKT_PUNCH || type === PKT_PUNCH_ACK) {
        const ack = Buffer.alloc(9);
        ack[0] = PKT_PUNCH_ACK;
        if (msg.length >= 9) msg.copy(ack, 1, 1, 9);
        socket.send(ack, rinfo.port, rinfo.address);

        let peer = session.peers.get(peerKey);
        if (!peer) {
          const bridge = new ReliableUdpBridge(socket, rinfo.address, rinfo.port);
          peer = { bridge, lastSeen: Date.now(), pingMs: null };
          session.peers.set(peerKey, peer);
        }
        peer.lastSeen = Date.now();
        session.status = 'connected';
        return;
      }

      if (type === PKT_PING) {
        const pong = Buffer.from(msg);
        pong[0] = PKT_PONG;
        socket.send(pong, rinfo.port, rinfo.address);
        const peer = session.peers.get(peerKey);
        if (peer) peer.lastSeen = Date.now();
        return;
      }

      const peer = session.peers.get(peerKey);
      if (peer) {
        peer.lastSeen = Date.now();
        peer.bridge.handlePacket(msg, (connId) => {
          const tcp = net.connect(session.gamePort, '127.0.0.1');
          peer.bridge.attachLocalTcp(connId, tcp, false);
        });
      }
    });

    // Run STUN + MQTT signaling asynchronously so HTTP returns roomCode promptly
    (async () => {
      try {
        const { endpoint, natType } = await discoverPublicEndpoint(socket);
        if (!this.hostSessions.has(serverId)) return;
        session.natType = natType;
        session.pubIp = endpoint?.ip || lanIp;
        session.pubPort = endpoint?.port || localUdpPort;

        const ok = await session.mqtt.connect();
        if (!ok) {
          session.status = 'error';
          session.error = '无法连接公共信令节点，请检查网络';
          return;
        }

        const hostTopic = `fastmc/p2p/${roomCode}/host`;
        const playerTopic = `fastmc/p2p/${roomCode}/player`;

        session.mqtt.onMessage = (topic, text) => {
          if (topic !== playerTopic) return;
          try {
            const p = JSON.parse(text);
            session.status = 'punching';
            const targets = [];
            if (p.pubIp && p.pubPort) targets.push({ ip: p.pubIp, port: p.pubPort });
            if (p.lanIp && p.localUdpPort) targets.push({ ip: p.lanIp, port: p.localUdpPort });

            const punchPkt = Buffer.alloc(9);
            punchPkt[0] = PKT_PUNCH;
            let count = 0;
            const t = setInterval(() => {
              if (!this.hostSessions.has(serverId) || count++ > 25) {
                clearInterval(t);
                return;
              }
              for (const tgt of targets) {
                try { socket.send(punchPkt, tgt.port, tgt.ip); } catch (_) {}
              }
            }, 150);
          } catch (_) {}
        };

        session.mqtt.subscribe(playerTopic);
        const announce = () => {
          if (!session.mqtt.connected) return;
          session.mqtt.publish(hostTopic, JSON.stringify({
            pubIp: session.pubIp,
            pubPort: session.pubPort,
            lanIp: session.lanIp,
            localUdpPort: session.localUdpPort,
            natType: session.natType,
            gamePort: session.gamePort,
            ts: Date.now(),
          }), true);
        };
        announce();
        session.announceTimer = setInterval(announce, 8000);
        session.status = 'waiting_peer';
      } catch (err) {
        session.status = 'error';
        session.error = err.message;
      }
    })();

    return this.getHostStatus(serverId);
  }

  stopHost(serverId) {
    const s = this.hostSessions.get(serverId);
    if (!s) return { stopped: true };
    this.hostSessions.delete(serverId);
    if (s.announceTimer) clearInterval(s.announceTimer);
    try {
      if (s.mqtt.connected) s.mqtt.publish(`fastmc/p2p/${s.roomCode}/host`, '', true);
      s.mqtt.close();
    } catch (_) {}
    for (const p of s.peers.values()) p.bridge.destroy();
    try { s.socket.close(); } catch (_) {}
    return { stopped: true };
  }

  getHostStatus(serverId) {
    const s = this.hostSessions.get(serverId);
    if (!s) return { active: false, status: 'idle', peersCount: 0 };
    return {
      active: true,
      roomCode: s.roomCode,
      status: s.status,
      natType: s.natType,
      pubIp: s.pubIp,
      pubPort: s.pubPort,
      lanIp: s.lanIp,
      gamePort: s.gamePort,
      peersCount: s.peers.size,
      error: s.error,
    };
  }

  async joinRoom(roomCode, requestedLocalPort = 25565) {
    this.leaveRoom();
    const cleanCode = String(roomCode || '').trim().toUpperCase();
    if (!cleanCode) throw new Error('请输入房间码');

    const socket = dgram.createSocket('udp4');
    await new Promise((res) => socket.bind(0, '0.0.0.0', res));
    const localUdpPort = socket.address().port;
    const lanIp = getLocalLanIp();

    const session = {
      roomCode: cleanCode,
      socket,
      mqtt: new SimpleMqttClient(),
      tcpServer: null,
      bridge: null,
      status: 'stun', // stun -> signaling -> punching -> connected -> error
      natType: 'unknown',
      hostNatType: 'unknown',
      pubIp: null,
      pubPort: null,
      lanIp,
      localUdpPort,
      localAddress: null,
      pingMs: null,
      nextConnId: 1,
      error: null,
    };
    this.playerSession = session;

    const startTcpProxy = async () => {
      if (session.tcpServer) return;
      const srv = net.createServer((tcpSocket) => {
        if (!session.bridge) {
          tcpSocket.destroy();
          return;
        }
        const connId = session.nextConnId++;
        session.bridge.attachLocalTcp(connId, tcpSocket, true);
      });

      await new Promise((resolve) => {
        srv.once('error', () => {
          srv.listen(0, '127.0.0.1', resolve);
        });
        srv.listen(requestedLocalPort, '127.0.0.1', resolve);
      });

      session.tcpServer = srv;
      const addr = srv.address();
      session.localAddress = `127.0.0.1:${addr.port}`;
    };

    socket.on('message', (msg, rinfo) => {
      if (msg.length < 1 || this.playerSession !== session) return;
      const type = msg[0];

      if (type === PKT_PUNCH || type === PKT_PUNCH_ACK) {
        if (msg.length >= 9) {
          const sentTs = msg.readDoubleBE(1);
          if (sentTs > 0 && sentTs < Date.now() + 1000) {
            const rtt = Math.max(1, Math.round(Date.now() - sentTs));
            if (rtt < 5000) session.pingMs = rtt;
          }
        }
        if (type === PKT_PUNCH) {
          const ack = Buffer.from(msg);
          ack[0] = PKT_PUNCH_ACK;
          socket.send(ack, rinfo.port, rinfo.address);
        }

        if (!session.bridge) {
          session.bridge = new ReliableUdpBridge(socket, rinfo.address, rinfo.port);
          session.status = 'connected';
          startTcpProxy();
        }
        return;
      }

      if (type === PKT_PONG && msg.length >= 9) {
        const sentTs = msg.readDoubleBE(1);
        session.pingMs = Math.max(1, Math.round(Date.now() - sentTs));
        return;
      }

      if (session.bridge) {
        session.bridge.handlePacket(msg, null);
      }
    });

    // Run STUN + MQTT + Punching asynchronously
    (async () => {
      try {
        const { endpoint, natType } = await discoverPublicEndpoint(socket);
        if (this.playerSession !== session) return;
        session.natType = natType;
        session.pubIp = endpoint?.ip || lanIp;
        session.pubPort = endpoint?.port || localUdpPort;

        session.status = 'signaling';
        const ok = await session.mqtt.connect();
        if (!ok) {
          session.status = 'error';
          session.error = '无法连接公共信令节点';
          return;
        }

        const hostTopic = `fastmc/p2p/${cleanCode}/host`;
        const playerTopic = `fastmc/p2p/${cleanCode}/player`;

        let punchingStarted = false;
        session.mqtt.onMessage = (topic, text) => {
          if (topic !== hostTopic || !text) return;
          try {
            const h = JSON.parse(text);
            if (!h.pubIp && !h.lanIp) return;
            session.hostNatType = h.natType || 'unknown';
            if (punchingStarted) return;
            punchingStarted = true;
            session.status = 'punching';

            // Publish our info back to host
            session.mqtt.publish(playerTopic, JSON.stringify({
              pubIp: session.pubIp,
              pubPort: session.pubPort,
              lanIp: session.lanIp,
              localUdpPort: session.localUdpPort,
              natType: session.natType,
            }));

            const targets = [];
            if (h.pubIp && h.pubPort) targets.push({ ip: h.pubIp, port: h.pubPort });
            if (h.lanIp && h.localUdpPort) targets.push({ ip: h.lanIp, port: h.localUdpPort });

            let attempts = 0;
            session.punchTimer = setInterval(() => {
              if (this.playerSession !== session || session.status === 'connected') {
                clearInterval(session.punchTimer);
                return;
              }
              if (attempts++ > 45) {
                clearInterval(session.punchTimer);
                if (session.status !== 'connected') {
                  session.status = 'error';
                  session.error = (session.natType === 'symmetric' || session.hostNatType === 'symmetric')
                    ? '双方存在对称型 NAT，纯 P2P 打洞超时'
                    : 'P2P 打洞超时，请确认房主已开启房间';
                }
                return;
              }
              const pkt = Buffer.alloc(9);
              pkt[0] = PKT_PUNCH;
              pkt.writeDoubleBE(Date.now(), 1);
              for (const tgt of targets) {
                try { socket.send(pkt, tgt.port, tgt.ip); } catch (_) {}
              }
            }, 180);

            session.keepaliveTimer = setInterval(() => {
              if (session.bridge && session.status === 'connected') {
                const ping = Buffer.alloc(9);
                ping[0] = PKT_PING;
                ping.writeDoubleBE(Date.now(), 1);
                try { socket.send(ping, session.bridge.remotePort, session.bridge.remoteIp); } catch (_) {}
              }
            }, 4000);
          } catch (_) {}
        };

        session.mqtt.subscribe(hostTopic);

        // If no retained host message within 10s
        setTimeout(() => {
          if (this.playerSession === session && !punchingStarted && session.status === 'signaling') {
            session.status = 'error';
            session.error = `未找到房间 ${cleanCode}，请确认服主已开启 P2P 房间`;
          }
        }, 10000);
      } catch (err) {
        session.status = 'error';
        session.error = err.message;
      }
    })();

    return this.getPlayerStatus();
  }

  leaveRoom() {
    const s = this.playerSession;
    if (!s) return { left: true };
    this.playerSession = null;
    if (s.punchTimer) clearInterval(s.punchTimer);
    if (s.keepaliveTimer) clearInterval(s.keepaliveTimer);
    try { s.mqtt.close(); } catch (_) {}
    if (s.bridge) s.bridge.destroy();
    if (s.tcpServer) try { s.tcpServer.close(); } catch (_) {}
    try { s.socket.close(); } catch (_) {}
    return { left: true };
  }

  getPlayerStatus() {
    const s = this.playerSession;
    if (!s) return { status: 'idle' };
    return {
      status: s.status,
      roomCode: s.roomCode,
      localAddress: s.localAddress,
      pingMs: s.pingMs,
      natType: s.natType,
      hostNatType: s.hostNatType,
      error: s.error,
    };
  }
}

export const P2PManager = new P2PManagerClass();
