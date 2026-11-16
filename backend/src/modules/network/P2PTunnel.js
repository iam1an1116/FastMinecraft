import dgram from 'dgram';
import net from 'net';
import os from 'os';
import crypto from 'crypto';

import WebSocket from 'ws';

const STUN_SERVERS = [
  { host: 'stun.miwifi.com', port: 3478 },
  { host: 'stun.qq.com', port: 3478 },
  { host: 'stun.chat.bilibili.com', port: 3478 },
];

const MQTT_WS_ENDPOINTS = [
  'wss://broker.emqx.io:8084/mqtt',
  'ws://broker.emqx.io:8083/mqtt',
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
    if (lower.includes('virtual') || lower.includes('docker') || lower.includes('tailscale') || lower.includes('utun') || lower.includes('loopback')) continue;
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function isPrivateIpv4(ip) {
  if (!ip) return false;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip === '127.0.0.1') return true;
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function roomMagicBuffer(roomCode) {
  return crypto.createHash('sha256').update(`fm-p2p:${roomCode}`).digest().subarray(0, 4);
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
      if (msg.readUInt16BE(0) !== 0x0101) return;
      if (!msg.subarray(8, 20).equals(txId)) return;

      let offset = 20;
      while (offset + 4 <= msg.length) {
        const attrType = msg.readUInt16BE(offset);
        const attrLen = msg.readUInt16BE(offset + 2);
        offset += 4;
        if (offset + attrLen > msg.length) break;

        if (attrType === 0x0020 && attrLen >= 8 && msg[offset + 1] === 0x01) {
          const port = msg.readUInt16BE(offset + 2) ^ 0x2112;
          const ipBuf = Buffer.alloc(4);
          const cookie = Buffer.from([0x21, 0x12, 0xa4, 0x42]);
          for (let i = 0; i < 4; i++) ipBuf[i] = msg[offset + 4 + i] ^ cookie[i];
          cleanup({ ip: `${ipBuf[0]}.${ipBuf[1]}.${ipBuf[2]}.${ipBuf[3]}`, port });
          return;
        } else if (attrType === 0x0001 && attrLen >= 8 && msg[offset + 1] === 0x01) {
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

// Encode MQTT 3.1.1 Remaining Length
function encodeMqttLen(len) {
  const bytes = [];
  do {
    let b = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) b |= 0x80;
    bytes.push(b);
  } while (len > 0);
  return Buffer.from(bytes);
}

function encodeMqttStr(str) {
  const b = Buffer.from(str, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length, 0);
  return Buffer.concat([len, b]);
}

// Zero-dependency MQTT 3.1.1 over WebSocket client (works directly in China & across firewalls)
class NativeMqttWsClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.onMessage = null;
    this.rxBuf = Buffer.alloc(0);
    this.packetId = 1;
    this.pingTimer = null;
  }

  connect() {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        resolve(ok);
      };

      const connectTimer = setTimeout(() => {
        if (!this.connected) {
          try { this.ws?.terminate(); } catch (_) {}
          done(false);
        }
      }, 3500);

      const ws = new WebSocket(this.url, 'mqtt', { handshakeTimeout: 3000 });
      this.ws = ws;

      ws.on('error', () => done(false));

      ws.on('close', () => {
        this.connected = false;
        if (this.pingTimer) clearInterval(this.pingTimer);
        done(false);
      });

      ws.on('open', () => {
        const clientId = `fm_${crypto.randomBytes(5).toString('hex')}`;
        const varHdr = Buffer.from([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c]);
        const payload = encodeMqttStr(clientId);
        const body = Buffer.concat([varHdr, payload]);
        const pkt = Buffer.concat([Buffer.from([0x10]), encodeMqttLen(body.length), body]);
        try { ws.send(pkt); } catch (_) { done(false); }
      });

      ws.on('message', (data) => {
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
        while (this.rxBuf.length >= 2) {
          const byte0 = this.rxBuf[0];
          let mul = 1;
          let remLen = 0;
          let idx = 1;
          let complete = false;
          while (idx < this.rxBuf.length) {
            const encoded = this.rxBuf[idx++];
            remLen += (encoded & 0x7f) * mul;
            if ((encoded & 0x80) === 0) {
              complete = true;
              break;
            }
            mul *= 128;
            if (idx > 4) break;
          }
          if (!complete || this.rxBuf.length < idx + remLen) break;

          const body = this.rxBuf.subarray(idx, idx + remLen);
          this.rxBuf = this.rxBuf.subarray(idx + remLen);
          const pktType = (byte0 >> 4) & 0x0f;

          if (pktType === 2 && body.length >= 2) {
            this.connected = body[1] === 0;
            if (this.connected) {
              this.pingTimer = setInterval(() => {
                if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
                  try { this.ws.send(Buffer.from([0xc0, 0x00])); } catch (_) {}
                }
              }, 25000);
            }
            done(this.connected);
          } else if (pktType === 3 && body.length >= 2) {
            const tLen = body.readUInt16BE(0);
            if (2 + tLen <= body.length) {
              const topic = body.subarray(2, 2 + tLen).toString('utf8');
              const qos = (byte0 >> 1) & 0x03;
              const payloadOffset = 2 + tLen + (qos > 0 ? 2 : 0);
              if (payloadOffset <= body.length) {
                const msgText = body.subarray(payloadOffset).toString('utf8');
                if (this.onMessage && msgText) {
                  this.onMessage(topic, msgText);
                }
              }
            }
          }
        }
      });
    });
  }

  subscribe(topic) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    const pid = this.packetId++;
    const hdr = Buffer.alloc(2);
    hdr.writeUInt16BE(pid, 0);
    const body = Buffer.concat([hdr, encodeMqttStr(topic), Buffer.from([0x00])]);
    const pkt = Buffer.concat([Buffer.from([0x82]), encodeMqttLen(body.length), body]);
    try { this.ws.send(pkt); } catch (_) {}
  }

  publish(topic, message, retain = false) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    const body = Buffer.concat([encodeMqttStr(topic), Buffer.from(message || '', 'utf8')]);
    const flagByte = retain ? 0x31 : 0x30;
    const pkt = Buffer.concat([Buffer.from([flagByte]), encodeMqttLen(body.length), body]);
    try { this.ws.send(pkt); } catch (_) {}
  }

  close() {
    this.connected = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(Buffer.from([0xe0, 0x00]));
        }
        this.ws.terminate();
      } catch (_) {}
      this.ws = null;
    }
  }
}

