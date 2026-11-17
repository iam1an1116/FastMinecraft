import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'fs';
import { basename, join } from 'path';
import AdmZip from 'adm-zip';
import { v4 as uuid } from 'uuid';
import { getDb } from '../../database/init.js';
import { BACKUPS_DIR, resolveServerDir } from '../../utils/paths.js';

function getWorldName(serverDir) {
  const propsPath = join(serverDir, 'server.properties');
  if (existsSync(propsPath)) {
    try {
      const content = readFileSync(propsPath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0 && trimmed.slice(0, eq).trim() === 'level-name') {
          const val = basename(trimmed.slice(eq + 1).trim());
          if (val) return val;
        }
      }
    } catch {}
  }
  return 'world';
}

export class BackupManager {
  static create(serverId, type = 'world') {
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    const serverDir = resolveServerDir(server, serverId);
    const backupId = uuid();
    const backupDir = join(BACKUPS_DIR, serverId);
    mkdirSync(backupDir, { recursive: true });

    const fileName = `${type}_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const filePath = join(backupDir, fileName);

    const zip = new AdmZip();

    if (type === 'world' || type === 'full') {
      const worldName = getWorldName(serverDir);
      const worldDir = join(serverDir, worldName);
      if (existsSync(worldDir)) {
        zip.addLocalFolder(worldDir, worldName);
      }
    }
    if (type === 'plugin' || type === 'full') {
      const pluginDir = join(serverDir, 'plugins');
      if (existsSync(pluginDir)) {
        zip.addLocalFolder(pluginDir, 'plugins');
      }
    }
    if (type === 'config' || type === 'full') {
      const files = ['server.properties', 'eula.txt', 'bukkit.yml', 'spigot.yml', 'paper.yml'];
      for (const file of files) {
        const fPath = join(serverDir, file);
        if (existsSync(fPath)) {
          zip.addLocalFile(fPath);
        }
      }
    }

    zip.writeZip(filePath);

    const fileSize = statSync(filePath).size;

    db.prepare(`
      INSERT INTO backups (id, server_id, type, file_path, file_size)
      VALUES (?, ?, ?, ?, ?)
    `).run(backupId, serverId, type, filePath, fileSize);

    return { id: backupId, type, filePath, fileSize };
  }

  static restore(backupId) {
    const db = getDb();
    const backup = db.prepare('SELECT * FROM backups WHERE id = ?').get(backupId);
    if (!backup) throw new Error('Backup not found');

    // Prevent restoring while server is running to avoid world corruption
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(backup.server_id);
    if (server && (server.status === 'running' || server.status === 'starting')) {
      throw new Error('Server must be stopped before restoring a backup');
    }

    const serverDir = resolveServerDir(server, backup.server_id);
    const zip = new AdmZip(backup.file_path);
    zip.extractAllTo(serverDir, true);

    return { restored: true };
  }

  static list(serverId) {
    const db = getDb();
    return db.prepare('SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC').all(serverId);
  }

  static delete(backupId) {
    const db = getDb();
    const backup = db.prepare('SELECT * FROM backups WHERE id = ?').get(backupId);
    if (!backup) throw new Error('Backup not found');

    if (existsSync(backup.file_path)) {
      unlinkSync(backup.file_path);
    }

    db.prepare('DELETE FROM backups WHERE id = ?').run(backupId);
    return { deleted: true };
  }
}
