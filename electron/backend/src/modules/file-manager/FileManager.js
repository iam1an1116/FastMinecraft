import { existsSync, readdirSync, statSync, unlinkSync, renameSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, basename, relative } from 'path';
import { INSTANCES_DIR } from '../../utils/paths.js';

function validatePath(serverId, requestedPath) {
  const serverDir = join(INSTANCES_DIR, serverId);
  const fullPath = join(serverDir, requestedPath || '');
  const resolved = join(serverDir, relative(serverDir, fullPath));

  // Prevent directory traversal
  if (!resolved.startsWith(serverDir)) {
    throw new Error('Directory traversal detected');
  }

  return resolved;
}

export class FileManager {
  static list(serverId, subPath = '') {
    const dirPath = validatePath(serverId, subPath);
    if (!existsSync(dirPath)) return [];

    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => !e.name.startsWith('.'))
      .map(entry => {
        const fullPath = join(dirPath, entry.name);
        const stats = statSync(fullPath);
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modified: stats.mtime,
          path: subPath ? `${subPath}/${entry.name}` : entry.name
        };
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  static readFile(serverId, filePath) {
    const fullPath = validatePath(serverId, filePath);
    if (!existsSync(fullPath)) throw new Error('File not found');
    return readFileSync(fullPath, 'utf-8');
  }

  static writeFile(serverId, filePath, content) {
    const fullPath = validatePath(serverId, filePath);
    writeFileSync(fullPath, content);
    return { written: true };
  }

  static upload(serverId, subPath, file) {
    const dirPath = validatePath(serverId, subPath);
    mkdirSync(dirPath, { recursive: true });
    const filePath = join(dirPath, basename(file.originalname));
    writeFileSync(filePath, file.buffer);
    return { uploaded: true, path: filePath };
  }

  static rename(serverId, oldPath, newName) {
    const fullOldPath = validatePath(serverId, oldPath);
    const dir = join(fullOldPath, '..');
    const newPath = join(dir, newName);

    if (!existsSync(fullOldPath)) throw new Error('File not found');
    renameSync(fullOldPath, newPath);

    return { renamed: true };
  }

  static delete(serverId, filePath) {
    const fullPath = validatePath(serverId, filePath);
    if (!existsSync(fullPath)) throw new Error('File not found');

    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      rmSync(fullPath, { recursive: true });
    } else {
      unlinkSync(fullPath);
    }

    return { deleted: true };
  }

  static createDir(serverId, dirPath) {
    const fullPath = validatePath(serverId, dirPath);
    mkdirSync(fullPath, { recursive: true });
    return { created: true };
  }
}
