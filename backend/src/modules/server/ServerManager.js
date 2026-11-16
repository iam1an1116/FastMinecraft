import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, appendFile } from 'fs';
import { join, resolve } from 'path';
import { v4 as uuid } from 'uuid';
import { getDb } from '../../database/init.js';
import { broadcast } from '../../websocket/handler.js';
import { getJavaPath } from '../java/JavaManager.js';
import { MonitorManager } from '../monitor/MonitorManager.js';
import { INSTANCES_DIR } from '../../utils/paths.js';

const LOG_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_RAM_LOG_LINES = 800;
const MAX_DISK_LOG_LINES = 3000;

export class ServerManager {
  static processes = new Map();
  static downloadStatus = new Map(); // serverId -> { progress, status, error }
  static logBuffers = new Map(); // serverId -> Array<{ ts, line }>

  static appendLog(serverId, serverDir, line) {
    const ts = Date.now();
    const cleanLine = String(line).replace(/\r/g, '');
    if (!cleanLine) return;

    let buf = this.logBuffers.get(serverId);
    if (!buf) {
      buf = [];
      this.logBuffers.set(serverId, buf);
    }
    buf.push({ ts, line: cleanLine });
    if (buf.length > MAX_RAM_LOG_LINES) {
      buf.splice(0, buf.length - MAX_RAM_LOG_LINES);
    }

    if (serverDir && existsSync(serverDir)) {
      const logFile = join(serverDir, 'fm-console.jsonl');
      appendFile(logFile, JSON.stringify({ ts, line: cleanLine }) + '\n', () => {});
    }
  }

  static getLogs(serverId, limit = 500) {
    const cutoff = Date.now() - LOG_RETENTION_MS;
    const db = getDb();
    const server = db.prepare('SELECT path FROM servers WHERE id = ?').get(serverId);
    const serverDir = server?.path || join(INSTANCES_DIR, serverId);

    let buf = this.logBuffers.get(serverId);
    if (!buf) {
      buf = [];
      const logFile = join(serverDir, 'fm-console.jsonl');
      if (existsSync(logFile)) {
        try {
          const raw = readFileSync(logFile, 'utf-8').split('\n');
          let pruned = false;
          for (const row of raw) {
            if (!row.trim()) continue;
            try {
              const entry = JSON.parse(row);
              if (entry.ts >= cutoff && typeof entry.line === 'string') {
                buf.push(entry);
              } else {
                pruned = true;
              }
            } catch (_) {}
          }
          if (buf.length > MAX_DISK_LOG_LINES) {
            buf = buf.slice(-MAX_DISK_LOG_LINES);
            pruned = true;
          }
          if (pruned) {
            writeFileSync(logFile, buf.map(e => JSON.stringify(e)).join('\n') + (buf.length ? '\n' : ''));
          }
        } catch (_) {}
      }
      if (buf.length > MAX_RAM_LOG_LINES) {
        buf = buf.slice(-MAX_RAM_LOG_LINES);
      }
      this.logBuffers.set(serverId, buf);
    }

    const valid = buf.filter(e => e.ts >= cutoff);
    return valid.slice(-limit).map(e => e.line);
  }

