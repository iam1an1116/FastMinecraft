import { Router } from 'express';
import { MonitorManager } from '../modules/monitor/MonitorManager.js';

const router = Router();

// Get server stats
router.get('/:id/stats', (req, res) => {
  const stats = MonitorManager.getServerStats(req.params.id);
  res.json(stats);
});

export { router as statsRoutes };
