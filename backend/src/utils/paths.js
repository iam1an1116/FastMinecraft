import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// FM_DATA_DIR is set by Electron in production
// Also accepts data dir as first CLI argument (fallback if env var fails)
// In dev (node src/index.js), cwd is backend/, so we go up one level
export const DATA_DIR = process.env.FM_DATA_DIR || process.argv[2] || join(process.cwd(), '..');

export const INSTANCES_DIR = join(DATA_DIR, 'instances');
export const BACKUPS_DIR = join(DATA_DIR, 'backups');
export const JAVA_DIR = join(DATA_DIR, 'java');
export const DOWNLOADS_DIR = join(DATA_DIR, 'downloads');
export const DB_DIR = join(DATA_DIR, 'database');

export function resolveServerDir(server, fallbackId = null) {
  if (server?.path) return server.path;
  const id = server?.id || fallbackId;
  return id ? join(INSTANCES_DIR, String(id)) : INSTANCES_DIR;
}

export function decodeUploadFilename(rawName = 'file') {
  let name = String(rawName || 'file');
  // Multer/busboy decodes non-ASCII Content-Disposition filenames as latin1 by default
  if (!/[^\x00-\xff]/.test(name) && /[\x80-\xff]/.test(name)) {
    try {
      const utf8 = Buffer.from(name, 'latin1').toString('utf8');
      if (!utf8.includes('\ufffd') && Buffer.from(utf8, 'utf8').toString('latin1') === name) {
        name = utf8;
      }
    } catch {}
  }
  const base = name.split(/[/\\]/).pop() || 'file';
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'file';
}
