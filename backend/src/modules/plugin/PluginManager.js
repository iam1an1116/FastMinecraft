import { existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync } from 'fs';
import { join, basename } from 'path';
import { v4 as uuid } from 'uuid';
import { getDb } from '../../database/init.js';
import { resolveServerDir, decodeUploadFilename } from '../../utils/paths.js';

function getPluginsDir(serverId) {
  const db = getDb();
  const server = db.prepare('SELECT id, path FROM servers WHERE id = ?').get(serverId);
  if (!server) throw new Error('Server not found');
  return join(resolveServerDir(server, serverId), 'plugins');
}

export class PluginManager {
  static list(serverId) {
    const db = getDb();
    return db.prepare('SELECT * FROM plugins WHERE server_id = ? ORDER BY created_at DESC').all(serverId);
  }

  static upload(serverId, file) {
    const db = getDb();
    const serverDir = getPluginsDir(serverId);
    mkdirSync(serverDir, { recursive: true });

    const fileName = decodeUploadFilename(file.originalname);
    const filePath = join(serverDir, fileName);
    writeFileSync(filePath, file.buffer);

    const displayName = fileName.replace(/\.jar(\.disabled)?$/i, '');
    const id = uuid();
    db.prepare(`
      INSERT INTO plugins (id, server_id, name, file_name, enabled)
      VALUES (?, ?, ?, ?, 1)
    `).run(id, serverId, displayName, fileName);

    return { id, name: displayName, fileName };
  }

  static toggle(serverId, pluginId, enabled) {
    const db = getDb();
    const plugin = db.prepare('SELECT * FROM plugins WHERE id = ? AND server_id = ?').get(pluginId, serverId);
    if (!plugin) throw new Error('Plugin not found');

    const serverDir = getPluginsDir(serverId);
    const oldPath = join(serverDir, plugin.file_name);
    const newPath = enabled
      ? oldPath.replace(/\.jar\.disabled$/i, '.jar')
      : oldPath.replace(/\.jar$/i, '.jar.disabled');

    if (existsSync(oldPath) && oldPath !== newPath) {
      renameSync(oldPath, newPath);
    }

    db.prepare('UPDATE plugins SET enabled = ?, file_name = ? WHERE id = ?')
      .run(enabled ? 1 : 0, basename(newPath), pluginId);

    return { ...plugin, enabled: !!enabled, file_name: basename(newPath) };
  }

  static delete(serverId, pluginId) {
    const db = getDb();
    const plugin = db.prepare('SELECT * FROM plugins WHERE id = ? AND server_id = ?').get(pluginId, serverId);
    if (!plugin) throw new Error('Plugin not found');

    const filePath = join(getPluginsDir(serverId), plugin.file_name);
    if (existsSync(filePath)) unlinkSync(filePath);

    db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
    return { deleted: true };
  }
}
