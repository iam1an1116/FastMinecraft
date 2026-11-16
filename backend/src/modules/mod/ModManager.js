import { existsSync, mkdirSync, readdirSync, writeFileSync, unlinkSync, renameSync, statSync } from 'fs';
import { join, basename } from 'path';
import { v4 as uuid } from 'uuid';
import { getDb } from '../../database/init.js';
import { INSTANCES_DIR } from '../../utils/paths.js';

export class ModManager {
  static list(serverId) {
    const db = getDb();
    const dbMods = db.prepare('SELECT * FROM mods WHERE server_id = ? ORDER BY created_at DESC').all(serverId);

    // Also scan the mods directory
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) return dbMods;

    const serverDir = server.path || join(INSTANCES_DIR, serverId);
    const modDir = join(serverDir, 'mods');

    if (!existsSync(modDir)) return dbMods;

    const files = readdirSync(modDir).filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled'));
    const dbFileNames = new Set(dbMods.map(m => m.file_name));

    // Add files that aren't in the database
    const fileMods = [];
    for (const file of files) {
      if (!dbFileNames.has(file)) {
        const filePath = join(modDir, file);
        const stats = statSync(filePath);
        fileMods.push({
          id: file,
          server_id: serverId,
          name: file.replace('.jar.disabled', '').replace('.jar', ''),
          file_name: file,
          loader: server.server_type,
          enabled: file.endsWith('.jar') ? 1 : 0,
          created_at: stats.mtime.toISOString(),
          from_file: true
        });
      }
    }

    return [...fileMods, ...dbMods];
  }

  static upload(serverId, file, loader) {
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    const modDir = join(INSTANCES_DIR, serverId, 'mods');
    mkdirSync(modDir, { recursive: true });

    const fileName = basename(file.originalname);
    const filePath = join(modDir, fileName);
    writeFileSync(filePath, file.buffer);

    const id = uuid();
    db.prepare(`
      INSERT INTO mods (id, server_id, name, file_name, loader, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, serverId, fileName.replace('.jar', ''), fileName, loader);

    return { id, name: fileName.replace('.jar', ''), fileName, loader };
  }

  static toggle(serverId, modId, enabled) {
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    const serverDir = server.path || join(INSTANCES_DIR, serverId);
    const modDir = join(serverDir, 'mods');

    // Check database first
    let mod = db.prepare('SELECT * FROM mods WHERE id = ? AND server_id = ?').get(modId, serverId);

    if (!mod) {
      // Might be a file-based mod, find by filename
      const files = readdirSync(modDir).filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled'));
      const matchFile = files.find(f => f === modId || f.replace('.jar.disabled', '').replace('.jar', '') === modId);
      if (!matchFile) throw new Error('Mod not found');

      // Add to database
      const id = uuid();
      db.prepare(`INSERT INTO mods (id, server_id, name, file_name, loader, enabled) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, serverId, matchFile.replace('.jar.disabled', '').replace('.jar', ''), matchFile, server.server_type, matchFile.endsWith('.jar') ? 1 : 0);
      mod = { id, file_name: matchFile };
      modId = id;
    }

    const oldPath = join(modDir, mod.file_name);
    const newPath = enabled
      ? oldPath.replace('.jar.disabled', '.jar')
      : oldPath.replace('.jar', '.jar.disabled');

    if (existsSync(oldPath)) {
      renameSync(oldPath, newPath);
    }

    db.prepare('UPDATE mods SET enabled = ?, file_name = ? WHERE id = ?')
      .run(enabled ? 1 : 0, basename(newPath), modId);

    return { ...mod, enabled: !!enabled, file_name: basename(newPath) };
  }

  static delete(serverId, modId) {
    const db = getDb();
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    const serverDir = server.path || join(INSTANCES_DIR, serverId);
    const modDir = join(serverDir, 'mods');

    // Check database first
    let mod = db.prepare('SELECT * FROM mods WHERE id = ? AND server_id = ?').get(modId, serverId);

    if (!mod) {
      // Might be a file-based mod
      const files = readdirSync(modDir).filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled'));
      const matchFile = files.find(f => f === modId || f.replace('.jar.disabled', '').replace('.jar', '') === modId);
      if (!matchFile) throw new Error('Mod not found');

      const filePath = join(modDir, matchFile);
      if (existsSync(filePath)) unlinkSync(filePath);
      return { deleted: true };
    }

    const filePath = join(modDir, mod.file_name);
    if (existsSync(filePath)) unlinkSync(filePath);

    db.prepare('DELETE FROM mods WHERE id = ?').run(modId);
    return { deleted: true };
  }
}
