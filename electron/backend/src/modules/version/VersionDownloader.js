import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { safeFetch } from '../../utils/fetch.js';
import { DOWNLOADS_DIR, INSTANCES_DIR } from '../../utils/paths.js';

// Version sources
const SOURCES = {
  vanilla: {
    list: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    getUrl: async (version) => {
      const resp = await safeFetch(SOURCES.vanilla.list);
      const data = await resp.json();
      const ver = data.versions.find(v => v.id === version);
      if (!ver) throw new Error(`Version ${version} not found`);
      const verResp = await safeFetch(ver.url);
      const verData = await verResp.json();
      return verData.downloads.server.url;
    }
  },
  paper: {
    list: async () => {
      const resp = await safeFetch('https://api.papermc.io/v2/projects/paper');
      const data = await resp.json();
      return data.versions;
    },
    getUrl: async (version) => {
      const resp = await safeFetch(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds`);
      const data = await resp.json();
      const build = data.builds[data.builds.length - 1];
      return `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${build.build}/downloads/${build.downloads.application.name}`;
    }
  },
  purpur: {
    list: async () => {
      const resp = await safeFetch('https://api.purpurmc.org/v2/purpur');
      const data = await resp.json();
      return data.versions;
    },
    getUrl: async (version) => {
      const resp = await safeFetch(`https://api.purpurmc.org/v2/purpur/${version}/latest`);
      const data = await resp.json();
      return `https://api.purpurmc.org/v2/purpur/${version}/${data.build}/download`;
    }
  },
  fabric: {
    list: async () => {
      const resp = await safeFetch('https://meta.fabricmc.net/v2/versions/game');
      const data = await resp.json();
      return data.filter(v => v.stable).map(v => v.version);
    },
    getUrl: async (version) => {
      const resp = await safeFetch('https://meta.fabricmc.net/v2/versions/loader/' + version);
      const data = await resp.json();
      const loader = data[0].loader.version;
      return `https://meta.fabricmc.net/v2/versions/loader/${version}/${loader}/1.0.0/server/jar`;
    }
  },
  forge: {
    list: async () => {
      const resp = await safeFetch('https://files.minecraftforge.net/maven/net/minecraftforge/forge/');
      const text = await resp.text();
      const versions = text.match(/(\d+\.\d+\.\d+)/g) || [];
      return [...new Set(versions)].slice(0, 30);
    },
    getUrl: async (version) => {
      return `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${version}-${getForgeVersion(version)}/forge-${version}-${getForgeVersion(version)}-installer.jar`;
    }
  },
  neoforge: {
    list: async () => {
      const resp = await safeFetch('https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml');
      const text = await resp.text();
      const versions = text.match(/<version>(.*?)<\/version>/g) || [];
      return versions.map(v => v.replace(/<\/?version>/g, '')).slice(0, 20);
    },
    getUrl: async (version) => {
      return `https://maven.neoforged.net/releases/net/neoforged/forge/${version}/forge-${version}-installer.jar`;
    }
  }
};

function getForgeVersion(mcVersion) {
  const forgeVersions = {
    '1.20.4': '49.0.30',
    '1.20.2': '48.1.0',
    '1.20.1': '47.2.0',
    '1.19.4': '45.2.0',
    '1.19.2': '43.3.0',
    '1.18.2': '40.2.0',
    '1.16.5': '36.2.39',
    '1.12.2': '14.23.5.2860'
  };
  return forgeVersions[mcVersion] || 'latest';
}

export async function getVersions(type = 'vanilla') {
  if (!SOURCES[type]) throw new Error(`Unknown server type: ${type}`);

  if (type === 'vanilla') {
    const resp = await safeFetch(SOURCES.vanilla.list);
    const data = await resp.json();
    return data.versions.filter(v => v.type === 'release').map(v => ({
      version: v.id,
      type: 'vanilla',
      date: v.releaseTime
    }));
  }

  const versions = await SOURCES[type].list();
  return versions.map(v => ({
    version: typeof v === 'string' ? v : v,
    type
  }));
}

export async function downloadServer(type, version, serverId, onProgress) {
  if (!SOURCES[type]) throw new Error(`Unknown server type: ${type}`);

  // Look up custom path from database
  const { getDb } = await import('../../database/init.js');
  const server = getDb().prepare('SELECT path FROM servers WHERE id = ?').get(serverId);
  const serverDir = server?.path || join(INSTANCES_DIR, serverId);
  mkdirSync(serverDir, { recursive: true });

  const url = await SOURCES[type].getUrl(version);
  console.log(`Downloading ${type} ${version} from ${url}`);

  const response = await safeFetch(url, {
    onProgress: (downloaded, total) => {
      if (onProgress) {
        onProgress({ downloaded, total, percent: Math.round((downloaded / total) * 100) });
      }
    }
  });

  if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

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

  // Run installer for forge/neoforge
  if (type === 'forge' || type === 'neoforge') {
    const { getJavaPath } = await import('../java/JavaManager.js');
    const javaPath = await getJavaPath(version);
    execSync(`"${javaPath}" -jar "${jarPath}" --installServer`, { cwd: serverDir });
  }

  console.log(`Downloaded ${type} ${version} to ${jarPath}`);
  return { jarPath, fileName };
}
