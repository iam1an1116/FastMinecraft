import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import AdmZip from 'adm-zip';
import { safeFetch } from '../../utils/fetch.js';
import { resolveServerDir } from '../../utils/paths.js';

const USER_AGENT = 'FastMinecraft/1.0 (desktop-manager)';

async function fetchJsonWithHeaders(url) {
  const resp = await safeFetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

function compareSemverDesc(a, b) {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const SOURCES = {
  vanilla: {
    list: async () => {
      try {
        const data = await fetchJsonWithHeaders('https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json');
        return data.versions.filter(v => v.type === 'release').map(v => v.id);
      } catch {
        const data = await fetchJsonWithHeaders('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        return data.versions.filter(v => v.type === 'release').map(v => v.id);
      }
    },
    getUrl: async (version) => {
      let data;
      try {
        data = await fetchJsonWithHeaders('https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json');
      } catch {
        data = await fetchJsonWithHeaders('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
      }
      const ver = data.versions.find(v => v.id === version);
      if (!ver) throw new Error(`Version ${version} not found`);
      const verData = await fetchJsonWithHeaders(ver.url);
      return verData.downloads.server.url;
    }
  },
  paper: {
    list: async () => {
      const data = await fetchJsonWithHeaders('https://fill.papermc.io/v3/projects/paper');
      const grouped = data.versions || {};
      const all = [];
      for (const group of Object.values(grouped)) {
        if (Array.isArray(group)) {
          for (const v of group) {
            if (!v.includes('-rc') && !v.includes('-pre')) all.push(v);
          }
        }
      }
      return all;
    },
    getUrl: async (version) => {
      const builds = await fetchJsonWithHeaders(`https://fill.papermc.io/v3/projects/paper/versions/${version}/builds`);
      if (!Array.isArray(builds) || builds.length === 0) throw new Error(`No Paper builds for ${version}`);
      const build = builds.find(b => b.channel === 'STABLE') || builds[0];
      const dl = build.downloads?.['server:default'] || Object.values(build.downloads || {})[0];
      if (!dl?.url) throw new Error(`No download URL for Paper ${version}`);
      return dl.url;
    }
  },
  purpur: {
    list: async () => {
      const data = await fetchJsonWithHeaders('https://api.purpurmc.org/v2/purpur');
      return [...(data.versions || [])].reverse();
    },
    getUrl: async (version) => {
      const data = await fetchJsonWithHeaders(`https://api.purpurmc.org/v2/purpur/${version}/latest`);
      return `https://api.purpurmc.org/v2/purpur/${version}/${data.build}/download`;
    }
  },
  fabric: {
    list: async () => {
      const data = await fetchJsonWithHeaders('https://meta.fabricmc.net/v2/versions/game');
      return data.filter(v => v.stable).map(v => v.version);
    },
    getUrl: async (version) => {
      const data = await fetchJsonWithHeaders(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
      if (!Array.isArray(data) || data.length === 0) throw new Error(`No Fabric loader for ${version}`);
      const loader = data[0].loader.version;
      return `https://meta.fabricmc.net/v2/versions/loader/${version}/${loader}/1.0.1/server/jar`;
    }
  },
  forge: {
    list: async () => {
      const data = await fetchJsonWithHeaders('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
      const promos = data.promos || {};
      const mcVersions = new Set();
      for (const key of Object.keys(promos)) {
        const m = key.match(/^(\d+\.\d+(?:\.\d+)?)-(recommended|latest)$/);
        if (m) mcVersions.add(m[1]);
      }
      return [...mcVersions].sort(compareSemverDesc).slice(0, 30);
    },
    getUrl: async (version) => {
      const data = await fetchJsonWithHeaders('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
      const promos = data.promos || {};
      const forgeBuild = promos[`${version}-recommended`] || promos[`${version}-latest`];
      if (!forgeBuild) throw new Error(`No Forge build found for ${version}`);
      return `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${forgeBuild}/forge-${version}-${forgeBuild}-installer.jar`;
    }
  },
  neoforge: {
    list: async () => {
      const resp = await safeFetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', {
        headers: { 'User-Agent': USER_AGENT }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching NeoForge versions`);
      const text = await resp.text();
      const versions = (text.match(/<version>(.*?)<\/version>/g) || [])
        .map(v => v.replace(/<\/?version>/g, ''))
        .filter(v => !v.includes('-alpha'));
      return versions.reverse().slice(0, 25);
    },
    getUrl: async (version) => {
      if (String(version).startsWith('1.20.1-')) {
        return `https://maven.neoforged.net/releases/net/neoforged/forge/${version}/forge-${version}-installer.jar`;
      }
      return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
    }
  }
};

export async function getVersions(type = 'vanilla') {
  if (!SOURCES[type]) throw new Error(`Unknown server type: ${type}`);
  const versions = await SOURCES[type].list();
  return versions.map(v => ({
    version: typeof v === 'string' ? v : String(v),
    type
  }));
}

export async function getDownloadUrl(type, version) {
  if (!SOURCES[type]) throw new Error(`Unknown server type: ${type}`);
  return SOURCES[type].getUrl(version);
}

export async function downloadServer(type, version, serverId, onProgress) {
  if (!SOURCES[type]) throw new Error(`Unknown server type: ${type}`);

  const { getDb } = await import('../../database/init.js');
  const server = getDb().prepare('SELECT id, path FROM servers WHERE id = ?').get(serverId);
  const serverDir = resolveServerDir(server, serverId);
  mkdirSync(serverDir, { recursive: true });

  const url = await SOURCES[type].getUrl(version);
  console.log(`Downloading ${type} ${version} from ${url}`);

  const response = await safeFetch(url, {
    timeout: 120000,
    headers: { 'User-Agent': USER_AGENT },
    onProgress: (downloaded, total) => {
      if (onProgress && total > 0) {
        onProgress({ downloaded, total, percent: Math.round((downloaded / total) * 100) });
      }
    }
  });

  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);

  const buffer = Buffer.from(await response.arrayBuffer());

  let fileName;
  if (type === 'vanilla') fileName = 'minecraft_server.jar';
  else if (type === 'paper') fileName = `paper-${version}.jar`;
  else if (type === 'purpur') fileName = `purpur-${version}.jar`;
  else if (type === 'fabric') fileName = 'fabric-server.jar';
  else if (type === 'forge') fileName = 'forge-installer.jar';
  else if (type === 'neoforge') fileName = 'neoforge-installer.jar';
  else fileName = `${type}-${version}.jar`;

  const jarPath = join(serverDir, fileName);
  writeFileSync(jarPath, buffer);

  if (type === 'forge' || type === 'neoforge') {
    const { getJavaPath } = await import('../java/JavaManager.js');
    const javaPath = await getJavaPath(version, null, serverDir);
    execFileSync(javaPath, ['-jar', jarPath, '--installServer'], {
      cwd: serverDir,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 300000,
      windowsHide: true,
    });
  }

  console.log(`Downloaded ${type} ${version} to ${jarPath}`);
  return { jarPath, fileName };
}

// === Modrinth Modpack Support ===

export async function searchModpacks(query = '', limit = 24) {
  const facets = encodeURIComponent(JSON.stringify([['project_type:modpack']]));
  const q = encodeURIComponent(query || '');
  const url = `https://api.modrinth.com/v2/search?facets=${facets}&limit=${limit}&index=downloads&query=${q}`;
  const data = await fetchJsonWithHeaders(url);
  return (data.hits || []).map(h => ({
    id: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description || '',
    iconUrl: h.icon_url || '',
    downloads: h.downloads || 0,
    author: h.author || '',
    versions: h.versions || [],
    latestVersion: Array.isArray(h.versions) && h.versions.length > 0 ? h.versions[h.versions.length - 1] : '',
  }));
}

export async function getModpackVersions(projectId) {
  const list = await fetchJsonWithHeaders(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`);
  return (Array.isArray(list) ? list : []).slice(0, 20).map(v => {
    const primary = v.files?.find(f => f.primary) || v.files?.[0];
    return {
      id: v.id,
      name: v.name || v.version_number,
      versionNumber: v.version_number,
      gameVersions: v.game_versions || [],
      loaders: v.loaders || [],
      downloadUrl: primary?.url || '',
      filename: primary?.filename || 'modpack.mrpack',
    };
  });
}

export async function deployModpack(projectId, versionId, serverId, onProgress) {
  const { getDb } = await import('../../database/init.js');
  const server = getDb().prepare('SELECT path FROM servers WHERE id = ?').get(serverId);
  const serverDir = server?.path || join(INSTANCES_DIR, serverId);
  mkdirSync(serverDir, { recursive: true });

  const versions = await getModpackVersions(projectId);
  const ver = versionId ? versions.find(v => v.id === versionId) : versions[0];
  if (!ver || !ver.downloadUrl) throw new Error('未找到整合包下载地址');

  if (onProgress) onProgress({ percent: 10 });
  const resp = await safeFetch(ver.downloadUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!resp.ok) throw new Error(`下载整合包失败: ${resp.statusText}`);

  const mrpackBuf = Buffer.from(await resp.arrayBuffer());
  const zip = new AdmZip(mrpackBuf);

  // Extract overrides & server-overrides
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    let rel = null;
    if (entry.entryName.startsWith('overrides/')) rel = entry.entryName.slice('overrides/'.length);
    else if (entry.entryName.startsWith('server-overrides/')) rel = entry.entryName.slice('server-overrides/'.length);
    if (rel && !rel.includes('..')) {
      const dest = join(serverDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, entry.getData());
    }
  }

  // Parse modrinth.index.json
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (indexEntry) {
    const idx = JSON.parse(indexEntry.getData().toString('utf8'));
    const deps = idx.dependencies || {};
    const mcVer = deps.minecraft || ver.gameVersions?.[0] || '1.20.1';
    let coreType = 'fabric';
    if (deps.neoforge) coreType = 'neoforge';
    else if (deps.forge) coreType = 'forge';
    else if (!deps['fabric-loader'] && !deps['quilt-loader']) coreType = 'vanilla';

    // Download server core jar
    try {
      await downloadServer(coreType, mcVer, serverId);
    } catch (e) {
      console.error('Modpack core download fallback to vanilla:', e.message);
      if (coreType !== 'vanilla') await downloadServer('vanilla', mcVer, serverId);
    }

    // Download server-compatible mod files (in small batches)
    const files = (idx.files || []).filter(f => f.env?.server !== 'unsupported' && f.downloads?.length > 0 && !f.path.includes('..'));
    let done = 0;
    const batchSize = 5;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      await Promise.all(batch.map(async (f) => {
        try {
          const r = await safeFetch(f.downloads[0], { headers: { 'User-Agent': USER_AGENT } });
          if (r.ok) {
            const b = Buffer.from(await r.arrayBuffer());
            const dest = join(serverDir, f.path);
            mkdirSync(dirname(dest), { recursive: true });
            writeFileSync(dest, b);
          }
        } catch (_) {}
        done++;
        if (onProgress && files.length > 0) {
          onProgress({ percent: Math.min(98, 25 + Math.round((done / files.length) * 70)) });
        }
      }));
    }
  }

  if (onProgress) onProgress({ percent: 100 });
  return { deployed: true };
}
