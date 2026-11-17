import { Router } from 'express';
import { execFile } from 'child_process';
import multer from 'multer';
import { join } from 'path';
import { renameSync, unlinkSync, copyFileSync } from 'fs';
import AdmZip from 'adm-zip';
import os from 'os';
import { ServerManager } from '../modules/server/ServerManager.js';
import { downloadServer, deployModpack } from '../modules/version/VersionDownloader.js';
import { resolveServerDir, decodeUploadFilename } from '../utils/paths.js';

const router = Router();

// Configure multer for file upload - use OS temp dir (fixes Windows /tmp issue)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    cb(null, `fm-upload-${unique}.tmp`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Allow .jar and .zip files
    if (file.originalname.endsWith('.jar') || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('只支持 .jar 或 .zip 文件'));
    }
  }
});

// Get LAN IP address
router.get('/lan-ip', (req, res) => {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  // Virtual adapter keywords to exclude
  const virtualKeywords = [
    'virtual', 'vmware', 'virtualbox', 'vbox', 'hyper-v', 'hyperv',
    'wsl', 'docker', 'veth', 'bridge', 'loopback', 'pseudo',
    'radmin', 'vpn', 'hamachi', 'zerotier', 'tailscale', 'tunnel',
    'teredo', 'isatap', '6to4', 'bluetooth', 'usb'
  ];

  for (const name of Object.keys(interfaces)) {
    const lower = name.toLowerCase();
    // Skip known virtual/VPN adapters
    if (virtualKeywords.some(k => lower.includes(k))) continue;

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const priority =
          lower.includes('以太') || lower.includes('ether') || lower.startsWith('en') ? 1 :
          lower.includes('wi-fi') || lower.includes('wlan') || lower.includes('无线') ? 2 :
          5;
        candidates.push({ ip: iface.address, priority });
      }
    }
  }

  candidates.sort((a, b) => a.priority - b.priority);
  res.json({ ip: candidates[0]?.ip || '127.0.0.1' });
});

// Get Public IPv6 address
router.get('/ipv6', (req, res) => {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const lower = name.toLowerCase();
    if (lower.includes('virtual') || lower.includes('wsl') || lower.includes('docker') || lower.includes('tailscale') || lower.includes('zerotier')) continue;

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv6' && !iface.internal) {
        const addr = iface.address.toLowerCase();
        // Skip link-local and unique-local
        if (addr.startsWith('fe80:') || addr.startsWith('fc') || addr.startsWith('fd')) continue;
        // Global unicast IPv6 usually starts with 2xxx
        if (addr.startsWith('2')) {
          candidates.push(iface.address);
        }
      }
    }
  }

  res.json({ ip: candidates[0] || null });
});

// System RAM & platform info
router.get('/system-info', (req, res) => {
  const totalMB = Math.floor(os.totalmem() / 1024 / 1024);
  const freeMB = Math.floor(os.freemem() / 1024 / 1024);
  const maxAllocatableMB = Math.max(4096, Math.floor((totalMB * 0.8) / 512) * 512);
  res.json({
    totalMemoryMB: totalMB,
    freeMemoryMB: freeMB,
    maxAllocatableMB,
    platform: process.platform
  });
});

// List all servers
router.get('/', (req, res) => {
  const servers = ServerManager.getAll();
  res.json(servers);
});