  // Re-attach to running server processes on startup
  static async initExistingServers() {
    const db = getDb();
    const servers = db.prepare('SELECT * FROM servers').all();
    console.log(`Checking ${servers.length} servers...`);

    for (const server of servers) {
      const serverDir = server.path || join(INSTANCES_DIR,server.id);

      if (!existsSync(serverDir)) {
        if (server.status === 'running') {
          console.log(`Server ${server.name}: directory not found, marking as stopped`);
          db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', server.id);
        }
        continue;
      }

      // Check for running Java process (Unix only; Windows re-attaches via fresh start)
      let hasProcess = false;
      if (process.platform !== 'win32') {
        try {
          const launchConfig = this.findJarFile(serverDir, server.server_type);
          if (launchConfig) {
            const searchPath = launchConfig.path;
            const psOutput = execSync(`ps aux | grep "${searchPath}" | grep -v grep`, { encoding: 'utf-8' });
            hasProcess = psOutput.trim().length > 0;
          }
        } catch {}
      }

      if (hasProcess) {
        // Kill the old process (we can't re-attach to it)
        console.log(`Server ${server.name}: killing old process and restarting...`);
        try {
          const { execSync } = await import('child_process');
          const launchConfig = this.findJarFile(serverDir, server.server_type);
          const searchPath = launchConfig.path;
          const psOutput = execSync(`ps aux | grep "${searchPath}" | grep -v grep | awk '{print $2}'`, { encoding: 'utf-8' });
          const pids = psOutput.trim().split('\n').filter(Boolean);
          for (const pid of pids) {
            execSync(`kill ${pid}`);
          }
        } catch {}

        // Wait for process to exit
        await new Promise(r => setTimeout(r, 2000));

        // Restart with proper child reference
        try {
          await this.start(server.id);
          console.log(`Server ${server.name}: restarted successfully`);
        } catch (err) {
          console.log(`Server ${server.name}: failed to restart: ${err.message}`);
          db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', server.id);
        }
      } else if (server.status === 'running') {
        // No process found but status says running
        console.log(`Server ${server.name}: no process found, marking as stopped`);
        db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', server.id);
      }
    }
  }

