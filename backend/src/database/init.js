import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DB_DIR } from '../utils/paths.js';

const DB_PATH = join(DB_DIR, 'fm.db');

let db;

export function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// Wrapper to mimic better-sqlite3 API
class DatabaseWrapper {
  constructor(sqlJsDb) {
    this._db = sqlJsDb;
  }

  exec(sql) {
    this._db.run(sql);
  }

  prepare(sql) {
    const db = this._db;
    return {
      run(...params) {
        db.run(sql, params);
        saveDb();
      },
      get(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const result = stmt.getAsObject();
          stmt.free();
          return result;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      }
    };
  }

  pragma(str) {
    try {
      this._db.run(`PRAGMA ${str}`);
    } catch {}
  }
}

function saveDb() {
  if (!db) return;
  const data = db._db.export();
  const buffer = Buffer.from(data);
  const tmpPath = `${DB_PATH}.tmp`;
  try {
    writeFileSync(tmpPath, buffer);
    renameSync(tmpPath, DB_PATH);
  } catch {
    writeFileSync(DB_PATH, buffer);
  }
}

export async function initDatabase() {
  mkdirSync(DB_DIR, { recursive: true });

  const SQL = await initSqlJs();

  if (existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    const sqlDb = new SQL.Database(fileBuffer);
    db = new DatabaseWrapper(sqlDb);
  } else {
    const sqlDb = new SQL.Database();
    db = new DatabaseWrapper(sqlDb);
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      server_type TEXT NOT NULL,
      port INTEGER DEFAULT 25565,
      status TEXT DEFAULT 'stopped',
      java_path TEXT,
      max_memory INTEGER DEFAULT 2048,
      path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      version TEXT,
      author TEXT,
      enabled BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mods (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      version TEXT,
      loader TEXT NOT NULL,
      enabled BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      command TEXT,
      enabled BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS java_runtimes (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      path TEXT NOT NULL,
      platform TEXT NOT NULL,
      downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS network_tunnels (
      server_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      tunnel_id TEXT,
      remote_port TEXT,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Reset stale transient states left behind by an unexpected process exit
  db.exec(`
    UPDATE servers SET status = 'stopped' WHERE status IN ('running', 'starting');
    UPDATE servers SET status = 'error' WHERE status = 'downloading';
  `);

  saveDb();
  console.log('Database initialized at', DB_PATH);
}