// Hybrid Signaling Client: MQTT-over-WebSocket (direct China/global) + optional ntfy.sh HTTPS fallback
class HybridSignalingClient {
  constructor() {
    this.connected = false;
    this.onMessage = null;
    this.mqttClients = [];
    this.ntfyEnabled = false;
    this.pollTimers = [];
    this.seenHashes = new Set();
  }

  _safeTopic(topic) {
    return topic.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  _dispatch(topic, msgText) {
    if (!msgText) return;
    const hash = `${topic}:${msgText}`;
    if (this.seenHashes.has(hash)) return;
    this.seenHashes.add(hash);
    if (this.onMessage) this.onMessage(topic, msgText);
  }

  async connect() {
    const mqttAttempt = Promise.all(
      MQTT_WS_ENDPOINTS.map(async (url) => {
        const c = new NativeMqttWsClient(url);
        c.onMessage = (topic, text) => this._dispatch(topic, text);
        const ok = await c.connect();
        if (ok) {
          this.mqttClients.push(c);
          return true;
        }
        c.close();
        return false;
      })
    ).then(res => res.some(Boolean));

    const ntfyAttempt = fetch('https://ntfy.sh/v1/health', {
      signal: AbortSignal.timeout(2500),
    }).then((r) => {
      if (r.ok) {
        this.ntfyEnabled = true;
        return true;
      }
      return false;
    }).catch(() => false);

    // Wait for fast MQTT WebSocket first; don't let blocked ntfy delay connection
    const mqttOk = await mqttAttempt;
    if (mqttOk) {
      this.connected = true;
      return true;
    }

    const ntfyOk = await ntfyAttempt;
    this.connected = ntfyOk || this.mqttClients.length > 0;
    if (!this.connected) {
      // Best-effort fallback
      this.ntfyEnabled = true;
      this.connected = true;
    }
    return this.connected;
  }

  subscribe(topic) {
    for (const c of this.mqttClients) {
      c.subscribe(topic);
    }

    if (!this.ntfyEnabled) return;
    const safe = this._safeTopic(topic);
    const poll = async () => {
      if (!this.connected) return;
      try {
        const resp = await fetch(`https://ntfy.sh/${safe}/json?poll=1&since=90s`, {
          signal: AbortSignal.timeout(2500),
        });
        if (!resp.ok) return;
        const text = await resp.text();
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.event === 'message' && obj.message) {
              this._dispatch(topic, obj.message);
            }
          } catch (_) {}
        }
      } catch (_) {}
    };
    poll();
    const t = setInterval(poll, 1200);
    this.pollTimers.push(t);
  }

  async publish(topic, message, retain = false) {
    if (!this.connected) return;
    for (const c of this.mqttClients) {
      c.publish(topic, message, retain);
    }
    if (this.ntfyEnabled && message) {
      const safe = this._safeTopic(topic);
      fetch(`https://ntfy.sh/${safe}`, {
        method: 'POST',
        body: message,
        signal: AbortSignal.timeout(2500),
      }).catch(() => {});
    }
  }

  close() {
    this.connected = false;
    for (const c of this.mqttClients) c.close();
    this.mqttClients = [];
    for (const t of this.pollTimers) clearInterval(t);
    this.pollTimers = [];
    this.seenHashes.clear();
  }
}