  static create({ name, version, serverType, maxMemory = 2048, path: customPath }) {
    const id = uuid();

    // Use custom path or default
    const serverDir = customPath
      ? resolve(customPath, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${id.slice(0, 8)}`)
      : join(INSTANCES_DIR,id);

    mkdirSync(serverDir, { recursive: true });

    // Find available port
    const port = this.findAvailablePort();

    // Save to database
    const db = getDb();
    db.prepare(`
      INSERT INTO servers (id, name, version, server_type, port, max_memory, path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, version, serverType, port, maxMemory, serverDir);

    // Mark as downloading
    this.downloadStatus.set(id, { status: 'downloading', progress: 0 });
    broadcast(id, 'status', { status: 'downloading' });

    return { id, name, version, serverType, port, maxMemory, status: 'downloading', path: serverDir };
  }

  static getDownloadStatus(serverId) {
    return this.downloadStatus.get(serverId) || { status: 'unknown', progress: 0 };
  }

  static updateDownloadProgress(serverId, progress) {
    const percent = progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : 0;
    this.downloadStatus.set(serverId, {
      status: 'downloading',
      downloaded: progress.downloaded,
      total: progress.total,
      percent
    });
    broadcast(serverId, 'download-progress', { ...progress, percent });
  }

  static setDownloadComplete(serverId) {
    this.downloadStatus.delete(serverId);
    const db = getDb();
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
    broadcast(serverId, 'status', { status: 'stopped' });
  }

  static setDownloadError(serverId, error) {
    this.downloadStatus.set(serverId, { status: 'error', error: error.message });
    broadcast(serverId, 'status', { status: 'error', error: error.message });
  }

  static findAvailablePort() {
    const db = getDb();
    const usedPorts = db.prepare('SELECT port FROM servers').all().map(r => r.port);
    let port = 25565;
    while (usedPorts.includes(port)) port++;
    return port;
  }

  static async start(serverId) {
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    if (this.processes.has(serverId)) {
      throw new Error('Server already running');
    }

    // Check if still downloading
    const dlStatus = this.downloadStatus.get(serverId);
    if (dlStatus) {
      throw new Error('Server is still downloading');
    }

    const serverDir = server.path || join(INSTANCES_DIR,serverId);

    if (!existsSync(serverDir)) {
      throw new Error('Server directory not found: ' + serverDir);
    }

    const launchConfig = this.findJarFile(serverDir, server.server_type);
    if (!launchConfig) throw new Error('Server jar not found in ' + serverDir);

    // Ensure EULA accepted
    const eulaPath = join(serverDir, 'eula.txt');
    if (!existsSync(eulaPath)) {
      writeFileSync(eulaPath, 'eula=true\n');
    }

    // Write server.properties
    this.writeServerProperties(serverDir, server);

    // Get Java path
    const javaPath = await getJavaPath(server.version);

    let args;
    if (launchConfig.type === 'args') {
      // Forge/NeoForge uses @args.txt format
      args = [
        '-Djava.awt.headless=true',
        `-Xmx${server.max_memory}M`,
        `-Xms${Math.min(server.max_memory, 512)}M`,
        `@${launchConfig.path}`,
        'nogui'
      ];
    } else {
      args = [
        '-Djava.awt.headless=true',
        `-Xmx${server.max_memory}M`,
        `-Xms${Math.min(server.max_memory, 512)}M`,
        '-jar',
        launchConfig.path,
        'nogui'
      ];
    }

    const child = spawn(javaPath, args, {
      cwd: serverDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.processes.set(serverId, child);

    // Update status to starting
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('starting', serverId);
    broadcast(serverId, 'status', { status: 'starting' });

    // Track if server has fully started
    let serverStarted = false;

    // Handle stdout
    child.stdout.on('data', (data) => {
      const text = data.toString();
      // Split by newline - each line is a separate log entry
      const lines = text.split('\n').filter(l => l.length > 0);
      for (const line of lines) {
        this.appendLog(serverId, serverDir, line);
        broadcast(serverId, 'log', { line });
        MonitorManager.updateFromLog(serverId, line);

        // Detect server fully started (Done message) - only when in starting state
        if (!serverStarted && line.includes('Done') && line.includes('For help')) {
          serverStarted = true;
          const db = getDb();
          db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('running', serverId);
          broadcast(serverId, 'status', { status: 'running' });
        }
      }
    });

    // Handle stderr
    child.stderr.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n').filter(l => l.length > 0);
      for (const line of lines) {
        this.appendLog(serverId, serverDir, line);
        broadcast(serverId, 'log', { line, type: 'error' });
      }
    });

    // Handle exit
    child.on('exit', (code) => {
      this.processes.delete(serverId);
      MonitorManager.stopMonitoring(serverId);
      const status = code === 0 ? 'stopped' : 'crashed';
      db.prepare('UPDATE servers SET status = ? WHERE id = ?').run(status, serverId);
      broadcast(serverId, 'status', { status, exitCode: code });
    });

    // Start monitoring (stats + player tracking)
    MonitorManager.startMonitoring(serverId, server.max_memory);

    return { status: 'running' };
  }

  static async stop(serverId) {
    const child = this.processes.get(serverId);

    if (child) {
      // Check if process already exited
      if (child.exitCode !== null) {
        this.processes.delete(serverId);
        MonitorManager.stopMonitoring(serverId);
        const db = getDb();
        db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
        broadcast(serverId, 'status', { status: 'stopped' });
        return { status: 'stopped' };
      }

      child.stdin.write('stop\n');

      return new Promise((resolve) => {
        const cleanup = () => {
          clearTimeout(timer);
          const db = getDb();
          db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
          broadcast(serverId, 'status', { status: 'stopped' });
          this.processes.delete(serverId);
          MonitorManager.stopMonitoring(serverId);
          resolve({ status: 'stopped' });
        };

        child.on('exit', cleanup);

        // Force kill after 30 seconds
        const timer = setTimeout(() => {
          child.off('exit', cleanup);
          if (this.processes.has(serverId)) {
            child.kill('SIGKILL');
          }
          cleanup();
        }, 30000);
      });
    }

    // No reference - try to kill by finding the process
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    const serverDir = server.path || join(INSTANCES_DIR,serverId);
    const launchConfig = this.findJarFile(serverDir, server.server_type);
    if (launchConfig) {
      try {
        const searchPath = launchConfig.path;
        // Find and kill the Java process
        const psOutput = execSync(`ps aux | grep "${searchPath}" | grep -v grep | awk '{print $2}'`, { encoding: 'utf-8' });
        const pids = psOutput.trim().split('\n').filter(Boolean);
        for (const pid of pids) {
          execSync(`kill ${pid}`);
        }
      } catch {}
    }

    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
    broadcast(serverId, 'status', { status: 'stopped' });
    MonitorManager.stopMonitoring(serverId);
    return { status: 'stopped' };
  }

  static async forceStop(serverId) {
    const child = this.processes.get(serverId);
    if (child) {
      try { child.kill('SIGKILL'); } catch {}
      this.processes.delete(serverId);
    }
    MonitorManager.stopMonitoring(serverId);
    const db = getDb();
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
    broadcast(serverId, 'status', { status: 'stopped' });
    return { status: 'stopped' };
  }

  static async restart(serverId) {
    await this.stop(serverId);
    return this.start(serverId);
  }

  static sendCommand(serverId, command) {
    const child = this.processes.get(serverId);
    if (!child) throw new Error('Server not running');
    child.stdin.write(command + '\n');
  }

  static findJarFile(dir, serverType) {
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir);

    // Check for Forge/NeoForge args file first (match host OS)
    const preferredArgs = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
    const fallbackArgs = process.platform === 'win32' ? 'unix_args.txt' : 'win_args.txt';
    const argsFile = files.find(f => f === preferredArgs) || files.find(f => f === fallbackArgs);
    if (argsFile) return { type: 'args', path: join(dir, argsFile) };

    const patterns = {
      vanilla: /^minecraft_server.*\.jar$/,
      paper: /^paper-.*\.jar$/,
      purpur: /^purpur-.*\.jar$/,
      fabric: /^fabric-server.*\.jar$/,
      forge: /^forge-.*\.jar$/,
      neoforge: /^neoforge-.*\.jar$/,
      custom: /\.jar$/  // 自定义服务端匹配所有 jar 文件
    };
    const pattern = patterns[serverType] || /\.jar$/;
    const found = files.find(f => pattern.test(f));
    if (found) return { type: 'jar', path: join(dir, found) };

    // Fallback: find any jar that's not installer
    const anyJar = files.find(f => f.endsWith('.jar') && !f.includes('installer'));
    return anyJar ? { type: 'jar', path: join(dir, anyJar) } : null;
  }

