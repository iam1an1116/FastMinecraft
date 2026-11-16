import { existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync } from 'fs';
import { join, basename } from 'path';
import { v4 as uuid } from 'uuid';
import { getDb } from '../../database/init.js';
import { INSTANCES_DIR } from '../../utils/paths.js';

export class PluginManager {
  static list(serverId) {
    const db = getDb();
    return db.prepare('SELECT * FROM plugins WHERE server_id = ? ORDER BY created_at DESC').all(serverId);
  }

  static upload(serverId, file) {
    const db = getDb();
    const serverDir = join(INSTANCES_DIR, serverId, 'plugins');
    mkdirSync(serverDir, { recursive: true });

    const fileName = basename(file.originalname);
    const filePath = join(serverDir, fileName);
    writeFileSync(filePath, file.buffer);

    const id = uuid();
    db.prepare(`
      INSERT INTO plugins (id, server_id, name, file_name, enabled)
      VALUES (?, ?, ?, ?, 1)
    `).run(id, serverId, fileName.replace('.jar', ''), fileName);

    return { id, name: fileName.replace('.jar', ''), fileName };
  }

  static toggle(serverId, pluginId, enabled) {
    const db = getDb();
    const plugin = db.prepare('SELECT * FROM plugins WHERE id = ? AND server_id = ?').get(pluginId, serverId);
    if (!plugin) throw new Error('Plugin not found');

    const serverDir = join(INSTANCES_DIR, serverId, 'plugins');
    const oldPath = join(serverDir, plugin.file_name);
    const newPath = enabled
      ? oldPath.replace('.jar.disabled', '.jar')
      : oldPath.replace('.jar', '.jar.disabled');

    if (existsSync(oldPath)) {
      renameSync(oldPath, newPath);
    }

    db.prepare('UPDATE plugins SET enabled = ?, file_name = ? WHERE id = ?')
      .run(enabled ? 1 : 0, basename(newPath), pluginId);

    return { ...plugin, enabled: !!enabled };
  }

  static delete(serverId, pluginId) {
    const db = getDb();
    const plugin = db.prepare('SELECT * FROM plugins WHERE id = ? AND server_id = ?').get(pluginId, serverId);
    if (!plugin) throw new Error('Plugin not found');

    const filePath = join(INSTANCES_DIR, serverId, 'plugins', plugin.file_name);
    if (existsSync(filePath)) unlinkSync(filePath);

    db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
    return { deleted: true };
  }
}