// Get server by ID
router.get('/:id', (req, res) => {
  const server = ServerManager.getById(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  res.json(server);
});

// Get server logs (24h persisted)
router.get('/:id/logs', (req, res) => {
  const limit = Number(req.query.limit) || 500;
  const logs = ServerManager.getLogs(req.params.id, limit);
  res.json({ logs });
});

// Get download status
router.get('/:id/download-status', (req, res) => {
  const status = ServerManager.getDownloadStatus(req.params.id);
  res.json(status);
});

// Create server
router.post('/', async (req, res) => {
  try {
    const { name, version, serverType, maxMemory, path, gamemode, onlineMode } = req.body;
    if (!name || !version || !serverType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const server = ServerManager.create({ name, version, serverType, maxMemory, path });
    if (gamemode || onlineMode !== undefined) {
      try {
        const props = ServerManager.readServerProperties(server.id);
        if (gamemode) props['gamemode'] = String(gamemode);
        if (onlineMode !== undefined) props['online-mode'] = onlineMode ? 'true' : 'false';
        ServerManager.writeServerPropertiesById(server.id, props);
      } catch (_) {}
    }

    // Download server jar with progress tracking
    downloadServer(serverType, version, server.id, (progress) => {
      ServerManager.updateDownloadProgress(server.id, progress);
    })
      .then(() => {
        ServerManager.setDownloadComplete(server.id);
        console.log(`Server ${server.id} download complete`);
      })
      .catch(err => {
        ServerManager.setDownloadError(server.id, err);
        console.error(`Server ${server.id} download failed:`, err);
      });

    res.status(201).json(server);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deploy Modrinth modpack
router.post('/modpack', async (req, res) => {
  try {
    const { projectId, versionId, name, gameVersion, maxMemory, gamemode, onlineMode } = req.body;
    if (!projectId || !name) {
      return res.status(400).json({ error: 'Missing projectId or name' });
    }

    const server = ServerManager.create({
      name,
      version: gameVersion || 'modpack',
      serverType: 'modpack',
      maxMemory: maxMemory || 4096,
    });

    if (gamemode || onlineMode !== undefined) {
      try {
        const props = ServerManager.readServerProperties(server.id);
        if (gamemode) props['gamemode'] = String(gamemode);
        if (onlineMode !== undefined) props['online-mode'] = onlineMode ? 'true' : 'false';
        ServerManager.writeServerPropertiesById(server.id, props);
      } catch (_) {}
    }

    deployModpack(projectId, versionId, server.id, (progress) => {
      ServerManager.updateDownloadProgress(server.id, progress);
    })
      .then(() => {
        ServerManager.setDownloadComplete(server.id);
        console.log(`Modpack server ${server.id} deployed`);
      })
      .catch(err => {
        ServerManager.setDownloadError(server.id, err);
        console.error(`Modpack server ${server.id} failed:`, err);
      });

    res.status(201).json(server);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create server with custom jar upload
router.post('/upload', upload.single('serverJar'), async (req, res) => {
  try {
    const { name, maxMemory, gamemode, onlineMode } = req.body;
    const file = req.file;

    if (!name) {
      return res.status(400).json({ error: '请输入服务器名称' });
    }

    if (!file) {
      return res.status(400).json({ error: '请上传服务端 jar 文件' });
    }

    // Create server with custom type
    const server = ServerManager.create({
      name,
      version: 'custom',
      serverType: 'custom',
      maxMemory: maxMemory ? parseInt(maxMemory) : 2048
    });

    if (gamemode || onlineMode !== undefined) {
      try {
        const props = ServerManager.readServerProperties(server.id);
        if (gamemode) props['gamemode'] = String(gamemode);
        if (onlineMode !== undefined) props['online-mode'] = (onlineMode === 'true' || onlineMode === true) ? 'true' : 'false';
        ServerManager.writeServerPropertiesById(server.id, props);
      } catch (_) {}
    }

    // Move uploaded file to server directory
    // Use copyFile + unlink instead of renameSync to avoid cross-device EXDEV on Windows
    const serverDir = resolveServerDir(server);
    const originalName = decodeUploadFilename(file.originalname);
    const destPath = join(serverDir, originalName);
    try {
      renameSync(file.path, destPath);
    } catch (e) {
      if (e.code === 'EXDEV') {
        copyFileSync(file.path, destPath);
        unlinkSync(file.path);
      } else {
        throw e;
      }
    }

    // For zip files: respond immediately, extract in background so UI isn't stuck
    if (originalName.toLowerCase().endsWith('.zip')) {
      console.log(`Extracting zip: ${originalName} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      res.status(201).json(server);

      // Defer extraction to next tick — don't block the event loop
      setImmediate(() => {
        try {
          const onExtracted = (err) => {
            if (err) {
              console.log('Native extract failed, using AdmZip:', err.message);
              extractWithAdmZip(destPath, serverDir, server.id);
              return;
            }
            console.log('Extracted archive successfully');
            try { unlinkSync(destPath); } catch {}
            try { ServerManager.unwrapSingleSubdir(serverDir); } catch {}
            ServerManager.setDownloadComplete(server.id);
          };

          if (process.platform === 'win32') {
            execFile('tar', ['-xf', destPath, '-C', serverDir], { timeout: 120000, windowsHide: true }, onExtracted);
          } else if (process.platform === 'darwin') {
            execFile('ditto', ['-x', '-k', destPath, serverDir], { timeout: 120000 }, onExtracted);
          } else {
            execFile('unzip', ['-oq', destPath, '-d', serverDir], { timeout: 120000 }, onExtracted);
          }
        } catch (err) {
          console.error('Extraction error:', err);
          ServerManager.setDownloadError(server.id, err);
        }
      });
      return;
    }

    // Non-zip: mark as ready
    ServerManager.setDownloadComplete(server.id);
    console.log(`Server ${server.id} created with custom file: ${originalName}`);
    res.status(201).json(server);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

function extractWithAdmZip(zipPath, destDir, serverId) {
  setImmediate(() => {
    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(destDir, true);
      unlinkSync(zipPath);
      try { ServerManager.unwrapSingleSubdir(destDir); } catch {}
      console.log('Extracted via AdmZip');
      ServerManager.setDownloadComplete(serverId);
    } catch (err) {
      console.error('AdmZip extraction failed:', err);
      ServerManager.setDownloadError(serverId, err);
    }
  });
}

// Handle multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件太大，最大支持 1GB' });
    }
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  }
  next(err);
});

// Start server
router.post('/:id/start', async (req, res) => {
  try {
    const result = await ServerManager.start(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop server
router.post('/:id/stop', async (req, res) => {
  try {
    const result = await ServerManager.stop(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force stop server (for stuck servers)
router.post('/:id/force-stop', async (req, res) => {
  try {
    const result = await ServerManager.forceStop(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restart server
router.post('/:id/restart', async (req, res) => {
  try {
    const result = await ServerManager.restart(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update server config
router.patch('/:id/config', (req, res) => {
  try {
    const result = ServerManager.updateConfig(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get server.properties
router.get('/:id/properties', (req, res) => {
  try {
    const props = ServerManager.readServerProperties(req.params.id);
    res.json(props);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update server.properties
router.put('/:id/properties', (req, res) => {
  try {
    const props = ServerManager.writeServerPropertiesById(req.params.id, req.body);
    res.json(props);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete server
router.delete('/:id', (req, res) => {
  try {
    ServerManager.delete(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { router as serverRoutes };
