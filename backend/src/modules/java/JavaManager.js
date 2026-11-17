import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync, execFileSync } from 'child_process';
import AdmZip from 'adm-zip';
import { getDb } from '../../database/init.js';
import { safeFetch } from '../../utils/fetch.js';
import { JAVA_DIR } from '../../utils/paths.js';

// Scan local system for installed Java
export function scanLocalJava() {
  const found = [];
  const platform = getPlatform();

  if (platform === 'darwin') {
    const searchPaths = [
      '/Library/Java/JavaVirtualMachines',
      '/usr/local/opt/openjdk',
      '/opt/homebrew/opt/openjdk',
      join(process.env.HOME || '', '.sdkman/candidates/java')
    ];

    for (const basePath of searchPaths) {
      if (!existsSync(basePath)) continue;

      try {
        const entries = readdirSync(basePath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const dir = join(basePath, entry.name);
          const candidates = [
            join(dir, 'Contents/Home/bin/java'),
            join(dir, 'bin/java'),
            join(dir, 'java')
          ];

          for (const javaPath of candidates) {
            if (existsSync(javaPath)) {
              const version = getJavaVersionFromPath(javaPath);
              if (version) {
                found.push({ path: javaPath, version, source: basePath });
              }
              break;
            }
          }
        }
      } catch {}
    }
  } else if (platform === 'win32') {
    const searchPaths = [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files\\BellSoft',
      'C:\\Program Files\\Amazon Corretto',
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs\\Eclipse Adoptium') : ''
    ].filter(Boolean);

    for (const basePath of searchPaths) {
      if (!existsSync(basePath)) continue;

      try {
        const entries = readdirSync(basePath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const dir = join(basePath, entry.name);
          const javaPath = join(dir, 'bin', 'java.exe');

          if (existsSync(javaPath)) {
            const version = getJavaVersionFromPath(javaPath);
            if (version) {
              found.push({ path: javaPath, version, source: basePath });
            }
          }
        }
      } catch {}
    }
  }

  // Also check PATH (split CRLF cleanly on Windows)
  try {
    const cmd = platform === 'win32' ? 'where java' : 'which java';
    const lines = execSync(cmd, { encoding: 'utf-8' }).trim().split(/\r?\n/);
    for (const rawLine of lines) {
      const systemJava = rawLine.trim();
      if (systemJava && existsSync(systemJava)) {
        const version = getJavaVersionFromPath(systemJava);
        if (version && !found.some(f => f.path === systemJava)) {
          found.push({ path: systemJava, version, source: 'PATH' });
        }
      }
    }
  } catch {}

  const db = getDb();
  for (const java of found) {
    const id = `local-${java.version}-${java.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
    db.prepare(`
      INSERT OR IGNORE INTO java_runtimes (id, version, path, platform)
      VALUES (?, ?, ?, ?)
    `).run(id, java.version, java.path, platform);
  }

  return found;
}

export function getJavaVersionFromPath(javaPath) {
  try {
    const output = execFileSync(javaPath, ['-version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    const match = output.match(/"(\d+)[._](\d+)/);
    if (match) {
      const major = parseInt(match[1]);
      const minor = parseInt(match[2]);
      return major === 1 ? minor : major;
    }
  } catch (err) {
    const combined = `${err.stdout || ''}\n${err.stderr || ''}`;
    const match = combined.match(/"(\d+)[._](\d+)/);
    if (match) {
      const major = parseInt(match[1]);
      const minor = parseInt(match[2]);
      return major === 1 ? minor : major;
    }
  }
  return null;
}

export function setCustomJavaPath(path) {
  const db = getDb();
  if (path) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('custom_java_path', ?)").run(path);
  } else {
    db.prepare("DELETE FROM settings WHERE key = 'custom_java_path'").run();
  }
}

export function getCustomJavaPath() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'custom_java_path'").get();
  return row?.value || null;
}

export function detectCustomMcVersion(serverDir) {
  if (!serverDir || !existsSync(serverDir)) return null;
  try {
    const forgeDir = join(serverDir, 'libraries', 'net', 'minecraftforge', 'forge');
    if (existsSync(forgeDir)) {
      const dirs = readdirSync(forgeDir);
      for (const d of dirs) {
        const m = d.match(/^(\d+\.\d+(?:\.\d+)?)-/);
        if (m) return m[1];
      }
    }
    const neoDir = join(serverDir, 'libraries', 'net', 'neoforged', 'neoforge');
    if (existsSync(neoDir)) {
      const dirs = readdirSync(neoDir);
      for (const d of dirs) {
        const m = d.match(/^(\d+\.\d+)/);
        if (m) return m[1];
      }
    }
    const verJson = join(serverDir, 'version.json');
    if (existsSync(verJson)) {
      const parsed = JSON.parse(readFileSync(verJson, 'utf8'));
      if (parsed?.id) return String(parsed.id);
    }
  } catch {}
  return null;
}

// MC version -> compatible Java major range { min, max, preferred }
export function getJavaRequirement(mcVersion, serverDir = null) {
  let effective = String(mcVersion || '').trim();
  if (!effective || effective === 'custom' || effective === 'modpack') {
    const detected = detectCustomMcVersion(serverDir);
    if (detected) effective = detected;
  }
  if (!effective || effective === 'custom' || effective === 'modpack') {
    return { min: 17, max: 21, preferred: 21 };
  }

  // Handle NeoForge versions like "21.4.120-beta" or "20.4.237"
  if (effective.startsWith('21.')) return { min: 21, max: 25, preferred: 21 };
  if (effective.startsWith('20.2') || effective.startsWith('20.4') || effective.startsWith('20.6')) {
    return effective.startsWith('20.6') ? { min: 21, max: 25, preferred: 21 } : { min: 17, max: 21, preferred: 17 };
  }

  // Legacy MC prefixed format (e.g. "1.20.1-47.1.106")
  const baseVer = effective.split('-')[0];
  const parts = baseVer.split('.');
  const v0 = parseInt(parts[0]) || 1;
  const v1 = parseInt(parts[1]) || 0;
  const v2 = parseInt(parts[2]) || 0;

  if (v0 >= 26) return { min: 25, max: 99, preferred: 25 };
  if (v0 === 1 && v1 <= 16) return { min: 8, max: 11, preferred: 8 };
  if (v0 === 1 && v1 === 17) return { min: 16, max: 21, preferred: 17 };
  if (v0 === 1 && (v1 < 20 || (v1 === 20 && v2 <= 4))) return { min: 17, max: 21, preferred: 17 };
  return { min: 21, max: 25, preferred: 21 };
}

function getPlatform() {
  return process.platform; // 'darwin' or 'win32'
}

function getArch() {
  return process.arch === 'arm64' ? 'aarch64' : 'x64';
}

function getJavaDownloadUrl(javaVersion) {
  const platform = getPlatform();
  const arch = getArch();

  const osMap = {
    darwin: 'mac',
    win32: 'windows'
  };

  return `https://api.adoptium.net/v3/binary/latest/${javaVersion}/ga/${osMap[platform]}/${arch}/jdk/hotspot/normal/eclipse?project=jdk`;
}

export async function getJavaPath(mcVersion, onProgress, serverDir = null) {
  const custom = getCustomJavaPath();
  if (custom && existsSync(custom)) {
    console.log(`Using custom Java path: ${custom}`);
    return custom;
  }

  const req = getJavaRequirement(mcVersion, serverDir);
  console.log(`MC ${mcVersion} requires Java ${req.preferred} (compatible: ${req.min}-${req.max})`);

  const db = getDb();
  let runtimes = db.prepare('SELECT * FROM java_runtimes WHERE platform = ?').all(getPlatform());
  if (runtimes.length === 0) {
    console.log('Scanning local system for Java...');
    scanLocalJava();
    runtimes = db.prepare('SELECT * FROM java_runtimes WHERE platform = ?').all(getPlatform());
  }

  const valid = runtimes
    .filter(r => r.version >= req.min && r.version <= req.max && existsSync(r.path))
    .sort((a, b) => Math.abs(a.version - req.preferred) - Math.abs(b.version - req.preferred));

  if (valid.length > 0) {
    console.log(`Found compatible Java ${valid[0].version} at ${valid[0].path}`);
    return valid[0].path;
  }

  const cachedDir = join(JAVA_DIR, `jdk-${req.preferred}`);
  if (existsSync(cachedDir)) {
    const javaPath = findJavaInDir(cachedDir);
    if (javaPath) return javaPath;
  }

  console.log(`Downloading Java ${req.preferred}...`);
  return downloadJava(req.preferred, onProgress);
}

function findJavaInDir(dir) {
  const javaBin = getPlatform() === 'win32' ? 'java.exe' : 'java';
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.name === javaBin && statSync(fullPath).isFile()) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = findJavaInDir(fullPath);
      if (found) return found;
    }
  }
  return null;
}

