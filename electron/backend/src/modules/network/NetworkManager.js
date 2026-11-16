import { exec, spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { promisify } from 'util';
import { getDb } from '../../database/init.js';
import { safeFetch } from '../../utils/fetch.js';

const execAsync = promisify(exec);
const isWin = platform() === 'win32';

function killProcessTree(pid, signal = 'SIGTERM') {
  return new Promise((resolve) => {
    try {
      if (isWin) {
        exec(`taskkill /pid ${pid} /T /F`, () => resolve());
      } else {
        process.kill(pid, signal);
        resolve();
      }
    } catch {
      resolve();
    }
  });
}
const NATFRP_API = 'https://api.natfrp.com/v4';

// 自动检测 frpc 和配置文件路径
function detectSakuraPaths() {
  const db = getDb();
  const customFrpc = db.prepare("SELECT value FROM settings WHERE key = 'custom_frpc_path'")?.get()?.value;
  const customConfig = db.prepare("SELECT value FROM settings WHERE key = 'custom_natfrp_config_path'")?.get()?.value;

  let frpcPath = (customFrpc && existsSync(customFrpc)) ? customFrpc : null;
  let configPath = (customConfig && existsSync(customConfig)) ? customConfig : null;
  let sakuraDir = null;

  // ========== Windows 检测 ==========
  if (isWin && (!frpcPath || !configPath)) {
    // 1. 通过正在运行的进程定位（最准确）
    // 优先 PowerShell（兼容 Win11 24H2+），回退 wmic
    try {
      const psResult = execSync(
        'powershell -NoProfile -Command "(Get-Process SakuraLauncher -ErrorAction SilentlyContinue | Select-Object -First 1).Path"',
        { encoding: 'utf-8', timeout: 8000 }
      ).trim();
      if (psResult && existsSync(psResult)) {
        sakuraDir = join(psResult, '..');
        console.log('[detect] Found SakuraLauncher via PowerShell:', sakuraDir);
      }
    } catch {}
    if (!sakuraDir) {
      try {
        const wmicResult = execSync(
          'wmic process where "name=\'SakuraLauncher.exe\'" get ExecutablePath /value 2>nul',
          { encoding: 'utf-8', timeout: 5000 }
        );
        const match = wmicResult.match(/ExecutablePath=(.+)/i);
        if (match && match[1].trim()) {
          sakuraDir = join(match[1].trim(), '..');
          console.log('[detect] Found SakuraLauncher via wmic:', sakuraDir);
        }
      } catch {}
    }

    // 2. 构建候选目录列表
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Default';
    const desktop = join(userProfile, 'Desktop');
    const downloads = join(userProfile, 'Downloads');

    const winBases = [
      // 进程检测到的目录（最高优先级）
      ...(sakuraDir ? [sakuraDir] : []),
      // 标准安装路径
      join(process.env.LOCALAPPDATA || '', 'SakuraLauncher'),
      join(process.env.APPDATA || '', 'SakuraLauncher'),
      join(process.env.PROGRAMFILES || '', 'SakuraLauncher'),
      join(process.env['ProgramFiles(x86)'] || '', 'SakuraLauncher'),
      // 用户目录
      join(userProfile, 'SakuraLauncher'),
      // 桌面/下载 常见解压位置
      join(desktop, 'SakuraLauncher'),
      join(downloads, 'SakuraLauncher'),
      // 盘符根目录
      'C:\\SakuraLauncher', 'D:\\SakuraLauncher', 'E:\\SakuraLauncher',
    ];

    // 3. 从候选目录查找 frpc 和 config
    const frpcSubPaths = [
      'frpc\\frpc.exe', 'bin\\frpc.exe', 'frpc.exe',
      'frpc\\frpc', 'bin\\frpc',  // 无扩展名（罕见但可能）
    ];
    const configSubPaths = [
      'config.json', 'data\\config.json',
      'natfrp-service\\config.json',
    ];

    for (const base of winBases) {
      if (!existsSync(base)) continue;
      if (!frpcPath) {
        for (const sub of frpcSubPaths) {
          const p = join(base, sub);
          if (existsSync(p)) { frpcPath = p; break; }
        }
      }
      if (!configPath) {
        for (const sub of configSubPaths) {
          const p = join(base, sub);
          if (existsSync(p)) { configPath = p; break; }
        }
      }
      if (frpcPath && configPath) break;
    }

    // 4. 独立 natfrp-service 配置路径（不在 SakuraLauncher 目录下）
    if (!configPath) {
      const standaloneConfigs = [
        join(process.env.LOCALAPPDATA || '', 'natfrp-service', 'config.json'),
        join(process.env.APPDATA || '', 'natfrp-service', 'config.json'),
      ];
      for (const p of standaloneConfigs) {
        if (existsSync(p)) { configPath = p; break; }
      }
    }

    // 5. PATH 搜索 frpc
    if (!frpcPath) {
      try {
        const result = execSync('where frpc.exe 2>nul', { encoding: 'utf-8', timeout: 5000 });
        for (const p of result.trim().split('\n')) {
          const clean = p.trim();
          if (clean && existsSync(clean)) { frpcPath = clean; break; }
        }
      } catch {}
    }

    // 6. 全盘快速扫描常见目录（C/D/E 盘 Program Files 和根目录）
    if (!frpcPath) {
      for (const drive of ['C:', 'D:', 'E:']) {
        for (const dir of ['Program Files', 'Program Files (x86)', '']) {
          const base = dir ? join(drive, dir, 'SakuraLauncher') : join(drive, 'SakuraLauncher');
          if (!existsSync(base)) continue;
          for (const sub of frpcSubPaths) {
            const p = join(base, sub);
            if (existsSync(p)) { frpcPath = p; break; }
          }
          if (frpcPath) break;
        }
        if (frpcPath) break;
      }
    }
  }

  // ========== macOS 检测 ==========
  if (!isWin) {
    const macCandidates = [
      '/Applications/SakuraLauncher.app/Contents/MacOS/natfrp-service.app/Contents/MacOS/frpc',
      join(homedir(), 'Applications/SakuraLauncher.app/Contents/MacOS/natfrp-service.app/Contents/MacOS/frpc'),
      '/usr/local/bin/frpc', '/opt/homebrew/bin/frpc',
    ];
    for (const p of macCandidates) {
      if (!frpcPath && existsSync(p)) frpcPath = p;
    }
    if (!frpcPath) {
      try {
        const r = execSync('which frpc 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }).trim();
        if (r && existsSync(r)) frpcPath = r;
      } catch {}
    }
    const macConfigs = [
      join(homedir(), 'Library/Containers/com.natfrp.launcher/Data/Library/Application Support/natfrp-service/config.json'),
      join(homedir(), 'Library/Application Support/natfrp-service/config.json'),
    ];
    for (const p of macConfigs) {
      if (!configPath && existsSync(p)) configPath = p;
    }
  }

  console.log(`[detect] frpc=${frpcPath || 'NOT FOUND'}, config=${configPath || 'NOT FOUND'}`);
  return { frpcPath, configPath };
}

export class NetworkManager {
  static tunnels = new Map();

  static getAvailableProviders() {
    const { frpcPath } = detectSakuraPaths();
    return [{ id: 'natfrp', name: '樱花映射 (Sakura Frp)', available: !!frpcPath, needKey: true, frpcPath }];
  }

  static getSakuraStatus() {
    const { frpcPath, configPath } = detectSakuraPaths();
    return {
      detected: !!(frpcPath || configPath),  // 有 frpc 或 config 都算检测到
      frpcPath: frpcPath || null,
      configPath: configPath || null,
      hasFrpc: !!frpcPath,
      hasConfig: !!configPath,
    };
  }

  static setCustomFrpcPath(path) {
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('custom_frpc_path', ?)`).run(path);
  }

  // === 配置读写 ===

  static readNatfrpConfig() {
    const { configPath } = detectSakuraPaths();
    if (!configPath || !existsSync(configPath)) return null;
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (err) {
      console.error('[natfrp] Failed to read config:', err.message);
      return null;
    }
  }

  static writeNatfrpConfig(config) {
    const { configPath } = detectSakuraPaths();
    if (!configPath) return false;
    try {
      writeFileSync(configPath, JSON.stringify(config, null, 4));
      return true;
    } catch (err) {
      console.error('[natfrp] Failed to write config:', err.message);
      return false;
    }
  }

  // 把隧道加入 SakuraLauncher 自动启动列表（静默操作，不杀进程）
  static addTunnelToAutoStartSync(tunnelId) {
    const config = this.readNatfrpConfig();
    if (!config) return false;
    if (!Array.isArray(config.auto_start_tunnels)) {
      config.auto_start_tunnels = [];
    }
    if (!config.auto_start_tunnels.includes(tunnelId)) {
      config.auto_start_tunnels.push(tunnelId);
      this.writeNatfrpConfig(config);
      console.log(`[config] Added tunnel ${tunnelId} to auto_start_tunnels`);
    }
    return true;
  }

  static removeTunnelFromAutoStartSync(tunnelId) {
    const config = this.readNatfrpConfig();
    if (!config || !Array.isArray(config.auto_start_tunnels)) return;
    config.auto_start_tunnels = config.auto_start_tunnels.filter(id => id !== tunnelId);
    this.writeNatfrpConfig(config);
    console.log(`[config] Removed tunnel ${tunnelId} from auto_start_tunnels`);
  }

  // 通知 natfrp-service 重新加载配置
  // 不杀 SakuraLauncher，只杀 natfrp-service 让它自动被拉起
  static async restartNatfrpService() {
    try {
      if (isWin) {
        // Windows: 只杀 natfrp-service，SakuraLauncher 会自动重启它
        await new Promise(resolve => {
          exec('taskkill /IM natfrp-service.exe /F', { timeout: 5000 }, () => resolve());
        });
        console.log('[natfrp] Killed natfrp-service on Windows');
      } else {
        // macOS
        await execAsync('pkill -f "natfrp-service"').catch(() => {});
        console.log('[natfrp] Killed natfrp-service on macOS');
      }
      // 等待 natfrp-service 被自动拉起并读取新配置
      await new Promise(r => setTimeout(r, 3000));
      console.log('[natfrp] natfrp-service should have been restarted');
    } catch (e) {
      console.error('[natfrp] Error during restart:', e.message);
    }
  }

  // === Sakura Frp API ===

  static async natfrpRequest(token, path, options = {}) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${NATFRP_API}${path}${sep}token=${encodeURIComponent(token)}`;
    const fetchOptions = { method: options.method || 'GET', headers: {} };
    if (options.body) {
      fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOptions.body = new URLSearchParams(options.body).toString();
    }
    const res = await safeFetch(url, fetchOptions);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`API 返回非 JSON: ${text.slice(0, 200)}`); }
    if (data.error || (data.code && data.code !== 0)) {
      throw new Error(data.msg || data.error || `API 错误 code=${data.code}`);
    }
    return data;
  }

  static async natfrpGetUserInfo(token) { return this.natfrpRequest(token, '/user/info'); }
  static async natfrpGetNodes(token) {
    const data = await this.natfrpRequest(token, '/nodes');
    const nodes = [];
    for (const [id, node] of Object.entries(data)) {
      const canCreate = (node.flag >> 2) & 1;
      const isOffline = (node.flag >> 9) & 1;
      if (canCreate && !isOffline) {
        nodes.push({ id: parseInt(id), name: node.name, host: node.host, description: node.description, vip: node.vip });
      }
    }
    return nodes;
  }
  static async natfrpCreateTunnel(token, { nodeId, name, localPort }) {
    return this.natfrpRequest(token, '/tunnels', {
      method: 'POST',
      body: { name: name || `FM-${Date.now()}`, type: 'tcp', node: String(nodeId), local_ip: '127.0.0.1', local_port: String(localPort) }
    });
  }
  static async natfrpStartTunnel(token, tunnelId) {
    return this.natfrpRequest(token, `/tunnel/start?id=${tunnelId}`, { method: 'POST' });
  }
  static async natfrpDeleteTunnel(token, tunnelId) {
    return this.natfrpRequest(token, '/tunnel/delete', { method: 'POST', body: { ids: String(tunnelId) } });
  }
  static async natfrpListTunnels(token) { return this.natfrpRequest(token, '/tunnels'); }

  // Token 管理
  static saveNatfrpToken(token) {
    getDb().prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('natfrp_token', ?)`).run(token);
  }
  static getNatfrpToken() {
    return getDb().prepare("SELECT value FROM settings WHERE key = 'natfrp_token'").get()?.value || null;
  }

  // 尝试直接启动 frpc（跑在后台），返回进程对象或 null
  static async spawnFrpc(frpcPath, token, label = '') {
    const frpcDir = join(frpcPath, '..');
    for (const flags of [['-f', token], ['-u', token]]) {
      try {
        const child = spawn(frpcPath, flags, {
          cwd: frpcDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        child.stdout?.on('data', d => console.log(`[frpc${label}] ${d.toString().trim()}`));
        child.stderr?.on('data', d => console.log(`[frpc${label}] ${d.toString().trim()}`));
        child.on('exit', code => console.log(`[frpc${label}] exited with code ${code}`));

        const survived = await new Promise(resolve => {
          const timer = setTimeout(() => resolve(true), 1500);
          child.on('exit', () => { clearTimeout(timer); resolve(false); });
        });

        if (survived) {
          console.log(`[frpc${label}] Started (PID ${child.pid}, flags=${flags[0]})`);
          return child;
        }
        try { child.kill(); } catch {}
      } catch {}
    }
    return null;
  }

  // === 检查 frpc/SakuraLauncher 是否已在运行 ===
  static isFrpcRunning() {
    try {
      if (isWin) {
        const result = execSync('tasklist /FI "IMAGENAME eq frpc.exe" /NH 2>nul', { encoding: 'utf-8', timeout: 5000 });
        return result.includes('frpc.exe');
      } else {
        execSync('pgrep -f frpc', { encoding: 'utf-8', timeout: 3000 });
        return true;
      }
    } catch {
      return false;
    }
  }

  // === 创建隧道 ===
  static async startTunnel(serverId, provider, port, options = {}) {
    if (provider !== 'natfrp') throw new Error(`Provider ${provider} not implemented`);

    const token = options.token || this.getNatfrpToken();
    if (!token) throw new Error('请先设置樱花映射 API Token');
    if (!options.nodeId) throw new Error('请选择一个节点');

    // 清理旧隧道
    if (this.tunnels.has(serverId)) {
      const old = this.tunnels.get(serverId);
      if (old.frpcProcess && !old.frpcProcess.killed && old.frpcProcess.exitCode === null) {
        throw new Error('该服务器已有隧道在运行，请先停止');
      }
      // 尝试删除旧隧道
      if (old.tunnelId && old.token) {
        try { await this.natfrpDeleteTunnel(old.token, old.tunnelId); } catch {}
      }
      this.tunnels.delete(serverId);
      getDb().prepare('DELETE FROM network_tunnels WHERE server_id = ?').run(serverId);
    }

    // 1. API 创建隧道（名称加时间戳避免冲突）
    const tunnelName = options.name || `FM${Date.now().toString(36)}`;
    const result = await this.natfrpCreateTunnel(token, {
      nodeId: options.nodeId,
      name: tunnelName,
      localPort: port,
    });
    if (result.code && result.code !== 0) {
      throw new Error(result.msg || '创建隧道失败');
    }

    const tunnelData = Array.isArray(result) ? result[0] : result;
    const tunnelId = tunnelData.id || tunnelData.tunnel_id;
    const remotePort = tunnelData.remote || tunnelData.port;
    if (!tunnelId) {
      throw new Error('创建隧道失败：未获取到隧道 ID');
    }

    // === 从这里开始，隧道已在 API 上创建，所有步骤不抛异常 ===

    // 2. API 激活隧道
    await this.natfrpStartTunnel(token, tunnelId).catch(err => {
      console.error('[startTunnel] Start API failed:', err.message);
    });

    // 3. 获取节点信息（失败不影响隧道）
    let nodeHost = '';
    let connectAddress = `隧道 #${tunnelId}`;
    try {
      const nodes = await this.natfrpGetNodes(token);
      const node = nodes.find(n => n.id === options.nodeId);
      if (node) {
        nodeHost = node.host || '';
        if (nodeHost && remotePort) connectAddress = `${nodeHost}:${remotePort}`;
      }
    } catch (err) {
      console.warn('[startTunnel] 获取节点信息失败:', err.message);
    }

    // 4. 本地 frpc 配置（非必须，隧道已通过 API 激活）
    let frpcProcess = null;
    try {
      const { frpcPath, configPath } = detectSakuraPaths();
      const frpcAlreadyRunning = this.isFrpcRunning();
      if (configPath) {
        this.addTunnelToAutoStartSync(tunnelId);
        await this.restartNatfrpService();
      } else if (frpcPath && !frpcAlreadyRunning) {
        frpcProcess = await this.spawnFrpc(frpcPath, token, '');
      }
    } catch (err) {
      console.warn('[startTunnel] 本地配置失败，隧道已通过 API 激活:', err.message);
    }

    // 5. 保存状态（一定执行）
    this.tunnels.set(serverId, { provider: 'natfrp', tunnelId, remotePort: remotePort || '', address: nodeHost, token, frpcProcess });
    getDb().prepare(`INSERT OR REPLACE INTO network_tunnels (server_id, provider, tunnel_id, remote_port, address) VALUES (?, ?, ?, ?, ?)`)
      .run(serverId, 'natfrp', String(tunnelId), remotePort ? String(remotePort) : '', nodeHost);

    return { provider: 'natfrp', tunnelId, address: nodeHost, port: remotePort, connectAddress };
  }

  // === 停止隧道 ===
  static async stopTunnel(serverId) {
    const tunnel = this.tunnels.get(serverId);
    if (!tunnel) throw new Error('没有运行中的隧道');

    if (tunnel.provider === 'natfrp' && tunnel.tunnelId) {
      // 从配置中移除
      this.removeTunnelFromAutoStartSync(tunnel.tunnelId);

      // 重启服务使配置生效（移除隧道）
      await this.restartNatfrpService();

      // 杀掉 frpc 进程
      if (tunnel.frpcProcess && !tunnel.frpcProcess.killed && tunnel.frpcProcess.exitCode === null) {
        try { await killProcessTree(tunnel.frpcProcess.pid, 'SIGKILL'); } catch {}
      }

      // API 删除隧道
      try {
        await this.natfrpDeleteTunnel(tunnel.token, tunnel.tunnelId);
        console.log(`[natfrp] Deleted tunnel ${tunnel.tunnelId}`);
      } catch (err) {
        console.error('[natfrp] Delete API failed:', err.message);
      }
    }

    this.tunnels.delete(serverId);
    getDb().prepare('DELETE FROM network_tunnels WHERE server_id = ?').run(serverId);
    return { stopped: true };
  }

  // === 获取状态 ===
  static getTunnelStatus(serverId) {
    const tunnel = this.tunnels.get(serverId);
    if (!tunnel) return { running: false };
    const connectAddress = tunnel.address && tunnel.remotePort ? `${tunnel.address}:${tunnel.remotePort}` : undefined;
    return { running: true, provider: tunnel.provider, tunnelId: tunnel.tunnelId, address: tunnel.address, port: tunnel.remotePort, connectAddress };
  }

  // === 启动时恢复隧道 ===
  static async restoreTunnels() {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM network_tunnels').all();
    const token = this.getNatfrpToken();
    if (rows.length === 0) return;
    console.log(`Restoring ${rows.length} tunnel(s)...`);

    const { frpcPath, configPath } = detectSakuraPaths();

    for (const row of rows) {
      const tunnelId = row.tunnel_id && row.tunnel_id !== 'undefined' ? parseInt(row.tunnel_id) : null;
      const remotePort = row.remote_port && row.remote_port !== 'undefined' ? row.remote_port : '';
      const address = row.address && row.address !== 'undefined' ? row.address : '';

      let frpcProcess = null;
      if (frpcPath && token && tunnelId) {
        // 尝试重启 frpc
        frpcProcess = await this.spawnFrpc(frpcPath, token, '-restore');
        // 同时写配置
        this.addTunnelToAutoStartSync(tunnelId);
      } else if (configPath && tunnelId) {
        // 没有 frpc 但有配置文件：写入 auto_start
        this.addTunnelToAutoStartSync(tunnelId);
      }

      this.tunnels.set(row.server_id, { provider: row.provider, tunnelId, remotePort, address, token: token || '', frpcProcess });
    }

    // 重启服务使 auto_start 配置生效
    if (configPath) {
      await this.restartNatfrpService();
    }

    // 刷新缺失的地址信息
    for (const row of rows) {
      const tunnel = this.tunnels.get(row.server_id);
      if (tunnel && tunnel.token && (!tunnel.remotePort || !tunnel.address)) {
        try {
          const list = await this.natfrpListTunnels(tunnel.token);
          const remote = Array.isArray(list) ? list.find(t => t.id === tunnel.tunnelId) : null;
          if (remote) {
            tunnel.remotePort = remote.remote;
            const nodes = await this.natfrpGetNodes(tunnel.token);
            const node = nodes.find(n => n.id === remote.node);
            if (node) tunnel.address = node.host;
            // 更新数据库
            db.prepare('UPDATE network_tunnels SET remote_port=?, address=? WHERE server_id=?')
              .run(tunnel.remotePort || '', tunnel.address || '', row.server_id);
          }
        } catch {}
      }
    }
    console.log(`Restored ${rows.length} tunnel(s)`);
  }

  static async refreshTunnelInfo(serverId) {
    const tunnel = this.tunnels.get(serverId);
    if (!tunnel || tunnel.provider !== 'natfrp' || !tunnel.token) return;
    try {
      const list = await this.natfrpListTunnels(tunnel.token);
      const remote = Array.isArray(list) ? list.find(t => t.id === tunnel.tunnelId) : null;
      if (remote) {
        tunnel.remotePort = remote.remote;
        const nodes = await this.natfrpGetNodes(tunnel.token);
        const node = nodes.find(n => n.id === remote.node);
        if (node) tunnel.address = node.host;
      }
    } catch {}
  }
}
