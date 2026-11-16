import { existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';
import { v4 as uuid } from 'uuid';
import { getDb } from '../../database/init.js';
import { BACKUPS_DIR, INSTANCES_DIR } from '../../utils/paths.js';

export class BackupManager {
  static create(serverId, type = 'world') {
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    const serverDir = join(INSTANCES_DIR, serverId);
    const backupId = uuid();
    const backupDir = join(BACKUPS_DIR, serverId);
    mkdirSync(backupDir, { recursive: true });

    const fileName = `${type}_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const filePath = join(backupDir, fileName);

    const zip = new AdmZip();

    if (type === 'world' || type === 'full') {
      const worldDir = join(serverDir, 'world');
      if (existsSync(worldDir)) {
        zip.addLocalFolder(worldDir, 'world');
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
    if (server && server.status === 'running') {
      throw new Error('Server must be stopped before restoring a backup');
    }

    const serverDir = join(INSTANCES_DIR, backup.server_id);
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