export async function downloadJava(javaVersion, onProgress) {
  const url = getJavaDownloadUrl(javaVersion);
  const platform = getPlatform();
  const ext = platform === 'win32' ? 'zip' : 'tar.gz';

  mkdirSync(JAVA_DIR, { recursive: true });

  const fileName = `jdk-${javaVersion}-${getPlatform()}-${getArch()}.${ext}`;
  const filePath = join(JAVA_DIR, fileName);

  console.log(`Downloading Java ${javaVersion} from ${url}`);

  try {
    const response = await safeFetch(url, {
      timeout: 120000,
      onProgress: (downloaded, total) => {
        if (onProgress) {
          onProgress({ downloaded, total, percent: Math.round((downloaded / total) * 100) });
        }
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(filePath, buffer);
    console.log(`Downloaded ${buffer.length} bytes to ${filePath}`);
  } catch (err) {
    console.error(`Failed to download Java: ${err.message}`);
    throw new Error(`Failed to download Java ${javaVersion}: ${err.message}`);
  }

  const extractDir = join(JAVA_DIR, `jdk-${javaVersion}`);
  mkdirSync(extractDir, { recursive: true });

  console.log(`Extracting to ${extractDir}...`);
  try {
    if (platform === 'win32') {
      try {
        execFileSync('tar', ['-xf', filePath, '-C', extractDir], { encoding: 'utf-8', timeout: 120000 });
      } catch {
        const zip = new AdmZip(filePath);
        zip.extractAllTo(extractDir, true);
      }
    } else {
      execFileSync('tar', ['-xzf', filePath, '-C', extractDir], { encoding: 'utf-8', timeout: 120000 });
    }
  } catch (err) {
    console.error(`Failed to extract: ${err.message}`);
    throw new Error(`Failed to extract Java: ${err.message}`);
  }

  const javaPath = findJavaInDir(extractDir);
  if (!javaPath) throw new Error('Java binary not found after extraction');

  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO java_runtimes (id, version, path, platform) VALUES (?, ?, ?, ?)'
  ).run(`java-${javaVersion}`, javaVersion, javaPath, getPlatform());

  console.log(`Java ${javaVersion} installed at ${javaPath}`);
  return javaPath;
}

export function getInstalledRuntimes() {
  const db = getDb();
  return db.prepare('SELECT * FROM java_runtimes WHERE platform = ?').all(getPlatform());
}