  static writeServerProperties(dir, server) {
    const propsPath = join(dir, 'server.properties');

    // 读取已有属性（保留用户自定义设置）
    let existing = {};
    if (existsSync(propsPath)) {
      const content = readFileSync(propsPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          existing[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
        }
      }
    }

    // 合并：已有属性优先，但 server-port 必须用数据库的值
    const merged = {
      'server-port': String(server.port),
      'online-mode': 'false',
      'max-players': '20',
      'level-name': 'world',
      'enable-command-block': 'true',
      'motd': server.name,
      'difficulty': 'normal',
      'gamemode': 'survival',
      ...existing,
      'server-port': String(server.port), // 确保端口一定用数据库的值
    };

    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    writeFileSync(propsPath, lines.join('\n') + '\n');
  }

  static getAll() {
    const db = getDb();
    return db.prepare('SELECT * FROM servers ORDER BY created_at DESC').all();
  }

  static getById(id) {
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    if (server) {
      server.downloadStatus = this.getDownloadStatus(id);
    }
    return server;
  }

  static delete(id) {
    if (this.processes.has(id)) {
      this.processes.get(id).kill('SIGKILL');
      this.processes.delete(id);
    }
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    const serverDir = server?.path || join(INSTANCES_DIR,id);
    if (existsSync(serverDir)) {
      rmSync(serverDir, { recursive: true, force: true });
    }
    this.downloadStatus.delete(id);
    db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  }

  static updateConfig(id, config) {
    const db = getDb();
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(config)) {
      if (['name', 'max_memory', 'port'].includes(key)) {
        sets.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (sets.length > 0) {
      values.push(id);
      db.prepare(`UPDATE servers SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    return this.getById(id);
  }

  // 读取 server.properties
  static readServerProperties(id) {
    const server = this.getById(id);
    if (!server) throw new Error('Server not found');
    const dir = server.path || join(INSTANCES_DIR,id);
    const propsPath = join(dir, 'server.properties');
    if (!existsSync(propsPath)) return {};
    const content = readFileSync(propsPath, 'utf-8');
    const props = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        props[key] = value;
      }
    }
    return props;
  }

  // 写入 server.properties
  static writeServerPropertiesById(id, props) {
    const server = this.getById(id);
    if (!server) throw new Error('Server not found');
    const dir = server.path || join(INSTANCES_DIR,id);
    const propsPath = join(dir, 'server.properties');

    // 读取现有属性
    let existing = {};
    if (existsSync(propsPath)) {
      const content = readFileSync(propsPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          existing[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
        }
      }
    }

    // 合并
    const merged = { ...existing, ...props };

    // 写入
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    writeFileSync(propsPath, lines.join('\n') + '\n');
    return merged;
  }
}
