import { Router } from 'express';
import multer from 'multer';
import { PluginManager } from '../modules/plugin/PluginManager.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// List plugins
router.get('/:id/plugins', (req, res) => {
  const plugins = PluginManager.list(req.params.id);
  res.json(plugins);
});

// Upload plugin
router.post('/:id/plugins', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.originalname.endsWith('.jar')) {
      return res.status(400).json({ error: 'Only .jar files allowed' });
    }
    const plugin = PluginManager.upload(req.params.id, req.file);
    res.status(201).json(plugin);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle plugin
router.patch('/:id/plugins/:pid', (req, res) => {
  try {
    const { enabled } = req.body;
    const plugin = PluginManager.toggle(req.params.id, req.params.pid, enabled);
    res.json(plugin);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete plugin
router.delete('/:id/plugins/:pid', (req, res) => {
  try {
    PluginManager.delete(req.params.id, req.params.pid);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { router as pluginRoutes };
