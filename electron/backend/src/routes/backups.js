import { Router } from 'express';
import { BackupManager } from '../modules/backup/BackupManager.js';

const router = Router();

// List backups
router.get('/:id/backups', (req, res) => {
  const backups = BackupManager.list(req.params.id);
  res.json(backups);
});

// Create backup
router.post('/:id/backups', (req, res) => {
  try {
    const type = req.body.type || 'world';
    const backup = BackupManager.create(req.params.id, type);
    res.status(201).json(backup);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore backup
router.post('/:id/backups/:bid/restore', (req, res) => {
  try {
    const result = BackupManager.restore(req.params.bid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete backup
router.delete('/:id/backups/:bid', (req, res) => {
  try {
    BackupManager.delete(req.params.bid);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { router as backupRoutes };
