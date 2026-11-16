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
