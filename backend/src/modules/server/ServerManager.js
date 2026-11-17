import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync, appendFile } from 'fs';
import { join, resolve, relative } from 'path';
import { StringDecoder } from 'string_decoder';
import treeKill from 'tree-kill';
import { v4 as uuid } from 'uuid';
import { getDb } from '../../database/init.js';
import { broadcast } from '../../websocket/handler.js';
import { getJavaPath } from '../java/JavaManager.js';
import { MonitorManager } from '../monitor/MonitorManager.js';
import { INSTANCES_DIR, resolveServerDir } from '../../utils/paths.js';

const LOG_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_RAM_LOG_LINES = 800;
const MAX_DISK_LOG_LINES = 3000;

export class ServerManager {
  static processes = new Map();
  static downloadStatus = new Map(); // serverId -> { progress, status, error }
  static logBuffers = new Map(); // serverId -> Array<{ ts, line }>
  static stoppingServers = new Set(); // serverId -> intentionally stopped

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
    const message = error?.message || String(error || 'Download failed');
    this.downloadStatus.set(serverId, { status: 'error', error: message });
    try {
      const db = getDb();
      db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('error', serverId);
    } catch {}
    broadcast(serverId, 'status', { status: 'error', error: message });
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
      if (dlStatus.status === 'error') {
        throw new Error(dlStatus.error || 'Server download failed');
      }
      throw new Error('Server is still downloading');
    }

    const serverDir = resolveServerDir(server, serverId);

    if (!existsSync(serverDir)) {
      throw new Error('Server directory not found: ' + serverDir);
    }

    // Unwrap single nested folder if user uploaded a zipped wrapper folder
    this.unwrapSingleSubdir(serverDir);

    const launchConfig = this.findJarFile(serverDir, server.server_type);
    if (!launchConfig) throw new Error('Server jar not found in ' + serverDir);

    // Ensure EULA accepted
    const eulaPath = join(serverDir, 'eula.txt');
    if (!existsSync(eulaPath)) {
      writeFileSync(eulaPath, 'eula=true\n');
    }

    // Write server.properties
    this.writeServerProperties(serverDir, server);

    // Get Java path (pass serverDir so custom/modded packs detect required Java version)
    const javaPath = await getJavaPath(server.version, null, serverDir);

    let args;
    if (launchConfig.type === 'args') {
      // Forge/NeoForge uses @args.txt format; relative path avoids spaces/Unicode path edge cases
      const relArgs = relative(serverDir, launchConfig.path);
      const argsTarget = relArgs && !relArgs.startsWith('..') ? relArgs : launchConfig.path;
      args = [
        '-Djava.awt.headless=true',
        '-Dfile.encoding=UTF-8',
        `-Xmx${server.max_memory}M`,
        `-Xms${Math.min(server.max_memory, 512)}M`,
        `@${argsTarget}`,
        'nogui'
      ];
    } else {
      args = [
        '-Djava.awt.headless=true',
        '-Dfile.encoding=UTF-8',
        `-Xmx${server.max_memory}M`,
        `-Xms${Math.min(server.max_memory, 512)}M`,
        '-jar',
        launchConfig.path,
        'nogui'
      ];
    }

    this.stoppingServers.delete(serverId);

    const child = spawn(javaPath, args, {
      cwd: serverDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.processes.set(serverId, child);
    child.stdin?.on('error', () => {});

    // Update status to starting
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('starting', serverId);
    broadcast(serverId, 'status', { status: 'starting' });

    // Track if server has fully started
    let serverStarted = false;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdoutBuf = '';
    let stderrBuf = '';

    const handleStdoutLine = (line) => {
      if (!line) return;
      this.appendLog(serverId, serverDir, line);
      broadcast(serverId, 'log', { line });
      MonitorManager.updateFromLog(serverId, line);

      // Detect server fully started (Done message)
      if (!serverStarted && line.includes('Done') && line.includes('For help')) {
        serverStarted = true;
        const dbNow = getDb();
        dbNow.prepare('UPDATE servers SET status = ? WHERE id = ?').run('running', serverId);
        broadcast(serverId, 'status', { status: 'running' });
      }
    };

    const handleStderrLine = (line) => {
      if (!line) return;
      this.appendLog(serverId, serverDir, line);
      broadcast(serverId, 'log', { line, type: 'error' });
    };

    // Handle stdout
    child.stdout.on('data', (data) => {
      stdoutBuf += stdoutDecoder.write(data);
      const parts = stdoutBuf.split(/\r?\n/);
      stdoutBuf = parts.pop() || '';
      for (const line of parts) {
        handleStdoutLine(line);
      }
    });

    // Handle stderr
    child.stderr.on('data', (data) => {
      stderrBuf += stderrDecoder.write(data);
      const parts = stderrBuf.split(/\r?\n/);
      stderrBuf = parts.pop() || '';
      for (const line of parts) {
        handleStderrLine(line);
      }
    });

    child.on('error', (err) => {
      this.processes.delete(serverId);
      this.stoppingServers.delete(serverId);
      MonitorManager.stopMonitoring(serverId);
      handleStderrLine(`Failed to launch Java: ${err.message}`);
      const dbNow = getDb();
      dbNow.prepare('UPDATE servers SET status = ? WHERE id = ?').run('crashed', serverId);
      broadcast(serverId, 'status', { status: 'crashed', error: err.message });
    });

    // Handle exit
    child.on('exit', (code) => {
      const restOut = stdoutBuf + stdoutDecoder.end();
      const restErr = stderrBuf + stderrDecoder.end();
      if (restOut.trim()) handleStdoutLine(restOut.trimEnd());
      if (restErr.trim()) handleStderrLine(restErr.trimEnd());
      stdoutBuf = '';
      stderrBuf = '';

      this.processes.delete(serverId);
      MonitorManager.stopMonitoring(serverId);
      const wasStopping = this.stoppingServers.delete(serverId);
      const status = (code === 0 || wasStopping) ? 'stopped' : 'crashed';
      const dbNow = getDb();
      dbNow.prepare('UPDATE servers SET status = ? WHERE id = ?').run(status, serverId);
      broadcast(serverId, 'status', { status, exitCode: code });
    });

    // Start monitoring (stats + player tracking)
    MonitorManager.startMonitoring(serverId, server.max_memory);

    return { status: 'running' };
  }

  static killProcessTree(pid) {
    return new Promise((resolve) => {
      if (!pid) return resolve();
      treeKill(pid, 'SIGKILL', () => resolve());
    });
  }

  static async stop(serverId) {
    const child = this.processes.get(serverId);
    this.stoppingServers.add(serverId);

    if (child) {
      // Check if process already exited
      if (child.exitCode !== null) {
        this.processes.delete(serverId);
        this.stoppingServers.delete(serverId);
        MonitorManager.stopMonitoring(serverId);
        const db = getDb();
        db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
        broadcast(serverId, 'status', { status: 'stopped' });
        return { status: 'stopped' };
      }

      try { child.stdin.write('stop\n'); } catch {}

      return new Promise((resolve) => {
        const cleanup = () => {
          clearTimeout(timer);
          const db = getDb();
          db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
          broadcast(serverId, 'status', { status: 'stopped' });
          this.processes.delete(serverId);
          this.stoppingServers.delete(serverId);
          MonitorManager.stopMonitoring(serverId);
          resolve({ status: 'stopped' });
        };

        child.once('exit', cleanup);

        // Force kill after 30 seconds
        const timer = setTimeout(async () => {
          child.off('exit', cleanup);
          if (this.processes.has(serverId)) {
            await this.killProcessTree(child.pid);
            try { child.kill('SIGKILL'); } catch {}
          }
          cleanup();
        }, 30000);
      });
    }

    // No reference - try to find and kill the Java process on POSIX hosts
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) {
      this.stoppingServers.delete(serverId);
      throw new Error('Server not found');
    }

    if (process.platform !== 'win32') {
      const serverDir = resolveServerDir(server, serverId);
      const launchConfig = this.findJarFile(serverDir, server.server_type);
      if (launchConfig) {
        try {
          const { execFileSync } = await import('child_process');
          const psOutput = execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf-8' });
          for (const line of psOutput.split('\n')) {
            if (line.includes(launchConfig.path) || line.includes(serverDir)) {
              const pid = parseInt(line.trim().split(/\s+/)[0], 10);
              if (pid && pid !== process.pid) {
                try { process.kill(pid, 'SIGTERM'); } catch {}
              }
            }
          }
        } catch {}
      }
    }

    this.stoppingServers.delete(serverId);
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run('stopped', serverId);
    broadcast(serverId, 'status', { status: 'stopped' });
    MonitorManager.stopMonitoring(serverId);
    return { status: 'stopped' };
  }

  static async forceStop(serverId) {
    this.stoppingServers.add(serverId);
    const child = this.processes.get(serverId);
    if (child) {
      await this.killProcessTree(child.pid);
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

  static looksLikeServerDir(dir, maxDepth = 2) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    const visible = entries.filter(e => !e.name.startsWith('.') && e.name !== '__MACOSX');
    if (visible.some(e =>
      e.name.endsWith('.jar') ||
      ['run.bat', 'run.sh', 'win_args.txt', 'unix_args.txt', 'server.properties', 'libraries', 'mods', 'plugins'].includes(e.name)
    )) {
      return true;
    }
    if (maxDepth > 0 && visible.length === 1 && visible[0].isDirectory()) {
      return this.looksLikeServerDir(join(dir, visible[0].name), maxDepth - 1);
    }
    return false;
  }

  static unwrapSingleSubdir(dir) {
    if (!existsSync(dir)) return false;
    const reservedDirs = new Set([
      'world', 'world_nether', 'world_the_end', 'mods', 'plugins',
      'libraries', 'config', 'logs', 'crash-reports', 'saves',
      'datapacks', 'cache', 'versions', 'assets'
    ]);
    let unwrapped = false;

    for (let depth = 0; depth < 2; depth++) {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        break;
      }
      const visible = entries.filter(e => !e.name.startsWith('.') && e.name !== '__MACOSX');
      if (visible.length !== 1 || !visible[0].isDirectory()) break;

      const subName = visible[0].name;
      if (reservedDirs.has(subName.toLowerCase())) break;

      const subDir = join(dir, subName);
      if (!this.looksLikeServerDir(subDir, 2)) break;

      const tmpDir = join(dir, `__unwrap_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      renameSync(subDir, tmpDir);
      try {
        for (const item of readdirSync(tmpDir, { withFileTypes: true })) {
          const src = join(tmpDir, item.name);
          const dst = join(dir, item.name);
          if (existsSync(dst)) {
            if (item.name.startsWith('.')) continue;
            rmSync(dst, { recursive: true, force: true });
          }
          renameSync(src, dst);
        }
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
      unwrapped = true;
    }
    return unwrapped;
  }

  static findArgsFileRecursive(baseDir, preferredName, fallbackName, maxDepth = 8) {
    if (!existsSync(baseDir)) return null;
    const queue = [{ dir: baseDir, depth: 0 }];
    let fallbackMatch = null;

    while (queue.length > 0) {
      const { dir, depth } = queue.shift();
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile()) {
          if (entry.name === preferredName) {
            return join(dir, entry.name);
          }
          if (!fallbackMatch && entry.name === fallbackName) {
            fallbackMatch = join(dir, entry.name);
          }
        } else if (entry.isDirectory() && depth < maxDepth && !entry.name.startsWith('.')) {
          queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
        }
      }
    }
    return fallbackMatch;
  }

  static findJarFile(dir, serverType) {
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir);

    // Check for Forge/NeoForge args file in root or nested libraries/ tree
    const preferredArgs = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
    const fallbackArgs = process.platform === 'win32' ? 'unix_args.txt' : 'win_args.txt';
    const rootArgs = files.find(f => f === preferredArgs) || files.find(f => f === fallbackArgs);
    if (rootArgs) return { type: 'args', path: join(dir, rootArgs) };

    const libsArgs = this.findArgsFileRecursive(join(dir, 'libraries'), preferredArgs, fallbackArgs);
    if (libsArgs) return { type: 'args', path: libsArgs };

    // Parse run.bat / run.sh generated by modern Forge / NeoForge / custom packs
    const runScripts = process.platform === 'win32' ? ['run.bat', 'run.sh'] : ['run.sh', 'run.bat'];
    for (const scriptName of runScripts) {
      if (!files.includes(scriptName)) continue;
      try {
        const scriptContent = readFileSync(join(dir, scriptName), 'utf-8');
        const argsMatch = scriptContent.match(/@["']?([^\s"'`]+(?:win|unix)_args\.txt)["']?/i);
        if (argsMatch) {
          const candidate = resolve(dir, argsMatch[1].replace(/[\\/]+/g, process.platform === 'win32' ? '\\' : '/'));
          if (existsSync(candidate)) {
            return { type: 'args', path: candidate };
          }
        }
        const jarMatch = scriptContent.match(/-jar\s+["']?([^\s"'`]+\.jar)["']?/i);
        if (jarMatch) {
          const candidate = resolve(dir, jarMatch[1].replace(/[\\/]+/g, process.platform === 'win32' ? '\\' : '/'));
          if (existsSync(candidate) && !candidate.toLowerCase().includes('installer')) {
            return { type: 'jar', path: candidate };
          }
        }
      } catch {}
    }

    const patterns = {
      vanilla: /^minecraft_server.*\.jar$/i,
      paper: /^paper-.*\.jar$/i,
      purpur: /^purpur-.*\.jar$/i,
      fabric: /^fabric-server.*\.jar$/i,
      forge: /^forge-.*\.jar$/i,
      neoforge: /^neoforge-.*\.jar$/i,
      custom: /\.jar$/i
    };
    const isInstaller = (name) => name.toLowerCase().includes('installer');
    const pattern = patterns[serverType] || /\.jar$/i;
    const found = files.find(f => pattern.test(f) && !isInstaller(f));
    if (found) return { type: 'jar', path: join(dir, found) };

    // Prefer standard server jar names before generic fallback
    const priorityJar = files.find(f =>
      /^(server|fabric-server-launch|paper-.*|purpur-.*|forge-.*|neoforge-.*)\.jar$/i.test(f) && !isInstaller(f)
    );
    if (priorityJar) return { type: 'jar', path: join(dir, priorityJar) };

    const anyJar = files.find(f => f.endsWith('.jar') && !isInstaller(f));
    return anyJar ? { type: 'jar', path: join(dir, anyJar) } : null;
  }

  static writeServerProperties(dir, server) {
    const propsPath = join(dir, 'server.properties');

    // 读取已有属性（保留用户自定义设置）
    let existing = {};
    if (existsSync(propsPath)) {
      const content = readFileSync(propsPath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
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
    const rows = db.prepare('SELECT * FROM servers ORDER BY created_at DESC').all();
    return rows.map((server) => ({
      ...server,
      downloadStatus: this.getDownloadStatus(server.id)
    }));
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
      this.stoppingServers.add(id);
      const child = this.processes.get(id);
      if (child?.pid) {
        treeKill(child.pid, 'SIGKILL', () => {});
      }
      try { child?.kill('SIGKILL'); } catch {}
      this.processes.delete(id);
    }
    MonitorManager.stopMonitoring(id);
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    const serverDir = resolveServerDir(server, id);
    if (existsSync(serverDir)) {
      rmSync(serverDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    this.downloadStatus.delete(id);
    db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  }

  static updateConfig(id, config) {
    const db = getDb();
    const normalized = { ...config };
    if (normalized.maxMemory !== undefined && normalized.max_memory === undefined) {
      normalized.max_memory = normalized.maxMemory;
    }

    const sets = [];
    const values = [];
    let updatedPort = null;

    for (const [key, value] of Object.entries(normalized)) {
      if (!['name', 'max_memory', 'port'].includes(key)) continue;
      if (key === 'max_memory') {
        const mem = parseInt(value, 10);
        if (!Number.isFinite(mem) || mem < 256) continue;
        sets.push('max_memory = ?');
        values.push(mem);
      } else if (key === 'port') {
        const port = parseInt(value, 10);
        if (!Number.isFinite(port) || port < 1 || port > 65535) continue;
        sets.push('port = ?');
        values.push(port);
        updatedPort = port;
      } else if (key === 'name') {
        const name = String(value || '').trim();
        if (!name) continue;
        sets.push('name = ?');
        values.push(name);
      }
    }

    if (sets.length > 0) {
      values.push(id);
      db.prepare(`UPDATE servers SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    if (updatedPort !== null) {
      try {
        const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
        const dir = resolveServerDir(server, id);
        if (existsSync(join(dir, 'server.properties'))) {
          this.writeServerProperties(dir, { ...server, port: updatedPort });
        }
      } catch {}
    }

    return this.getById(id);
  }

  // 读取 server.properties
  static readServerProperties(id) {
    const server = this.getById(id);
    if (!server) throw new Error('Server not found');
    const dir = resolveServerDir(server, id);
    const propsPath = join(dir, 'server.properties');
    if (!existsSync(propsPath)) return {};
    const content = readFileSync(propsPath, 'utf-8');
    const props = {};
    for (const line of content.split(/\r?\n/)) {
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
    const dir = resolveServerDir(server, id);
    mkdirSync(dir, { recursive: true });
    const propsPath = join(dir, 'server.properties');

    // 读取现有属性
    let existing = {};
    if (existsSync(propsPath)) {
      const content = readFileSync(propsPath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
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

    // Sync server-port back to servers DB table so P2P & status cards stay consistent
    const portNum = parseInt(merged['server-port'], 10);
    if (Number.isFinite(portNum) && portNum >= 1 && portNum <= 65535 && portNum !== server.port) {
      const db = getDb();
      db.prepare('UPDATE servers SET port = ? WHERE id = ?').run(portNum, id);
    }

    return merged;
  }
}
