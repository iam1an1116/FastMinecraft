import { Router } from 'express';
import { execSync } from 'child_process';
import net from 'net';
import os from 'os';
import { NetworkManager } from '../modules/network/NetworkManager.js';
import { P2PManager } from '../modules/network/P2PTunnel.js';
import { ServerManager } from '../modules/server/ServerManager.js';

const router = Router();

// === P2P Tunnel Routes (Zero Third-Party Relay) ===

router.post('/p2p/host/start', async (req, res) => {
  try {
    const { serverId, port } = req.body;
    const status = await P2PManager.startHost(serverId || 'default', port || 25565);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/p2p/host/stop', (req, res) => {
  try {
    const { serverId } = req.body;
    res.json(P2PManager.stopHost(serverId || 'default'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/p2p/host/status', (req, res) => {
  const serverId = req.query.serverId || 'default';
  res.json(P2PManager.getHostStatus(serverId));
});

router.post('/p2p/player/join', async (req, res) => {
  try {
    const { roomCode, localPort } = req.body;
    const status = await P2PManager.joinRoom(roomCode, localPort || 25565);
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/p2p/player/leave', (req, res) => {
  res.json(P2PManager.leaveRoom());
});

router.get('/p2p/player/status', (req, res) => {
  res.json(P2PManager.getPlayerStatus());
});

// === Comprehensive IPv6 Diagnostics ===

function checkTcpConnect(host, port, family = 6, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port, family });
    let done = false;
    const finish = (ok, errMsg = null) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve({ ok, errMsg });
    };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false, '连接超时'));
    sock.on('error', (e) => finish(false, e.code || e.message));
  });
}

router.get('/ipv6-diagnose', async (req, res) => {
  const port = Number(req.query.port) || 25565;
  const serverId = req.query.serverId ? String(req.query.serverId) : null;
  const checks = [];

  // 1. Scan all IPv6 addresses & inspect temporary flags on macOS
  let ifconfigOut = '';
  if (process.platform === 'darwin') {
    try {
      ifconfigOut = execSync('ifconfig', { encoding: 'utf-8', timeout: 2000 });
    } catch (_) {}
  }

  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    const lower = name.toLowerCase();
    if (lower.includes('virtual') || lower.includes('docker') || lower.includes('tailscale') || lower.includes('zerotier') || lower.includes('utun')) continue;
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv6' && !iface.internal) {
        const addr = iface.address.toLowerCase();
        if (addr.startsWith('fe80:') || addr.startsWith('fc') || addr.startsWith('fd')) continue;
        if (addr.startsWith('2') || addr.startsWith('3')) {
          let isTemporary = false;
          if (ifconfigOut) {
            const line = ifconfigOut.split('\n').find(l => l.includes(addr));
            if (line && line.includes('temporary')) isTemporary = true;
          }
          candidates.push({ ip: iface.address, iface: name, isTemporary });
        }
      }
    }
  }

  // Prefer non-temporary global unicast address
  candidates.sort((a, b) => Number(a.isTemporary) - Number(b.isTemporary));
  const best = candidates[0] || null;

  if (!best) {
    checks.push({
      id: 'addr',
      label: '公网 IPv6 地址',
      status: 'error',
      detail: '未检测到公网 IPv6 地址，请确认宽带/路由器已开启 IPv6'
    });
  } else if (best.isTemporary) {
    checks.push({
      id: 'addr',
      label: '公网 IPv6 地址',
      status: 'warn',
      detail: `已获取 (${best.iface})，但当前为临时隐私地址，重启或长时间后可能会变`
    });
  } else {
    checks.push({
      id: 'addr',
      label: '公网 IPv6 地址',
      status: 'ok',
      detail: `已获取稳定公网 IPv6 (${best.iface})`
    });
  }

  // 2. Check outbound IPv6 routing
  if (best) {
    const routeTest = await checkTcpConnect('2400:3200::1', 53, 6, 2200);
    const routeTest2 = routeTest.ok ? routeTest : await checkTcpConnect('2001:4860:4860::8888', 53, 6, 2200);
    checks.push({
      id: 'route',
      label: 'IPv6 外网路由',
      status: routeTest2.ok ? 'ok' : 'error',
      detail: routeTest2.ok ? 'IPv6 外网通信正常' : `无法访问 IPv6 公网 (${routeTest2.errMsg || '网络不通'})`
    });
  }

  // 3. Check server.properties server-ip conflict & port listening
  if (serverId) {
    try {
      const props = ServerManager.readServerProperties(serverId);
      const sip = (props['server-ip'] || '').trim();
      if (sip && !sip.includes(':') && sip !== '0.0.0.0') {
        checks.push({
          id: 'bind_ip',
          label: '服务端绑定配置',
          status: 'error',
          detail: `server.properties 中 server-ip=${sip} 绑定了 IPv4，会导致无法接受 IPv6 连接，请清空`
        });
      } else {
        checks.push({
          id: 'bind_ip',
          label: '服务端绑定配置',
          status: 'ok',
          detail: '未限制 IPv4 绑定，支持双栈监听'
        });
      }
    } catch (_) {}
  }

  if (best) {
    const listenTest = await checkTcpConnect(best.ip, port, 6, 1200);
    checks.push({
      id: 'port',
      label: `端口 ${port} 监听状态`,
      status: listenTest.ok ? 'ok' : 'warn',
      detail: listenTest.ok ? `服务端已在 IPv6 ${port} 端口正常监听` : `端口 ${port} 暂未监听（请先启动服务器）`
    });
  }

  // 4. System firewall check (macOS & Windows)
  if (process.platform === 'darwin') {
    try {
      const fwOut = execSync('/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate', { encoding: 'utf-8', timeout: 1500 });
      const enabled = fwOut.toLowerCase().includes('enabled') && !fwOut.toLowerCase().includes('disabled');
      checks.push({
        id: 'sys_fw',
        label: 'macOS 系统防火墙',
        status: enabled ? 'warn' : 'ok',
        detail: enabled ? '系统防火墙已开启，请确保允许 java 接收传入连接' : '系统防火墙未拦截入站连接'
      });
    } catch (_) {}
  } else if (process.platform === 'win32') {
    try {
      const fwOut = execSync('netsh advfirewall show allprofiles state', { encoding: 'utf-8', timeout: 2000 });
      const enabled = /State\s+ON/i.test(fwOut);
      checks.push({
        id: 'sys_fw',
        label: 'Windows 防火墙',
        status: enabled ? 'warn' : 'ok',
        detail: enabled ? 'Windows 防火墙已开启，请确保放行 java.exe 与对应端口' : 'Windows 防火墙未开启'
      });
    } catch (_) {}
  }

  // 5. Router / ONT IPv6 SPI firewall advisory
  if (best) {
    checks.push({
      id: 'router_fw',
      label: '光猫 / 路由器入站策略',
      status: 'warn',
      detail: '若好友仍提示连接超时，请检查光猫和路由器后台是否默认开启了“IPv6 防火墙”并关闭或放行端口'
    });
  }

  res.json({
    ip: best?.ip || null,
    address: best ? `[${best.ip}]:${port}` : null,
    candidates,
    checks
  });
});

