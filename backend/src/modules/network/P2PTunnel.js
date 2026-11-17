import dgram from 'dgram';
import net from 'net';
import os from 'os';
import crypto from 'crypto';
import WebSocket from 'ws';

const VPS_RELAY_URL = process.env.FM_RELAY_URL || 'wss://www.zhouzi.ink/fm-p2p';

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

const PORT_PREDICT_OFFSETS = [
  1, -1, 2, -2, 3, 4, 5, -3, -4, 6, 7, 8, -5, 9, 10, 11, 12, -6, 13, 14, 15, 16,
];

function getLocalLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const lower = name.toLowerCase();
    if (
      lower.includes('virtual') ||
      lower.includes('docker') ||
      lower.includes('tailscale') ||
      lower.includes('utun') ||
      lower.includes('loopback')
    ) {
      continue;
    }
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

// Build UDP punch targets with symmetric-NAT port prediction fan-out
function buildPunchTargets(peerInfo, selfNatType) {
  const targets = [];
  const seen = new Set();
  const push = (ip, port) => {
    const p = Number(port);
    if (!ip || !Number.isInteger(p) || p < 1 || p > 65535) return;
    const key = `${ip}:${p}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ ip, port: p });
  };

  if (peerInfo.lanIp && peerInfo.localUdpPort) {
    push(peerInfo.lanIp, peerInfo.localUdpPort);
  }
  if (peerInfo.pubIp && peerInfo.pubPort) {
    push(peerInfo.pubIp, peerInfo.pubPort);
    if (peerInfo.natType === 'symmetric' || selfNatType === 'symmetric') {
      const base = Number(peerInfo.pubPort);
      for (const off of PORT_PREDICT_OFFSETS) {
        push(peerInfo.pubIp, base + off);
      }
    }
  }
  return targets;
}

function stunQuery(socket, stunHost, stunPort, timeoutMs = 1300) {
  return new Promise((resolve) => {
    const txId = crypto.randomBytes(12);
    const req = Buffer.alloc(20);
    req.writeUInt16BE(0x0001, 0);
    req.writeUInt16BE(0x0000, 2);
    req.writeUInt32BE(0x2112a442, 4);
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
    STUN_SERVERS.map(s => stunQuery(socket, s.host, s.port, 1300))
  )).filter(Boolean);

  if (results.length === 0) return { endpoint: null, natType: 'unknown' };
  const first = results[0];
  let natType = 'cone';
  if (results.length >= 2) {
    natType = results.every(r => r.port === first.port && r.ip === first.ip) ? 'cone' : 'symmetric';
  }
  return { endpoint: first, natType };
}

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
      }, 2800);

      const ws = new WebSocket(this.url, 'mqtt', { handshakeTimeout: 2500 });
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

// Secondary MQTT signaling client (fallback when VPS is unreachable)
class FallbackMqttSignaling {
  constructor() {
    this.connected = false;
    this.onMessage = null;
    this.clients = [];
    this.seenHashes = new Set();
  }

  _dispatch(topic, msgText) {
    if (!msgText) return;
    const hash = `${topic}:${msgText}`;
    if (this.seenHashes.has(hash)) return;
    this.seenHashes.add(hash);
    if (this.onMessage) this.onMessage(topic, msgText);
  }

  async connect() {
    // Race fastest EMQX endpoint without blocking on slower ones
    const attempts = MQTT_WS_ENDPOINTS.map(async (url) => {
      const c = new NativeMqttWsClient(url);
      c.onMessage = (topic, text) => this._dispatch(topic, text);
      const ok = await c.connect();
      if (ok) {
        this.clients.push(c);
        return true;
      }
      c.close();
      return false;
    });
    try {
      await Promise.any(attempts.map((p) => p.then((ok) => (ok ? true : Promise.reject()))));
      this.connected = true;
      return true;
    } catch (_) {
      this.connected = this.clients.length > 0;
      return this.connected;
    }
  }

  subscribe(topic) {
    for (const c of this.clients) c.subscribe(topic);
  }

  publish(topic, message, retain = false) {
    for (const c of this.clients) c.publish(topic, message, retain);
  }

  close() {
    this.connected = false;
    for (const c of this.clients) c.close();
    this.clients = [];
    this.seenHashes.clear();
  }
}

// Private VPS WebSocket client (handles fast signaling + Symmetric NAT relay)
class VpsRelayClient {
  constructor(url = VPS_RELAY_URL) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.onJson = null;
    this.onBinary = null;
    this.onClose = null;
  }

  connect() {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        if (!this.connected) {
          try { this.ws?.terminate(); } catch (_) {}
          done(false);
        }
      }, 3500);

      const ws = new WebSocket(this.url, { handshakeTimeout: 3000 });
      this.ws = ws;

      ws.on('open', () => {
        this.connected = true;
        done(true);
      });

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          if (this.onBinary) this.onBinary(buf);
          return;
        }
        try {
          const obj = JSON.parse(data.toString('utf8'));
          if (this.onJson) this.onJson(obj);
        } catch (_) {}
      });

      ws.on('error', () => done(false));
      ws.on('close', () => {
        this.connected = false;
        done(false);
        if (this.onClose) this.onClose();
      });
    });
  }

  bufferedAmount() {
    return this.ws?.bufferedAmount || 0;
  }

  sendJson(obj) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(obj));
      return true;
    } catch (_) {
      return false;
    }
  }

  sendBinary(dir, peerNum, connId, payload) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return false;
    const pkt = Buffer.allocUnsafe(9 + payload.length);
    pkt[0] = dir;
    pkt.writeUInt32BE(peerNum >>> 0, 1);
    pkt.writeUInt32BE(connId >>> 0, 5);
    payload.copy(pkt, 9);
    try {
      this.ws.send(pkt, { binary: true });
      return true;
    } catch (_) {
      return false;
    }
  }

  close() {
    this.connected = false;
    if (this.ws) {
      try { this.ws.terminate(); } catch (_) {}
      this.ws = null;
    }
  }
}

function getLocalConnectHosts(lanIp) {
  const hosts = ['127.0.0.1', '::1'];
  if (lanIp && lanIp !== '127.0.0.1' && lanIp !== '0.0.0.0') {
    hosts.push(lanIp);
  }
  return hosts;
}

function probeLocalPort(port, lanIp = null) {
  const hosts = getLocalConnectHosts(lanIp);
  return new Promise((resolve) => {
    let idx = 0;
    const tryNext = () => {
      if (idx >= hosts.length) {
        resolve(false);
        return;
      }
      const host = hosts[idx++];
      let settled = false;
      const sock = net.connect({ host, port });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch (_) {}
        tryNext();
      }, 280);
      sock.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { sock.destroy(); } catch (_) {}
        resolve(true);
      });
      sock.once('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { sock.destroy(); } catch (_) {}
        tryNext();
      });
    };
    tryNext();
  });
}

// Connects reliably to a local Minecraft server across 127.0.0.1 -> ::1 -> LAN IP
// while buffering any early incoming chunks until the winning socket connects.
function connectToLocalGamePort(port, lanIp, callbacks = {}) {
  const hosts = getLocalConnectHosts(lanIp);
  let targetIdx = 0;
  let activeSock = null;
  let connected = false;
  let destroyed = false;
  let endedByCaller = false;
  const pendingWrites = [];
  const listeners = { data: [], close: [], error: [] };

  const emit = (evt, a, b) => {
    for (const fn of listeners[evt]) {
      try { fn(a, b); } catch (_) {}
    }
  };

  const flushPending = () => {
    while (pendingWrites.length > 0 && activeSock && !activeSock.destroyed) {
      const chunk = pendingWrites.shift();
      activeSock.write(chunk);
    }
    if (endedByCaller && activeSock && !activeSock.destroyed) {
      try { activeSock.end(); } catch (_) {}
    }
  };

  const attemptNext = (lastErr) => {
    if (destroyed) return;
    if (targetIdx >= hosts.length) {
      destroyed = true;
      pendingWrites.length = 0;
      const err = lastErr || new Error('ECONNREFUSED');
      if (callbacks.onError) callbacks.onError(err, false);
      emit('error', err, false);
      if (callbacks.onClose) callbacks.onClose();
      emit('close');
      return;
    }

    const host = hosts[targetIdx++];
    const sock = net.connect({ host, port });
    activeSock = sock;
    let attemptSettled = false;

    const connectTimer = setTimeout(() => {
      if (!attemptSettled && !connected) {
        attemptSettled = true;
        try { sock.destroy(); } catch (_) {}
        attemptNext(new Error('ETIMEDOUT'));
      }
    }, 1500);

    sock.once('connect', () => {
      clearTimeout(connectTimer);
      if (destroyed) {
        try { sock.destroy(); } catch (_) {}
        return;
      }
      attemptSettled = true;
      connected = true;
      try { sock.setNoDelay(true); } catch (_) {}
      flushPending();
      if (callbacks.onConnect) callbacks.onConnect();
    });

    sock.on('data', (chunk) => {
      if (!destroyed && connected) {
        if (callbacks.onData) callbacks.onData(chunk);
        emit('data', chunk);
      }
    });

    sock.on('close', () => {
      clearTimeout(connectTimer);
      if (!connected) {
        if (!attemptSettled) {
          attemptSettled = true;
          attemptNext(lastErr);
        }
        return;
      }
      if (!destroyed) {
        destroyed = true;
        if (callbacks.onClose) callbacks.onClose();
        emit('close');
      }
    });

    sock.on('error', (err) => {
      clearTimeout(connectTimer);
      if (!connected) {
        if (!attemptSettled) {
          attemptSettled = true;
          try { sock.destroy(); } catch (_) {}
          attemptNext(err);
        }
        return;
      }
      if (!destroyed) {
        destroyed = true;
        if (callbacks.onError) callbacks.onError(err, true);
        emit('error', err, true);
      }
    });
  };

  attemptNext(null);

  return {
    get connected() {
      return connected;
    },
    get destroyed() {
      return destroyed;
    },
    on(evt, fn) {
      if (listeners[evt]) listeners[evt].push(fn);
      return this;
    },
    setNoDelay() {},
    write(buf) {
      if (destroyed) return false;
      if (!connected || !activeSock || activeSock.destroyed) {
        pendingWrites.push(Buffer.from(buf));
        return true;
      }
      return activeSock.write(buf);
    },
    pause() {
      if (activeSock && !activeSock.destroyed) {
        try { activeSock.pause(); } catch (_) {}
      }
    },
    resume() {
      if (activeSock && !activeSock.destroyed) {
        try { activeSock.resume(); } catch (_) {}
      }
    },
    end() {
      endedByCaller = true;
      if (connected && activeSock && !activeSock.destroyed) {
        try { activeSock.end(); } catch (_) {}
      }
    },
    destroy() {
      destroyed = true;
      pendingWrites.length = 0;
      if (activeSock) {
        try { activeSock.destroy(); } catch (_) {}
      }
    },
  };
}

// Reliable framed stream over punched UDP peer with adaptive RTO & sliding window
class ReliableUdpBridge {
  constructor(socket, remoteIp, remotePort) {
    this.socket = socket;
    this.remoteIp = remoteIp;
    this.remotePort = remotePort;
    this.rttMs = 60;
    this.streams = new Map();
    this.unacked = new Map();
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
    try { tcpSocket.setNoDelay?.(true); } catch (_) {}
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
    this.hostSessions = new Map();
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
      vps: new VpsRelayClient(),
      fallbackMqtt: new FallbackMqttSignaling(),
      status: 'stun',
      transport: 'p2p', // 'p2p' | 'relay'
      natType: 'unknown',
      pubIp: lanIp,
      pubPort: localUdpPort,
      lanIp,
      localUdpPort,
      portListening: null,
      peers: new Map(), // `${ip}:${port}` -> { bridge, lastSeen }
      relayStreams: new Map(), // `${peerNum}:${connId}` -> tcpWrapper
      closedRelayStreams: new Map(), // `${peerNum}:${connId}` -> expireTs
      relayPeers: new Set(),
      pruneTimer: null,
      portProbeTimer: null,
      announceTimer: null,
      vpsReconnectTimer: null,
      destroyed: false,
      lastConnectError: null,
      error: null,
    };
    this.hostSessions.set(serverId, session);

    const refreshPortProbe = async () => {
      if (session.destroyed || this.hostSessions.get(serverId) !== session) return;
      const ok = await probeLocalPort(session.gamePort, session.lanIp);
      if (session.destroyed || this.hostSessions.get(serverId) !== session) return;
      session.portListening = ok;
      if (ok && session.lastConnectError) {
        session.lastConnectError = null;
      }
    };
    refreshPortProbe();
    session.portProbeTimer = setInterval(refreshPortProbe, 2500);

    session.pruneTimer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - 90000;
      for (const [k, p] of session.peers.entries()) {
        if (p.lastSeen < cutoff) {
          p.bridge.destroy();
          session.peers.delete(k);
        }
      }
      for (const [k, exp] of session.closedRelayStreams.entries()) {
        if (exp <= now) session.closedRelayStreams.delete(k);
      }
    }, 5000);

    const launchPunchBurst = (p) => {
      if (!this.hostSessions.has(serverId)) return;
      if (session.status !== 'connected') session.status = 'punching';
      const targets = buildPunchTargets(p, session.natType);
      const punchPkt = Buffer.alloc(13);
      punchPkt[0] = PKT_PUNCH;
      session.magic.copy(punchPkt, 9);
      let count = 0;
      const t = setInterval(() => {
        if (!this.hostSessions.has(serverId) || count++ > 28) {
          clearInterval(t);
          return;
        }
        for (const tgt of targets) {
          try { socket.send(punchPkt, tgt.port, tgt.ip); } catch (_) {}
        }
      }, 150);
    };

    const openRelayStream = (peerNum, connId) => {
      const streamKey = `${peerNum}:${connId}`;
      if (session.relayStreams.has(streamKey) || session.closedRelayStreams.has(streamKey)) {
        return session.relayStreams.get(streamKey) || null;
      }
      session.relayPeers.add(peerNum);
      session.transport = 'relay';
      session.status = 'connected';

      let backpressureTimer = null;
      const tcp = connectToLocalGamePort(session.gamePort, session.lanIp, {
        onConnect: () => {
          session.lastConnectError = null;
          session.portListening = true;
        },
        onData: (chunk) => {
          let off = 0;
          while (off < chunk.length) {
            const slice = chunk.subarray(off, off + 16384);
            off += slice.length;
            session.vps.sendBinary(2, peerNum, connId, slice);
          }
          if (session.vps.bufferedAmount() > 512 * 1024 && !backpressureTimer) {
            tcp.pause();
            backpressureTimer = setInterval(() => {
              if (tcp.destroyed || session.destroyed) {
                clearInterval(backpressureTimer);
                backpressureTimer = null;
                return;
              }
              if (session.vps.bufferedAmount() < 128 * 1024) {
                clearInterval(backpressureTimer);
                backpressureTimer = null;
                tcp.resume();
              }
            }, 30);
          }
        },
        onClose: () => {
          if (backpressureTimer) {
            clearInterval(backpressureTimer);
            backpressureTimer = null;
          }
          if (session.relayStreams.get(streamKey) === tcp) {
            session.relayStreams.delete(streamKey);
            session.closedRelayStreams.set(streamKey, Date.now() + 5000);
            session.vps.sendJson({ type: 'relay_close', roomCode, peerNum, connId });
          }
        },
        onError: (err, wasConnected) => {
          if (!wasConnected) {
            const msgText = `无法连接房主本地 MC 端口 ${session.gamePort} (${err.code || err.message})，请确认 MC 服务器已启动`;
            session.lastConnectError = msgText;
            session.portListening = false;
            session.vps.sendJson({
              type: 'relay_error',
              roomCode,
              peerNum,
              connId,
              error: msgText,
            });
          } else {
            session.lastConnectError = `MC 本地连接中断 (${err.code || err.message})`;
          }
        },
      });
      session.relayStreams.set(streamKey, tcp);
      return tcp;
    };

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
        session.transport = 'p2p';
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
        session.transport = 'p2p';
        session.status = 'connected';
      }
      if (peer) {
        peer.lastSeen = Date.now();
        peer.bridge.handlePacket(msg, (connId) => {
          const tcp = connectToLocalGamePort(session.gamePort, session.lanIp, {
            onConnect: () => {
              session.lastConnectError = null;
              session.portListening = true;
            },
            onError: (err, wasConnected) => {
              if (!wasConnected) {
                session.lastConnectError = `无法连接房主本地 MC 端口 ${session.gamePort} (${err.code || err.message})，请确认 MC 服务器已启动`;
                session.portListening = false;
              }
            },
          });
          peer.bridge.attachLocalTcp(connId, tcp, false);
        });
      }
    });

    session.vps.onJson = (msg) => {
      if (session.destroyed || this.hostSessions.get(serverId) !== session) return;
      if (msg.type === 'player_join') {
        launchPunchBurst(msg.payload || {});
      } else if (msg.type === 'relay_open') {
        openRelayStream(Number(msg.peerNum), Number(msg.connId));
      } else if (msg.type === 'relay_close') {
        const key = `${msg.peerNum}:${msg.connId}`;
        session.closedRelayStreams.set(key, Date.now() + 5000);
        const tcp = session.relayStreams.get(key);
        if (tcp) {
          session.relayStreams.delete(key);
          try { tcp.end(); } catch (_) {}
        }
      } else if (msg.type === 'player_left') {
        const prefix = `${msg.peerNum}:`;
        session.relayPeers.delete(Number(msg.peerNum));
        for (const [k, tcp] of session.relayStreams.entries()) {
          if (k.startsWith(prefix)) {
            session.relayStreams.delete(k);
            try { tcp.destroy(); } catch (_) {}
          }
        }
      } else if (msg.type === 'relay_e2e_ping') {
        session.vps.sendJson({ type: 'relay_e2e_pong', roomCode, peerNum: msg.peerNum, ts: msg.ts });
      }
    };

    session.vps.onBinary = (buf) => {
      if (session.destroyed || this.hostSessions.get(serverId) !== session) return;
      if (buf.length < 9 || buf[0] !== 1) return;
      const peerNum = buf.readUInt32BE(1);
      const connId = buf.readUInt32BE(5);
      const payload = buf.subarray(9);
      const key = `${peerNum}:${connId}`;
      if (session.closedRelayStreams.has(key)) return;
      let tcp = session.relayStreams.get(key);
      if (!tcp) {
        tcp = openRelayStream(peerNum, connId);
      }
      if (tcp && !tcp.destroyed) {
        tcp.write(payload);
      }
    };

    const payloadJson = () => ({
      pubIp: session.pubIp,
      pubPort: session.pubPort,
      lanIp: session.lanIp,
      localUdpPort: session.localUdpPort,
      natType: session.natType,
      gamePort: session.gamePort,
      ts: Date.now(),
    });

    let reconnectDelay = 1200;
    session.vps.onClose = () => {
      if (session.destroyed || this.hostSessions.get(serverId) !== session) return;
      if (session.vpsReconnectTimer) return;
      const delay = reconnectDelay;
      reconnectDelay = Math.min(8000, Math.round(reconnectDelay * 1.6));
      session.vpsReconnectTimer = setTimeout(async () => {
        session.vpsReconnectTimer = null;
        if (session.destroyed || this.hostSessions.get(serverId) !== session) return;
        const ok = await session.vps.connect();
        if (ok && !session.destroyed && this.hostSessions.get(serverId) === session) {
          reconnectDelay = 1200;
          session.vps.sendJson({ type: 'host_register', roomCode, payload: payloadJson() });
        } else if (!session.destroyed && this.hostSessions.get(serverId) === session) {
          session.vps.onClose();
        }
      }, delay);
    };

    const vpsConnectPromise = session.vps.connect().then((ok) => {
      if (ok && !session.destroyed && this.hostSessions.get(serverId) === session) {
        session.vps.sendJson({ type: 'host_register', roomCode, payload: payloadJson() });
      }
      return ok;
    });

    const stunPromise = discoverPublicEndpoint(socket).then(({ endpoint, natType }) => {
      if (session.destroyed || this.hostSessions.get(serverId) !== session) return;
      session.natType = natType;
      session.pubIp = endpoint?.ip || lanIp;
      session.pubPort = endpoint?.port || localUdpPort;
      if (session.vps.connected) {
        session.vps.sendJson({ type: 'host_update', roomCode, payload: payloadJson() });
      }
    });

    await Promise.race([
      Promise.all([vpsConnectPromise, stunPromise]),
      new Promise((r) => setTimeout(r, 1400)),
    ]);

    if (!session.destroyed && this.hostSessions.get(serverId) === session) {
      if (session.status === 'stun') session.status = 'waiting_peer';
      (async () => {
        try {
          const ok = await session.fallbackMqtt.connect();
          if (!ok || session.destroyed || this.hostSessions.get(serverId) !== session) return;
          const hostTopic = `fastmc/p2p/${roomCode}/host`;
          const playerTopic = `fastmc/p2p/${roomCode}/player`;
          session.fallbackMqtt.onMessage = (topic, text) => {
            if (topic !== playerTopic) return;
            try { launchPunchBurst(JSON.parse(text)); } catch (_) {}
          };
          session.fallbackMqtt.subscribe(playerTopic);
          const announce = () => {
            if (session.fallbackMqtt.connected && !session.destroyed && this.hostSessions.get(serverId) === session) {
              session.fallbackMqtt.publish(hostTopic, JSON.stringify(payloadJson()), true);
            }
          };
          announce();
          setTimeout(announce, 1500);
          session.announceTimer = setInterval(announce, 8000);
        } catch (_) {}
      })();
    }

    return this.getHostStatus(serverId);
  }

  stopHost(serverId) {
    const s = this.hostSessions.get(serverId);
    if (!s) return { stopped: true };
    s.destroyed = true;
    this.hostSessions.delete(serverId);
    if (s.announceTimer) clearInterval(s.announceTimer);
    if (s.pruneTimer) clearInterval(s.pruneTimer);
    if (s.portProbeTimer) clearInterval(s.portProbeTimer);
    if (s.vpsReconnectTimer) clearTimeout(s.vpsReconnectTimer);
    try {
      if (s.fallbackMqtt.connected) s.fallbackMqtt.publish(`fastmc/p2p/${s.roomCode}/host`, '', true);
      s.fallbackMqtt.close();
    } catch (_) {}
    try { s.vps.close(); } catch (_) {}
    for (const p of s.peers.values()) p.bridge.destroy();
    for (const tcp of s.relayStreams.values()) {
      try { tcp.destroy(); } catch (_) {}
    }
    s.relayStreams.clear();
    s.closedRelayStreams.clear();
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
      transport: s.transport,
      natType: s.natType,
      pubIp: s.pubIp,
      pubPort: s.pubPort,
      lanIp: s.lanIp,
      gamePort: s.gamePort,
      portListening: s.portListening,
      peersCount: s.peers.size + s.relayPeers.size,
      vpsConnected: s.vps.connected,
      error: s.error || s.lastConnectError || null,
    };
  }

  async joinRoom(roomCode, requestedLocalPort = 25565, options = {}) {
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
      vps: new VpsRelayClient(),
      fallbackMqtt: new FallbackMqttSignaling(),
      tcpServer: null,
      ipv6Server: null,
      bridge: null,
      relayStreams: new Map(), // connId -> tcpSocket
      relayMode: false,
      forceRelay: Boolean(options.forceRelay),
      status: 'stun', // stun -> signaling -> punching -> connected -> error
      transport: null, // 'p2p' | 'relay'
      natType: 'unknown',
      hostNatType: 'unknown',
      pubIp: lanIp,
      pubPort: localUdpPort,
      lanIp,
      localUdpPort,
      localAddress: null,
      pingMs: null,
      nextConnId: 1,
      punchTimer: null,
      fallbackTimer: null,
      keepaliveTimer: null,
      vpsReconnectTimer: null,
      destroyed: false,
      relayWarning: null,
      error: null,
    };
    this.playerSession = session;

    const handleAcceptedSocket = (tcpSocket) => {
      if (session.destroyed || this.playerSession !== session) {
        tcpSocket.destroy();
        return;
      }
      try { tcpSocket.setNoDelay(true); } catch (_) {}
      const connId = session.nextConnId++;
      if (session.relayMode) {
        if (!session.vps.connected) {
          session.relayWarning = '中继连接正在重连，请稍等一秒后重连 MC';
          tcpSocket.destroy();
          return;
        }
        let backpressureTimer = null;
        session.relayStreams.set(connId, tcpSocket);
        session.vps.sendJson({ type: 'relay_open', roomCode: cleanCode, connId });
        tcpSocket.on('data', (chunk) => {
          if (!session.relayMode || !session.vps.connected) return;
          let off = 0;
          while (off < chunk.length) {
            const slice = chunk.subarray(off, off + 16384);
            off += slice.length;
            session.vps.sendBinary(1, 0, connId, slice);
          }
          if (session.vps.bufferedAmount() > 512 * 1024 && !backpressureTimer) {
            try { tcpSocket.pause(); } catch (_) {}
            backpressureTimer = setInterval(() => {
              if (tcpSocket.destroyed || session.destroyed) {
                clearInterval(backpressureTimer);
                backpressureTimer = null;
                return;
              }
              if (session.vps.bufferedAmount() < 128 * 1024) {
                clearInterval(backpressureTimer);
                backpressureTimer = null;
                try { tcpSocket.resume(); } catch (_) {}
              }
            }, 30);
          }
        });
        tcpSocket.on('close', () => {
          if (backpressureTimer) {
            clearInterval(backpressureTimer);
            backpressureTimer = null;
          }
          if (session.relayStreams.get(connId) === tcpSocket) {
            session.relayStreams.delete(connId);
            session.vps.sendJson({ type: 'relay_close', roomCode: cleanCode, connId });
          }
        });
        tcpSocket.on('error', () => {
          try { tcpSocket.destroy(); } catch (_) {}
        });
        return;
      }
      if (!session.bridge) {
        tcpSocket.destroy();
        return;
      }
      session.bridge.attachLocalTcp(connId, tcpSocket, true);
    };

    let proxyStarting = false;
    const startTcpProxy = async (transportName) => {
      if (session.tcpServer || proxyStarting || session.destroyed || this.playerSession !== session) return;
      proxyStarting = true;
      const srv = net.createServer(handleAcceptedSocket);

      await new Promise((resolve) => {
        srv.once('error', () => {
          srv.listen(0, '127.0.0.1', resolve);
        });
        srv.listen(requestedLocalPort, '127.0.0.1', resolve);
      });

      if (session.destroyed || this.playerSession !== session) {
        try { srv.close(); } catch (_) {}
        return;
      }

      session.tcpServer = srv;
      const addr = srv.address();
      session.localAddress = `127.0.0.1:${addr.port}`;
      session.transport = transportName;
      session.status = 'connected';

      // Best-effort IPv6 loopback companion listener on the same port so `localhost:<port>`
      // works seamlessly alongside `127.0.0.1:<port>` on Windows dual-stack setups.
      try {
        const ipv6Srv = net.createServer(handleAcceptedSocket);
        ipv6Srv.once('error', () => {
          try { ipv6Srv.close(); } catch (_) {}
        });
        ipv6Srv.listen({ port: addr.port, host: '::1', ipv6Only: true }, () => {
          if (session.destroyed || this.playerSession !== session) {
            try { ipv6Srv.close(); } catch (_) {}
            return;
          }
          session.ipv6Server = ipv6Srv;
        });
      } catch (_) {}
    };

    const activateRelayFallback = () => {
      if (session.destroyed || this.playerSession !== session || session.status === 'connected' || session.relayMode) return;
      if (!session.vps.connected) return;
      if (session.punchTimer) clearInterval(session.punchTimer);
      session.relayMode = true;
      session.vps.sendJson({ type: 'relay_e2e_ping', roomCode: cleanCode, ts: Date.now() });
      session.keepaliveTimer = setInterval(() => {
        if (!session.destroyed && this.playerSession === session && session.relayMode && session.vps.connected) {
          session.vps.sendJson({ type: 'relay_e2e_ping', roomCode: cleanCode, ts: Date.now() });
        }
      }, 4000);
      startTcpProxy('relay');
    };

    socket.on('message', (msg, rinfo) => {
      if (msg.length < 1 || session.destroyed || this.playerSession !== session || session.relayMode) return;
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
          if (session.fallbackTimer) clearTimeout(session.fallbackTimer);
          session.bridge = new ReliableUdpBridge(socket, rinfo.address, rinfo.port);
          if (session.pingMs) session.bridge.updateRtt(session.pingMs);
          startTcpProxy('p2p');
        } else if (isPrivateIpv4(rinfo.address) && !isPrivateIpv4(session.bridge.remoteIp)) {
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

    session.vps.onBinary = (buf) => {
      if (session.destroyed || this.playerSession !== session || !session.relayMode || buf.length < 9 || buf[0] !== 2) return;
      const connId = buf.readUInt32BE(5);
      const tcp = session.relayStreams.get(connId);
      if (tcp && !tcp.destroyed) {
        session.relayWarning = null;
        tcp.write(buf.subarray(9));
      }
    };

    const sendPlayerJoin = () => {
      session.vps.sendJson({
        type: 'player_join',
        roomCode: cleanCode,
        payload: {
          pubIp: session.pubIp,
          pubPort: session.pubPort,
          lanIp: session.lanIp,
          localUdpPort: session.localUdpPort,
          natType: session.natType,
        },
      });
    };

    let vpsReconnectDelay = 1200;
    session.vps.onClose = () => {
      if (session.destroyed || this.playerSession !== session || !session.relayMode) return;
      if (session.vpsReconnectTimer) return;
      const delay = vpsReconnectDelay;
      vpsReconnectDelay = Math.min(8000, Math.round(vpsReconnectDelay * 1.6));
      session.vpsReconnectTimer = setTimeout(async () => {
        session.vpsReconnectTimer = null;
        if (session.destroyed || this.playerSession !== session || !session.relayMode) return;
        const ok = await session.vps.connect();
        if (ok && !session.destroyed && this.playerSession === session) {
          vpsReconnectDelay = 1200;
          session.relayWarning = null;
          sendPlayerJoin();
        } else if (!session.destroyed && this.playerSession === session) {
          session.relayWarning = '中继服务器暂时断开，正在尝试重连...';
          session.vps.onClose();
        }
      }, delay);
    };

    (async () => {
      try {
        const vpsPromise = session.vps.connect();
        const stunPromise = discoverPublicEndpoint(socket);
        const [{ endpoint, natType }, vpsOk] = await Promise.all([stunPromise, vpsPromise]);
        if (session.destroyed || this.playerSession !== session) return;

        session.natType = natType;
        session.pubIp = endpoint?.ip || lanIp;
        session.pubPort = endpoint?.port || localUdpPort;
        session.status = 'signaling';

        let punchingStarted = false;
        let vpsSaidNotFound = false;
        let retriedVpsJoin = false;

        const beginPunchWithHost = (h, viaVps) => {
          if (session.destroyed || this.playerSession !== session || (!h.pubIp && !h.lanIp) || punchingStarted) return;
          punchingStarted = true;
          session.hostNatType = h.natType || 'unknown';

          if (session.forceRelay && vpsOk) {
            activateRelayFallback();
            return;
          }

          session.status = 'punching';

          const myPayload = {
            pubIp: session.pubIp,
            pubPort: session.pubPort,
            lanIp: session.lanIp,
            localUdpPort: session.localUdpPort,
            natType: session.natType,
          };
          if (session.fallbackMqtt.connected) {
            session.fallbackMqtt.publish(`fastmc/p2p/${cleanCode}/player`, JSON.stringify(myPayload));
          }

          const targets = buildPunchTargets(h, session.natType);
          const hasSymmetric = session.natType === 'symmetric' || session.hostNatType === 'symmetric';
          const fallbackDelayMs = hasSymmetric ? 2200 : 3800;

          if (viaVps && vpsOk) {
            session.fallbackTimer = setTimeout(() => {
              if (!session.destroyed && this.playerSession === session && session.status !== 'connected' && !session.bridge) {
                activateRelayFallback();
              }
            }, fallbackDelayMs);
          }

          let attempts = 0;
          session.punchTimer = setInterval(() => {
            if (session.destroyed || this.playerSession !== session || session.status === 'connected' || session.relayMode) {
              clearInterval(session.punchTimer);
              return;
            }
            if (attempts++ > 45) {
              clearInterval(session.punchTimer);
              if (session.status !== 'connected') {
                if (viaVps && session.vps.connected) {
                  activateRelayFallback();
                } else {
                  session.status = 'error';
                  session.error = hasSymmetric
                    ? '双方存在对称型 NAT 且中继不可达，打洞超时'
                    : 'P2P 打洞超时，请确认房主已开启房间';
                }
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
            if (!session.destroyed && this.playerSession === session && !session.relayMode && session.bridge && session.status === 'connected') {
              const ping = Buffer.alloc(9);
              ping[0] = PKT_PING;
              ping.writeDoubleBE(Date.now(), 1);
              try { socket.send(ping, session.bridge.remotePort, session.bridge.remoteIp); } catch (_) {}
            }
          }, 4000);
        };

        session.vps.onJson = (msg) => {
          if (session.destroyed || this.playerSession !== session) return;
          if (msg.type === 'host_info') {
            beginPunchWithHost(msg.payload || {}, true);
          } else if (msg.type === 'room_not_found') {
            vpsSaidNotFound = true;
            if (!retriedVpsJoin && !punchingStarted && session.vps.connected) {
              retriedVpsJoin = true;
              setTimeout(() => {
                if (!session.destroyed && this.playerSession === session && !punchingStarted && session.vps.connected) {
                  sendPlayerJoin();
                }
              }, 850);
            }
          } else if (msg.type === 'relay_close') {
            const tcp = session.relayStreams.get(Number(msg.connId));
            if (tcp) {
              session.relayStreams.delete(Number(msg.connId));
              try { tcp.end(); } catch (_) {}
            }
          } else if (msg.type === 'relay_error') {
            session.relayWarning = msg.error || '无法连接房主 MC 服务端，请确认房主已启动服务器';
          } else if (msg.type === 'relay_e2e_pong') {
            const rtt = Math.max(1, Math.round(Date.now() - Number(msg.ts || 0)));
            if (rtt < 5000) session.pingMs = rtt;
          } else if (msg.type === 'host_closed') {
            if (session.relayMode) {
              session.status = 'error';
              session.error = '房主已关闭房间';
            }
          }
        };

        if (vpsOk) {
          sendPlayerJoin();
        }

        // Start fallback MQTT lookup in parallel (useful if host wasn't connected to VPS)
        session.fallbackMqtt.connect().then((ok) => {
          if (!ok || session.destroyed || this.playerSession !== session || punchingStarted) return;
          const hostTopic = `fastmc/p2p/${cleanCode}/host`;
          session.fallbackMqtt.onMessage = (topic, text) => {
            if (topic !== hostTopic || !text) return;
            try { beginPunchWithHost(JSON.parse(text), false); } catch (_) {}
          };
          session.fallbackMqtt.subscribe(hostTopic);
        }).catch(() => {});

        setTimeout(() => {
          if (!session.destroyed && this.playerSession === session && !punchingStarted && session.status === 'signaling') {
            session.status = 'error';
            session.error = vpsSaidNotFound
              ? `未找到房间 ${cleanCode}，请确认房主已开启联机`
              : `未找到房间 ${cleanCode}，请确认房主已开启 P2P 房间`;
          }
        }, vpsOk ? 4500 : 9000);
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
    s.destroyed = true;
    this.playerSession = null;
    if (s.punchTimer) clearInterval(s.punchTimer);
    if (s.fallbackTimer) clearTimeout(s.fallbackTimer);
    if (s.keepaliveTimer) clearInterval(s.keepaliveTimer);
    if (s.vpsReconnectTimer) clearTimeout(s.vpsReconnectTimer);
    try { s.fallbackMqtt.close(); } catch (_) {}
    try { s.vps.close(); } catch (_) {}
    if (s.bridge) s.bridge.destroy();
    for (const tcp of s.relayStreams.values()) {
      try { tcp.destroy(); } catch (_) {}
    }
    s.relayStreams.clear();
    if (s.ipv6Server) try { s.ipv6Server.close(); } catch (_) {}
    if (s.tcpServer) try { s.tcpServer.close(); } catch (_) {}
    try { s.socket.close(); } catch (_) {}
    return { left: true };
  }

  getPlayerStatus() {
    const s = this.playerSession;
    if (!s) return { status: 'idle' };
    return {
      status: s.status,
      transport: s.transport,
      roomCode: s.roomCode,
      localAddress: s.localAddress,
      pingMs: s.pingMs,
      natType: s.natType,
      hostNatType: s.hostNatType,
      vpsConnected: s.vps.connected,
      warning: s.relayWarning,
      error: s.error,
    };
  }
}

export const P2PManager = new P2PManagerClass();
