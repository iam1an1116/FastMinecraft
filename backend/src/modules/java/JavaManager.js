import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { getDb } from '../../database/init.js';
import { safeFetch } from '../../utils/fetch.js';
import { JAVA_DIR } from '../../utils/paths.js';

// Scan local system for installed Java
export function scanLocalJava() {
  const found = [];
  const platform = getPlatform();

  if (platform === 'darwin') {
    // macOS paths
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
          // Try to find java binary
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
    // Windows paths
    const searchPaths = [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Zulu',
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

  // Also check PATH
  try {
    const cmd = platform === 'win32' ? 'where java' : 'which java';
    const systemJava = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0];
    if (systemJava && existsSync(systemJava)) {
      const version = getJavaVersionFromPath(systemJava);
      if (version && !found.some(f => f.path === systemJava)) {
        found.push({ path: systemJava, version, source: 'PATH' });
      }
    }
  } catch {}

  // Save found runtimes to database
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
    const output = execSync(`"${javaPath}" -version 2>&1`, { encoding: 'utf-8' });
    const match = output.match(/"(\d+)[._](\d+)/);
    if (match) {
      const major = parseInt(match[1]);
      const minor = parseInt(match[2]);
      // Java 8 = 1.8, Java 9+ = 9+
      return major === 1 ? minor : major;
    }
  } catch {}
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

// MC version -> Java version mapping
function getRequiredJavaVersion(mcVersion) {
  if (!mcVersion || mcVersion === 'custom') return 21; // Default to Java 21 for custom servers
  const parts = String(mcVersion).split('.');
  const v0 = parseInt(parts[0]) || 1;
  const v1 = parseInt(parts[1]) || 0;
  if (v0 >= 26) return 25;
  if (v0 === 1 && v1 <= 16) return 8;
  if (v0 === 1 && v1 <= 20) return 17;
  return 21;
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

  const ext = platform === 'win32' ? 'zip' : 'tar.gz';

  return `https://api.adoptium.net/v3/binary/latest/${javaVersion}/ga/${osMap[platform]}/${arch}/jdk/hotspot/normal/eclipse?project=jdk`;
}

export async function getJavaPath(mcVersion, onProgress) {
  // Check custom path first
  const custom = getCustomJavaPath();
  if (custom) {
    console.log(`Using custom Java path: ${custom}`);
    return custom;
  }

  const javaVersion = getRequiredJavaVersion(mcVersion);
  console.log(`MC ${mcVersion} requires Java ${javaVersion}`);

  // Scan local system for Java (first time or when no runtimes found)
  const db = getDb();
  const existingRuntimes = db.prepare('SELECT * FROM java_runtimes WHERE platform = ?').all(getPlatform());
  if (existingRuntimes.length === 0) {
    console.log('Scanning local system for Java...');
    scanLocalJava();
  }

  // Check database for existing runtime (exact version or higher)
  const existing = db.prepare(
    'SELECT * FROM java_runtimes WHERE version >= ? AND platform = ? ORDER BY version ASC'
  ).get(javaVersion, getPlatform());

  if (existing && existsSync(existing.path)) {
    console.log(`Found cached Java ${existing.version} at ${existing.path}`);
    return existing.path;
  }

  // Check if we already downloaded it
  const existingJar = join(JAVA_DIR, `jdk-${javaVersion}`);
  if (existsSync(existingJar)) {
    const javaPath = findJavaInDir(existingJar);
    if (javaPath) return javaPath;
  }

  // Download Java
  console.log(`Downloading Java ${javaVersion}...`);
  return downloadJava(javaVersion, onProgress);
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

  // Extract
  const extractDir = join(JAVA_DIR, `jdk-${javaVersion}`);
  mkdirSync(extractDir, { recursive: true });

  console.log(`Extracting to ${extractDir}...`);
  try {
    if (platform === 'win32') {
      execSync(`tar -xf "${filePath}" -C "${extractDir}"`, { encoding: 'utf-8' });
    } else {
      execSync(`tar -xzf "${filePath}" -C "${extractDir}"`, { encoding: 'utf-8' });
    }
  } catch (err) {
    console.error(`Failed to extract: ${err.message}`);
    throw new Error(`Failed to extract Java: ${err.message}`);
  }

  // Find java binary
  const javaPath = findJavaInDir(extractDir);
  if (!javaPath) throw new Error('Java binary not found after extraction');

  // Save to database
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