// Reliable framed stream over punched UDP peer with adaptive RTO & sliding window
class ReliableUdpBridge {
  constructor(socket, remoteIp, remotePort) {
    this.socket = socket;
    this.remoteIp = remoteIp;
    this.remotePort = remotePort;
    this.rttMs = 60;
    this.streams = new Map(); // connId -> { tcpSocket, nextTxSeq, nextRxSeq, rxBuffer, inFlight, closed }
    this.unacked = new Map(); // key `${type}:${connId}:${seq}` -> { pkt, connId, retries, sentAt }
    this.retryTimer = setInterval(() => this._retransmit(), 60);
  }

  updateRtt(rtt) {
    if (typeof rtt === 'number' && rtt > 0 && rtt < 5000) {
      this.rttMs = Math.round(this.rttMs * 0.7 + rtt * 0.3);
    }
  }

  updateEndpoint(ip, port) {
    this.remoteIp = ip;
    this.remotePort = port;
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
      this.unacked.set(key, { pkt, connId, retries: 0, sentAt: Date.now() });
    }
    this._sendRaw(pkt);
  }

  _retransmit() {
    const now = Date.now();
    const baseRto = Math.max(160, Math.min(800, Math.round(this.rttMs * 2.5)));
    for (const [key, item] of this.unacked.entries()) {
      const rto = baseRto * (1 + Math.min(3, item.retries >> 2));
      if (now - item.sentAt >= rto) {
        if (item.retries >= 40) {
          this.unacked.delete(key);
          const st = this.streams.get(item.connId);
          if (st && !st.closed) {
            st.closed = true;
            try { st.tcpSocket.destroy(); } catch (_) {}
            this.streams.delete(item.connId);
          }
          continue;
        }
        item.retries++;
        item.sentAt = now;
        this._sendRaw(item.pkt);
      }
    }
  }

  _clearStreamUnacked(connId) {
    for (const [key, item] of this.unacked.entries()) {
      if (item.connId === connId) this.unacked.delete(key);
    }
  }

  attachLocalTcp(connId, tcpSocket, sendOpenPacket = false) {
    const state = {
      tcpSocket,
      nextTxSeq: 1,
      nextRxSeq: 1,
      rxBuffer: new Map(),
      inFlight: 0,
      closed: false,
    };
    this.streams.set(connId, state);

    if (sendOpenPacket) {
      this._sendControl(PKT_OPEN, connId, 0);
    }

    tcpSocket.on('data', (chunk) => {
      if (state.closed) return;
      let offset = 0;
      while (offset < chunk.length) {
        const slice = chunk.subarray(offset, offset + 1150);
        offset += slice.length;
        const seq = state.nextTxSeq++;
        state.inFlight++;
        this._sendControl(PKT_DATA, connId, seq, slice);
      }
      if (state.inFlight >= 64) {
        try { tcpSocket.pause(); } catch (_) {}
      }
    });

    tcpSocket.on('close', () => {
      if (this.streams.get(connId) !== state) return;
      if (!state.closed) {
        state.closed = true;
        this._sendControl(PKT_CLOSE, connId, 0);
        this.streams.delete(connId);
      }
    });

    tcpSocket.on('error', () => {
      try { tcpSocket.destroy(); } catch (_) {}
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
      const key = `${ackedType}:${connId}:${seq}`;
      const entry = this.unacked.get(key);
      if (entry) {
        this.updateRtt(Date.now() - entry.sentAt);
        this.unacked.delete(key);
        if (ackedType === PKT_DATA) {
          const st = this.streams.get(connId);
          if (st && !st.closed) {
            st.inFlight = Math.max(0, st.inFlight - 1);
            if (st.inFlight < 32) {
              try { st.tcpSocket.resume(); } catch (_) {}
            }
          }
        }
      }
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
        try { st.tcpSocket.end(); } catch (_) {}
        this.streams.delete(connId);
        this._clearStreamUnacked(connId);
      }
      return;
    }

    if (type === PKT_DATA) {
      // Handle UDP reordering where initial PKT_DATA arrives before PKT_OPEN
      if (!this.streams.has(connId) && onOpenRequest && seq >= 1 && seq <= 16) {
        onOpenRequest(connId);
      }
      const st = this.streams.get(connId);
      if (!st || st.closed) return;

      this._sendControl(PKT_ACK, connId, seq, Buffer.from([PKT_DATA]));

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
    const magic = roomMagicBuffer(roomCode);
    const socket = dgram.createSocket('udp4');
    await new Promise((res) => socket.bind(0, '0.0.0.0', res));
    const localUdpPort = socket.address().port;
    const lanIp = getLocalLanIp();

    const session = {
      serverId,
      roomCode,
      magic,
      gamePort: Number(gamePort) || 25565,
      socket,
      signaling: new HybridSignalingClient(),
      status: 'stun', // stun -> waiting_peer -> punching -> connected -> error
      natType: 'unknown',
      pubIp: null,
      pubPort: null,
      lanIp,
      localUdpPort,
      peers: new Map(), // `${ip}:${port}` -> { bridge, lastSeen }
      pruneTimer: null,
      announceTimer: null,
      lastConnectError: null,
      error: null,
    };
    this.hostSessions.set(serverId, session);

    session.pruneTimer = setInterval(() => {
      const cutoff = Date.now() - 90000;
      for (const [k, p] of session.peers.entries()) {
        if (p.lastSeen < cutoff) {
          p.bridge.destroy();
          session.peers.delete(k);
        }
      }
    }, 30000);

    socket.on('message', (msg, rinfo) => {
      if (msg.length < 1) return;
      const type = msg[0];
      const peerKey = `${rinfo.address}:${rinfo.port}`;

      if (type === PKT_PUNCH || type === PKT_PUNCH_ACK) {
        if (msg.length >= 13 && !msg.subarray(9, 13).equals(session.magic)) return;
        const ack = Buffer.alloc(13);
        ack[0] = PKT_PUNCH_ACK;
        if (msg.length >= 9) msg.copy(ack, 1, 1, 9);
        session.magic.copy(ack, 9);
        socket.send(ack, rinfo.port, rinfo.address);

        let peer = session.peers.get(peerKey);
        if (!peer) {
          const bridge = new ReliableUdpBridge(socket, rinfo.address, rinfo.port);
          peer = { bridge, lastSeen: Date.now() };
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

      let peer = session.peers.get(peerKey);
      if (!peer && (type === PKT_OPEN || type === PKT_DATA || type === PKT_CLOSE)) {
        const bridge = new ReliableUdpBridge(socket, rinfo.address, rinfo.port);
        peer = { bridge, lastSeen: Date.now() };
        session.peers.set(peerKey, peer);
        session.status = 'connected';
      }
      if (peer) {
        peer.lastSeen = Date.now();
        peer.bridge.handlePacket(msg, (connId) => {
          const tcp = net.connect({
            port: session.gamePort,
            host: 'localhost',
            autoSelectFamily: true,
          });
          tcp.on('error', (err) => {
            session.lastConnectError = `本地 ${session.gamePort} 端口不可达 (${err.code || err.message})`;
          });
          peer.bridge.attachLocalTcp(connId, tcp, false);
        });
      }
    });

    (async () => {
      try {
        const { endpoint, natType } = await discoverPublicEndpoint(socket);
        if (!this.hostSessions.has(serverId)) return;
        session.natType = natType;
        session.pubIp = endpoint?.ip || lanIp;
        session.pubPort = endpoint?.port || localUdpPort;

        await session.signaling.connect();

        const hostTopic = `fastmc/p2p/${roomCode}/host`;
        const playerTopic = `fastmc/p2p/${roomCode}/player`;

        session.signaling.onMessage = (topic, text) => {
          if (topic !== playerTopic) return;
          try {
            const p = JSON.parse(text);
            session.status = 'punching';
            const targets = [];
            if (p.lanIp && p.localUdpPort) targets.push({ ip: p.lanIp, port: p.localUdpPort });
            if (p.pubIp && p.pubPort && (p.pubIp !== p.lanIp || p.pubPort !== p.localUdpPort)) {
              targets.push({ ip: p.pubIp, port: p.pubPort });
            }

            const punchPkt = Buffer.alloc(13);
            punchPkt[0] = PKT_PUNCH;
            session.magic.copy(punchPkt, 9);
            let count = 0;
            const t = setInterval(() => {
              if (!this.hostSessions.has(serverId) || count++ > 30) {
                clearInterval(t);
                return;
              }
              for (const tgt of targets) {
                try { socket.send(punchPkt, tgt.port, tgt.ip); } catch (_) {}
              }
            }, 140);
          } catch (_) {}
        };

        session.signaling.subscribe(playerTopic);
        const announce = () => {
          if (!session.signaling.connected) return;
          session.signaling.publish(hostTopic, JSON.stringify({
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
    if (s.pruneTimer) clearInterval(s.pruneTimer);
    try {
      if (s.signaling.connected) s.signaling.publish(`fastmc/p2p/${s.roomCode}/host`, '', true);
      s.signaling.close();
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
      error: s.error || s.lastConnectError || null,
    };
  }

  async joinRoom(roomCode, requestedLocalPort = 25565) {
    this.leaveRoom();
    const cleanCode = String(roomCode || '').trim().toUpperCase();
    if (!cleanCode) throw new Error('请输入房间码');

    const magic = roomMagicBuffer(cleanCode);
    const socket = dgram.createSocket('udp4');
    await new Promise((res) => socket.bind(0, '0.0.0.0', res));
    const localUdpPort = socket.address().port;
    const lanIp = getLocalLanIp();

    const session = {
      roomCode: cleanCode,
      magic,
      socket,
      signaling: new HybridSignalingClient(),
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

    let proxyStarting = false;
    const startTcpProxy = async () => {
      if (session.tcpServer || proxyStarting) return;
      proxyStarting = true;
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
      session.status = 'connected';
    };

    socket.on('message', (msg, rinfo) => {
      if (msg.length < 1 || this.playerSession !== session) return;
      const type = msg[0];

      if (type === PKT_PUNCH || type === PKT_PUNCH_ACK) {
        if (msg.length >= 13 && !msg.subarray(9, 13).equals(session.magic)) return;
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
          if (session.pingMs) session.bridge.updateRtt(session.pingMs);
          startTcpProxy();
        } else if (isPrivateIpv4(rinfo.address) && !isPrivateIpv4(session.bridge.remoteIp)) {
          // Upgrade to direct LAN path when both public & LAN hole punch succeed
          session.bridge.updateEndpoint(rinfo.address, rinfo.port);
        }
        return;
      }

      if (type === PKT_PONG && msg.length >= 9) {
        const sentTs = msg.readDoubleBE(1);
        const rtt = Math.max(1, Math.round(Date.now() - sentTs));
        session.pingMs = rtt;
        if (session.bridge) session.bridge.updateRtt(rtt);
        return;
      }

      if (session.bridge) {
        session.bridge.handlePacket(msg, null);
      }
    });

    (async () => {
      try {
        const { endpoint, natType } = await discoverPublicEndpoint(socket);
        if (this.playerSession !== session) return;
        session.natType = natType;
        session.pubIp = endpoint?.ip || lanIp;
        session.pubPort = endpoint?.port || localUdpPort;

        session.status = 'signaling';
        await session.signaling.connect();

        const hostTopic = `fastmc/p2p/${cleanCode}/host`;
        const playerTopic = `fastmc/p2p/${cleanCode}/player`;

        let punchingStarted = false;
        session.signaling.onMessage = (topic, text) => {
          if (topic !== hostTopic || !text) return;
          try {
            const h = JSON.parse(text);
            if (!h.pubIp && !h.lanIp) return;
            session.hostNatType = h.natType || 'unknown';
            if (punchingStarted) return;
            punchingStarted = true;
            session.status = 'punching';

            session.signaling.publish(playerTopic, JSON.stringify({
              pubIp: session.pubIp,
              pubPort: session.pubPort,
              lanIp: session.lanIp,
              localUdpPort: session.localUdpPort,
              natType: session.natType,
            }));

            const targets = [];
            if (h.lanIp && h.localUdpPort) targets.push({ ip: h.lanIp, port: h.localUdpPort });
            if (h.pubIp && h.pubPort && (h.pubIp !== h.lanIp || h.pubPort !== h.localUdpPort)) {
              targets.push({ ip: h.pubIp, port: h.pubPort });
            }

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
              const pkt = Buffer.alloc(13);
              pkt[0] = PKT_PUNCH;
              pkt.writeDoubleBE(Date.now(), 1);
              session.magic.copy(pkt, 9);
              for (const tgt of targets) {
                try { socket.send(pkt, tgt.port, tgt.ip); } catch (_) {}
              }
            }, 160);

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

        session.signaling.subscribe(hostTopic);

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
    try { s.signaling.close(); } catch (_) {}
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
