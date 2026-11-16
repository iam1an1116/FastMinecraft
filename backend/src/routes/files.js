import { Router } from 'express';
import multer from 'multer';
import { FileManager } from '../modules/file-manager/FileManager.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// List files
router.get('/:id/files', (req, res) => {
  try {
    const subPath = req.query.path || '';
    const files = FileManager.list(req.params.id, subPath);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read file
router.get('/:id/files/*', (req, res) => {
  try {
    const filePath = req.params[0];
    const content = FileManager.readFile(req.params.id, filePath);
    res.type('text/plain').send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload file
router.post('/:id/files', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const subPath = req.body.path || '';
    const result = FileManager.upload(req.params.id, subPath, req.file);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Write file content
router.put('/:id/files/*', (req, res) => {
  try {
    const filePath = req.params[0];
    const { content } = req.body;
    FileManager.writeFile(req.params.id, filePath, content);
    res.json({ written: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rename file
router.patch('/:id/files/*', (req, res) => {
  try {
    const filePath = req.params[0];
    const { newName } = req.body;
    const result = FileManager.rename(req.params.id, filePath, newName);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete file
router.delete('/:id/files/*', (req, res) => {
  try {
    const filePath = req.params[0];
    FileManager.delete(req.params.id, filePath);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { router as fileRoutes };
