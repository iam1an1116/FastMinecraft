import { Router } from 'express';
import multer from 'multer';
import { join } from 'path';
import { renameSync, unlinkSync } from 'fs';
import AdmZip from 'adm-zip';
import os from 'os';
import { ServerManager } from '../modules/server/ServerManager.js';
import { downloadServer } from '../modules/version/VersionDownloader.js';

const router = Router();

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // We'll set the destination after creating the server
    cb(null, '/tmp');
  },
  filename: (req, file, cb) => {
    // Keep the original filename
    cb(null, file.originalname);
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

// Get download status
router.get('/:id/download-status', (req, res) => {
  const status = ServerManager.getDownloadStatus(req.params.id);
  res.json(status);
});

// Create server
router.post('/', async (req, res) => {
  try {
    const { name, version, serverType, maxMemory, path } = req.body;
    if (!name || !version || !serverType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const server = ServerManager.create({ name, version, serverType, maxMemory, path });

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

// Create server with custom jar upload
router.post('/upload', upload.single('serverJar'), async (req, res) => {
  try {
    const { name, maxMemory } = req.body;
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

    // Move uploaded file to server directory
    const destPath = join(server.path, file.originalname);
    renameSync(file.path, destPath);

    // If it's a zip file, extract it
    if (file.originalname.endsWith('.zip')) {
      console.log(`Extracting zip file: ${file.originalname}`);
      const zip = new AdmZip(destPath);
      zip.extractAllTo(server.path, true);
      // Delete the zip file after extraction
      unlinkSync(destPath);
      console.log(`Extracted and removed zip file`);
    }

    // Mark as ready (no need to download)
    ServerManager.setDownloadComplete(server.id);

    console.log(`Server ${server.id} created with custom file: ${file.originalname}`);
    res.status(201).json(server);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

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
