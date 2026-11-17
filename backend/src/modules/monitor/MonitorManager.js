import os from 'os';
import { execSync, execFile } from 'child_process';
import { broadcast } from '../../websocket/handler.js';
import { ServerManager } from '../server/ServerManager.js';

const statsCache = new Map(); // serverId -> { tps, mspt, players, chunks, entities, proc }
const playerCache = new Map(); // serverId -> Map<playerName, { name, ip, ping, joinTime }>
const monitorIntervals = new Map(); // serverId -> interval
const winSamplePending = new Set();

function sampleWindowsStatsAsync(serverId, pid, maxMemoryMB) {
  if (winSamplePending.has(serverId)) return;
  winSamplePending.add(serverId);
  const psCmd = `$p=Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if($p){"$($p.WorkingSet64),$($p.CPU)"}`;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psCmd],
    { encoding: 'utf8', timeout: 2500, windowsHide: true },
    (err, stdout) => {
      winSamplePending.delete(serverId);
      if (err || !stdout) return;
      const parts = stdout.trim().split(',');
      const wsBytes = parseInt(parts[0], 10) || 0;
      const cpuSecs = parseFloat(parts[1]) || 0;
      const now = Date.now();
      const cached = statsCache.get(serverId) || {};
      const prev = cached.procSample;
      let cpuPercent = 0;
      if (prev && cpuSecs >= prev.cpuSecs && now > prev.ts) {
        const elapsedSecs = (now - prev.ts) / 1000;
        const cores = Math.max(1, os.cpus().length);
        cpuPercent = Math.min(100, Math.round((((cpuSecs - prev.cpuSecs) / elapsedSecs) / cores) * 10000) / 100);
      }
      const memoryUsed = Math.round(wsBytes / (1024 * 1024));
      cached.procSample = { cpuSecs, ts: now };
      cached.proc = {
        cpu: cpuPercent,
        memoryUsed,
        memory: memoryUsed,
        memoryTotal: maxMemoryMB,
        memoryPercent: maxMemoryMB > 0 ? Math.round((memoryUsed / maxMemoryMB) * 10000) / 100 : 0,
      };
      statsCache.set(serverId, cached);
    }
  );
}

export class MonitorManager {
  static getProcessStats(pid, maxMemoryMB, serverId = null) {
    if (process.platform === 'win32') {
      if (serverId) sampleWindowsStatsAsync(serverId, pid, maxMemoryMB);
      return (serverId && statsCache.get(serverId)?.proc) || null;
    }

    try {
      const output = execSync(`ps -p ${pid} -o %cpu,rss`, { encoding: 'utf-8' });
      const lines = output.trim().split('\n');
      if (lines.length < 2) return null;
      const parts = lines[1].trim().split(/\s+/);
      const rawCpu = parseFloat(parts[0]) || 0;
      const rssKB = parseInt(parts[1]) || 0;
      const memoryUsed = Math.round(rssKB / 1024);
      const cpuCores = Math.max(1, os.cpus().length);
      const cpu = Math.min(Math.round((rawCpu / cpuCores) * 100) / 100, 100);
      return {
        cpu,
        memoryUsed,
        memory: memoryUsed,
        memoryTotal: maxMemoryMB,
        memoryPercent: maxMemoryMB > 0 ? Math.round((memoryUsed / maxMemoryMB) * 100 * 100) / 100 : 0
      };
    } catch {
      return null;
    }
  }

  static getServerStats(serverId) {
    const cached = statsCache.get(serverId) || {};
    const players = playerCache.get(serverId);

    const child = ServerManager.processes.get(serverId);
    let processStats = null;
    if (child && child.pid) {
      processStats = this.getProcessStats(child.pid, cached.maxMemory || 2048, serverId);
    }

    const sys = processStats || {
      cpu: 0,
      memoryUsed: 0,
      memory: 0,
      memoryTotal: cached.maxMemory || 2048,
      memoryPercent: 0
    };

    return {
      ...sys,
      tps: cached.tps ?? 20,
      mspt: cached.mspt ?? 0,
      players: players ? players.size : (cached.players ?? 0),
      chunks: cached.chunks ?? 0,
      entities: cached.entities ?? 0
    };
  }

  static getPlayers(serverId) {
    const players = playerCache.get(serverId);
    if (!players) return [];
    return Array.from(players.values());
  }

