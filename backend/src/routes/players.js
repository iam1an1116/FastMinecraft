import { Router } from 'express';
import { ServerManager } from '../modules/server/ServerManager.js';
import { MonitorManager } from '../modules/monitor/MonitorManager.js';

const router = Router();

// Get online players
router.get('/:id/players', (req, res) => {
  const players = MonitorManager.getPlayers(req.params.id);
  res.json(players);
});

function sanitizePlayerName(name) {
  // Strip newlines and carriage returns to prevent command injection
  return String(name).replace(/[\r\n]+/g, '');
}

// Kick player
router.post('/:id/players/kick', (req, res) => {
  try {
    const { player, reason } = req.body;
    const safePlayer = sanitizePlayerName(player);
    const safeReason = reason ? sanitizePlayerName(reason) : '';
    ServerManager.sendCommand(req.params.id, `kick ${safePlayer} ${safeReason}`);
    res.json({ kicked: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ban player
router.post('/:id/players/ban', (req, res) => {
  try {
    const { player, reason } = req.body;
    const safePlayer = sanitizePlayerName(player);
    const safeReason = reason ? sanitizePlayerName(reason) : '';
    ServerManager.sendCommand(req.params.id, `ban ${safePlayer} ${safeReason}`);
    res.json({ banned: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// OP player
router.post('/:id/players/op', (req, res) => {
  try {
    const { player } = req.body;
    ServerManager.sendCommand(req.params.id, `op ${sanitizePlayerName(player)}`);
    res.json({ opped: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { router as playerRoutes };
