import { exec, spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform, tmpdir } from 'os';
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

  // 获取 frpc 配置文件（返回原始文本，不是 JSON）
  static async getFrpcConfig(token, tunnelId, frpcPath) {
    // 先尝试检测用户机器上的 frpc 版本
    let frpcVer = '0.51.0-sakura-12.3'; // 默认最新版本
    try {
      const result = execSync(`"${frpcPath}" --version`, { encoding: 'utf-8', timeout: 5000 });
      const match = result.match(/(\d+\.\d+\.\d+[^\s]*)/);
      if (match) {
        frpcVer = match[1];
        console.log(`[getFrpcConfig] Detected frpc version: ${frpcVer}`);
      }
    } catch {}
    console.log(`[getFrpcConfig] Using frpc version: ${frpcVer}`);

    const url = `${NATFRP_API}/tunnel/config?token=${encodeURIComponent(token)}`;
    const res = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query: String(tunnelId), frpc: frpcVer }).toString()
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`获取 frpc 配置失败 (HTTP ${res.status}): ${text.slice(0, 200)}`);
    return text;
  }

  // 启动 frpc（使用配置文件），返回进程对象或 { error }
  static async spawnFrpc(frpcPath, token, tunnelId, label = '', onDeath = null) {
    const frpcDir = join(frpcPath, '..');
    const logs = [];
    const emit = (msg) => { console.log(`[spawnFrpc${label}] ${msg}`); logs.push(msg); };

    try {
      // 1. 获取 frpc 版本
      let frpcVer = '0.51.0-sakura-12.3';
      try {
        const result = execSync(`"${frpcPath}" --version`, { encoding: 'utf-8', timeout: 5000 });
        const match = result.match(/(\d+\.\d+\.\d+[^\s]*)/);
        if (match) frpcVer = match[1];
        emit(`frpc --version => ${frpcVer}`);
      } catch (e) { emit('frpc --version 失败: ' + e.message); }

      // 2. 从 API 获取配置文件
      emit(`请求 tunnel/config (query=${tunnelId}, frpc=${frpcVer})`);
      const res = await safeFetch(`${NATFRP_API}/tunnel/config?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query: String(tunnelId), frpc: frpcVer }).toString()
      });
      const configText = await res.text();
      emit(`API 响应 HTTP ${res.status}, body 长度=${configText.length}`);

      if (!res.ok) {
        emit(`API 错误: ${configText.slice(0, 500)}`);
        return { error: `API 返回错误 HTTP ${res.status}:\n${configText.slice(0, 500)}`, logs };
      }

      // 验证返回的是有效的 ini 配置
      if (!configText.includes('[common]') || !configText.includes('server_addr')) {
        emit(`配置内容异常（不像合法的 frpc 配置）: ${configText.slice(0, 300)}`);
      }

      // 3. 写入临时文件
      const tmpDir = join(tmpdir(), 'fm-frpc');
      mkdirSync(tmpDir, { recursive: true });
      const configPath = join(tmpDir, `frpc-${tunnelId}.ini`);
      writeFileSync(configPath, configText);
      emit(`配置写入: ${configPath} (${configText.length} bytes)`);

      // 4. 启动 frpc
      emit(`启动: "${frpcPath}" -c "${configPath}"`);
      const child = spawn(frpcPath, ['-c', configPath], {
        cwd: frpcDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      child.stdout?.on('data', d => {
        const t = d.toString().trim();
        if (t) emit(`stdout: ${t}`);
      });
      child.stderr?.on('data', d => {
        const t = d.toString().trim();
        if (t) { stderr += t + '\n'; emit(`stderr: ${t}`); }
      });
      child.on('error', err => {
        emit(`spawn error 事件: ${err.message}`);
      });
      child.on('exit', code => {
        emit(`frpc 退出 code=${code}`);
        try { unlinkSync(configPath); } catch {}
        if (onDeath) onDeath(code);
      });

      // 等待 5 秒确认存活（Windows 上启动可能较慢）
      const survived = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(true), 5000);
        child.on('exit', () => { clearTimeout(timer); resolve(false); });
      });

      if (survived) {
        emit(`frpc 存活 (PID ${child.pid})`);
        return child;
      }

      child.removeAllListeners('exit');
      try { unlinkSync(configPath); } catch {}
      try { child.kill(); } catch {}
      const errMsg = `frpc 立即退出:\nstderr: ${stderr.trim() || '(无)'}\n日志: ${logs.slice(-8).join('\n')}`;
      emit(errMsg);
      return { error: errMsg, logs };
    } catch (e) {
      emit(`异常: ${e.message}`);
      return { error: `异常: ${e.message}\n日志:\n${logs.join('\n')}`, logs };
    }
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

    // === 隧道已在 API 创建。frpc 用 -f token 连接后会自动激活所有隧道，无需单独调用 start API ===

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

    // 4. 本地 frpc 启动
    let frpcProcess = null;
    let localOk = false;
    let localError = '';
    const { frpcPath, configPath } = detectSakuraPaths();
    const frpcAlreadyRunning = this.isFrpcRunning();

    const onFrpcDeath = (code) => {
      const t = this.tunnels.get(serverId);
      if (t) { t.frpcProcess = null; t.frpcDead = true; }
    };

    // 始终优先直接 spawn frpc —— 不依赖 SakuraLauncher，即使已有 frpc 也在跑
    if (!localOk && frpcPath) {
      const r = await this.spawnFrpc(frpcPath, token, tunnelId, '', onFrpcDeath);
      if (r && r.error) {
        localError = 'frpc 直接启动失败：' + (r.logs ? r.logs.slice(-5).join('\n') : r.error);
      } else if (r) {
        frpcProcess = r;
        localOk = true;
      }
    }

    // spawn 失败，但 SakuraLauncher 的 frpc 在运行——杀掉 natfrp-service 让它重新加载配置
    if (!localOk && frpcAlreadyRunning) {
      try { await this.restartNatfrpService(); localOk = true; localError = ''; }
      catch (err) { localError = '重启 natfrp-service 失败：' + err.message; }
    }

    // 最后尝试：写入配置 + 重启服务
    if (!localOk && configPath) {
      if (this.addTunnelToAutoStartSync(tunnelId)) {
        try { await this.restartNatfrpService(); localOk = true; localError = ''; }
        catch (err) { localError = '重启 natfrp-service 失败：' + err.message; }
      } else {
        localError = '写入 SakuraLauncher 配置失败';
      }
    }

    if (!localOk) {
      if (!frpcPath && !configPath) {
        throw new Error('未检测到 frpc，请安装 SakuraLauncher 或手动指定 frpc 路径');
      }
      if (localError) {
        throw new Error('frpc 启动失败：' + localError);
      }
    }

    // 5. 保存状态
    this.tunnels.set(serverId, {
      provider: 'natfrp', tunnelId, remotePort: remotePort || '', address: nodeHost, token, frpcProcess,
      configured: localOk  // 本地 frpc 是否已成功配置/启动
    });
    getDb().prepare(`INSERT OR REPLACE INTO network_tunnels (server_id, provider, tunnel_id, remote_port, address) VALUES (?, ?, ?, ?, ?)`)
      .run(serverId, 'natfrp', String(tunnelId), remotePort ? String(remotePort) : '', nodeHost);

    return { provider: 'natfrp', tunnelId, address: nodeHost, port: remotePort, connectAddress, localOk, localError };
  }

  // === 停止隧道 ===
  static async stopTunnel(serverId) {
    const tunnel = this.tunnels.get(serverId);
    if (!tunnel) throw new Error('没有运行中的隧道');

    if (tunnel.provider === 'natfrp' && tunnel.tunnelId) {
      // 从配置文件移除（不改动 natfrp-service，避免影响其他隧道）
      this.removeTunnelFromAutoStartSync(tunnel.tunnelId);

      // 杀掉本隧道的 frpc 进程
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

    // 判断 frpc 是否仍在运行
    let frpcAlive = false;
    if (tunnel.frpcProcess) {
      frpcAlive = !tunnel.frpcProcess.killed && tunnel.frpcProcess.exitCode === null;
      if (!frpcAlive) tunnel.frpcProcess = null;
    }
    // frpcDead 是 onDeath 回调设置的，表示进程意外退出
    if (tunnel.frpcDead) {
      tunnel.frpcDead = false;
      tunnel.frpcProcess = null;
    }

    // 判断隧道是否真正在运行
    // - frpcAlive: frpc 进程存活
    // - tunnel.configured: Mac 配置方式，frpc 由 SakuraLauncher 管理
    const isRunning = frpcAlive || !!tunnel.configured;

    const connectAddress = tunnel.address && tunnel.remotePort ? `${tunnel.address}:${tunnel.remotePort}` : undefined;
    return { running: isRunning, provider: tunnel.provider, tunnelId: tunnel.tunnelId, address: tunnel.address, port: tunnel.remotePort, connectAddress };
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
        const r = await this.spawnFrpc(frpcPath, token, tunnelId, '-restore');
        if (r && !r.error) frpcProcess = r;
        this.addTunnelToAutoStartSync(tunnelId);
      } else if (configPath && tunnelId) {
        this.addTunnelToAutoStartSync(tunnelId);
      }

      this.tunnels.set(row.server_id, { provider: row.provider, tunnelId, remotePort, address, token: token || '', frpcProcess, configured: !!frpcProcess });
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
