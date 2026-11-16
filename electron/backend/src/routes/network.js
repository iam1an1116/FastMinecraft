import { Router } from 'express';
import { NetworkManager } from '../modules/network/NetworkManager.js';

const router = Router();

// Get available providers
router.get('/providers', (req, res) => {
  res.json(NetworkManager.getAvailableProviders());
});

// Get sakura detection status
router.get('/sakura-status', (req, res) => {
  res.json(NetworkManager.getSakuraStatus());
});

// Set custom frpc path
router.post('/frpc-path', (req, res) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: '请输入路径' });
    NetworkManager.setCustomFrpcPath(path);
    res.json({ ok: true, ...NetworkManager.getSakuraStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Sakura Frp (natfrp) ===

// Save API token
router.post('/natfrp/token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: '请输入 Token' });

    // Clean token - remove whitespace, quotes
    const cleanToken = token.trim().replace(/^["']|["']$/g, '');

    // Verify token by getting user info
    const info = await NetworkManager.natfrpGetUserInfo(cleanToken);
    NetworkManager.saveNatfrpToken(cleanToken);
    res.json({ ok: true, user: info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get current token status
router.get('/natfrp/token', (req, res) => {
  const token = NetworkManager.getNatfrpToken();
  res.json({ hasToken: !!token });
});

// Get available nodes
router.get('/natfrp/nodes', async (req, res) => {
  try {
    const token = NetworkManager.getNatfrpToken();
    if (!token) return res.status(400).json({ error: '请先设置 API Token' });
    const nodes = await NetworkManager.natfrpGetNodes(token);
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create tunnel
router.post('/tunnel/:id/start', async (req, res) => {
  try {
    const { provider, port, nodeId, token: userToken, name } = req.body;
    const result = await NetworkManager.startTunnel(req.params.id, provider, port, {
      nodeId, token: userToken, name
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop tunnel
router.post('/tunnel/:id/stop', async (req, res) => {
  try {
    const result = await NetworkManager.stopTunnel(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get tunnel status
router.get('/tunnel/:id/status', async (req, res) => {
  const status = NetworkManager.getTunnelStatus(req.params.id);
  // If tunnel is running but missing address info, refresh from API
  if (status.running && !status.connectAddress) {
    await NetworkManager.refreshTunnelInfo(req.params.id);
    res.json(NetworkManager.getTunnelStatus(req.params.id));
  } else {
    res.json(status);
  }
});

export { router as networkRoutes };