  static updateFromLog(serverId, line) {
    // Parse TPS from Paper/Spigot: "TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0"
    const tpsMatch = line.match(/TPS from last 1m, 5m, 15m:\s*([\d.]+)/);
    if (tpsMatch) {
      const cached = statsCache.get(serverId) || {};
      cached.tps = parseFloat(tpsMatch[1]);
      statsCache.set(serverId, cached);
    }

    // Parse TPS from Vanilla: "XX.XX ticks per second"
    const tpsMatch2 = line.match(/([\d.]+) ticks per second/);
    if (tpsMatch2) {
      const cached = statsCache.get(serverId) || {};
      cached.tps = parseFloat(tpsMatch2[1]);
      statsCache.set(serverId, cached);
    }

    // Parse MSPT: "Mean tick time: XX.XX ms"
    const msptMatch = line.match(/Mean tick time:\s*([\d.]+)\s*ms/);
    if (msptMatch) {
      const cached = statsCache.get(serverId) || {};
      cached.mspt = parseFloat(msptMatch[1]);
      statsCache.set(serverId, cached);
    }

    // Parse player count from "list" command response
    // "There are 2 of a max of 20 players online: Player1, Player2"
    const playerMatch = line.match(/There are (\d+) of a max of (\d+) players online/);
    if (playerMatch) {
      const cached = statsCache.get(serverId) || {};
      cached.players = parseInt(playerMatch[1]);
      statsCache.set(serverId, cached);
    }

    // === Player Join Patterns ===

    // Pattern 1: "Username[/ip:port] logged in with entity id" (vanilla/paper/fabric)
    const join1 = line.match(/(\w+)\[\/([\d.]+):\d+]\s+logged in/);
    if (join1) {
      this.addPlayer(serverId, join1[1], join1[2]);
      return;
    }

    // Pattern 2: "Username joined the game" (vanilla/paper/fabric)
    const join2 = line.match(/(\w+)\s+joined the game/);
    if (join2) {
      this.addPlayer(serverId, join2[1], '');
      return;
    }

    // Pattern 3: "UUID of player Username is" (paper)
    const join3 = line.match(/UUID of player (\w+) is/);
    if (join3) {
      this.addPlayer(serverId, join3[1], '');
      return;
    }

    // === Player Leave Patterns ===

    // Pattern 1: "Username left the game"
    const leave1 = line.match(/(\w+)\s+left the game/);
    if (leave1) {
      this.removePlayer(serverId, leave1[1]);
      return;
    }

    // Pattern 2: "Username lost connection"
    const leave2 = line.match(/(\w+)\s+lost connection/);
    if (leave2) {
      this.removePlayer(serverId, leave2[1]);
      return;
    }

    // Pattern 3: "Username disconnected"
    const leave3 = line.match(/(\w+)\s+disconnected/);
    if (leave3) {
      this.removePlayer(serverId, leave3[1]);
      return;
    }
  }

  static addPlayer(serverId, name, ip) {
    if (!playerCache.has(serverId)) {
      playerCache.set(serverId, new Map());
    }
    const players = playerCache.get(serverId);
    if (!players.has(name)) {
      players.set(name, {
        name,
        ip: ip || '',
        ping: 0,
        joinTime: new Date().toISOString()
      });
    } else if (ip) {
      // Update IP if we got it
      players.get(name).ip = ip;
    }
  }

  static removePlayer(serverId, name) {
    const players = playerCache.get(serverId);
    if (players) {
      players.delete(name);
    }
  }

  static startMonitoring(serverId, maxMemory = 2048) {
    // Don't start if already monitoring
    if (monitorIntervals.has(serverId)) return;

    // Initialize player cache
    if (!playerCache.has(serverId)) {
      playerCache.set(serverId, new Map());
    }

    // Store server's max memory for stats
    const cached = statsCache.get(serverId) || {};
    cached.maxMemory = maxMemory;
    statsCache.set(serverId, cached);

    // Send stats every 2 seconds
    const interval = setInterval(() => {
      if (!ServerManager.processes.has(serverId)) {
        this.stopMonitoring(serverId);
        return;
      }
      const stats = this.getServerStats(serverId);
      broadcast(serverId, 'stats', stats);
    }, 2000);

    monitorIntervals.set(serverId, interval);
  }

  static stopMonitoring(serverId) {
    const interval = monitorIntervals.get(serverId);
    if (interval) {
      clearInterval(interval);
      monitorIntervals.delete(serverId);
    }
    statsCache.delete(serverId);
    playerCache.delete(serverId);
  }
}
