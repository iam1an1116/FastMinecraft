import { Router } from 'express';
import multer from 'multer';
import { ModManager } from '../modules/mod/ModManager.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// List mods
router.get('/:id/mods', (req, res) => {
  const mods = ModManager.list(req.params.id);
  res.json(mods);
});

// Upload mod
router.post('/:id/mods', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.originalname.endsWith('.jar')) {
      return res.status(400).json({ error: 'Only .jar files allowed' });
    }
    const loader = req.body.loader || 'fabric';
    const mod = ModManager.upload(req.params.id, req.file, loader);
    res.status(201).json(mod);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle mod
router.patch('/:id/mods/:mid', (req, res) => {
  try {
    const { enabled } = req.body;
    const mod = ModManager.toggle(req.params.id, req.params.mid, enabled);
    res.json(mod);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete mod
router.delete('/:id/mods/:mid', (req, res) => {
  try {
    ModManager.delete(req.params.id, req.params.mid);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { router as modRoutes };