// === Legacy / Existing Provider Routes ===

router.get('/providers', (req, res) => {
  res.json(NetworkManager.getAvailableProviders());
});

router.get('/sakura-status', (req, res) => {
  res.json(NetworkManager.getSakuraStatus());
});

router.post('/frpc-path', (req, res) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: '请输入路径' });
    NetworkManager.setCustomFrpcPath(path);
    res.json({ ok: true, ...NetworkManager.getSakuraStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/natfrp/token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: '请输入 Token' });
    const cleanToken = token.trim().replace(/^["']|["']$/g, '');
    const info = await NetworkManager.natfrpGetUserInfo(cleanToken);
    NetworkManager.saveNatfrpToken(cleanToken);
    res.json({ ok: true, user: info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/natfrp/token', (req, res) => {
  const token = NetworkManager.getNatfrpToken();
  res.json({ hasToken: !!token });
});

router.get('/natfrp/nodes', async (req, res) => {
  try {
    const token = NetworkManager.getNatfrpToken();
    if (!token) return res.status(400).json({ error: '请先设置 API Token' });
    const nodes = await NetworkManager.natfrpGetNodes(token);
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tunnel/:id/start', async (req, res) => {
  try {
    const { provider, port, nodeId, token: userToken, name } = req.body;
    const result = await NetworkManager.startTunnel(req.params.id, provider, port, {
      nodeId, token: userToken, name
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tunnel/:id/stop', async (req, res) => {
  try {
    const result = await NetworkManager.stopTunnel(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tunnel/:id/status', async (req, res) => {
  const status = NetworkManager.getTunnelStatus(req.params.id);
  if (status.running && !status.connectAddress) {
    await NetworkManager.refreshTunnelInfo(req.params.id);
    res.json(NetworkManager.getTunnelStatus(req.params.id));
  } else {
    res.json(status);
  }
});

export { router as networkRoutes };
